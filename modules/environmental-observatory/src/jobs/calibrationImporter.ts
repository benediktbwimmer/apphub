import { Readable } from 'node:stream';

import {
  createJobHandler,
  inheritModuleSettings,
  inheritModuleSecrets,
  type FilestoreCapability,
  type FilestoreDownloadStream,
  type JobContext
} from '@apphub/module-sdk';
import { z } from 'zod';

import {
  DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY,
  ensureResolvedBackendId
} from '../runtime/filestore';
import {
  buildMetastoreRecordPayload,
  calibrationFileSchema,
  deriveMetastoreKey,
  normalizeCalibrationRecord
} from '../runtime/calibrations';
import { createObservatoryEventPublisher, toJsonRecord } from '../runtime/events';
import { selectEventBus, selectFilestore, selectMetastore } from '../runtime/capabilities';
import type { ObservatoryModuleSecrets, ObservatoryModuleSettings } from '../runtime/settings';

const parametersSchema = z
  .object({
    calibrationPath: z.string().min(1, 'calibrationPath is required'),
    calibrationNodeId: z.number().int().optional(),
    checksum: z.string().optional()
  })
  .strip();

export type CalibrationImporterParameters = z.infer<typeof parametersSchema>;

interface CalibrationImporterResult {
  calibrationId: string;
  instrumentId: string;
  effectiveAt: string;
  metastoreNamespace: string;
  metastoreRecordKey: string;
  metastoreVersion: number | null;
  assets: Array<{
    assetId: string;
    partitionKey: string;
    producedAt: string;
    payload: Record<string, unknown>;
  }>;
}

type CalibrationImporterContext = JobContext<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets,
  CalibrationImporterParameters
>;

async function streamToString(stream: FilestoreDownloadStream): Promise<string> {
  const candidate = stream as ReadableStream<Uint8Array> & { getReader?: () => ReadableStreamDefaultReader<Uint8Array> };
  if (typeof candidate?.getReader === 'function') {
    const reader = candidate.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        chunks.push(value);
      }
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
  }

  const nodeStream = stream as Readable;
  const buffers: Buffer[] = [];
  for await (const chunk of nodeStream) {
    buffers.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(buffers).toString('utf8');
}

export const calibrationImporterJob = createJobHandler<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets,
  CalibrationImporterResult,
  CalibrationImporterParameters,
  ['filestore', 'events.default', 'metastore.calibrations']
>({
  name: 'observatory-calibration-importer',
  settings: inheritModuleSettings(),
  secrets: inheritModuleSecrets(),
  requires: ['filestore', 'events.default', 'metastore.calibrations'] as const,
  parameters: {
    resolve: (raw) => parametersSchema.parse(raw ?? {})
  },
  handler: async (context: CalibrationImporterContext): Promise<CalibrationImporterResult> => {
    const filestoreCapability = selectFilestore(context.capabilities);
    if (!filestoreCapability) {
      throw new Error('Filestore capability is required for the calibration importer job');
    }
    const filestore: FilestoreCapability = filestoreCapability;
    const eventsCapability = selectEventBus(context.capabilities, 'default');
    if (!eventsCapability) {
      throw new Error('Event bus capability is required for the calibration importer job');
    }

    const metastore = selectMetastore(context.capabilities, 'calibrations');
    if (!metastore) {
      throw new Error('Calibration metastore capability is not configured');
    }

    const principal = context.settings.principals.calibrationImporter?.trim() || undefined;
    const backendContext = {
      filestoreBackendId: context.settings.filestore.backendId,
      filestoreBackendKey: context.settings.filestore.backendKey ?? DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY
    } satisfies {
      filestoreBackendId?: number | null;
      filestoreBackendKey?: string | null;
    };
    const backendMountId = await ensureResolvedBackendId(filestore, backendContext);

    const calibrationPath = context.parameters.calibrationPath.replace(/^\/+/, '');
    const calibrationsPrefix = context.settings.filestore.calibrationsPrefix.replace(/^\/+|\/+$/g, '');
    if (calibrationsPrefix && !calibrationPath.startsWith(calibrationsPrefix)) {
      context.logger.warn('Calibration file outside configured prefix; skipping import', {
        calibrationPath,
        calibrationsPrefix
      });
      return {
        calibrationId: '',
        instrumentId: '',
        effectiveAt: '',
        metastoreNamespace: context.settings.calibrations.namespace,
        metastoreRecordKey: '',
        metastoreVersion: null,
        assets: []
      } satisfies CalibrationImporterResult;
    }
    const calibrationNode = await filestore.getNodeByPath({
      backendMountId,
      path: calibrationPath,
      principal
    });

    const download = await filestore.downloadFile({
      nodeId: calibrationNode.id,
      principal
    });

    const content = await streamToString(download.stream);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(
        `Calibration payload at ${calibrationPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const calibrationFile = calibrationFileSchema.parse(parsed);
    const normalized = normalizeCalibrationRecord(calibrationFile, content);
    const metastoreKey = deriveMetastoreKey(normalized);

    await metastore.upsertRecord({
      key: metastoreKey,
      metadata: buildMetastoreRecordPayload(normalized),
      principal
    });

    const recordResult = await metastore.getRecord({ key: metastoreKey, principal });
    const metastoreVersion = recordResult?.version ?? null;

    const publisher = createObservatoryEventPublisher({
      capability: eventsCapability,
      source: 'observatory.calibration-importer'
    });

    const generatedAt = new Date().toISOString();

    try {
      await publisher.publish({
        type: 'observatory.calibration.updated',
        occurredAt: generatedAt,
        payload: {
          calibrationId: normalized.calibrationId,
          instrumentId: normalized.instrumentId,
          effectiveAt: normalized.effectiveAt,
          createdAt: normalized.createdAt,
          revision: normalized.revision ?? undefined,
          offsets: normalized.offsets,
          scales: normalized.scales ?? undefined,
          notes: normalized.notes ?? undefined,
          metadata: normalized.metadata,
          sourcePath: calibrationPath,
          metastoreVersion: metastoreVersion ?? undefined
        },
        metadata: toJsonRecord({
          calibrationPath,
          calibrationNodeId: calibrationNode.id ?? null,
          checksum: context.parameters.checksum ?? calibrationNode.checksum ?? normalized.sourceChecksum
        })
      });
    } finally {
      await publisher.close().catch(() => undefined);
    }

    return {
      calibrationId: normalized.calibrationId,
      instrumentId: normalized.instrumentId,
      effectiveAt: normalized.effectiveAt,
      metastoreNamespace: context.settings.calibrations.namespace,
      metastoreRecordKey: metastoreKey,
      metastoreVersion,
      assets: [
        {
          assetId: 'observatory.calibration.instrument',
          partitionKey: normalized.calibrationId,
          producedAt: generatedAt,
          payload: {
            calibrationId: normalized.calibrationId,
            instrumentId: normalized.instrumentId,
            effectiveAt: normalized.effectiveAt,
            createdAt: normalized.createdAt,
            revision: normalized.revision,
            offsets: normalized.offsets,
            scales: normalized.scales,
            notes: normalized.notes,
            metadata: normalized.metadata,
            sourcePath: calibrationPath,
            sourceChecksum: normalized.sourceChecksum,
            metastoreNamespace: context.settings.calibrations.namespace,
            metastoreRecordKey: metastoreKey,
            metastoreVersion
          }
        }
      ]
    } satisfies CalibrationImporterResult;
  }
});

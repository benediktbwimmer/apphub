import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  CapabilityRequestError,
  createJobHandler,
  enforceScratchOnlyWrites,
  inheritModuleSettings,
  inheritModuleSecrets,
  sanitizeIdentifier,
  selectFilestore,
  selectMetastore,
  toTemporalKey,
  type FilestoreCapability,
  type JobContext,
  type MetastoreCapability
} from '@apphub/module-sdk';
import { ensureFilestoreHierarchy, ensureResolvedBackendId } from '@apphub/module-sdk';
import { DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY } from '../runtime';
import {
  applyCalibrationAdjustments,
  fetchCalibrationById,
  lookupCalibration,
  type CalibrationLookupConfig,
  type CalibrationLookupResult,
  type CalibrationSnapshot
} from '../runtime/calibrations';
import { toJsonRecord } from '../runtime/events';
import type { ObservatorySecrets, ObservatorySettings } from '../config/settings';

enforceScratchOnlyWrites();

const MAX_FILES_LIMIT = 200;
const INGEST_RECORD_TYPE = 'observatory.ingest.file';

const parametersSchema = z
  .object({
    minute: z.string().min(1, 'minute parameter is required'),
    maxFiles: z.coerce.number().int().positive().max(MAX_FILES_LIMIT).optional(),
    commandPath: z.string().min(1).optional()
  })
  .strip();

export type MinutePreprocessorParameters = z.infer<typeof parametersSchema>;

export interface MinutePreprocessorFile {
  path: string;
  nodeId: number | null;
  site: string | null;
  instrumentId: string | null;
  rows: number;
  sizeBytes: number | null;
  checksum: string | null;
  calibration: CalibrationReference | null;
}

export interface CalibrationReference {
  calibrationId: string;
  instrumentId: string;
  effectiveAt: string;
  metastoreVersion: number | null;
}

export interface RawAssetPayload {
  partitionKey: string;
  minute: string;
  backendMountId: number;
  stagingPrefix: string;
  stagingMinutePrefix: string;
  files: MinutePreprocessorFile[];
  instrumentCount: number;
  recordCount: number;
  normalizedAt: string;
  calibrationsApplied: CalibrationReference[];
}

export interface MinutePreprocessorJobResult {
  partitionKey: string;
  normalized: RawAssetPayload;
  assets: Array<{
    assetId: string;
    partitionKey: string;
    producedAt: string;
    payload: RawAssetPayload;
  }>;
}

type MinutePreprocessorContext = JobContext<
  ObservatorySettings,
  ObservatorySecrets,
  MinutePreprocessorParameters
>;

type CachedCalibration = {
  reference: CalibrationReference | null;
  lookup: CalibrationLookupResult;
  warnedMissing: boolean;
  warnedFuture: boolean;
};

function normalizePrefix(prefix: string): string {
  return prefix.replace(/\/+$/g, '');
}

function sanitizeRecordKey(value: string): string {
  return sanitizeIdentifier(value, { allow: /[0-9A-Za-z._/\-]/ });
}

function deriveMinuteSuffixes(minute: string): string[] {
  const trimmed = minute.trim();
  const suffixes = new Set<string>();
  if (trimmed) {
    suffixes.add(`${trimmed}.csv`);
  }
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (digits.length >= 10) {
    suffixes.add(`${digits}.csv`);
  }
  return Array.from(suffixes);
}

function nodeMatchesMinute(
  path: string,
  metadata: Record<string, unknown> | undefined,
  minute: string,
  suffixes: string[]
): boolean {
  const filename = path.split('/').pop() ?? '';
  const normalizedMinute = toTemporalKey(minute);
  const minuteCandidates = new Set<string>();
  if (metadata) {
    const raw = metadata.minute ?? metadata.minuteKey ?? metadata.minute_key ?? metadata.minuteIso ?? metadata.minute_iso;
    if (typeof raw === 'string' && raw.trim().length > 0) {
      minuteCandidates.add(raw.trim());
    }
  }
  if (minuteCandidates.has(minute) || minuteCandidates.has(normalizedMinute)) {
    return true;
  }
  return suffixes.some((suffix) => filename.endsWith(suffix));
}

async function readStreamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else if (chunk instanceof Buffer) {
      chunks.push(chunk);
    } else {
      chunks.push(Buffer.from(chunk));
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseCsv(content: string): { rows: number; site: string | null } {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return { rows: 0, site: null };
  }
  const headers = lines[0]?.split(',').map((entry) => entry.trim()) ?? [];
  const siteIndex = headers.indexOf('site');
  let site: string | null = null;
  if (siteIndex >= 0) {
    for (let index = 1; index < lines.length; index += 1) {
      const parts = lines[index]?.split(',') ?? [];
      const candidate = parts[siteIndex]?.trim();
      if (candidate) {
        site = candidate;
        break;
      }
    }
  }
  return {
    rows: lines.length - 1,
    site
  };
}

function collectCalibrationReference(snapshot: CalibrationSnapshot | null): CalibrationReference | null {
  if (!snapshot) {
    return null;
  }
  return {
    calibrationId: snapshot.calibrationId,
    instrumentId: snapshot.instrumentId,
    effectiveAt: snapshot.effectiveAt,
    metastoreVersion: snapshot.metastoreVersion ?? null
  } satisfies CalibrationReference;
}

function serializeCalibration(reference: CalibrationReference | null): Record<string, unknown> | null {
  if (!reference) {
    return null;
  }
  return {
    calibrationId: reference.calibrationId,
    instrumentId: reference.instrumentId,
    effectiveAt: reference.effectiveAt,
    metastoreVersion: reference.metastoreVersion
  } satisfies Record<string, unknown>;
}

function collectAppliedCalibrations(files: MinutePreprocessorFile[]): CalibrationReference[] {
  const map = new Map<string, CalibrationReference>();
  for (const file of files) {
    if (file.calibration && !map.has(file.calibration.calibrationId)) {
      map.set(file.calibration.calibrationId, file.calibration);
    }
  }
  return Array.from(map.values());
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

async function resolveCalibration(
  context: MinutePreprocessorContext,
  cache: Map<string, CachedCalibration>,
  lookupConfig: CalibrationLookupConfig | null,
  instrumentId: string,
  asOf: string
): Promise<CalibrationReference | null> {
  if (!lookupConfig) {
    return null;
  }

  const trimmed = instrumentId.trim();
  if (!trimmed) {
    return null;
  }

  const existing = cache.get(trimmed);
  if (existing) {
    maybeWarnCalibration(context, trimmed, existing, asOf);
    return existing.reference;
  }

  try {
    const lookup = await lookupCalibration(lookupConfig, trimmed, asOf, { limit: 5 });
    const reference = collectCalibrationReference(lookup.active);
    const cached: CachedCalibration = {
      reference,
      lookup,
      warnedMissing: !reference,
      warnedFuture: false
    };
    cache.set(trimmed, cached);
    maybeWarnCalibration(context, trimmed, cached, asOf);
    return reference;
  } catch (error) {
    context.logger.error('Calibration lookup failed', {
      instrumentId: trimmed,
      minute: asOf,
      error: error instanceof Error ? error.message : String(error)
    });
    const fallback: CachedCalibration = {
      reference: null,
      lookup: { active: null, latest: null, all: [] },
      warnedMissing: true,
      warnedFuture: false
    };
    cache.set(trimmed, fallback);
    return null;
  }
}

function maybeWarnCalibration(
  context: MinutePreprocessorContext,
  instrumentId: string,
  entry: CachedCalibration,
  asOf: string
): void {
  if (!entry.reference && !entry.warnedMissing) {
    entry.warnedMissing = true;
    context.logger.warn('No calibration found for instrument', {
      instrumentId,
      minute: asOf
    });
  }

  const latest = entry.lookup.latest;
  if (!latest) {
    return;
  }

  if (entry.reference) {
    const latestMs = Date.parse(latest.effectiveAt);
    const referenceMs = Date.parse(entry.reference.effectiveAt);
    const asOfMs = Date.parse(asOf);
    if (!entry.warnedFuture && Number.isFinite(latestMs) && Number.isFinite(asOfMs) && latestMs > asOfMs) {
      entry.warnedFuture = true;
      context.logger.info('Newer calibration available for instrument', {
        instrumentId,
        activeCalibrationEffectiveAt: entry.reference.effectiveAt,
        latestEffectiveAt: latest.effectiveAt
      });
    }
    if (!entry.warnedFuture && Number.isFinite(referenceMs) && Number.isFinite(asOfMs) && referenceMs > asOfMs) {
      entry.warnedFuture = true;
      context.logger.info('Active calibration effectiveAt in future', {
        instrumentId,
        effectiveAt: entry.reference.effectiveAt,
        minute: asOf
      });
    }
    return;
  }

  if (!entry.warnedFuture) {
    const latestMs = Date.parse(latest.effectiveAt);
    const asOfMs = Date.parse(asOf);
    if (Number.isFinite(latestMs) && Number.isFinite(asOfMs) && latestMs > asOfMs) {
      entry.warnedFuture = true;
      context.logger.info('Calibration effectiveAt is in the future', {
        instrumentId,
        effectiveAt: latest.effectiveAt,
        minute: asOf
      });
    }
  }
}

async function upsertIngestionRecord(
  capability: MetastoreCapability | undefined,
  key: string,
  metadata: Record<string, unknown>,
  principal?: string
): Promise<void> {
  if (!capability) {
    return;
  }
  const sanitized = sanitizeRecordKey(key);
  if (!sanitized) {
    return;
  }
  await capability.upsertRecord({
    key: sanitized,
    metadata: {
      ...metadata,
      type: INGEST_RECORD_TYPE
    },
    principal
  });
}

function buildCalibrationAdjustments(reference: CalibrationReference | null, snapshot: CalibrationSnapshot | null) {
  if (!reference || !snapshot) {
    return { offsets: {}, scales: null } as const;
  }
  return {
    offsets: snapshot.offsets,
    scales: snapshot.scales
  } as const;
}

function normalizeArchivePath(
  archivePrefix: string,
  instrumentId: string | null,
  minute: string,
  filename: string
): string {
  const normalizedPrefix = normalizePrefix(archivePrefix);
  const sanitizedInstrument = sanitizeIdentifier(instrumentId?.trim() ?? 'unknown');
  const minuteKey = toTemporalKey(minute);
  return `${normalizedPrefix}/${sanitizedInstrument}/${minuteKey}/${filename}`;
}

function buildChecksum(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export const minutePreprocessorJob = createJobHandler<
  ObservatorySettings,
  ObservatorySecrets,
  MinutePreprocessorJobResult,
  MinutePreprocessorParameters,
  ['filestore', 'metastore.reports']
>({
  name: 'observatory-minute-preprocessor',
  settings: inheritModuleSettings(),
  secrets: inheritModuleSecrets(),
  requires: ['filestore', 'metastore.reports'] as const,
  parameters: {
    resolve: (raw) => parametersSchema.parse(raw ?? {})
  },
  handler: async (context: MinutePreprocessorContext): Promise<MinutePreprocessorJobResult> => {
    const filestoreCapabilityCandidate = selectFilestore(context.capabilities);
    if (!filestoreCapabilityCandidate) {
      throw new Error('Filestore capability is required for the inbox normalizer job');
    }
    const filestore: FilestoreCapability = filestoreCapabilityCandidate;
    const minute = context.parameters.minute.trim();
    if (!minute) {
      throw new Error('minute parameter is required');
    }

    const maxFiles = context.parameters.maxFiles ?? context.settings.ingest.maxFiles;
    if (!Number.isFinite(maxFiles) || maxFiles <= 0 || maxFiles > MAX_FILES_LIMIT) {
      throw new Error(`maxFiles must be between 1 and ${MAX_FILES_LIMIT}`);
    }

    const principal = context.settings.principals.minutePreprocessor;
    const normalizedPrincipal = principal?.trim() || undefined;

    const backendMountId = await ensureResolvedBackendId(filestore, {
      filestoreBackendId: context.settings.filestore.backendId,
      filestoreBackendKey: context.settings.filestore.backendKey ?? DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY
    });

    const inboxPrefix = normalizePrefix(context.settings.filestore.inboxPrefix);
    const stagingPrefix = normalizePrefix(context.settings.filestore.stagingPrefix);
    const archivePrefix = normalizePrefix(context.settings.filestore.archivePrefix);

    const shouldCopyToStaging = stagingPrefix !== inboxPrefix;
    const shouldArchive = archivePrefix !== inboxPrefix;

    if (shouldCopyToStaging) {
      await ensureFilestoreHierarchy(filestore, backendMountId, stagingPrefix, normalizedPrincipal);
    }
    if (shouldArchive) {
      await ensureFilestoreHierarchy(filestore, backendMountId, archivePrefix, normalizedPrincipal);
    }

    const commandPath = context.parameters.commandPath?.trim() ?? null;
    if (commandPath && !commandPath.startsWith(`${inboxPrefix}/`)) {
      context.logger.info('Command path outside inbox prefix; skipping', {
        commandPath,
        inboxPrefix
      });
      return {
        partitionKey: minute,
        normalized: {
          partitionKey: minute,
          minute,
          backendMountId,
          stagingPrefix,
          stagingMinutePrefix: `${stagingPrefix}/${toTemporalKey(minute)}`,
          files: [],
          instrumentCount: 0,
          recordCount: 0,
          normalizedAt: new Date().toISOString(),
          calibrationsApplied: []
        },
        assets: []
      } satisfies MinutePreprocessorJobResult;
    }

    const ingestMetastore = selectMetastore(context.capabilities, 'reports');
    const calibrationMetastore = selectMetastore(context.capabilities, 'calibrations');

    const calibrationConfig = calibrationMetastore
      ? ({
          namespace: context.settings.calibrations.namespace,
          metastore: calibrationMetastore,
          principal: normalizedPrincipal
        } satisfies CalibrationLookupConfig)
      : null;

    const calibrationCache = new Map<string, CachedCalibration>();
    const minuteSuffixes = deriveMinuteSuffixes(minute);

    async function listCandidateNodes() {
      if (commandPath) {
        try {
          const node = await filestore.getNodeByPath({ backendMountId, path: commandPath, principal: normalizedPrincipal });
          const metadata = (node.metadata ?? {}) as Record<string, unknown>;
          if (nodeMatchesMinute(node.path, metadata, minute, minuteSuffixes)) {
            return [node];
          }
          return [];
        } catch (error) {
          if (error instanceof CapabilityRequestError && error.status === 404) {
            return [];
          }
          throw error;
        }
      }

      const candidates: Awaited<ReturnType<typeof filestore.listNodes>>['nodes'] = [];
      let offset: number | undefined = 0;
      const limit = Math.min(Math.max(maxFiles * 2, 50), MAX_FILES_LIMIT * 2);

      while (candidates.length < maxFiles) {
        const result = await filestore.listNodes({
          backendMountId,
          path: inboxPrefix,
          limit,
          offset,
          depth: 1,
          kinds: ['file'],
          principal: normalizedPrincipal
        });

        for (const node of result.nodes) {
          const metadata = (node.metadata ?? {}) as Record<string, unknown>;
          if (nodeMatchesMinute(node.path, metadata, minute, minuteSuffixes)) {
            candidates.push(node);
          }
          if (candidates.length >= maxFiles) {
            break;
          }
        }

        if (!result.nextOffset || candidates.length >= maxFiles) {
          break;
        }
        offset = result.nextOffset;
        if (offset === null || offset === undefined) {
          break;
        }
      }

      return candidates.slice(0, maxFiles);
    }

    const nodes = await listCandidateNodes();
    if (nodes.length === 0) {
      context.logger.info('No inbox files found for minute', { minute });
      return {
        partitionKey: minute,
        normalized: {
          partitionKey: minute,
          minute,
          backendMountId,
          stagingPrefix,
          stagingMinutePrefix: `${stagingPrefix}/${toTemporalKey(minute)}`,
          files: [],
          instrumentCount: 0,
          recordCount: 0,
          normalizedAt: new Date().toISOString(),
          calibrationsApplied: []
        },
        assets: []
      } satisfies MinutePreprocessorJobResult;
    }

    const stagingMinutePrefix = `${stagingPrefix}/${toTemporalKey(minute)}`;
    if (shouldCopyToStaging) {
      await ensureFilestoreHierarchy(filestore, backendMountId, stagingMinutePrefix, normalizedPrincipal);
    }

    const observedFiles: MinutePreprocessorFile[] = [];
    const instrumentation = new Map<string, string | null>();
    let totalRows = 0;
    let normalizedAt = new Date().toISOString();

    for (const node of nodes) {
      const filename = node.path.split('/').pop() ?? 'file.csv';
      const stagingTargetPath = `${stagingMinutePrefix}/${filename}`;

      let stagingNode = node;

      if (shouldCopyToStaging) {
        await filestore.copyNode({
          backendMountId,
          path: node.path,
          targetPath: stagingTargetPath,
          overwrite: true,
          principal: normalizedPrincipal
        });

        stagingNode = await filestore.getNodeByPath({
          backendMountId,
          path: stagingTargetPath,
          principal: normalizedPrincipal
        });
      }

      const download = await filestore.downloadFile({
        nodeId: stagingNode.id,
        principal: normalizedPrincipal
      });

      const csvContent = await readStreamToString(download.stream as Readable);
      const checksum = buildChecksum(csvContent);
      const parsedCsv = parseCsv(csvContent);

      const metadata = (node.metadata ?? {}) as Record<string, unknown>;
      const instrumentId = typeof metadata.instrumentId === 'string'
        ? metadata.instrumentId
        : typeof metadata.instrument_id === 'string'
          ? metadata.instrument_id
          : null;

      let calibration: CalibrationReference | null = null;
      let calibrationSnapshot: CalibrationSnapshot | null = null;
      if (calibrationConfig) {
        calibration = await resolveCalibration(context, calibrationCache, calibrationConfig, instrumentId ?? 'unknown', minute);
        if (calibration) {
          calibrationSnapshot = await fetchCalibrationById(calibrationConfig, calibration.calibrationId);
        }
      }

      const adjustments = buildCalibrationAdjustments(calibration, calibrationSnapshot);

      const ingestMetadata: Record<string, unknown> = {
        minute,
        instrumentId,
        site: parsedCsv.site ?? metadata.site ?? metadata.location ?? null,
        rows: parsedCsv.rows,
        stagingPath: stagingNode.path,
        stagingNodeId: stagingNode.id,
        stagingSizeBytes: stagingNode.sizeBytes ?? null,
        stagingChecksum: stagingNode.checksum ?? checksum,
        filestorePath: node.path,
        backendMountId,
        calibration: serializeCalibration(calibration),
        calibrationId: calibration?.calibrationId ?? null,
        calibrationEffectiveAt: calibration?.effectiveAt ?? null,
        calibrationMetastoreVersion: calibration?.metastoreVersion ?? null,
        adjustedMeasurements:
          calibrationSnapshot && parsedCsv.rows > 0
            ? applyCalibrationAdjustments(
                {
                  temperature_c: toNumber(metadata.temperature_c) ?? undefined,
                  relative_humidity_pct: toNumber(metadata.relative_humidity_pct) ?? undefined,
                  pm2_5_ug_m3: toNumber(metadata.pm2_5_ug_m3) ?? undefined,
                  battery_voltage: toNumber(metadata.battery_voltage) ?? undefined
                },
                adjustments
              )
            : undefined
      };

      await upsertIngestionRecord(
        ingestMetastore,
        node.path,
        {
          ...ingestMetadata,
          status: 'processed',
          processedAt: normalizedAt
        },
        normalizedPrincipal
      );

      if (shouldArchive) {
        const archivePath = normalizeArchivePath(archivePrefix, instrumentId, minute, filename);
        const archiveDir = archivePath.split('/').slice(0, -1).join('/');
        await ensureFilestoreHierarchy(filestore, backendMountId, archiveDir, normalizedPrincipal);

        try {
          await filestore.moveNode({
            backendMountId,
            path: node.path,
            targetPath: archivePath,
            overwrite: true,
            principal: normalizedPrincipal
          });
        } catch (error) {
          if (!(error instanceof CapabilityRequestError && error.status === 409)) {
            throw error;
          }
          await filestore.deleteNode({
            backendMountId,
            path: node.path,
            recursive: false,
            principal: normalizedPrincipal
          });
        }
      }

      const fileRecord: MinutePreprocessorFile = {
        path: stagingNode.path,
        nodeId: stagingNode.id ?? null,
        site: parsedCsv.site ?? (typeof metadata.site === 'string' ? metadata.site : null),
        instrumentId,
        rows: parsedCsv.rows,
        sizeBytes: stagingNode.sizeBytes ?? null,
        checksum: checksum ?? stagingNode.checksum ?? null,
        calibration
      };

      observedFiles.push(fileRecord);
      if (instrumentId) {
        instrumentation.set(instrumentId, fileRecord.site ?? null);
      }
      totalRows += parsedCsv.rows;
      normalizedAt = new Date().toISOString();
    }

    const calibrationsApplied = collectAppliedCalibrations(observedFiles);
    const instrumentCount = instrumentation.size;

    const normalizedPayload: RawAssetPayload = {
      partitionKey: minute,
      minute,
      backendMountId,
      stagingPrefix,
      stagingMinutePrefix,
      files: observedFiles,
      instrumentCount,
      recordCount: totalRows,
      normalizedAt,
      calibrationsApplied
    } satisfies RawAssetPayload;

    context.logger.info('Normalized observatory inbox files', {
      minute,
      filesProcessed: observedFiles.length,
      recordCount: totalRows,
      instrumentCount
    });

    return {
      partitionKey: minute,
      normalized: normalizedPayload,
      assets: [
        {
          assetId: 'observatory.inbox.normalized',
          partitionKey: minute,
          producedAt: normalizedAt,
          payload: normalizedPayload
        }
      ]
    } satisfies MinutePreprocessorJobResult;
  }
});

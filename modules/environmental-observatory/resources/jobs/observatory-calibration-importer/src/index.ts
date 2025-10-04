import { FilestoreClient, type FilestoreNodeResponse } from '@apphub/filestore-client';
import { ensureResolvedBackendId, DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY } from '../../shared/filestore';
import { enforceScratchOnlyWrites } from '../../shared/scratchGuard';

enforceScratchOnlyWrites();

import {
  createObservatoryEventPublisher,
  toJsonRecord
} from '../../shared/events';
import {
  buildMetastoreRecordPayload,
  calibrationFileSchema,
  deriveMetastoreKey,
  normalizeCalibrationRecord,
  type NormalizedCalibrationRecord
} from '../../shared/calibrations';

const DEFAULT_CALIBRATION_NAMESPACE = 'observatory.calibrations';

type JobRunStatus = 'succeeded' | 'failed' | 'canceled' | 'expired';

type JobRunResult = {
  status?: JobRunStatus;
  result?: unknown;
  errorMessage?: string | null;
};

type JobRunContext = {
  parameters: unknown;
  logger: (message: string, meta?: Record<string, unknown>) => void;
  update: (updates: Record<string, unknown>) => Promise<void>;
};

type CalibrationImportParameters = {
  filestoreBaseUrl: string;
  filestoreBackendId: number | null;
  filestoreBackendKey: string;
  filestoreToken?: string;
  filestorePrincipal?: string;
  calibrationPath: string;
  calibrationNodeId?: number;
  calibrationsPrefix?: string;
  metastoreBaseUrl: string;
  metastoreNamespace: string;
  metastoreAuthToken?: string;
  checksum?: string | null;
};

type LoadedCalibrationFile = {
  node: FilestoreNodeResponse;
  content: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function ensureString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function ensureNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function parseParameters(raw: unknown): CalibrationImportParameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }

  const filestoreBaseUrl = ensureString(raw.filestoreBaseUrl ?? raw.filestore_base_url, '');
  if (!filestoreBaseUrl) {
    throw new Error('filestoreBaseUrl is required');
  }

  const backendKey = ensureString(
    raw.filestoreBackendKey ??
      raw.filestore_backend_key ??
      raw.backendMountKey ??
      raw.backend_mount_key ??
      DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY,
    DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY
  );
  const backendId = ensureNumber(raw.filestoreBackendId ?? raw.filestore_backend_id ?? raw.backendMountId);
  if (!backendKey) {
    throw new Error('filestoreBackendKey is required');
  }

  const calibrationPath = ensureString(raw.calibrationPath ?? raw.path ?? raw.commandPath ?? '', '');
  if (!calibrationPath) {
    throw new Error('calibrationPath is required');
  }

  const calibrationNodeId = ensureNumber(raw.calibrationNodeId ?? raw.nodeId ?? raw.node_id ?? raw.fileNodeId);
  const calibrationsPrefix = ensureString(
    raw.calibrationsPrefix ?? raw.calibrationPrefix ?? raw.prefix ?? '',
    ''
  );

  const metastoreBaseUrl = ensureString(
    raw.metastoreBaseUrl ?? raw.metastore_base_url ?? process.env.OBSERVATORY_METASTORE_BASE_URL,
    ''
  );
  if (!metastoreBaseUrl) {
    throw new Error('metastoreBaseUrl is required');
  }

  const metastoreNamespace = ensureString(
    raw.metastoreNamespace ?? raw.metastore_namespace ?? process.env.OBSERVATORY_CALIBRATION_NAMESPACE,
    DEFAULT_CALIBRATION_NAMESPACE
  );

  return {
    filestoreBaseUrl,
    filestoreBackendId: backendId ?? null,
    filestoreBackendKey: backendKey,
    filestoreToken: ensureString(raw.filestoreToken ?? raw.filestore_token ?? '', '') || undefined,
    filestorePrincipal: ensureString(raw.filestorePrincipal ?? raw.filestore_principal ?? '', '') || undefined,
    calibrationPath,
    calibrationNodeId: calibrationNodeId ?? undefined,
    calibrationsPrefix: calibrationsPrefix || undefined,
    metastoreBaseUrl,
    metastoreNamespace,
    metastoreAuthToken:
      ensureString(raw.metastoreAuthToken ?? raw.metastore_auth_token ?? '', '') || undefined,
    checksum: ensureString(raw.checksum ?? raw.fileChecksum ?? raw.calibrationChecksum ?? '', '') || undefined
  } satisfies CalibrationImportParameters;
}

async function readStreamToString(stream: NodeJS.ReadableStream): Promise<string> {
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

async function loadCalibrationFile(
  client: FilestoreClient,
  parameters: CalibrationImportParameters
): Promise<LoadedCalibrationFile> {
  const backendMountId = parameters.filestoreBackendId;
  if (!backendMountId || backendMountId <= 0) {
    throw new Error('filestoreBackendId must be resolved before loading calibration file');
  }
  if (parameters.calibrationNodeId) {
    const download = await client.downloadFile(parameters.calibrationNodeId, {
      principal: parameters.filestorePrincipal
    });
    const content = await readStreamToString(download.stream);
    return {
      node: download.node,
      content
    } satisfies LoadedCalibrationFile;
  }

  const normalizedPath = parameters.calibrationPath.replace(/^\/+/, '').replace(/\/+$/g, '');
  const node = await client.getNodeByPath({
    backendMountId,
    path: normalizedPath
  });
  const download = await client.downloadFile(node.id, {
    principal: parameters.filestorePrincipal
  });
  const content = await readStreamToString(download.stream);
  return {
    node,
    content
  } satisfies LoadedCalibrationFile;
}

type UpsertResult = {
  recordKey: string;
  version: number | null;
};

async function upsertCalibrationRecord(
  parameters: CalibrationImportParameters,
  record: NormalizedCalibrationRecord
): Promise<UpsertResult> {
  const namespace = (parameters.metastoreNamespace || DEFAULT_CALIBRATION_NAMESPACE).trim();
  const recordKey = deriveMetastoreKey(record);
  const baseUrl = parameters.metastoreBaseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/records/${encodeURIComponent(namespace)}/${encodeURIComponent(recordKey)}`;
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };
  if (parameters.metastoreAuthToken) {
    headers.authorization = `Bearer ${parameters.metastoreAuthToken}`;
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ metadata: buildMetastoreRecordPayload(record) })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to upsert metastore record ${namespace}/${recordKey}: ${errorText}`);
  }

  let version: number | null = null;
  try {
    const payload = (await response.json()) as { record?: { version?: number | null } | null };
    const versionRaw = payload.record?.version;
    if (typeof versionRaw === 'number' && Number.isFinite(versionRaw)) {
      version = versionRaw;
    }
  } catch {
    version = null;
  }

  return { recordKey, version } satisfies UpsertResult;
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  const parameters = parseParameters(context.parameters);
  const filestoreClient = new FilestoreClient({
    baseUrl: parameters.filestoreBaseUrl,
    token: parameters.filestoreToken,
    userAgent: 'observatory-calibration-importer/0.1.0'
  });
  await ensureResolvedBackendId(filestoreClient, parameters);

  const observatoryEvents = createObservatoryEventPublisher({
    source: 'observatory.calibration-importer'
  });

  try {
    const { node, content } = await loadCalibrationFile(filestoreClient, parameters);

    if (parameters.calibrationsPrefix) {
      const normalizedPrefix = parameters.calibrationsPrefix.replace(/^\/+|\/+$/g, '');
      const normalizedPath = node.path.replace(/^\/+/, '');
      if (!normalizedPath.startsWith(normalizedPrefix)) {
        context.logger('Skipping calibration file outside configured prefix', {
          calibrationPath: node.path,
          calibrationsPrefix: parameters.calibrationsPrefix
        });
        return {
          status: 'succeeded',
          result: {
            skipped: true,
            reason: 'Calibration file outside configured prefix',
            calibrationPath: node.path
          }
        } satisfies JobRunResult;
      }
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(content);
    } catch (error) {
      throw new Error(
        `Calibration file at ${node.path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const calibrationFile = calibrationFileSchema.parse(parsedPayload);
    const normalized = normalizeCalibrationRecord(calibrationFile, content);
    const upsertResult = await upsertCalibrationRecord(parameters, normalized);

    const occurredAt = new Date().toISOString();
    const assetPayload = {
      calibrationId: normalized.calibrationId,
      instrumentId: normalized.instrumentId,
      effectiveAt: normalized.effectiveAt,
      createdAt: normalized.createdAt,
      revision: normalized.revision,
      offsets: normalized.offsets,
      scales: normalized.scales,
      notes: normalized.notes,
      metadata: normalized.metadata,
      sourcePath: node.path,
      sourceNodeId: node.id ?? null,
      sourceChecksum: normalized.sourceChecksum,
      metastoreNamespace: parameters.metastoreNamespace || DEFAULT_CALIBRATION_NAMESPACE,
      metastoreRecordKey: upsertResult.recordKey,
      metastoreVersion: upsertResult.version
    } satisfies Record<string, unknown>;

    await context.update({
      instrumentId: normalized.instrumentId,
      calibrationId: normalized.calibrationId,
      metastoreVersion: upsertResult.version ?? null
    });

    await observatoryEvents.publish({
      type: 'observatory.calibration.updated',
      payload: {
        instrumentId: normalized.instrumentId,
        effectiveAt: normalized.effectiveAt,
        createdAt: normalized.createdAt,
        revision: normalized.revision ?? undefined,
        offsets: normalized.offsets,
        scales: normalized.scales ?? undefined,
        notes: normalized.notes ?? undefined,
        metadata: normalized.metadata,
        calibrationId: normalized.calibrationId,
        sourcePath: node.path,
        metastoreVersion: upsertResult.version ?? undefined
      },
      occurredAt,
      metadata: toJsonRecord({
        calibrationPath: node.path,
        calibrationNodeId: node.id ?? null,
        checksum: parameters.checksum ?? node.checksum ?? normalized.sourceChecksum
      })
    });

    return {
      status: 'succeeded',
      result: {
        calibrationId: normalized.calibrationId,
        instrumentId: normalized.instrumentId,
        effectiveAt: normalized.effectiveAt,
        metastoreNamespace: parameters.metastoreNamespace || DEFAULT_CALIBRATION_NAMESPACE,
        metastoreRecordKey: upsertResult.recordKey,
        metastoreVersion: upsertResult.version,
        assets: [
          {
            assetId: 'observatory.calibration.instrument',
            partitionKey: normalized.calibrationId,
            producedAt: occurredAt,
            payload: assetPayload
          }
        ]
      }
    } satisfies JobRunResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.logger('Calibration import failed', {
      error: message,
      path: parameters.calibrationPath
    });
    return {
      status: 'failed',
      errorMessage: message
    } satisfies JobRunResult;
  } finally {
    await observatoryEvents.close().catch(() => undefined);
  }
}

export default handler;

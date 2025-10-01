import path from 'node:path';
import {
  FilestoreClient,
  FilestoreClientError,
  FilestoreNodeResponse
} from '@apphub/filestore-client';
import { createObservatoryEventPublisher, toJsonRecord } from '../../shared/events';
import {
  lookupCalibration,
  type CalibrationLookupResult
} from '../../shared/calibrations';
import {
  ensureFilestoreHierarchy,
  ensureResolvedBackendId,
  DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY
} from '../../shared/filestore';
import { enforceScratchOnlyWrites } from '../../shared/scratchGuard';

enforceScratchOnlyWrites();

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

type ObservatoryNormalizerParameters = {
  minute: string;
  maxFiles: number;
  filestoreBaseUrl: string;
  filestoreBackendId: number | null;
  filestoreBackendKey: string;
  filestoreToken?: string;
  inboxPrefix: string;
  stagingPrefix: string;
  archivePrefix: string;
  principal?: string;
  commandPath?: string;
  metastoreBaseUrl?: string;
  metastoreNamespace?: string;
  metastoreAuthToken?: string;
  calibrationsBaseUrl?: string;
  calibrationsNamespace?: string;
  calibrationsAuthToken?: string;
};

type StagingFileMetadata = {
  path: string;
  nodeId: number | null;
  site: string;
  instrumentId: string;
  rows: number;
  sizeBytes: number | null;
  checksum: string | null;
  calibration: CalibrationReference | null;
};

type RawAssetPayload = {
  partitionKey: string;
  minute: string;
  instrumentCount: number;
  recordCount: number;
  backendMountId: number;
  stagingPrefix: string;
  stagingMinutePrefix: string;
  files: StagingFileMetadata[];
  normalizedAt: string;
  calibrationsApplied: CalibrationReference[];
};

type CalibrationReference = {
  calibrationId: string;
  effectiveAt: string;
  instrumentId: string;
  metastoreVersion: number | null;
};

type CachedCalibration = {
  lookup: CalibrationLookupResult;
  reference: CalibrationReference | null;
  warnedNotFound?: boolean;
  warnedFuture?: boolean;
};

function normalizeIsoString(value: string): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function parseIsoToMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return timestamp;
}

function resolveCalibrationInstrument(calibrationId: string, candidate: string): string {
  if (candidate) {
    return candidate;
  }
  if (!calibrationId) {
    return 'unknown';
  }
  const separatorIndex = calibrationId.indexOf(':');
  if (separatorIndex > 0) {
    return calibrationId.slice(0, separatorIndex);
  }
  return calibrationId;
}

function toCalibrationReferenceFromValue(value: unknown): CalibrationReference | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const calibrationId = ensureString(record.calibrationId ?? record.id ?? record.key);
  const effectiveAtRaw = ensureString(record.effectiveAt ?? record.effective_at ?? record.timestamp);
  if (!calibrationId || !effectiveAtRaw) {
    return null;
  }
  const normalizedEffectiveAt = normalizeIsoString(effectiveAtRaw) ?? effectiveAtRaw;
  const instrumentCandidate = ensureString(record.instrumentId ?? record.instrument_id ?? '');
  const instrumentId = resolveCalibrationInstrument(calibrationId, instrumentCandidate);
  const versionValue = record.metastoreVersion ?? record.version ?? record.metastore_version;
  const metastoreVersion =
    typeof versionValue === 'number' && Number.isFinite(versionValue)
      ? Math.trunc(versionValue)
      : typeof versionValue === 'string' && versionValue.trim().length > 0
        ? Number.isFinite(Number(versionValue))
          ? Math.trunc(Number(versionValue))
          : null
        : null;
  return {
    calibrationId,
    effectiveAt: normalizedEffectiveAt,
    instrumentId,
    metastoreVersion
  } satisfies CalibrationReference;
}

function parseCalibrationFromRecord(metadata: Record<string, unknown>): CalibrationReference | null {
  const direct = toCalibrationReferenceFromValue(metadata.calibration ?? metadata.calibrationMetadata);
  if (direct) {
    return direct;
  }
  const calibrationId = ensureString(
    metadata.calibrationId ?? metadata.calibration_id ?? metadata.calibrationKey ?? ''
  );
  const effectiveAtRaw = ensureString(
    metadata.calibrationEffectiveAt ?? metadata.calibration_effective_at ?? ''
  );
  if (!calibrationId || !effectiveAtRaw) {
    return null;
  }
  const normalizedEffectiveAt = normalizeIsoString(effectiveAtRaw) ?? effectiveAtRaw;
  const instrumentCandidate = ensureString(
    metadata.calibrationInstrumentId ??
      metadata.calibration_instrument_id ??
      metadata.instrumentId ??
      metadata.instrument_id ??
      ''
  );
  const versionValue =
    metadata.calibrationMetastoreVersion ??
    metadata.calibration_version ??
    metadata.metastoreVersion;
  const metastoreVersion =
    typeof versionValue === 'number' && Number.isFinite(versionValue)
      ? Math.trunc(versionValue)
      : typeof versionValue === 'string' && versionValue.trim().length > 0
        ? Number.isFinite(Number(versionValue))
          ? Math.trunc(Number(versionValue))
          : null
        : null;
  return {
    calibrationId,
    effectiveAt: normalizedEffectiveAt,
    instrumentId: resolveCalibrationInstrument(calibrationId, instrumentCandidate),
    metastoreVersion
  } satisfies CalibrationReference;
}

function serializeCalibrationReference(reference: CalibrationReference | null): Record<string, unknown> | null {
  if (!reference) {
    return null;
  }
  return {
    calibrationId: reference.calibrationId,
    effectiveAt: reference.effectiveAt,
    instrumentId: reference.instrumentId,
    metastoreVersion: reference.metastoreVersion ?? null
  } satisfies Record<string, unknown>;
}

function applyCalibrationMetadata(
  target: Record<string, unknown>,
  reference: CalibrationReference | null
): void {
  target.calibration = serializeCalibrationReference(reference);
  target.calibrationId = reference ? reference.calibrationId : null;
  target.calibrationEffectiveAt = reference ? reference.effectiveAt : null;
  target.calibrationInstrumentId = reference ? reference.instrumentId : null;
  target.calibrationMetastoreVersion = reference?.metastoreVersion ?? null;
}

function collectAppliedCalibrations(files: StagingFileMetadata[]): CalibrationReference[] {
  const seen = new Map<string, CalibrationReference>();
  for (const file of files) {
    if (file.calibration && !seen.has(file.calibration.calibrationId)) {
      seen.set(file.calibration.calibrationId, file.calibration);
    }
  }
  return Array.from(seen.values());
}

function deriveCalibrationAsOf(minute: string): string {
  if (!minute) {
    return new Date().toISOString();
  }
  const candidate = `${minute}:59:59.999Z`;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) {
    const fallback = new Date(minute);
    if (Number.isNaN(fallback.getTime())) {
      return new Date().toISOString();
    }
    return fallback.toISOString();
  }
  return date.toISOString();
}

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

function ensureNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function parseParameters(raw: unknown): ObservatoryNormalizerParameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }
  const minute = ensureString(raw.minute ?? raw.partitionKey ?? raw.partition_key ?? raw.hour);
  if (!minute) {
    throw new Error('minute parameter is required');
  }
  const maxFiles = Math.max(1, ensureNumber(raw.maxFiles ?? raw.max_files, 64));
  const filestoreBaseUrl =
    ensureString(
      raw.filestoreBaseUrl ??
        raw.filestore_base_url ??
        process.env.OBSERVATORY_FILESTORE_BASE_URL ??
        process.env.FILESTORE_BASE_URL,
      'http://127.0.0.1:4300'
    ) || 'http://127.0.0.1:4300';

  const filestoreBackendKey = ensureString(
    raw.filestoreBackendKey ??
      raw.filestore_backend_key ??
      raw.backendMountKey ??
      raw.backend_mount_key ??
      process.env.OBSERVATORY_FILESTORE_BACKEND_KEY ??
      process.env.OBSERVATORY_FILESTORE_MOUNT_KEY ??
      DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY,
    DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY
  );

  const backendRaw =
    raw.filestoreBackendId ??
    raw.filestore_backend_id ??
    raw.backendMountId ??
    raw.backend_mount_id ??
    process.env.OBSERVATORY_FILESTORE_BACKEND_ID ??
    process.env.FILESTORE_BACKEND_ID;
  const backendIdCandidate = ensureNumber(backendRaw, Number.NaN);
  const filestoreBackendId = Number.isFinite(backendIdCandidate) && backendIdCandidate > 0
    ? backendIdCandidate
    : null;

  const filestoreToken = ensureString(
    raw.filestoreToken ??
      raw.filestore_token ??
      process.env.OBSERVATORY_FILESTORE_TOKEN ??
      process.env.FILESTORE_TOKEN,
    ''
  );

  const inboxPrefix = ensureString(
    raw.inboxPrefix ??
      raw.inbox_prefix ??
      raw.filestoreInboxPrefix ??
      raw.filestore_inbox_prefix ??
      process.env.OBSERVATORY_FILESTORE_INBOX_PREFIX ??
      process.env.FILESTORE_INBOX_PREFIX,
    'datasets/observatory/inbox'
  );

  const stagingPrefix = ensureString(
    raw.stagingPrefix ??
      raw.staging_prefix ??
      raw.filestoreStagingPrefix ??
      raw.filestore_staging_prefix ??
      process.env.OBSERVATORY_FILESTORE_STAGING_PREFIX ??
      process.env.FILESTORE_STAGING_PREFIX,
    'datasets/observatory/staging'
  );

  const archivePrefix = ensureString(
    raw.archivePrefix ??
      raw.archive_prefix ??
      raw.filestoreArchivePrefix ??
      raw.filestore_archive_prefix ??
      process.env.OBSERVATORY_FILESTORE_ARCHIVE_PREFIX ??
      process.env.FILESTORE_ARCHIVE_PREFIX,
    'datasets/observatory/archive'
  );

  const principal = ensureString(
    raw.principal ?? raw.actor ?? process.env.OBSERVATORY_FILESTORE_PRINCIPAL,
    'observatory-inbox-normalizer'
  );

  const commandPath = ensureString(raw.commandPath ?? raw.command_path ?? '');

  const metastoreBaseUrl = ensureString(
    raw.metastoreBaseUrl ??
      raw.metastore_base_url ??
      process.env.OBSERVATORY_METASTORE_BASE_URL ??
      process.env.METASTORE_BASE_URL,
    ''
  );

  const metastoreNamespace = ensureString(
    raw.metastoreNamespace ??
      raw.metastore_namespace ??
      process.env.OBSERVATORY_METASTORE_INGEST_NAMESPACE ??
      process.env.OBSERVATORY_METASTORE_NAMESPACE ??
      'observatory.ingest'
  );

  const metastoreAuthToken = ensureString(
    raw.metastoreAuthToken ??
      raw.metastore_auth_token ??
      process.env.OBSERVATORY_METASTORE_TOKEN ??
      process.env.METASTORE_AUTH_TOKEN,
    ''
  );

  const calibrationsBaseUrlCandidate = ensureString(
    raw.calibrationsBaseUrl ??
      raw.calibrations_base_url ??
      raw.calibrationMetastoreBaseUrl ??
      raw.calibration_metastore_base_url ??
      process.env.OBSERVATORY_CALIBRATIONS_METASTORE_BASE_URL ??
      process.env.OBSERVATORY_METASTORE_BASE_URL ??
      process.env.METASTORE_BASE_URL,
    ''
  );

  const calibrationsNamespace = ensureString(
    raw.calibrationsNamespace ??
      raw.calibrations_namespace ??
      raw.calibrationMetastoreNamespace ??
      raw.calibration_metastore_namespace ??
      process.env.OBSERVATORY_CALIBRATIONS_NAMESPACE ??
      'observatory.calibrations'
  );

  const calibrationsAuthTokenCandidate = ensureString(
    raw.calibrationsAuthToken ??
      raw.calibrations_auth_token ??
      raw.calibrationMetastoreAuthToken ??
      raw.calibration_metastore_auth_token ??
      process.env.OBSERVATORY_CALIBRATIONS_METASTORE_TOKEN ??
      process.env.OBSERVATORY_METASTORE_TOKEN ??
      process.env.METASTORE_AUTH_TOKEN,
    ''
  );

  const finalCalibrationsBaseUrl = calibrationsBaseUrlCandidate || metastoreBaseUrl;
  const finalCalibrationsAuthToken = calibrationsAuthTokenCandidate || metastoreAuthToken;

  return {
    minute,
    maxFiles,
    filestoreBaseUrl,
    filestoreBackendId,
    filestoreBackendKey,
    filestoreToken: filestoreToken || undefined,
    inboxPrefix,
    stagingPrefix,
    archivePrefix,
    principal: principal || undefined,
    commandPath: commandPath || undefined,
    metastoreBaseUrl: metastoreBaseUrl ? normalizeBaseUrl(metastoreBaseUrl) : undefined,
    metastoreNamespace: (metastoreNamespace || 'observatory.ingest').trim() || 'observatory.ingest',
    metastoreAuthToken: metastoreAuthToken || undefined,
    calibrationsBaseUrl: finalCalibrationsBaseUrl
      ? normalizeBaseUrl(finalCalibrationsBaseUrl)
      : undefined,
    calibrationsNamespace:
      (calibrationsNamespace || 'observatory.calibrations').trim() || 'observatory.calibrations',
    calibrationsAuthToken: finalCalibrationsAuthToken || undefined
  } satisfies ObservatoryNormalizerParameters;
}

async function collectInboxNodes(
  client: FilestoreClient,
  parameters: ObservatoryNormalizerParameters,
  minuteSuffixes: string[]
): Promise<FilestoreNodeResponse[]> {
  const matches: FilestoreNodeResponse[] = [];
  let offset: number | undefined = 0;
  const limit = Math.min(Math.max(parameters.maxFiles * 2, 50), 200);
  const normalizedPrefix = parameters.inboxPrefix.replace(/\/+$/g, '');

  while (matches.length < parameters.maxFiles) {
    let result;
    try {
      result = await client.listNodes({
        backendMountId: parameters.filestoreBackendId,
        path: normalizedPrefix,
        limit,
        offset,
        depth: 1,
        kinds: ['file']
      });
    } catch (error) {
      if (error instanceof FilestoreClientError && (error.statusCode ?? 0) >= 500) {
        console.warn('[observatory-inbox-normalizer] listNodes failed; treating as empty inbox', {
          statusCode: error.statusCode ?? null,
          code: error.code ?? null,
          message: error.message
        });
        break;
      }
      throw error;
    }

    if (!result) {
      break;
    }

    for (const node of result.nodes) {
      if (nodeMatchesMinute(node, parameters.minute, minuteSuffixes)) {
        matches.push(node);
      }
      if (matches.length >= parameters.maxFiles) {
        break;
      }
    }

    if (!result.nextOffset || matches.length >= parameters.maxFiles) {
      break;
    }
    offset = result.nextOffset ?? undefined;
    if (offset === undefined) {
      break;
    }
  }

  return matches.slice(0, parameters.maxFiles);
}

function deriveMinuteSuffixes(minute: string): string[] {
  const trimmed = minute.trim();
  const suffixes = new Set<string>();
  if (trimmed) {
    suffixes.add(`${trimmed}.csv`);
  }
  const digitsOnly = trimmed.replace(/[^0-9]/g, '');
  if (digitsOnly.length >= 10) {
    suffixes.add(`${digitsOnly}.csv`);
  }
  return Array.from(suffixes);
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

function parseInstrumentId(filename: string): string {
  const match = filename.match(/instrument_(.+?)_\d{12}\.csv$/i);
  if (match?.[1]) {
    return match[1];
  }
  const fallback = filename.replace(/\.csv$/i, '');
  return fallback;
}

function sanitizePathSegment(value: string, fallback: string): string {
  const trimmed = value.trim();
  const sanitized = trimmed.replace(/[^0-9A-Za-z._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return sanitized || fallback;
}

type MetastoreConfig = {
  baseUrl: string;
  namespace: string;
  authToken?: string;
};

type MetastoreRecord = {
  metadata: Record<string, unknown>;
  version: number;
};

const INGEST_RECORD_TYPE = 'observatory.ingest.file';

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function sanitizeRecordKey(value: string): string {
  return value
    ? value.replace(/[^0-9A-Za-z._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '')
    : '';
}

function deriveArchiveRelativePath(
  instrumentId: string,
  minuteKey: string,
  filename: string
): string {
  const sanitizedInstrument = sanitizePathSegment(
    instrumentId || 'unknown-instrument',
    'unknown-instrument'
  );

  let hourSegment = '';
  let minuteFilename = '';
  const timestampDigits = filename.match(/_(\d{12})\.csv$/i)?.[1] ?? '';

  if (timestampDigits.length === 12) {
    const year = timestampDigits.slice(0, 4);
    const month = timestampDigits.slice(4, 6);
    const day = timestampDigits.slice(6, 8);
    const hour = timestampDigits.slice(8, 10);
    const minute = timestampDigits.slice(10, 12);
    hourSegment = `${year}-${month}-${day}T${hour}`;
    minuteFilename = `${minute}.csv`;
  } else {
    const isoMatch = minuteKey.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
    if (isoMatch) {
      const [, datePart, hourPart, minutePart] = isoMatch;
      hourSegment = `${datePart}T${hourPart}`;
      minuteFilename = `${minutePart}.csv`;
    } else {
      hourSegment = 'unknown-hour';
      minuteFilename = `${sanitizePathSegment(minuteKey || 'minute', 'minute')}.csv`;
    }
  }

  const segments = [sanitizedInstrument, hourSegment, minuteFilename].filter(Boolean);
  return segments.join('/');
}

function toMetastoreConfig(parameters: ObservatoryNormalizerParameters): MetastoreConfig | null {
  if (!parameters.metastoreBaseUrl) {
    return null;
  }
  const namespace = parameters.metastoreNamespace?.trim() || 'observatory.ingest';
  return {
    baseUrl: normalizeBaseUrl(parameters.metastoreBaseUrl),
    namespace,
    authToken: parameters.metastoreAuthToken?.trim() || undefined
  } satisfies MetastoreConfig;
}

function toCalibrationConfig(parameters: ObservatoryNormalizerParameters): MetastoreConfig | null {
  const baseUrl = parameters.calibrationsBaseUrl ?? parameters.metastoreBaseUrl;
  if (!baseUrl) {
    return null;
  }
  const namespace = parameters.calibrationsNamespace?.trim() || 'observatory.calibrations';
  const authToken = parameters.calibrationsAuthToken ?? parameters.metastoreAuthToken;
  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    namespace,
    authToken: authToken?.trim() || undefined
  } satisfies MetastoreConfig;
}

function toRecordMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function getRecordStatus(metadata: Record<string, unknown>): string | null {
  const status = metadata.status;
  return typeof status === 'string' ? status : null;
}

async function fetchMetastoreRecord(
  config: MetastoreConfig,
  key: string
): Promise<MetastoreRecord | null> {
  const recordKey = sanitizeRecordKey(key);
  if (!recordKey) {
    return null;
  }

  const url = `${config.baseUrl}/records/${encodeURIComponent(config.namespace)}/${encodeURIComponent(recordKey)}`;
  const headers: Record<string, string> = {};
  if (config.authToken) {
    headers.authorization = `Bearer ${config.authToken}`;
  }

  const response = await fetch(url, { headers });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to fetch metastore record ${config.namespace}/${recordKey}: ${errorText}`);
  }

  const payload = (await response.json()) as {
    record?: { metadata?: unknown; version?: number } | null;
  };
  const metadata = toRecordMetadata(payload.record?.metadata);
  const versionRaw = payload.record?.version;
  const version = typeof versionRaw === 'number' && Number.isFinite(versionRaw) ? versionRaw : 0;
  return { metadata, version } satisfies MetastoreRecord;
}

async function upsertMetastoreRecord(
  config: MetastoreConfig,
  key: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const recordKey = sanitizeRecordKey(key);
  if (!recordKey) {
    throw new Error('Metastore record key must not be empty');
  }

  const url = `${config.baseUrl}/records/${encodeURIComponent(config.namespace)}/${encodeURIComponent(recordKey)}`;
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };
  if (config.authToken) {
    headers.authorization = `Bearer ${config.authToken}`;
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ metadata })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to upsert metastore record ${config.namespace}/${recordKey}: ${errorText}`);
  }
}

function nodeMatchesMinute(
  node: FilestoreNodeResponse,
  minute: string,
  minuteSuffixes: string[]
): boolean {
  const filename = node.path.split('/').pop() ?? '';
  const metadata =
    node.metadata && typeof node.metadata === 'object'
      ? (node.metadata as Record<string, unknown>)
      : {};
  const metadataMinute = ensureString(
    metadata.minute ?? metadata.minuteKey ?? metadata.minute_key ?? metadata.minuteIso ?? metadata.minute_iso
  );
  const normalizedMinute = minute.replace(/:/g, '-');
  if (metadataMinute) {
    if (metadataMinute === minute || metadataMinute === normalizedMinute) {
      return true;
    }
  }
  const metadataIso = ensureString(metadata.minuteIso ?? metadata.minute_iso);
  if (metadataIso && metadataIso === minute) {
    return true;
  }
  return minuteSuffixes.some((suffix) => filename.endsWith(suffix));
}

async function loadNodeFromCommandPath(
  client: FilestoreClient,
  backendMountId: number,
  commandPath: string,
  minute: string,
  minuteSuffixes: string[]
): Promise<FilestoreNodeResponse | null> {
  try {
    const node = await client.getNodeByPath({ backendMountId, path: commandPath });
    if (nodeMatchesMinute(node, minute, minuteSuffixes)) {
      return node;
    }
    return null;
  } catch (err) {
    if (err instanceof FilestoreClientError && err.statusCode === 404) {
      return null;
    }
    throw err;
  }
}

type ParsedCsvMetadata = {
  rows: number;
  site: string;
};

function parseCsv(content: string): ParsedCsvMetadata {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return { rows: 0, site: '' };
  }
  const headers = lines[0]?.split(',').map((entry) => entry.trim()) ?? [];
  const siteIndex = headers.indexOf('site');
  const rows = lines.length - 1;
  let site = '';
  if (siteIndex !== -1) {
    for (let index = 1; index < lines.length; index += 1) {
      const parts = lines[index]?.split(',') ?? [];
      const candidate = parts[siteIndex]?.trim();
      if (candidate) {
        site = candidate;
        break;
      }
    }
  }
  return { rows, site } satisfies ParsedCsvMetadata;
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  const parameters = parseParameters(context.parameters);
  const observatoryEvents = createObservatoryEventPublisher({
    source: 'observatory.inbox-normalizer'
  });

  try {
  const minuteSuffixes = deriveMinuteSuffixes(parameters.minute);
  const filestoreClient = new FilestoreClient({
    baseUrl: parameters.filestoreBaseUrl,
    token: parameters.filestoreToken,
    userAgent: 'observatory-inbox-normalizer/0.2.0'
  });

  const backendMountId = await ensureResolvedBackendId(filestoreClient, parameters);

  if (
    parameters.commandPath &&
    !parameters.commandPath.startsWith(parameters.inboxPrefix.replace(/\/+$/g, '') + '/')
  ) {
    context.logger('Skipping filestore command outside inbox prefix', {
      commandPath: parameters.commandPath,
      inboxPrefix: parameters.inboxPrefix
    });
    return {
      status: 'succeeded',
      result: {
        skipped: true,
        reason: 'Command path outside inbox prefix'
      }
    } satisfies JobRunResult;
  }

  const metastoreConfig = toMetastoreConfig(parameters);
  const calibrationConfig = toCalibrationConfig(parameters);
  const calibrationCache = new Map<string, CachedCalibration>();
  const calibrationAsOf = deriveCalibrationAsOf(parameters.minute);

  function maybeWarnForCalibration(entry: CachedCalibration, instrumentId: string): void {
    if (!entry.reference && !entry.warnedNotFound) {
      entry.warnedNotFound = true;
      context.logger('No calibration found for instrument', {
        instrumentId,
        minute: parameters.minute
      });
    }

    if (entry.warnedFuture) {
      return;
    }

    const latest = entry.lookup.latest;
    if (!latest) {
      return;
    }

    const asOfMs = parseIsoToMs(calibrationAsOf);
    const latestMs = parseIsoToMs(latest.effectiveAt);
    if (latestMs === null) {
      return;
    }

    if (entry.reference) {
      if (latest.calibrationId !== entry.reference.calibrationId && asOfMs !== null && latestMs > asOfMs) {
        entry.warnedFuture = true;
        context.logger('Newer calibration pending for instrument', {
          instrumentId,
          minute: parameters.minute,
          latestEffectiveAt: latest.effectiveAt
        });
      }
      return;
    }

    if (asOfMs !== null && latestMs > asOfMs) {
      entry.warnedFuture = true;
      context.logger('Calibration effectiveAt is in the future', {
        instrumentId,
        minute: parameters.minute,
        effectiveAt: latest.effectiveAt
      });
    }
  }

  async function resolveCalibrationForInstrument(instrumentId: string): Promise<CalibrationReference | null> {
    if (!calibrationConfig || !instrumentId || instrumentId === 'unknown') {
      return null;
    }

    const existing = calibrationCache.get(instrumentId);
    if (existing) {
      maybeWarnForCalibration(existing, instrumentId);
      return existing.reference;
    }

    let lookup: CalibrationLookupResult;
    try {
      lookup = await lookupCalibration(
        {
          baseUrl: calibrationConfig.baseUrl,
          namespace: calibrationConfig.namespace,
          authToken: calibrationConfig.authToken
        },
        instrumentId,
        calibrationAsOf
      );
    } catch (error) {
      context.logger('Calibration lookup failed', {
        instrumentId,
        minute: parameters.minute,
        error: error instanceof Error ? error.message : String(error)
      });
      const failureEntry: CachedCalibration = {
        lookup: { active: null, latest: null, all: [] },
        reference: null,
        warnedNotFound: true
      };
      calibrationCache.set(instrumentId, failureEntry);
      return null;
    }

    const reference = lookup.active
      ? {
          calibrationId: lookup.active.calibrationId,
          effectiveAt: lookup.active.effectiveAt,
          instrumentId: lookup.active.instrumentId ?? instrumentId,
          metastoreVersion: lookup.active.metastoreVersion ?? null
        }
      : null;

    const entry: CachedCalibration = {
      lookup,
      reference,
      warnedNotFound: !reference
    };

    calibrationCache.set(instrumentId, entry);
    maybeWarnForCalibration(entry, instrumentId);
    return entry.reference;
  }

  const normalizedCommandPath = parameters.commandPath?.replace(/^\/+/, '') ?? null;
  const recordKeySource = normalizedCommandPath ?? parameters.minute;
  const existingRecord =
    metastoreConfig && normalizedCommandPath
      ? await fetchMetastoreRecord(metastoreConfig, normalizedCommandPath)
      : null;
  const existingMetadata = toRecordMetadata(existingRecord?.metadata);
  const existingStatus = getRecordStatus(existingMetadata);

  const stagingSubdir = parameters.minute.replace(':', '-');
  const normalizedStagingPrefix = parameters.stagingPrefix.replace(/\/+$/g, '');
  const stagingMinutePrefix = `${normalizedStagingPrefix}/${stagingSubdir}`;
  await ensureFilestoreHierarchy(
    filestoreClient,
    parameters.filestoreBackendId,
    stagingMinutePrefix,
    parameters.principal
  );

  let inboxNode: FilestoreNodeResponse | null = null;
  if (normalizedCommandPath) {
    inboxNode = await loadNodeFromCommandPath(
      filestoreClient,
      parameters.filestoreBackendId,
      normalizedCommandPath,
      parameters.minute,
      minuteSuffixes
    );
  }

  if (!inboxNode) {
    const fallbackNodes = await collectInboxNodes(filestoreClient, parameters, minuteSuffixes);
    inboxNode = fallbackNodes[0] ?? null;
  }

  const stagingFiles: StagingFileMetadata[] = [];
  let recordCount = 0;
  const instrumentIds = new Set<string>();
  let normalizedAt = new Date().toISOString();

  if (!inboxNode) {
    if (normalizedCommandPath && existingStatus === 'processed') {
      const rows =
        typeof existingMetadata.rows === 'number' && Number.isFinite(existingMetadata.rows)
          ? existingMetadata.rows
          : 0;
      const instrumentId = ensureString(existingMetadata.instrumentId);
      const site = ensureString(existingMetadata.site);
      const stagingRelative = ensureString(existingMetadata.stagingRelativePath);
      if (!stagingRelative) {
        throw new Error(
          `Metastore record for ${normalizedCommandPath} is missing stagingRelativePath`
        );
      }
      const normalizedRelative = stagingRelative.split(path.sep).join('/');
      const stagingPath = ensureString(
        existingMetadata.stagingPath ?? existingMetadata.stagingFilestorePath ?? ''
      );
      if (!stagingPath) {
        throw new Error(
          `Metastore record for ${normalizedCommandPath} is missing stagingPath metadata`
        );
      }
      const calibration = parseCalibrationFromRecord(existingMetadata);
      stagingFiles.push({
        path: stagingPath,
        nodeId:
          typeof existingMetadata.stagingNodeId === 'number' && Number.isFinite(existingMetadata.stagingNodeId)
            ? existingMetadata.stagingNodeId
            : null,
        site,
        instrumentId,
        rows,
        sizeBytes:
          typeof existingMetadata.stagingSizeBytes === 'number' && Number.isFinite(existingMetadata.stagingSizeBytes)
            ? existingMetadata.stagingSizeBytes
            : null,
        checksum: ensureString(existingMetadata.stagingChecksum ?? existingMetadata.checksum ?? '') || null,
        calibration
      });
      if (instrumentId) {
        instrumentIds.add(instrumentId);
      }
      recordCount = rows;
      normalizedAt = ensureString(existingMetadata.processedAt) || normalizedAt;

      const calibrationsApplied = collectAppliedCalibrations(stagingFiles);

      const payload: RawAssetPayload = {
        partitionKey: parameters.minute,
        minute: parameters.minute,
        instrumentCount: instrumentIds.size || (instrumentId ? 1 : 0),
        recordCount,
        backendMountId: parameters.filestoreBackendId,
        stagingPrefix: normalizedStagingPrefix,
        stagingMinutePrefix,
        files: stagingFiles,
        normalizedAt,
        calibrationsApplied
      } satisfies RawAssetPayload;

      context.logger('Replaying normalization from metastore record', {
        minute: parameters.minute,
        commandPath: normalizedCommandPath,
        recordCount,
        instrumentCount: payload.instrumentCount
      });

      await context.update({
        filesProcessed: stagingFiles.length,
        recordCount,
        filesArchived: stagingFiles.length,
        replayed: true,
        calibrationId: stagingFiles[0]?.calibration?.calibrationId ?? null
      });

      return {
        status: 'succeeded',
        result: {
          partitionKey: parameters.minute,
          normalized: payload,
          assets: [
            {
              assetId: 'observatory.timeseries.raw',
              partitionKey: parameters.minute,
              producedAt: normalizedAt,
              payload
            }
          ]
        }
      } satisfies JobRunResult;
    }

    const missingPath = normalizedCommandPath
      ? `Inbox file ${normalizedCommandPath} not found for minute ${parameters.minute}`
      : `No inbox files matching minute ${parameters.minute} under ${parameters.inboxPrefix}`;
    context.logger('Skipping normalization because inbox file is missing', {
      commandPath: normalizedCommandPath,
      inboxPrefix: parameters.inboxPrefix,
      minute: parameters.minute
    });
    await context.update({
      filesProcessed: 0,
      filesArchived: 0,
      recordCount: 0,
      skipped: true,
      reason: missingPath
    });
    return {
      status: 'succeeded',
      result: {
        skipped: true,
        reason: missingPath
      }
    } satisfies JobRunResult;
  }

  const filename = inboxNode.path.split('/').pop() ?? '';
  const stagingTargetPath = `${stagingMinutePrefix}/${filename}`;

  let stagingNode: FilestoreNodeResponse | null = null;
  try {
    const copyResponse = await filestoreClient.copyNode({
      backendMountId: parameters.filestoreBackendId,
      path: inboxNode.path,
      targetPath: stagingTargetPath,
      overwrite: true,
      principal: parameters.principal
    });
    stagingNode = copyResponse.node;
  } catch (err) {
    context.logger('Filestore copy failed', {
      error: err instanceof FilestoreClientError ? err.message : String(err),
      code: err instanceof FilestoreClientError ? err.code : undefined,
      statusCode: err instanceof FilestoreClientError ? err.statusCode : undefined,
      details: err instanceof FilestoreClientError ? err.details : undefined,
      path: inboxNode.path,
      targetPath: stagingTargetPath
    });
    throw err;
  }

  if (!stagingNode) {
    stagingNode = await filestoreClient.getNodeByPath({
      backendMountId: parameters.filestoreBackendId,
      path: stagingTargetPath
    });
  }

  const download = await filestoreClient.downloadFile(stagingNode.id, {
    principal: parameters.principal
  });
  const csvContent = await readStreamToString(download.stream);

  const metadata =
    inboxNode.metadata && typeof inboxNode.metadata === 'object'
      ? (inboxNode.metadata as Record<string, unknown>)
      : {};

  const inferredInstrumentId = ensureString(metadata.instrumentId ?? metadata.instrument_id)
    || parseInstrumentId(filename);

  const archiveRelative = deriveArchiveRelativePath(
    inferredInstrumentId,
    parameters.minute,
    filename
  );
  const normalizedArchivePrefix = parameters.archivePrefix.replace(/\/+$/g, '');
  const archiveTargetPath = `${normalizedArchivePrefix}/${archiveRelative}`;
  const archiveTargetDir = archiveTargetPath.split('/').slice(0, -1).join('/');
  if (archiveTargetDir) {
    await ensureFilestoreHierarchy(
      filestoreClient,
      parameters.filestoreBackendId,
      archiveTargetDir,
      parameters.principal
    );
  }

  try {
    await filestoreClient.moveNode({
      backendMountId: parameters.filestoreBackendId,
      path: inboxNode.path,
      targetPath: archiveTargetPath,
      overwrite: true,
      principal: parameters.principal
    });
  } catch (err) {
    const isFilestoreError = err instanceof FilestoreClientError;
    const errorCode = isFilestoreError ? err.code : undefined;
    if (errorCode === 'NODE_EXISTS') {
      context.logger('Filestore move target already exists; skipping overwrite', {
        path: inboxNode.path,
        targetPath: archiveTargetPath,
        statusCode: err.statusCode,
        code: err.code,
        details: err.details
      });
      await filestoreClient
        .deleteNode({
          backendMountId: parameters.filestoreBackendId,
          path: inboxNode.path,
          recursive: false,
          principal: parameters.principal
        })
        .catch((deleteErr) => {
          context.logger('Failed to remove staging node after move conflict', {
            error:
              deleteErr instanceof FilestoreClientError
                ? deleteErr.message
                : String(deleteErr),
            code: deleteErr instanceof FilestoreClientError ? deleteErr.code : undefined,
            statusCode: deleteErr instanceof FilestoreClientError ? deleteErr.statusCode : undefined,
            path: inboxNode.path
          });
        });
    } else {
      context.logger('Filestore move failed', {
        error: isFilestoreError ? err.message : String(err),
        code: errorCode,
        statusCode: isFilestoreError ? err.statusCode : undefined,
        details: isFilestoreError ? err.details : undefined,
        path: inboxNode.path,
        targetPath: archiveTargetPath
      });
      throw err;
    }
  }

  const { rows, site } = parseCsv(csvContent);

  const sourceSite = site || ensureString(metadata.site ?? metadata.location ?? '');
  const instrumentId = inferredInstrumentId || 'unknown';
  const calibration = await resolveCalibrationForInstrument(instrumentId);

  const stagingFile: StagingFileMetadata = {
    path: stagingNode.path,
    nodeId: stagingNode.id ?? null,
    site: sourceSite,
    instrumentId,
    rows,
    sizeBytes: stagingNode.sizeBytes ?? null,
    checksum: stagingNode.checksum ?? null,
    calibration
  } satisfies StagingFileMetadata;
  recordCount = rows;

  if (stagingFile.instrumentId) {
    instrumentIds.add(stagingFile.instrumentId);
  }
  stagingFiles.push(stagingFile);

  normalizedAt = new Date().toISOString();
  const calibrationsApplied = collectAppliedCalibrations(stagingFiles);
  const payload: RawAssetPayload = {
    partitionKey: parameters.minute,
    minute: parameters.minute,
    instrumentCount: instrumentIds.size,
    recordCount,
    backendMountId: parameters.filestoreBackendId,
    stagingPrefix: normalizedStagingPrefix,
    stagingMinutePrefix,
    files: stagingFiles,
    normalizedAt,
    calibrationsApplied
  } satisfies RawAssetPayload;

  if (metastoreConfig) {
    const primarySource = stagingFiles[0];
    const updatedMetadata: Record<string, unknown> = {
      ...existingMetadata,
      type: existingMetadata.type ?? INGEST_RECORD_TYPE,
      status: 'processed',
      processedAt: normalizedAt,
      minute: parameters.minute,
      minuteKey: stagingSubdir,
      instrumentId: primarySource?.instrumentId ?? existingMetadata.instrumentId ?? null,
      site: primarySource?.site ?? existingMetadata.site ?? null,
      rows: recordCount,
      instrumentCount: instrumentIds.size,
      filestorePath: normalizedCommandPath ?? existingMetadata.filestorePath ?? null,
      stagingPath: primarySource?.path ?? existingMetadata.stagingPath ?? null,
      stagingNodeId: primarySource?.nodeId ?? existingMetadata.stagingNodeId ?? null,
      stagingSizeBytes: primarySource?.sizeBytes ?? existingMetadata.stagingSizeBytes ?? null,
      stagingChecksum: primarySource?.checksum ?? existingMetadata.stagingChecksum ?? existingMetadata.checksum ?? null,
      archivePath: archiveTargetPath ?? existingMetadata.archivePath ?? null,
      archiveRelativePath: archiveRelative
    };
    applyCalibrationMetadata(updatedMetadata, primarySource?.calibration ?? null);
    await upsertMetastoreRecord(metastoreConfig, recordKeySource, updatedMetadata);
  }

  await context.update({
    filesProcessed: stagingFiles.length,
    recordCount,
    filesArchived: stagingFiles.length,
    instrumentId: stagingFiles[0]?.instrumentId ?? null,
    calibrationId: stagingFiles[0]?.calibration?.calibrationId ?? null
  });

  context.logger('Normalized observatory inbox file', {
    minute: parameters.minute,
    filesProcessed: stagingFiles.length,
    recordCount,
    instrumentId: stagingFiles[0]?.instrumentId ?? null,
    stagingPrefix: stagingMinutePrefix,
    archivePrefix: parameters.archivePrefix,
    calibrationId: stagingFiles[0]?.calibration?.calibrationId ?? null
  });

  if (inboxNode) {
    const observedAt = inboxNode.observedAt ?? normalizedAt;
    const metadataRecord = toJsonRecord({
      minute: parameters.minute,
      commandPath: normalizedCommandPath,
      stagingPrefix: stagingMinutePrefix,
      archivePrefix: parameters.archivePrefix,
      files: stagingFiles
    });

    await observatoryEvents.publish({
      type: 'observatory.minute.raw-uploaded',
      payload: {
        minute: parameters.minute,
        observedAt,
        backendMountId: parameters.filestoreBackendId,
        nodeId: inboxNode.id ?? null,
        path: inboxNode.path,
        instrumentId: stagingFiles[0]?.instrumentId ?? null,
        site: stagingFiles[0]?.site ?? null,
        metadata: metadataRecord,
        principal: parameters.principal ?? null,
        sizeBytes: inboxNode.sizeBytes ?? null,
        checksum: inboxNode.checksum ?? null
      }
    });
  }

  return {
    status: 'succeeded',
    result: {
      partitionKey: parameters.minute,
      normalized: payload,
      assets: [
        {
          assetId: 'observatory.timeseries.raw',
          partitionKey: parameters.minute,
          producedAt: normalizedAt,
          payload
        }
      ]
    }
  } satisfies JobRunResult;
  } finally {
    await observatoryEvents.close().catch(() => undefined);
  }
}

export default handler;

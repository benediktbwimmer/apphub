import { FilestoreClient, FilestoreClientError } from '@apphub/filestore-client';
import { enforceScratchOnlyWrites } from '../../shared/scratchGuard';

enforceScratchOnlyWrites();
import { createObservatoryEventPublisher } from '../../shared/events';
import {
  applyCalibrationAdjustments,
  fetchCalibrationById,
  lookupCalibration,
  type CalibrationLookupConfig,
  type CalibrationLookupResult,
  type CalibrationSnapshot
} from '../../shared/calibrations';

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

type RawAssetFile = {
  path: string;
  nodeId?: number;
  site?: string;
  instrumentId?: string;
  rows?: number;
  sizeBytes?: number;
  checksum?: string;
  calibration?: CalibrationReference | null;
};

type RawAsset = {
  partitionKey: string;
  minute: string;
  backendMountId: number;
  stagingPrefix: string;
  stagingMinutePrefix?: string;
  files: RawAssetFile[];
  instrumentCount?: number;
  recordCount?: number;
  normalizedAt?: string;
  calibrationsApplied?: CalibrationReference[];
};

type CalibrationReference = {
  calibrationId: string;
  instrumentId: string;
  effectiveAt: string;
  metastoreVersion: number | null;
};

type InstrumentCalibrationState = {
  reference: CalibrationReference | null;
  snapshot: CalibrationSnapshot | null;
  lookup?: CalibrationLookupResult;
  warnedMissing?: boolean;
  warnedFuture?: boolean;
};

type TimestoreLoaderParameters = {
  datasetSlug: string;
  datasetName?: string;
  tableName: string;
  timestoreBaseUrl: string;
  timestoreAuthToken?: string;
  storageTargetId?: string;
  partitionNamespace?: string;
  minute: string;
  filestoreBaseUrl: string;
  filestoreToken?: string;
  filestoreBackendId: number;
  filestorePrincipal?: string;
  stagingPrefix: string;
  rawAsset: RawAsset | null;
  idempotencyKey?: string;
  calibrationsBaseUrl?: string;
  calibrationsNamespace?: string;
  calibrationsAuthToken?: string;
};

type ObservatoryRow = {
  timestamp: string;
  instrument_id: string;
  site: string;
  temperature_c: number;
  relative_humidity_pct: number;
  pm2_5_ug_m3: number;
  battery_voltage: number;
};

const DEFAULT_SCHEMA_FIELDS = [
  { name: 'timestamp', type: 'timestamp' as const },
  { name: 'instrument_id', type: 'string' as const },
  { name: 'site', type: 'string' as const },
  { name: 'temperature_c', type: 'double' as const },
  { name: 'relative_humidity_pct', type: 'double' as const },
  { name: 'pm2_5_ug_m3', type: 'double' as const },
  { name: 'battery_voltage', type: 'double' as const }
];

const DEFAULT_PARTITION_NAMESPACE = 'observatory';
const DEFAULT_TABLE_NAME = 'observations';
const DEFAULT_TIMESTORE_BASE_URL = 'http://127.0.0.1:4200';
const DEFAULT_DATASET_SLUG = 'observatory-timeseries';

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

function ensureArray<T>(value: unknown, mapper: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: T[] = [];
  for (const entry of value) {
    const mapped = mapper(entry);
    if (mapped !== null) {
      result.push(mapped);
    }
  }
  return result;
}

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

function parseOptionalInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return null;
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

function resolveCalibrationInstrument(
  calibrationId: string,
  candidate: string,
  fallback: string
): string {
  if (candidate) {
    return candidate;
  }
  if (fallback) {
    return fallback;
  }
  if (!calibrationId) {
    return 'unknown';
  }
  const index = calibrationId.indexOf(':');
  if (index > 0) {
    return calibrationId.slice(0, index);
  }
  return calibrationId;
}

function parseCalibrationReference(value: unknown, fallbackInstrumentId: string): CalibrationReference | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const calibrationId = ensureString(record.calibrationId ?? record.id ?? record.key);
  const effectiveAtRaw = ensureString(record.effectiveAt ?? record.effective_at ?? record.timestamp);
  if (!calibrationId || !effectiveAtRaw) {
    return null;
  }
  const instrumentCandidate = ensureString(record.instrumentId ?? record.instrument_id ?? '');
  const instrumentId = resolveCalibrationInstrument(calibrationId, instrumentCandidate, fallbackInstrumentId);
  const effectiveAt = normalizeIsoString(effectiveAtRaw) ?? effectiveAtRaw;
  const metastoreVersion = parseOptionalInteger(
    record.metastoreVersion ?? record.version ?? record.metastore_version
  );
  return {
    calibrationId,
    instrumentId,
    effectiveAt,
    metastoreVersion
  } satisfies CalibrationReference;
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

function parseRawAsset(raw: unknown): RawAsset | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }
    try {
      return parseRawAsset(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }

  if (!isRecord(raw)) {
    return null;
  }

  const partitionKey = ensureString(raw.partitionKey ?? raw.partition_key ?? raw.hour);
  const minute = ensureString(raw.minute ?? raw.partitionKey ?? raw.partition_key ?? raw.hour);
  const backendMountId = ensureNumber(
    raw.backendMountId ??
      raw.backend_mount_id ??
      raw.filestoreBackendId ??
      raw.filestore_backend_id
  );
  const stagingPrefix = ensureString(
    raw.stagingPrefix ?? raw.staging_prefix ?? raw.filestoreStagingPrefix ?? raw.filestore_staging_prefix ?? ''
  );
  const stagingMinutePrefix = ensureString(
    raw.stagingMinutePrefix ?? raw.staging_minute_prefix ?? raw.minutePrefix ?? raw.minute_prefix ?? ''
  );
  const files = ensureArray<RawAssetFile>(raw.files ?? raw.sourceFiles ?? raw.source_files, (entry) => {
    if (!isRecord(entry)) {
      return null;
    }
    const pathValue = ensureString(entry.path ?? entry.filestorePath ?? entry.relativePath ?? entry.relative_path ?? '');
    if (!pathValue) {
      return null;
    }
    const site = ensureString(entry.site ?? entry.location ?? '');
    const instrumentId = ensureString(entry.instrumentId ?? entry.instrument_id ?? '');
    const rows = typeof entry.rows === 'number' && Number.isFinite(entry.rows) ? entry.rows : undefined;
    const nodeIdValue = ensureNumber(entry.nodeId ?? entry.node_id ?? entry.id);
    const sizeBytesValue = ensureNumber(entry.sizeBytes ?? entry.size_bytes ?? entry.size);
    const checksum = ensureString(entry.checksum ?? '');
    const calibration = parseCalibrationReference(
      entry.calibration ?? entry.calibrationMetadata ?? entry.calibration_reference,
      instrumentId
    );
    return {
      path: pathValue,
      site: site || undefined,
      instrumentId: instrumentId || undefined,
      rows,
      nodeId: nodeIdValue ?? undefined,
      sizeBytes: sizeBytesValue ?? undefined,
      checksum: checksum || undefined,
      calibration: calibration ?? null
    } satisfies RawAssetFile;
  });

  const calibrationsApplied = ensureArray<CalibrationReference>(
    raw.calibrationsApplied ??
      raw.calibrations_applied ??
      raw.calibrationReferences ??
      raw.calibration_references,
    (entry) => parseCalibrationReference(entry, '')
  );

  if (!partitionKey || !minute) {
    return null;
  }

  return {
    partitionKey,
    minute,
    backendMountId: backendMountId ?? 0,
    stagingPrefix,
    stagingMinutePrefix: stagingMinutePrefix || undefined,
    files,
    calibrationsApplied: calibrationsApplied.length > 0 ? calibrationsApplied : undefined
  } satisfies RawAsset;
}

function parseParameters(raw: unknown): TimestoreLoaderParameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }

  const datasetSlug =
    ensureString(raw.datasetSlug ?? raw.dataset_slug ?? raw.slug) ||
    ensureString(process.env.TIMESTORE_DATASET_SLUG, DEFAULT_DATASET_SLUG) ||
    DEFAULT_DATASET_SLUG;
  if (!datasetSlug) {
    throw new Error('datasetSlug parameter is required');
  }

  const datasetName = ensureString(raw.datasetName ?? raw.dataset_name ?? '');
  const tableName = ensureString(raw.tableName ?? raw.table_name ?? DEFAULT_TABLE_NAME) || DEFAULT_TABLE_NAME;
  const timestoreBaseUrl = ensureString(
    raw.timestoreBaseUrl ?? raw.timestore_base_url ?? raw.apiBaseUrl ?? raw.api_base_url
  ) || DEFAULT_TIMESTORE_BASE_URL;
  const timestoreAuthToken = ensureString(raw.timestoreAuthToken ?? raw.timestore_auth_token ?? raw.apiToken);
  const storageTargetId = ensureString(raw.storageTargetId ?? raw.storage_target_id ?? '');
  const partitionNamespace = ensureString(raw.partitionNamespace ?? raw.partition_namespace ?? '')
    || DEFAULT_PARTITION_NAMESPACE;
  const minute = ensureString(raw.minute ?? raw.partitionKey ?? raw.partition_key ?? raw.hour);
  if (!minute) {
    throw new Error('minute parameter is required');
  }

  const idempotencyKey = ensureString(raw.idempotencyKey ?? raw.idempotency_key ?? minute);
  let rawAsset = parseRawAsset(raw.rawAsset ?? raw.raw_asset);

  const filestoreBaseUrl = ensureString(
    raw.filestoreBaseUrl ??
      raw.filestore_base_url ??
      process.env.OBSERVATORY_FILESTORE_BASE_URL ??
      process.env.FILESTORE_BASE_URL ??
      ''
  );
  const filestoreToken = ensureString(
    raw.filestoreToken ?? raw.filestore_token ?? process.env.OBSERVATORY_FILESTORE_TOKEN ?? ''
  );
  const explicitBackendId = ensureNumber(raw.filestoreBackendId ?? raw.filestore_backend_id);
  const fallbackBackendId = rawAsset ? rawAsset.backendMountId : null;
  const filestoreBackendId = explicitBackendId ?? fallbackBackendId;
  if (!filestoreBaseUrl) {
    throw new Error('filestoreBaseUrl parameter is required');
  }
  if (filestoreBackendId === null) {
    throw new Error('filestoreBackendId parameter is required');
  }
  const stagingPrefixInput = ensureString(
    raw.stagingPrefix ?? raw.staging_prefix ?? rawAsset?.stagingPrefix ?? ''
  );
  if (!stagingPrefixInput) {
    throw new Error('stagingPrefix parameter is required');
  }
  const stagingPrefix = stagingPrefixInput.replace(/\/+$/g, '');
  const filestorePrincipal = ensureString(
    raw.filestorePrincipal ?? raw.filestore_principal ?? raw.principal ?? ''
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

  const finalCalibrationsBaseUrl = calibrationsBaseUrlCandidate || '';
  const finalCalibrationsAuthToken = calibrationsAuthTokenCandidate || '';

  if (rawAsset) {
    if (!rawAsset.backendMountId || rawAsset.backendMountId <= 0) {
      rawAsset.backendMountId = filestoreBackendId;
    }
    if (!rawAsset.stagingPrefix) {
      rawAsset.stagingPrefix = stagingPrefix;
    }
    if (!rawAsset.stagingMinutePrefix) {
      const minuteKey = minute.replace(/:/g, '-');
      rawAsset.stagingMinutePrefix = `${stagingPrefix}/${minuteKey}`;
    }
  }

  return {
    datasetSlug,
    datasetName: datasetName || undefined,
    tableName,
    timestoreBaseUrl,
    timestoreAuthToken: timestoreAuthToken || undefined,
    storageTargetId: storageTargetId || undefined,
    partitionNamespace,
    minute,
    filestoreBaseUrl,
    filestoreToken: filestoreToken || undefined,
    filestoreBackendId,
    filestorePrincipal: filestorePrincipal || undefined,
    stagingPrefix,
    rawAsset,
    idempotencyKey: idempotencyKey || undefined,
    calibrationsBaseUrl: finalCalibrationsBaseUrl
      ? finalCalibrationsBaseUrl.replace(/\/+$/, '')
      : undefined,
    calibrationsNamespace:
      (calibrationsNamespace || 'observatory.calibrations').trim() || 'observatory.calibrations',
    calibrationsAuthToken: finalCalibrationsAuthToken || undefined
  } satisfies TimestoreLoaderParameters;
}

function inferInstrumentFromFilename(path: string): string | undefined {
  const name = path.split('/').pop() ?? '';
  const match = name.match(/([A-Za-z0-9_-]+)_\d+/);
  return match ? match[1] : undefined;
}

async function discoverRawAssetFromStaging(
  parameters: TimestoreLoaderParameters,
  filestoreClient: FilestoreClient,
  logger: JobRunContext['logger']
): Promise<RawAsset> {
  const normalizedStagingPrefix = parameters.stagingPrefix.replace(/\/+$/g, '');
  const minuteKey = parameters.minute.replace(/:/g, '-');
  const stagingMinutePrefix = `${normalizedStagingPrefix}/${minuteKey}`;
  logger('rawAsset parameter missing; discovering staging files for timestore loader', {
    stagingMinutePrefix,
    backendMountId: parameters.filestoreBackendId
  });

  const files: RawAssetFile[] = [];
  const calibrations: CalibrationReference[] = [];
  let normalizedAt: string | undefined;
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const page = await filestoreClient.listNodes({
      backendMountId: parameters.filestoreBackendId,
      path: stagingMinutePrefix,
      depth: 1,
      limit: pageSize,
      offset
    });

    for (const node of page.nodes) {
      if (node.kind !== 'file') {
        continue;
      }
      const metadata = (node.metadata ?? {}) as Record<string, unknown>;
      const instrumentCandidate = ensureString(metadata.instrumentId ?? metadata.instrument_id ?? '');
      const instrumentId = instrumentCandidate || inferInstrumentFromFilename(node.path);
      const siteCandidate = ensureString(metadata.site ?? metadata.location ?? '');
      const rowsCandidate = ensureNumber(metadata.rows ?? metadata.recordCount ?? metadata.rowCount ?? null);
      const calibration = parseCalibrationReference(
        metadata.calibration ?? metadata.calibrationMetadata ?? metadata.calibration_reference,
        instrumentId ?? ''
      );
      const normalizedAtCandidate = ensureString(metadata.normalizedAt ?? metadata.normalized_at ?? '');
      if (!normalizedAt && normalizedAtCandidate) {
        normalizedAt = normalizeIsoString(normalizedAtCandidate) ?? normalizedAtCandidate;
      }
      if (calibration) {
        calibrations.push(calibration);
      }

      files.push({
        path: node.path,
        nodeId: node.id,
        site: siteCandidate || undefined,
        instrumentId: instrumentId || undefined,
        rows: rowsCandidate ?? undefined,
        sizeBytes: Number.isFinite(node.sizeBytes) ? node.sizeBytes : undefined,
        checksum: typeof node.checksum === 'string' && node.checksum.length > 0 ? node.checksum : undefined,
        calibration
      });
    }

    if (page.nextOffset === null || page.nextOffset === page.offset) {
      break;
    }
    offset = page.nextOffset;
  }

  if (files.length === 0) {
    throw new Error(`No staging files found under ${stagingMinutePrefix}`);
  }

  const recordCount = files.reduce((total, file) => total + (file.rows ?? 0), 0);
  const instrumentIds = new Set<string>();
  for (const file of files) {
    if (file.instrumentId) {
      instrumentIds.add(file.instrumentId);
    }
  }

  const uniqueCalibrations = calibrations.filter((entry, index, list) => {
    if (!entry) {
      return false;
    }
    return list.findIndex((candidate) => candidate && candidate.calibrationId === entry.calibrationId) === index;
  });

  return {
    partitionKey: parameters.minute,
    minute: parameters.minute,
    backendMountId: parameters.filestoreBackendId,
    stagingPrefix: normalizedStagingPrefix,
    stagingMinutePrefix,
    files,
    recordCount: recordCount || undefined,
    instrumentCount: instrumentIds.size || undefined,
    normalizedAt,
    calibrationsApplied: uniqueCalibrations.length > 0 ? uniqueCalibrations : undefined
  } satisfies RawAsset;
}

function toCalibrationConfig(parameters: TimestoreLoaderParameters): CalibrationLookupConfig | null {
  if (!parameters.calibrationsBaseUrl) {
    return null;
  }
  return {
    baseUrl: parameters.calibrationsBaseUrl.replace(/\/+$/, ''),
    namespace: parameters.calibrationsNamespace?.trim() || 'observatory.calibrations',
    authToken: parameters.calibrationsAuthToken?.trim() || undefined
  } satisfies CalibrationLookupConfig;
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

function findCalibrationReference(rawAsset: RawAsset, instrumentId: string): CalibrationReference | null {
  for (const file of rawAsset.files) {
    const fileInstrument = file.instrumentId ?? instrumentId;
    if (fileInstrument === instrumentId && file.calibration) {
      return file.calibration;
    }
  }

  for (const reference of rawAsset.calibrationsApplied ?? []) {
    if (reference && reference.instrumentId === instrumentId) {
      return reference;
    }
  }

  return null;
}

async function ingestableRowsFromCsv(
  filestoreClient: FilestoreClient,
  backendMountId: number,
  source: RawAssetFile,
  principal?: string
): Promise<{ rows: ObservatoryRow[]; minTimestamp: string; maxTimestamp: string }> {
  const normalizedPath = source.path.replace(/^\/+/g, '').replace(/\/+/g, '/');
  let nodeId = typeof source.nodeId === 'number' && Number.isFinite(source.nodeId) ? source.nodeId : null;
  if (!nodeId) {
    try {
      const node = await filestoreClient.getNodeByPath({
        backendMountId,
        path: normalizedPath
      });
      nodeId = node.id ?? null;
    } catch (error) {
      if (error instanceof FilestoreClientError && error.statusCode === 404) {
        throw new Error(`Staging file ${normalizedPath} no longer available in Filestore`);
      }
      throw error;
    }
  }

  if (!nodeId) {
    throw new Error(`Unable to resolve node id for staging file ${normalizedPath}`);
  }

  const download = await filestoreClient.downloadFile(nodeId, {
    principal
  });
  const content = await readStreamToString(download.stream);
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return { rows: [], minTimestamp: '', maxTimestamp: '' };
  }

  const headers = lines[0]?.split(',').map((entry) => entry.trim().toLowerCase()) ?? [];
  const timestampIndex = headers.indexOf('timestamp');
  const instrumentIndex = headers.indexOf('instrument_id');
  const siteIndex = headers.indexOf('site');
  const temperatureIndex = headers.indexOf('temperature_c');
  const humidityIndex = headers.indexOf('relative_humidity_pct');
  const pm25Index = headers.indexOf('pm2_5_ug_m3');
  const batteryIndex = headers.indexOf('battery_voltage');

  if (timestampIndex === -1) {
    throw new Error(`CSV file ${normalizedPath} is missing required timestamp column`);
  }

  const rows: ObservatoryRow[] = [];
  let minTimestamp = '';
  let maxTimestamp = '';

  for (let index = 1; index < lines.length; index += 1) {
    const parts = lines[index]?.split(',') ?? [];
    const timestampRaw = ensureString(parts[timestampIndex] ?? '');
    if (!timestampRaw) {
      continue;
    }
    const timestamp = new Date(timestampRaw).toISOString();
    if (!timestamp || Number.isNaN(new Date(timestamp).getTime())) {
      continue;
    }
    const instrument = ensureString(parts[instrumentIndex] ?? source.instrumentId ?? '');
    const site = ensureString(parts[siteIndex] ?? source.site ?? '');
    const temperature = Number(parts[temperatureIndex] ?? '0');
    const humidity = Number(parts[humidityIndex] ?? '0');
    const pm25 = Number(parts[pm25Index] ?? '0');
    const battery = Number(parts[batteryIndex] ?? '0');

    rows.push({
      timestamp,
      instrument_id: instrument,
      site,
      temperature_c: Number.isFinite(temperature) ? temperature : 0,
      relative_humidity_pct: Number.isFinite(humidity) ? humidity : 0,
      pm2_5_ug_m3: Number.isFinite(pm25) ? pm25 : 0,
      battery_voltage: Number.isFinite(battery) ? battery : 0
    });

    if (!minTimestamp || timestamp < minTimestamp) {
      minTimestamp = timestamp;
    }
    if (!maxTimestamp || timestamp > maxTimestamp) {
      maxTimestamp = timestamp;
    }
  }

  return { rows, minTimestamp, maxTimestamp };
}

function buildPartitionKey(namespace: string, instrumentId: string, minute: string): Record<string, string> {
  const normalizedInstrument = instrumentId && instrumentId.trim().length > 0 ? instrumentId.trim() : 'unknown';
  return {
    dataset: namespace,
    instrument: normalizedInstrument,
    window: minute
  } satisfies Record<string, string>;
}

function serializePartitionKey(key: Record<string, string>): string {
  return Object.entries(key)
    .map(([field, value]) => ({ field, value }))
    .filter(({ field, value }) => field.length > 0 && value.length > 0)
    .sort((a, b) => a.field.localeCompare(b.field))
    .map(({ field, value }) => `${field}=${value}`)
    .join('|');
}

type InstrumentBucket = {
  rows: ObservatoryRow[];
  minTimestamp: string;
  maxTimestamp: string;
};

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  const parameters = parseParameters(context.parameters);
  const observatoryEvents = createObservatoryEventPublisher({
    source: 'observatory.timestore-loader'
  });
  const publishOperations: Array<Promise<void>> = [];
  const filestoreClient = new FilestoreClient({
    baseUrl: parameters.filestoreBaseUrl,
    token: parameters.filestoreToken,
    userAgent: 'observatory-timestore-loader/0.2.0'
  });
  if (!parameters.rawAsset) {
    try {
      parameters.rawAsset = await discoverRawAssetFromStaging(parameters, filestoreClient, context.logger);
    } catch (error) {
      context.logger('Failed to infer rawAsset from staging prefix', {
        minute: parameters.minute,
        stagingPrefix: parameters.stagingPrefix,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  const rawAsset = parameters.rawAsset;
  if (!rawAsset) {
    throw new Error('Unable to resolve rawAsset for timestore loader');
  }
  const backendMountId = parameters.filestoreBackendId || rawAsset.backendMountId;
  if (!backendMountId || backendMountId <= 0) {
    throw new Error('filestoreBackendId must be provided for timestore loader');
  }

  const calibrationConfig = toCalibrationConfig(parameters);
  const instrumentCalibrations = new Map<string, InstrumentCalibrationState>();
  const calibrationAsOf = deriveCalibrationAsOf(parameters.minute);

  function maybeWarnCalibrationState(
    instrumentId: string,
    state: InstrumentCalibrationState
  ): void {
    if (!state.snapshot && !state.reference && !state.warnedMissing) {
      state.warnedMissing = true;
      context.logger('No calibration found for instrument', {
        instrumentId,
        minute: parameters.minute
      });
    }

    if (state.warnedFuture) {
      return;
    }

    const latest = state.lookup?.latest;
    if (!latest) {
      return;
    }
    const latestMs = parseIsoToMs(latest.effectiveAt);
    const asOfMs = parseIsoToMs(calibrationAsOf);
    if (latestMs !== null && asOfMs !== null && latestMs > asOfMs) {
      state.warnedFuture = true;
      context.logger('Calibration effectiveAt is in the future', {
        instrumentId,
        minute: parameters.minute,
        effectiveAt: latest.effectiveAt
      });
    }
  }

  async function resolveCalibrationForInstrument(
    instrumentId: string
  ): Promise<InstrumentCalibrationState> {
    const key = instrumentId.trim() || 'unknown';
    const existing = instrumentCalibrations.get(key);
    if (existing) {
      maybeWarnCalibrationState(key, existing);
      return existing;
    }

    const state: InstrumentCalibrationState = {
      reference: findCalibrationReference(rawAsset, key),
      snapshot: null
    };

    if (!calibrationConfig) {
      instrumentCalibrations.set(key, state);
      maybeWarnCalibrationState(key, state);
      return state;
    }

    try {
      if (state.reference) {
        state.snapshot = await fetchCalibrationById(calibrationConfig, state.reference.calibrationId);
        if (!state.snapshot) {
          context.logger('Calibration reference not found in metastore', {
            instrumentId: key,
            calibrationId: state.reference.calibrationId
          });
        } else if (
          state.reference.metastoreVersion !== null &&
          state.snapshot.metastoreVersion !== null &&
          state.reference.metastoreVersion !== state.snapshot.metastoreVersion
        ) {
          context.logger('Calibration version mismatch for instrument', {
            instrumentId: key,
            calibrationId: state.reference.calibrationId,
            expectedVersion: state.reference.metastoreVersion,
            actualVersion: state.snapshot.metastoreVersion
          });
        }
      }

      if (!state.snapshot) {
        state.lookup = await lookupCalibration(calibrationConfig, key, calibrationAsOf, {
          limit: 5
        });
        if (!state.reference && state.lookup.active) {
          state.reference = {
            calibrationId: state.lookup.active.calibrationId,
            instrumentId: state.lookup.active.instrumentId ?? key,
            effectiveAt: state.lookup.active.effectiveAt,
            metastoreVersion: state.lookup.active.metastoreVersion ?? null
          } satisfies CalibrationReference;
          state.snapshot = state.lookup.active;
        }
      }
    } catch (error) {
      context.logger('Calibration lookup failed for instrument', {
        instrumentId: key,
        minute: parameters.minute,
        error: error instanceof Error ? error.message : String(error)
      });
      state.warnedMissing = true;
    }

    instrumentCalibrations.set(key, state);
    maybeWarnCalibrationState(key, state);
    return state;
  }

  try {
    const instrumentBuckets = new Map<string, InstrumentBucket>();
    let totalRows = 0;

    if (rawAsset.files.length === 0) {
      context.logger('No source files provided for Timestore ingestion; skipping', {
        minute: parameters.minute,
        datasetSlug: parameters.datasetSlug
      });
      await context.update({ skipped: true, reason: 'no-source-files' });
      return {
        status: 'succeeded',
        result: {
          skipped: true,
          rowsIngested: 0,
          datasetSlug: parameters.datasetSlug,
          minute: parameters.minute
        }
      } satisfies JobRunResult;
    }

    for (const source of rawAsset.files) {
      const { rows, minTimestamp, maxTimestamp } = await ingestableRowsFromCsv(
        filestoreClient,
        backendMountId,
        source,
        parameters.filestorePrincipal
      );
      context.logger('Parsed staging file for Timestore ingestion', {
        path: source.path,
        rows: rows.length
      });

      const sourceInstrumentId = source.instrumentId ?? rows[0]?.instrument_id ?? 'unknown';
      const calibrationState = await resolveCalibrationForInstrument(sourceInstrumentId);

      if (calibrationState.snapshot) {
        for (const row of rows) {
          const adjusted = applyCalibrationAdjustments(
            {
              temperature_c: row.temperature_c,
              relative_humidity_pct: row.relative_humidity_pct,
              pm2_5_ug_m3: row.pm2_5_ug_m3,
              battery_voltage: row.battery_voltage
            },
            {
              offsets: calibrationState.snapshot.offsets,
              scales: calibrationState.snapshot.scales
            }
          );

          if (typeof adjusted.temperature_c === 'number') {
            row.temperature_c = Number(adjusted.temperature_c.toFixed(6));
          }
          if (typeof adjusted.relative_humidity_pct === 'number') {
            row.relative_humidity_pct = Number(adjusted.relative_humidity_pct.toFixed(6));
          }
          if (typeof adjusted.pm2_5_ug_m3 === 'number') {
            row.pm2_5_ug_m3 = Number(adjusted.pm2_5_ug_m3.toFixed(6));
          }
          if (typeof adjusted.battery_voltage === 'number') {
            row.battery_voltage = Number(adjusted.battery_voltage.toFixed(6));
          }
          row.instrument_id = row.instrument_id || sourceInstrumentId;
        }

        context.logger('Applied calibration adjustments', {
          instrumentId: sourceInstrumentId,
          calibrationId:
            calibrationState.reference?.calibrationId ?? calibrationState.snapshot.calibrationId,
          effectiveAt: calibrationState.snapshot.effectiveAt
        });
      } else {
        for (const row of rows) {
          row.instrument_id = row.instrument_id || sourceInstrumentId;
        }
      }

      for (const row of rows) {
        const instrumentId = row.instrument_id || sourceInstrumentId || 'unknown';
        const bucket = instrumentBuckets.get(instrumentId) ?? {
          rows: [],
          minTimestamp: '',
          maxTimestamp: ''
        };
        bucket.rows.push(row);
        const candidateMin = minTimestamp && minTimestamp.length > 0 ? minTimestamp : row.timestamp;
        const candidateMax = maxTimestamp && maxTimestamp.length > 0 ? maxTimestamp : row.timestamp;
        if (!bucket.minTimestamp || candidateMin < bucket.minTimestamp) {
          bucket.minTimestamp = candidateMin;
        }
        if (!bucket.maxTimestamp || candidateMax > bucket.maxTimestamp) {
          bucket.maxTimestamp = candidateMax;
        }
        instrumentBuckets.set(instrumentId, bucket);
      }
    }

    if (instrumentBuckets.size === 0) {
      throw new Error('No valid observatory readings found in staging directory');
    }

    context.logger('Prepared instrument-partitioned Timestore ingestion batches', {
      instrumentCount: instrumentBuckets.size,
      minute: parameters.minute
    });

    const headers: Record<string, string> = {
      'content-type': 'application/json'
    };
    if (parameters.timestoreAuthToken) {
      headers.authorization = `Bearer ${parameters.timestoreAuthToken}`;
    }

    const ingestionUrl = `${parameters.timestoreBaseUrl.replace(/\/$/, '')}/datasets/${encodeURIComponent(
      parameters.datasetSlug
    )}/ingest`;
    const sanitizedMinuteKey = parameters.minute.replace(/:/g, '-');

    const ingestionSummaries: Array<Record<string, unknown>> = [];
    const assetEntries: Array<Record<string, unknown>> = [];

    for (const [instrumentId, bucket] of instrumentBuckets.entries()) {
      totalRows += bucket.rows.length;

      const partitionKey = buildPartitionKey(
        parameters.partitionNamespace ?? DEFAULT_PARTITION_NAMESPACE,
        instrumentId,
        parameters.minute
      );
      const partitionAttributes = {
        instrumentId,
        window: parameters.minute,
        minuteKey: sanitizedMinuteKey
      } satisfies Record<string, string>;

      const calibrationState = instrumentCalibrations.get(instrumentId) ?? null;
      const calibrationReference = calibrationState?.reference ?? null;

      const ingestionRequest = {
        datasetSlug: parameters.datasetSlug,
        datasetName: parameters.datasetName ?? parameters.datasetSlug,
        tableName: parameters.tableName,
        storageTargetId: parameters.storageTargetId,
        schema: {
          fields: DEFAULT_SCHEMA_FIELDS
        },
        partition: {
          key: partitionKey,
          attributes: partitionAttributes,
          timeRange: {
            start: bucket.minTimestamp || `${parameters.minute}:00Z`,
            end: bucket.maxTimestamp || `${parameters.minute}:59:59.999Z`
          }
        },
        rows: bucket.rows,
        idempotencyKey: parameters.idempotencyKey ? `${parameters.idempotencyKey}:${instrumentId}` : undefined
      } satisfies Record<string, unknown>;

      const response = await fetch(ingestionUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(ingestionRequest)
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`Timestore ingestion failed with status ${response.status}: ${errorText}`);
      }

      const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const manifest = isRecord(responseBody.manifest) ? responseBody.manifest : null;
      const dataset = isRecord(responseBody.dataset) ? responseBody.dataset : null;
      const manifestId = manifest && typeof manifest.id === 'string' ? manifest.id : null;
      const datasetId = dataset && typeof dataset.id === 'string' ? dataset.id : null;

      const partitionKeyString = serializePartitionKey(partitionKey);
      const ingestedAt = new Date().toISOString();

      const summary = {
        instrumentId,
        partitionKey: partitionKeyString,
        partitionKeyFields: partitionKey,
        datasetSlug: parameters.datasetSlug,
        datasetId,
        manifestId,
        rowCount: bucket.rows.length,
        storageTargetId: parameters.storageTargetId ?? null,
        ingestionMode: ensureString(responseBody.mode, 'inline'),
        calibrationId: calibrationReference?.calibrationId ?? null,
        calibrationEffectiveAt: calibrationReference?.effectiveAt ?? null,
        calibrationMetastoreVersion: calibrationReference?.metastoreVersion ?? null
      } satisfies Record<string, unknown>;

      ingestionSummaries.push({ ...summary, ingestedAt });
      assetEntries.push({
        assetId: 'observatory.timeseries.timestore',
        partitionKey: partitionKeyString,
        producedAt: new Date().toISOString(),
        payload: summary
      });

      await context.update({
        instrumentId,
        rows: bucket.rows.length,
        partitionKey: partitionKeyString,
        calibrationId: calibrationReference?.calibrationId ?? null
      });

      publishOperations.push(
        observatoryEvents
          .publish({
            type: 'observatory.minute.partition-ready',
            payload: {
              minute: parameters.minute,
              instrumentId,
              partitionKey: partitionKeyString,
              partitionKeyFields: partitionKey,
              datasetSlug: parameters.datasetSlug,
              datasetId,
              manifestId,
              storageTargetId: parameters.storageTargetId ?? null,
              rowsIngested: bucket.rows.length,
              ingestedAt,
              ingestionMode: summary.ingestionMode as string,
              calibrationId: calibrationReference?.calibrationId ?? null,
              calibrationEffectiveAt: calibrationReference?.effectiveAt ?? null,
              calibrationMetastoreVersion: calibrationReference?.metastoreVersion ?? null
            },
            occurredAt: ingestedAt
          })
          .catch((err) => {
            context.logger('Failed to publish observatory partition event', {
              instrumentId,
              partitionKey: partitionKeyString,
              error: err instanceof Error ? err.message : String(err)
            });
          })
      );
    }

    await Promise.all(publishOperations);

    return {
      status: 'succeeded',
      result: {
        partitions: ingestionSummaries,
        totalRows,
        assets: assetEntries
      }
    } satisfies JobRunResult;
  } finally {
    await observatoryEvents.close().catch(() => undefined);
  }
}

export default handler;

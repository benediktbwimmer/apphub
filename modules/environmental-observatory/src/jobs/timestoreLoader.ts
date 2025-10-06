import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { z } from 'zod';
import {
  CapabilityRequestError,
  createJobHandler,
  inheritModuleSettings,
  inheritModuleSecrets,
  selectEventBus,
  selectFilestore,
  selectMetastore,
  selectTimestore,
  sanitizeIdentifier,
  toTemporalKey,
  type FilestoreCapability,
  type JobContext,
  type MetastoreCapability
} from '@apphub/module-sdk';
import { ensureResolvedBackendId } from '@apphub/module-sdk';
import {
  applyCalibrationAdjustments,
  fetchCalibrationById,
  lookupCalibration,
  type CalibrationLookupConfig,
  type CalibrationLookupResult,
  type CalibrationSnapshot
} from '../runtime/calibrations';
import { createObservatoryEventPublisher } from '../runtime/events';
import type { ObservatoryModuleSecrets, ObservatoryModuleSettings } from '../runtime/settings';

const DEFAULT_SCHEMA_FIELDS = [
  { name: 'timestamp', type: 'timestamp' as const },
  { name: 'instrument_id', type: 'string' as const },
  { name: 'site', type: 'string' as const },
  { name: 'temperature_c', type: 'double' as const },
  { name: 'relative_humidity_pct', type: 'double' as const },
  { name: 'pm2_5_ug_m3', type: 'double' as const },
  { name: 'battery_voltage', type: 'double' as const }
];

const parametersSchema = z
  .object({
    minute: z.string().min(1, 'minute is required'),
    datasetSlug: z.string().min(1).optional(),
    datasetName: z.string().min(1).optional(),
    tableName: z.string().min(1).optional(),
    storageTargetId: z.string().min(1).nullable().optional(),
    partitionNamespace: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1).optional(),
    filestoreBackendId: z.number().int().positive().nullable().optional(),
    filestoreBackendKey: z.string().min(1).optional(),
    rawAsset: z.unknown().optional()
  })
  .strip();

export type TimestoreLoaderParameters = z.infer<typeof parametersSchema>;

export interface RawAssetFile {
  path: string;
  nodeId: number | null;
  site: string | null;
  instrumentId: string | null;
  rows: number | null;
  sizeBytes: number | null;
  checksum: string | null;
  calibration: CalibrationReference | null;
}

export interface RawAsset {
  partitionKey: string;
  minute: string;
  backendMountId: number | null;
  backendMountKey: string | null;
  stagingPrefix: string;
  stagingMinutePrefix?: string;
  files: RawAssetFile[];
  calibrationsApplied?: CalibrationReference[];
}

export interface CalibrationReference {
  calibrationId: string;
  instrumentId: string;
  effectiveAt: string;
  metastoreVersion: number | null;
}

export interface TimestorePartitionSummary {
  instrumentId: string;
  partitionKey: string;
  partitionKeyFields: Record<string, string>;
  datasetSlug: string;
  datasetId: string | null;
  manifestId: string | null;
  storageTargetId: string | null;
  rowsIngested: number;
  ingestionMode: string;
  flushPending: boolean;
  calibrationId: string | null;
  calibrationEffectiveAt: string | null;
  calibrationMetastoreVersion: number | null;
  ingestedAt: string;
}

export interface TimestoreLoaderResult {
  partitions: TimestorePartitionSummary[];
  totalRows: number;
  assets: Array<{
    assetId: string;
    partitionKey: string;
    producedAt: string;
    payload: Record<string, unknown>;
  }>;
}

type TimestoreLoaderContext = JobContext<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets,
  TimestoreLoaderParameters
>;

type InstrumentBucket = {
  rows: ObservatoryRow[];
  minTimestamp: string;
  maxTimestamp: string;
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

type CachedCalibration = {
  reference: CalibrationReference | null;
  snapshot: CalibrationSnapshot | null;
  lookup?: CalibrationLookupResult;
  warnedMissing?: boolean;
  warnedFuture?: boolean;
};

function ensureString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
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

function toInteger(value: unknown): number | null {
  const candidate = toNumber(value);
  if (candidate === null) {
    return null;
  }
  return Math.trunc(candidate);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function deriveMinuteKey(minute: string): string {
  return toTemporalKey(minute);
}

function deriveCalibrationAsOf(minute: string): string {
  if (!minute) {
    return new Date().toISOString();
  }
  const candidate = `${minute}:59:59.999Z`;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(minute).toISOString();
  }
  return parsed.toISOString();
}

function sanitizePartitionKey(key: Record<string, string>): string {
  return Object.entries(key)
    .map(([field, value]) => ({ field, value }))
    .filter(({ field, value }) => field && value)
    .sort((a, b) => a.field.localeCompare(b.field))
    .map(({ field, value }) => `${field}=${sanitizeIdentifier(value)}`)
    .join('|');
}

function buildPartitionKey(namespace: string, instrumentId: string, minute: string): Record<string, string> {
  const normalizedInstrument = sanitizeIdentifier(instrumentId?.trim() ?? 'unknown');
  return {
    dataset: namespace,
    instrument: normalizedInstrument,
    window: minute
  } satisfies Record<string, string>;
}

function normalizeCalibrationReference(
  value: unknown,
  fallbackInstrumentId: string
): CalibrationReference | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }
  const calibrationId = ensureString(record.calibrationId ?? record.id ?? record.key);
  const effectiveAtRaw = ensureString(record.effectiveAt ?? record.effective_at ?? record.timestamp);
  if (!calibrationId || !effectiveAtRaw) {
    return null;
  }
  const instrumentCandidate = ensureString(record.instrumentId ?? record.instrument_id ?? '');
  const instrumentId = instrumentCandidate || fallbackInstrumentId || resolveInstrumentFromCalibrationId(calibrationId);
  const effectiveAt = new Date(effectiveAtRaw).toISOString();
  const metastoreVersion = toInteger(record.metastoreVersion ?? record.version ?? record.metastore_version);
  return {
    calibrationId,
    instrumentId,
    effectiveAt,
    metastoreVersion
  } satisfies CalibrationReference;
}

function resolveInstrumentFromCalibrationId(calibrationId: string): string {
  const index = calibrationId.indexOf(':');
  if (index > 0) {
    return calibrationId.slice(0, index);
  }
  return calibrationId || 'unknown';
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

  const record = toRecord(raw);
  if (!record) {
    return null;
  }

  const partitionKey = ensureString(record.partitionKey ?? record.partition_key ?? record.hour ?? '');
  const minute = ensureString(record.minute ?? record.partitionKey ?? record.partition_key ?? record.hour ?? '');
  if (!partitionKey || !minute) {
    return null;
  }

  const backendMountId = toInteger(
    record.backendMountId ??
      record.backend_mount_id ??
      record.filestoreBackendId ??
      record.filestore_backend_id
  );
  const backendMountKey = ensureString(
    record.backendMountKey ??
      record.backend_mount_key ??
      record.filestoreBackendKey ??
      record.filestore_backend_key ??
      ''
  );

  const stagingPrefix = ensureString(
    record.stagingPrefix ?? record.staging_prefix ?? record.filestoreStagingPrefix ?? record.filestore_staging_prefix ?? ''
  );
  if (!stagingPrefix) {
    return null;
  }

  const stagingMinutePrefix = ensureString(
    record.stagingMinutePrefix ?? record.staging_minute_prefix ?? record.minutePrefix ?? record.minute_prefix ?? ''
  );

  const files: RawAssetFile[] = [];
  const fileEntries = Array.isArray(record.files)
    ? record.files
    : Array.isArray(record.sourceFiles)
      ? record.sourceFiles
      : [];

  for (const entry of fileEntries) {
    const fileRecord = toRecord(entry);
    if (!fileRecord) {
      continue;
    }
    const path = ensureString(
      fileRecord.path ?? fileRecord.filestorePath ?? fileRecord.relativePath ?? fileRecord.relative_path ?? ''
    );
    if (!path) {
      continue;
    }
    const site = ensureString(fileRecord.site ?? fileRecord.location ?? '');
    const instrumentId = ensureString(fileRecord.instrumentId ?? fileRecord.instrument_id ?? '');
    const rows = toInteger(fileRecord.rows ?? fileRecord.rowCount ?? fileRecord.row_count);
    const nodeId = toInteger(fileRecord.nodeId ?? fileRecord.node_id ?? fileRecord.id);
    const sizeBytes = toInteger(fileRecord.sizeBytes ?? fileRecord.size_bytes ?? fileRecord.size);
    const checksum = ensureString(fileRecord.checksum ?? fileRecord.contentHash ?? '');
    const calibration = normalizeCalibrationReference(
      fileRecord.calibration ?? fileRecord.calibrationMetadata ?? fileRecord.calibration_reference,
      instrumentId
    );
    files.push({
      path,
      nodeId: nodeId ?? null,
      site: site || null,
      instrumentId: instrumentId || null,
      rows: rows ?? null,
      sizeBytes: sizeBytes ?? null,
      checksum: checksum || null,
      calibration
    } satisfies RawAssetFile);
  }

  const calibrationsApplied = Array.isArray(record.calibrationsApplied)
    ? record.calibrationsApplied
        .map((entry) => normalizeCalibrationReference(entry, ''))
        .filter((entry): entry is CalibrationReference => Boolean(entry))
    : undefined;

  return {
    partitionKey,
    minute,
    backendMountId: backendMountId ?? null,
    backendMountKey: backendMountKey || null,
    stagingPrefix,
    stagingMinutePrefix: stagingMinutePrefix || undefined,
    files,
    calibrationsApplied
  } satisfies RawAsset;
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

function parseCsvContent(content: string): ObservatoryRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const requiredColumns = [
    'timestamp',
    'instrument_id',
    'site',
    'temperature_c',
    'relative_humidity_pct',
    'pm2_5_ug_m3',
    'battery_voltage'
  ];
  const firstRowRaw = lines[0]?.split(',') ?? [];
  let headers = firstRowRaw.map((entry) => entry.trim().toLowerCase());
  let dataStartIndex = 1;

  const headerSet = new Set(headers);
  const missingColumns = requiredColumns.filter((column) => !headerSet.has(column));
  if (missingColumns.length > 0) {
    const headerlessCandidate =
      missingColumns.length === requiredColumns.length && firstRowRaw.length >= requiredColumns.length;
    if (headerlessCandidate) {
      headers = [...requiredColumns];
      dataStartIndex = 0;
    } else {
      throw new Error(`CSV payload is missing required columns: ${missingColumns.join(', ')}`);
    }
  }

  const locateColumn = (column: string): number => headers.indexOf(column);
  let timestampIndex = locateColumn('timestamp');
  const instrumentIndex = locateColumn('instrument_id');
  const siteIndex = locateColumn('site');
  const temperatureIndex = locateColumn('temperature_c');
  const humidityIndex = locateColumn('relative_humidity_pct');
  const pm25Index = locateColumn('pm2_5_ug_m3');
  const batteryIndex = locateColumn('battery_voltage');

  if (timestampIndex === -1) {
    const sampleRowIndex = dataStartIndex < lines.length ? dataStartIndex : 0;
    const sampleColumns = lines[sampleRowIndex]?.split(',') ?? [];
    const inferredIndex = sampleColumns.findIndex((value) => {
      const candidate = ensureString(value);
      if (!candidate) {
        return false;
      }
      const parsed = new Date(candidate);
      return !Number.isNaN(parsed.getTime());
    });
    if (inferredIndex >= 0) {
      timestampIndex = inferredIndex;
    }
  }

  if (timestampIndex === -1) {
    throw new Error('CSV payload is missing a timestamp column');
  }

  const rows: ObservatoryRow[] = [];

  for (let index = dataStartIndex; index < lines.length; index += 1) {
    const columns = lines[index]?.split(',') ?? [];
    const timestampRaw = ensureString(columns[timestampIndex]);
    if (!timestampRaw) {
      continue;
    }
    const timestamp = new Date(timestampRaw).toISOString();
    if (!timestamp || Number.isNaN(new Date(timestamp).getTime())) {
      continue;
    }

    const instrument = ensureString(columns[instrumentIndex] ?? '');
    const site = ensureString(columns[siteIndex] ?? '');
    const temperature = Number(columns[temperatureIndex] ?? '0');
    const humidity = Number(columns[humidityIndex] ?? '0');
    const pm25 = Number(columns[pm25Index] ?? '0');
    const battery = Number(columns[batteryIndex] ?? '0');

    rows.push({
      timestamp,
      instrument_id: instrument,
      site,
      temperature_c: Number.isFinite(temperature) ? temperature : 0,
      relative_humidity_pct: Number.isFinite(humidity) ? humidity : 0,
      pm2_5_ug_m3: Number.isFinite(pm25) ? pm25 : 0,
      battery_voltage: Number.isFinite(battery) ? battery : 0
    });
  }

  return rows;
}

async function ingestableRowsFromCsv(
  filestore: FilestoreCapability,
  context: TimestoreLoaderContext,
  backendMountId: number,
  source: RawAssetFile,
  principal: string | undefined
): Promise<{ rows: ObservatoryRow[]; minTimestamp: string; maxTimestamp: string; checksum: string }> {
  let nodeId = source.nodeId;
  if (!nodeId || nodeId <= 0) {
    try {
      const node = await filestore.getNodeByPath({
        backendMountId,
        path: source.path,
        principal
      });
      nodeId = node.id;
    } catch (error) {
      if (error instanceof CapabilityRequestError && error.status === 404) {
        throw new Error(`Staging file ${source.path} no longer available in the filestore`);
      }
      throw error;
    }
  }

  const download = await filestore.downloadFile({
    nodeId: nodeId!,
    principal
  });

  const content = await readStreamToString(download.stream as Readable);
  const rows = parseCsvContent(content);

  let minTimestamp = '';
  let maxTimestamp = '';
  for (const row of rows) {
    if (!minTimestamp || row.timestamp < minTimestamp) {
      minTimestamp = row.timestamp;
    }
    if (!maxTimestamp || row.timestamp > maxTimestamp) {
      maxTimestamp = row.timestamp;
    }
  }

  const checksum = source.checksum ?? createHash('sha256').update(content, 'utf8').digest('hex');

  return {
    rows,
    minTimestamp,
    maxTimestamp,
    checksum
  };
}

async function discoverRawAssetFromStaging(
  filestore: FilestoreCapability,
  context: TimestoreLoaderContext,
  backendMountId: number,
  stagingPrefix: string,
  minute: string,
  principal: string | undefined
): Promise<RawAsset | null> {
  const normalizedPrefix = stagingPrefix.replace(/\/+$/g, '');
  const minuteKey = deriveMinuteKey(minute);
  const stagingMinutePrefix = `${normalizedPrefix}/${minuteKey}`;

  try {
    const listing = await filestore.listNodes({
      backendMountId,
      path: stagingMinutePrefix,
      depth: 1,
      kinds: ['file'],
      limit: 200,
      principal
    });

    if (!listing.nodes.length) {
      return null;
    }

    const files: RawAssetFile[] = listing.nodes.map((node) => {
      const metadata = toRecord(node.metadata) ?? {};
      const instrumentId = ensureString(metadata.instrumentId ?? metadata.instrument_id ?? '');
      const site = ensureString(metadata.site ?? metadata.location ?? '');
      const rows = toInteger(metadata.rows ?? metadata.rowCount ?? metadata.row_count);
      const calibration = normalizeCalibrationReference(
        metadata.calibration ?? metadata.calibrationMetadata,
        instrumentId
      );
      return {
        path: node.path,
        nodeId: node.id,
        site: site || null,
        instrumentId: instrumentId || null,
        rows: rows ?? null,
        sizeBytes: node.sizeBytes ?? null,
        checksum: ensureString(metadata.stagingChecksum ?? metadata.checksum ?? node.checksum ?? '') || null,
        calibration
      } satisfies RawAssetFile;
    });

    return {
      partitionKey: minute,
      minute,
      backendMountId,
      backendMountKey: null,
      stagingPrefix: normalizedPrefix,
      stagingMinutePrefix,
      files
    } satisfies RawAsset;
  } catch (error) {
    if (error instanceof CapabilityRequestError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function resolveCalibration(
  context: TimestoreLoaderContext,
  cache: Map<string, CachedCalibration>,
  lookupConfig: CalibrationLookupConfig | null,
  instrumentId: string,
  asOf: string,
  rawAsset: RawAsset
): Promise<CachedCalibration> {
  const trimmed = instrumentId.trim() || 'unknown';
  const existing = cache.get(trimmed);
  if (existing) {
    maybeWarnCalibration(context, trimmed, existing, asOf);
    return existing;
  }

  const referenceFromAsset = rawAsset.calibrationsApplied?.find(
    (reference) => reference.instrumentId === trimmed
  );

  const state: CachedCalibration = {
    reference: referenceFromAsset ?? null,
    snapshot: null,
    warnedMissing: false,
    warnedFuture: false
  };

  if (!lookupConfig) {
    cache.set(trimmed, state);
    maybeWarnCalibration(context, trimmed, state, asOf);
    return state;
  }

  try {
    if (state.reference) {
      state.snapshot = await fetchCalibrationById(lookupConfig, state.reference.calibrationId);
      if (!state.snapshot) {
        context.logger.warn('Calibration reference missing from metastore', {
          instrumentId: trimmed,
          calibrationId: state.reference.calibrationId
        });
      }
    }

    if (!state.snapshot) {
      state.lookup = await lookupCalibration(lookupConfig, trimmed, asOf, { limit: 5 });
      if (!state.reference && state.lookup.active) {
        state.reference = {
          calibrationId: state.lookup.active.calibrationId,
          instrumentId: state.lookup.active.instrumentId ?? trimmed,
          effectiveAt: state.lookup.active.effectiveAt,
          metastoreVersion: state.lookup.active.metastoreVersion ?? null
        } satisfies CalibrationReference;
        state.snapshot = state.lookup.active;
      }
    }
  } catch (error) {
    context.logger.warn('Calibration lookup failed', {
      instrumentId: trimmed,
      error: error instanceof Error ? error.message : String(error)
    });
    state.warnedMissing = true;
  }

  cache.set(trimmed, state);
  maybeWarnCalibration(context, trimmed, state, asOf);
  return state;
}

function maybeWarnCalibration(
  context: TimestoreLoaderContext,
  instrumentId: string,
  state: CachedCalibration,
  asOf: string
): void {
  if (!state.reference && !state.snapshot && !state.warnedMissing) {
    state.warnedMissing = true;
    context.logger.warn('No calibration found for instrument', {
      instrumentId,
      minute: asOf
    });
  }

  if (state.warnedFuture) {
    return;
  }

  const latest = state.lookup?.latest;
  if (!latest) {
    return;
  }

  const latestMs = Date.parse(latest.effectiveAt);
  const asOfMs = Date.parse(asOf);
  if (Number.isFinite(latestMs) && Number.isFinite(asOfMs) && latestMs > asOfMs) {
    state.warnedFuture = true;
    context.logger.info('Calibration effectiveAt is in the future', {
      instrumentId,
      effectiveAt: latest.effectiveAt
    });
  }
}

function applyCalibration(
  rows: ObservatoryRow[],
  calibration: CachedCalibration | null,
  instrumentId: string
): void {
  if (!calibration || !calibration.snapshot) {
    for (const row of rows) {
      row.instrument_id = row.instrument_id || instrumentId;
    }
    return;
  }

  for (const row of rows) {
    const adjusted = applyCalibrationAdjustments(
      {
        temperature_c: row.temperature_c,
        relative_humidity_pct: row.relative_humidity_pct,
        pm2_5_ug_m3: row.pm2_5_ug_m3,
        battery_voltage: row.battery_voltage
      },
      {
        offsets: calibration.snapshot.offsets,
        scales: calibration.snapshot.scales
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
    row.instrument_id = row.instrument_id || instrumentId;
  }
}

function buildCalibrationLookupConfig(
  capability: MetastoreCapability | undefined,
  principal: string | undefined,
  settings: ObservatoryModuleSettings
): CalibrationLookupConfig | null {
  if (!capability) {
    return null;
  }
  return {
    namespace: settings.calibrations.namespace,
    metastore: capability,
    principal
  } satisfies CalibrationLookupConfig;
}

export const timestoreLoaderJob = createJobHandler<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets,
  TimestoreLoaderResult,
  TimestoreLoaderParameters,
  ['filestore', 'timestore', 'events.default']
>({
  name: 'observatory-timestore-loader',
  settings: inheritModuleSettings(),
  secrets: inheritModuleSecrets(),
  requires: ['filestore', 'timestore', 'events.default'] as const,
  parameters: {
    resolve: (raw) => {
      const candidate: Record<string, unknown> = { ...(raw ?? {}) };

      const backendId = candidate.filestoreBackendId ?? candidate.backendMountId;
      if (typeof backendId === 'string') {
        const parsed = Number(backendId.trim());
        if (Number.isFinite(parsed) && parsed > 0) {
          candidate.filestoreBackendId = parsed;
        } else {
          delete candidate.filestoreBackendId;
        }
      } else if (typeof backendId === 'number' && Number.isFinite(backendId) && backendId > 0) {
        candidate.filestoreBackendId = backendId;
      }

      const storageTargetCandidate =
        candidate.storageTargetId ?? candidate.timestoreStorageTargetId ?? null;
      if (typeof storageTargetCandidate === 'string') {
        const trimmed = storageTargetCandidate.trim();
        candidate.storageTargetId = trimmed.length > 0 ? trimmed : null;
      } else if (storageTargetCandidate === null || storageTargetCandidate === undefined) {
        candidate.storageTargetId = null;
      }
      delete candidate.timestoreStorageTargetId;

      if (typeof candidate.idempotencyKey === 'string') {
        const trimmed = candidate.idempotencyKey.trim();
        if (trimmed.length === 0) {
          delete candidate.idempotencyKey;
        } else {
          candidate.idempotencyKey = trimmed;
        }
      } else if (candidate.idempotencyKey === null) {
        delete candidate.idempotencyKey;
      }

      return parametersSchema.parse(candidate);
    }
  },
  handler: async (context: TimestoreLoaderContext): Promise<TimestoreLoaderResult> => {
    const filestore = selectFilestore(context.capabilities);
    if (!filestore) {
      throw new Error('Filestore capability is required for the timestore loader job');
    }

    const timestore = selectTimestore(context.capabilities);
    if (!timestore) {
      throw new Error('Timestore capability is required for the timestore loader job');
    }

    const principal = context.settings.principals.timestoreLoader?.trim() || undefined;

    const backendParams = {
      filestoreBackendId: context.parameters.filestoreBackendId ?? context.settings.filestore.backendId ?? null,
      filestoreBackendKey:
        context.parameters.filestoreBackendKey ?? context.settings.filestore.backendKey ?? null
    } satisfies {
      filestoreBackendId?: number | null;
      filestoreBackendKey?: string | null;
    };
    const backendMountId = await ensureResolvedBackendId(filestore, backendParams);

    const datasetSlug = context.parameters.datasetSlug ?? context.settings.timestore.datasetSlug;
    const datasetName = context.parameters.datasetName ?? context.settings.timestore.datasetName;
    const tableName = context.parameters.tableName ?? context.settings.timestore.tableName;
    const storageTargetId =
      context.parameters.storageTargetId ?? context.settings.timestore.storageTargetId ?? undefined;
    const partitionNamespace =
      context.parameters.partitionNamespace ?? context.settings.timestore.partitionNamespace;
    const idempotencyKey = context.parameters.idempotencyKey ?? context.parameters.minute;
    const minute = context.parameters.minute.trim();
    if (!minute) {
      throw new Error('minute parameter is required');
    }

    let rawAsset = parseRawAsset(context.parameters.rawAsset);
    if (!rawAsset) {
      rawAsset = await discoverRawAssetFromStaging(
        filestore,
        context,
        backendMountId,
        context.settings.filestore.stagingPrefix,
        minute,
        principal
      );
    }

    if (!rawAsset) {
      throw new Error('Unable to resolve rawAsset for timestore ingestion');
    }

    rawAsset.backendMountId = rawAsset.backendMountId ?? backendMountId;
    rawAsset.backendMountKey = rawAsset.backendMountKey ?? backendParams.filestoreBackendKey ?? null;
    rawAsset.stagingPrefix = rawAsset.stagingPrefix || context.settings.filestore.stagingPrefix;
    rawAsset.stagingMinutePrefix =
      rawAsset.stagingMinutePrefix ?? `${rawAsset.stagingPrefix}/${deriveMinuteKey(minute)}`;

    if (!rawAsset.files.length) {
      context.logger.info('No source files provided; skipping ingestion', { minute, datasetSlug });
      return {
        partitions: [],
        totalRows: 0,
        assets: []
      } satisfies TimestoreLoaderResult;
    }

    const calibrationCapability = selectMetastore(context.capabilities, 'calibrations');
    const calibrationConfig = buildCalibrationLookupConfig(calibrationCapability, principal, context.settings);
    const calibrationCache = new Map<string, CachedCalibration>();
    const calibrationAsOf = deriveCalibrationAsOf(minute);

    const instrumentBuckets = new Map<string, InstrumentBucket>();
    let totalRows = 0;

    for (const source of rawAsset.files) {
      const { rows, minTimestamp, maxTimestamp } = await ingestableRowsFromCsv(
        filestore,
        context,
        backendMountId,
        source,
        principal
      );

      const sourceInstrumentId = source.instrumentId ?? rows[0]?.instrument_id ?? 'unknown';
      const calibrationState = await resolveCalibration(
        context,
        calibrationCache,
        calibrationConfig,
        sourceInstrumentId,
        calibrationAsOf,
        rawAsset
      );

      applyCalibration(rows, calibrationState, sourceInstrumentId);

      for (const row of rows) {
        const instrumentId = row.instrument_id || sourceInstrumentId || 'unknown';
        const bucket = instrumentBuckets.get(instrumentId) ?? {
          rows: [],
          minTimestamp: '',
          maxTimestamp: ''
        } satisfies InstrumentBucket;
        bucket.rows.push(row);
        if (!bucket.minTimestamp || (minTimestamp && minTimestamp < bucket.minTimestamp)) {
          bucket.minTimestamp = minTimestamp || row.timestamp;
        }
        if (!bucket.maxTimestamp || (maxTimestamp && maxTimestamp > bucket.maxTimestamp)) {
          bucket.maxTimestamp = maxTimestamp || row.timestamp;
        }
        instrumentBuckets.set(instrumentId, bucket);
      }
    }

    if (instrumentBuckets.size === 0) {
      throw new Error('No observatory readings discovered for timestore ingestion');
    }

    const eventsCapability = selectEventBus(context.capabilities, 'default');
    if (!eventsCapability) {
      throw new Error('Event bus capability is required for timestore ingestion');
    }

    const publisher = createObservatoryEventPublisher({
      capability: eventsCapability,
      source: context.settings.events.source || 'observatory.timestore-loader'
    });

    const summaries: TimestorePartitionSummary[] = [];
    const assets: TimestoreLoaderResult['assets'] = [];
    const minuteKey = deriveMinuteKey(minute);

    try {
      for (const [instrumentId, bucket] of instrumentBuckets.entries()) {
        const partitionKeyFields = buildPartitionKey(partitionNamespace, instrumentId, minute);
        const idempotentKeyForPartition = idempotencyKey ? `${idempotencyKey}:${instrumentId}` : undefined;

        const ingestionResult = (await timestore.ingestRecords({
          datasetSlug,
          datasetName,
          tableName,
          storageTargetId,
          schema: {
            fields: DEFAULT_SCHEMA_FIELDS
          },
          partition: {
            key: partitionKeyFields,
            attributes: {
              instrumentId,
              window: minute,
              minuteKey
            },
            timeRange: {
              start: bucket.minTimestamp || `${minute}:00Z`,
              end: bucket.maxTimestamp || `${minute}:59:59.999Z`
            }
          },
          rows: bucket.rows,
          idempotencyKey: idempotentKeyForPartition,
          principal
        })) as {
          dataset?: { id?: string | null } | null;
          manifest?: { id?: string | null } | null;
          storageTarget?: { id?: string | null } | null;
          mode?: string;
          flushPending?: boolean;
        };

        totalRows += bucket.rows.length;

        const calibrationState = calibrationCache.get(instrumentId) ?? null;
        const calibrationReference = calibrationState?.reference ?? null;
        const ingestedAt = new Date().toISOString();
        const partitionKey = sanitizePartitionKey(partitionKeyFields);
        const flushPending = Boolean(ingestionResult.flushPending);

        const summary: TimestorePartitionSummary = {
          instrumentId,
          partitionKey,
          partitionKeyFields,
          datasetSlug,
          datasetId: ingestionResult.dataset?.id ?? null,
          manifestId: (ingestionResult.manifest as { id?: string } | undefined)?.id ?? null,
          storageTargetId:
            (ingestionResult.storageTarget as { id?: string } | undefined)?.id ?? storageTargetId ?? null,
          rowsIngested: bucket.rows.length,
          ingestionMode: ingestionResult.mode ?? 'inline',
          flushPending,
          calibrationId: calibrationReference?.calibrationId ?? null,
          calibrationEffectiveAt: calibrationReference?.effectiveAt ?? null,
          calibrationMetastoreVersion: calibrationReference?.metastoreVersion ?? null,
          ingestedAt
        } satisfies TimestorePartitionSummary;

        summaries.push(summary);
        assets.push({
          assetId: 'observatory.timeseries.timestore',
          partitionKey,
          producedAt: ingestedAt,
          payload: {
            ...summary,
            rowsIngested: summary.rowsIngested
          }
        });
        await publisher.publish({
          type: 'observatory.minute.partition-ready',
          occurredAt: ingestedAt,
          payload: {
            minute,
            instrumentId,
            partitionKey,
            partitionKeyFields,
            datasetSlug,
            datasetId: summary.datasetId,
            manifestId: summary.manifestId,
            storageTargetId: summary.storageTargetId,
            rowsIngested: summary.rowsIngested,
            ingestedAt,
            ingestionMode: summary.ingestionMode,
            flushPending,
            calibrationId: summary.calibrationId,
            calibrationEffectiveAt: summary.calibrationEffectiveAt,
            calibrationMetastoreVersion: summary.calibrationMetastoreVersion
          }
        });
      }
    } finally {
      await publisher.close().catch(() => undefined);
    }

    const windowProducedAt = new Date().toISOString();
    assets.push({
      assetId: 'observatory.burst.window',
      partitionKey: minute,
      producedAt: windowProducedAt,
      payload: {
        minute,
        instrumentCount: instrumentBuckets.size,
        filesIngested: rawAsset.files.length,
        partitions: summaries,
        rowsIngested: totalRows,
        ingestedAt: windowProducedAt,
        stagingPrefix: rawAsset.stagingMinutePrefix,
        backendMountId: rawAsset.backendMountId,
        backendMountKey: rawAsset.backendMountKey
      }
    });

    context.logger.info('Completed timestore ingestion', {
      instrumentCount: instrumentBuckets.size,
      totalRows,
      minute,
      datasetSlug
    });

    return {
      partitions: summaries,
      totalRows,
      assets
    } satisfies TimestoreLoaderResult;
  }
});

import { FilestoreClient, FilestoreClientError } from '@apphub/filestore-client';
import { enforceScratchOnlyWrites } from '../../shared/scratchGuard';

enforceScratchOnlyWrites();
import { createObservatoryEventPublisher } from '../../shared/events';

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
  rawAsset: RawAsset;
  idempotencyKey?: string;
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

function parseRawAsset(raw: unknown): RawAsset {
  if (!isRecord(raw)) {
    throw new Error('rawAsset parameter must be an object');
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
    return {
      path: pathValue,
      site: site || undefined,
      instrumentId: instrumentId || undefined,
      rows,
      nodeId: nodeIdValue ?? undefined,
      sizeBytes: sizeBytesValue ?? undefined,
      checksum: checksum || undefined
    } satisfies RawAssetFile;
  });

  if (!partitionKey || !minute) {
    throw new Error('rawAsset must include partitionKey and minute');
  }

  return {
    partitionKey,
    minute,
    backendMountId: backendMountId ?? 0,
    stagingPrefix,
    stagingMinutePrefix: stagingMinutePrefix || undefined,
    files
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
  const rawAsset = parseRawAsset(raw.rawAsset ?? raw.raw_asset);

  const filestoreBaseUrl = ensureString(
    raw.filestoreBaseUrl ??
      raw.filestore_base_url ??
      (rawAsset ? (raw as Record<string, unknown>).filestoreBaseUrl : undefined) ??
      process.env.OBSERVATORY_FILESTORE_BASE_URL ??
      process.env.FILESTORE_BASE_URL ??
      ''
  );
  const filestoreToken = ensureString(
    raw.filestoreToken ?? raw.filestore_token ?? process.env.OBSERVATORY_FILESTORE_TOKEN ?? ''
  );
  const filestoreBackendId = ensureNumber(
    raw.filestoreBackendId ?? raw.filestore_backend_id ?? rawAsset.backendMountId ?? null
  );
  if (!filestoreBaseUrl) {
    throw new Error('filestoreBaseUrl parameter is required');
  }
  if (filestoreBackendId === null) {
    throw new Error('filestoreBackendId parameter is required');
  }
  const stagingPrefix = ensureString(
    raw.stagingPrefix ?? raw.staging_prefix ?? rawAsset.stagingPrefix ?? ''
  );
  if (!stagingPrefix) {
    throw new Error('stagingPrefix parameter is required');
  }
  const filestorePrincipal = ensureString(
    raw.filestorePrincipal ?? raw.filestore_principal ?? raw.principal ?? ''
  );

  if (!rawAsset.backendMountId || rawAsset.backendMountId <= 0) {
    rawAsset.backendMountId = filestoreBackendId;
  }
  if (!rawAsset.stagingPrefix) {
    rawAsset.stagingPrefix = stagingPrefix;
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
    idempotencyKey: idempotencyKey || undefined
  } satisfies TimestoreLoaderParameters;
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
  const backendMountId = parameters.filestoreBackendId || parameters.rawAsset.backendMountId;
  if (!backendMountId || backendMountId <= 0) {
    throw new Error('filestoreBackendId must be provided for timestore loader');
  }

  try {
    const instrumentBuckets = new Map<string, InstrumentBucket>();
    let totalRows = 0;

    if (parameters.rawAsset.files.length === 0) {
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

    for (const source of parameters.rawAsset.files) {
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
      for (const row of rows) {
        const instrumentId = row.instrument_id || 'unknown';
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
        ingestionMode: ensureString(responseBody.mode, 'inline')
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
        partitionKey: partitionKeyString
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
              ingestionMode: summary.ingestionMode as string
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

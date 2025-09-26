import { readFile } from 'node:fs/promises';
import path from 'node:path';

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

type RawAssetSourceFile = {
  relativePath: string;
  site?: string;
  instrumentId?: string;
  rows?: number;
};

type RawAsset = {
  partitionKey: string;
  minute: string;
  stagingDir: string;
  stagingMinuteDir?: string;
  sourceFiles: RawAssetSourceFile[];
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

function parseRawAsset(raw: unknown): RawAsset {
  if (!isRecord(raw)) {
    throw new Error('rawAsset parameter must be an object');
  }

  const partitionKey = ensureString(raw.partitionKey ?? raw.partition_key ?? raw.hour);
  const minute = ensureString(raw.minute ?? raw.partitionKey ?? raw.partition_key ?? raw.hour);
  const stagingDir = ensureString(raw.stagingDir ?? raw.staging_dir);
  const stagingMinuteDir = ensureString(raw.stagingMinuteDir ?? raw.staging_minute_dir ?? '');
  const sourceFiles = ensureArray<RawAssetSourceFile>(raw.sourceFiles ?? raw.source_files, (entry) => {
    if (!isRecord(entry)) {
      return null;
    }
    const relativePath = ensureString(entry.relativePath ?? entry.relative_path ?? entry.path);
    if (!relativePath) {
      return null;
    }
    const site = ensureString(entry.site ?? entry.location ?? '');
    const instrumentId = ensureString(entry.instrumentId ?? entry.instrument_id ?? '');
    const rows = typeof entry.rows === 'number' && Number.isFinite(entry.rows) ? entry.rows : undefined;
    return {
      relativePath,
      site: site || undefined,
      instrumentId: instrumentId || undefined,
      rows
    } satisfies RawAssetSourceFile;
  });

  if (!partitionKey || !minute || !stagingDir || sourceFiles.length === 0) {
    throw new Error('rawAsset must include partitionKey/minute, stagingDir, and at least one source file');
  }

  return {
    partitionKey,
    minute,
    stagingDir,
    stagingMinuteDir: stagingMinuteDir || undefined,
    sourceFiles
  } satisfies RawAsset;
}

function parseParameters(raw: unknown): TimestoreLoaderParameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }

  const datasetSlug = ensureString(raw.datasetSlug ?? raw.dataset_slug ?? raw.slug);
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

  return {
    datasetSlug,
    datasetName: datasetName || undefined,
    tableName,
    timestoreBaseUrl,
    timestoreAuthToken: timestoreAuthToken || undefined,
    storageTargetId: storageTargetId || undefined,
    partitionNamespace,
    minute,
    rawAsset,
    idempotencyKey: idempotencyKey || undefined
  } satisfies TimestoreLoaderParameters;
}

async function ingestableRowsFromCsv(
  stagingDir: string,
  source: RawAssetSourceFile
): Promise<{ rows: ObservatoryRow[]; minTimestamp: string; maxTimestamp: string }> {
  const absolutePath = path.resolve(stagingDir, source.relativePath);
  const content = await readFile(absolutePath, 'utf8');
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
    throw new Error(`CSV file ${absolutePath} is missing required timestamp column`);
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

function buildPartitionKey(namespace: string, minute: string): Record<string, string> {
  return {
    dataset: namespace,
    window: minute
  } satisfies Record<string, string>;
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  const parameters = parseParameters(context.parameters);
  const allRows: ObservatoryRow[] = [];
  let minTimestamp = '';
  let maxTimestamp = '';

  for (const source of parameters.rawAsset.sourceFiles) {
    const { rows, minTimestamp: localMin, maxTimestamp: localMax } = await ingestableRowsFromCsv(
      parameters.rawAsset.stagingDir,
      source
    );
    context.logger('Parsed staging file for Timestore ingestion', {
      relativePath: source.relativePath,
      rows: rows.length
    });
    if (rows.length === 0) {
      continue;
    }
    allRows.push(...rows);
    if (!minTimestamp || (localMin && localMin < minTimestamp)) {
      minTimestamp = localMin;
    }
    if (!maxTimestamp || (localMax && localMax > maxTimestamp)) {
      maxTimestamp = localMax;
    }
  }

  if (allRows.length === 0) {
    throw new Error('No valid observatory readings found in staging directory');
  }

  context.logger('Prepared Timestore ingestion batch', {
    rows: allRows.length,
    minTimestamp,
    maxTimestamp
  });

  const partition = buildPartitionKey(parameters.partitionNamespace ?? DEFAULT_PARTITION_NAMESPACE, parameters.minute);
  const partitionStart = minTimestamp || `${parameters.minute}:00Z`;
  const partitionEnd = maxTimestamp || `${parameters.minute}:59:59.999Z`;

  const ingestionRequest = {
    datasetSlug: parameters.datasetSlug,
    datasetName: parameters.datasetName ?? parameters.datasetSlug,
    tableName: parameters.tableName,
    storageTargetId: parameters.storageTargetId,
    schema: {
      fields: DEFAULT_SCHEMA_FIELDS
    },
    partition: {
      key: partition,
      timeRange: {
        start: partitionStart,
        end: partitionEnd
      }
    },
    rows: allRows,
    idempotencyKey: parameters.idempotencyKey ?? undefined
  } satisfies Record<string, unknown>;

  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };
  if (parameters.timestoreAuthToken) {
    headers.authorization = `Bearer ${parameters.timestoreAuthToken}`;
  }

  const url = `${parameters.timestoreBaseUrl.replace(/\/$/, '')}/datasets/${encodeURIComponent(
    parameters.datasetSlug
  )}/ingest`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(ingestionRequest)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Timestore ingestion failed with status ${response.status}: ${errorText}`);
  }

  const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  await context.update({
    rows: allRows.length,
    partition: parameters.minute
  });

  const manifest = isRecord(responseBody.manifest) ? responseBody.manifest : null;
  const dataset = isRecord(responseBody.dataset) ? responseBody.dataset : null;

  const resultPayload = {
    partitionKey: parameters.rawAsset.partitionKey,
    datasetSlug: parameters.datasetSlug,
    ingestionMode: ensureString(responseBody.mode, 'inline'),
    manifestId: manifest?.id ?? null,
    datasetId: dataset?.id ?? null,
    rowCount: allRows.length,
    storageTargetId: parameters.storageTargetId ?? null
  } satisfies Record<string, unknown>;

  return {
    status: 'succeeded',
    result: {
      partitionKey: parameters.rawAsset.partitionKey,
      timestoreIngestion: resultPayload,
      assets: [
        {
          assetId: 'observatory.timeseries.timestore',
          partitionKey: parameters.rawAsset.partitionKey,
          producedAt: new Date().toISOString(),
          payload: resultPayload
        }
      ]
    }
  } satisfies JobRunResult;
}

export default handler;

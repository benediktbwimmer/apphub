import { mkdir, writeFile, stat } from 'node:fs/promises';
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

type VisualizationParameters = {
  timestoreBaseUrl: string;
  timestoreDatasetSlug: string;
  timestoreAuthToken?: string;
  plotsDir: string;
  partitionKey: string;
  lookbackMinutes: number;
  siteFilter?: string;
};

type TimestoreQueryResponse = {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  mode: 'raw' | 'downsampled';
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

type TrendRow = {
  minute_key: string;
  avg_temp: number;
  avg_pm25: number;
  avg_humidity: number;
  avg_battery: number;
  samples: number;
};

type SummaryRow = {
  samples: number;
  instrument_count: number;
  site_count: number;
  avg_temp: number;
  avg_pm25: number;
  max_pm25: number;
};

type VisualizationMetrics = {
  samples: number;
  instrumentCount: number;
  siteCount: number;
  averageTemperatureC: number;
  averagePm25: number;
  maxPm25: number;
  partitionKey: string;
  lookbackMinutes: number;
  siteFilter?: string;
};

type VisualizationAssetPayload = {
  generatedAt: string;
  partitionKey: string;
  plotsDir: string;
  lookbackMinutes: number;
  artifacts: Array<{
    relativePath: string;
    mediaType: string;
    description: string;
    sizeBytes: number;
  }>;
  metrics: VisualizationMetrics;
};

const DEFAULT_TIMESTORE_BASE_URL = 'http://127.0.0.1:4200';
const MAX_ROWS = 10000;

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
  if (typeof value === 'bigint') {
    const converted = Number(value);
    if (Number.isFinite(converted)) {
      return converted;
    }
    return fallback;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function parseParameters(raw: unknown): VisualizationParameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }
  const timestoreBaseUrl = ensureString(
    raw.timestoreBaseUrl ?? raw.timestore_base_url ?? DEFAULT_TIMESTORE_BASE_URL
  ).replace(/\/$/, '') || DEFAULT_TIMESTORE_BASE_URL;
  const timestoreDatasetSlug = ensureString(
    raw.timestoreDatasetSlug ?? raw.timestore_dataset_slug ?? raw.datasetSlug
  );
  if (!timestoreDatasetSlug) {
    throw new Error('timestoreDatasetSlug parameter is required');
  }
  const timestoreAuthToken = ensureString(raw.timestoreAuthToken ?? raw.timestore_auth_token ?? '');
  const plotsDir = ensureString(raw.plotsDir ?? raw.plots_dir ?? raw.outputDir);
  const partitionKey = ensureString(raw.partitionKey ?? raw.partition_key);
  if (!plotsDir || !partitionKey) {
    throw new Error('plotsDir and partitionKey parameters are required');
  }
  const lookbackMinutes = Math.max(
    1,
    ensureNumber(raw.lookbackMinutes ?? raw.lookback_minutes ?? raw.lookbackHours ?? raw.lookback_hours, 180)
  );
  const siteFilter = ensureString(raw.siteFilter ?? raw.site_filter ?? '');
  return {
    timestoreBaseUrl,
    timestoreDatasetSlug,
    timestoreAuthToken: timestoreAuthToken || undefined,
    plotsDir,
    partitionKey,
    lookbackMinutes,
    siteFilter: siteFilter || undefined
  } satisfies VisualizationParameters;
}

function toIsoMinute(partitionKey: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(partitionKey)) {
    return `${partitionKey}:00Z`;
  }
  return partitionKey;
}

function computeTimeRange(
  partitionKey: string,
  lookbackMinutes: number
): { startIso: string; endIso: string } {
  const endIso = toIsoMinute(partitionKey);
  const endDate = new Date(endIso);
  if (Number.isNaN(endDate.getTime())) {
    throw new Error(`Invalid partitionKey '${partitionKey}', expected format YYYY-MM-DDTHH:mm`);
  }
  const startDate = new Date(endDate.getTime() - (lookbackMinutes - 1) * 60 * 1000);
  const startIso = startDate.toISOString().slice(0, 19) + 'Z';
  const endWithWindow = new Date(endDate.getTime() + 59 * 1000 + 999);
  const normalizedEndIso = endWithWindow.toISOString().slice(0, 23) + 'Z';
  return { startIso, endIso: normalizedEndIso };
}

async function queryTimestore(
  params: VisualizationParameters,
  startIso: string,
  endIso: string
): Promise<ObservatoryRow[]> {
  const url = `${params.timestoreBaseUrl}/datasets/${encodeURIComponent(params.timestoreDatasetSlug)}/query`;
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };
  if (params.timestoreAuthToken) {
    headers.authorization = `Bearer ${params.timestoreAuthToken}`;
  }

  const body = {
    timeRange: { start: startIso, end: endIso },
    timestampColumn: 'timestamp',
    columns: [
      'timestamp',
      'instrument_id',
      'site',
      'temperature_c',
      'relative_humidity_pct',
      'pm2_5_ug_m3',
      'battery_voltage'
    ],
    limit: MAX_ROWS
  } satisfies Record<string, unknown>;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Timestore query failed with status ${response.status}: ${errorText}`);
  }

  const payload = (await response.json()) as TimestoreQueryResponse;
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const normalized: ObservatoryRow[] = [];

  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const timestamp = ensureString(row.timestamp ?? row['window_start'] ?? '');
    if (!timestamp) {
      continue;
    }
    const parsedDate = new Date(timestamp);
    if (Number.isNaN(parsedDate.getTime())) {
      continue;
    }
    const formattedTimestamp = parsedDate.toISOString();
    const instrumentId = ensureString(row.instrument_id ?? '');
    const site = ensureString(row.site ?? '');
    const temperature = ensureNumber(row.temperature_c, 0);
    const humidity = ensureNumber(row.relative_humidity_pct, 0);
    const pm25 = ensureNumber(row.pm2_5_ug_m3, 0);
    const battery = ensureNumber(row.battery_voltage, 0);

    normalized.push({
      timestamp: formattedTimestamp,
      instrument_id: instrumentId,
      site,
      temperature_c: temperature,
      relative_humidity_pct: humidity,
      pm2_5_ug_m3: pm25,
      battery_voltage: battery
    });
  }

  if (params.siteFilter) {
    const filterValue = params.siteFilter.toLowerCase();
    return normalized.filter((row) => row.site.toLowerCase() === filterValue);
  }
  return normalized;
}

function bucketByMinute(rows: ObservatoryRow[]): TrendRow[] {
  const buckets = new Map<string, {
    sumTemp: number;
    sumPm25: number;
    sumHumidity: number;
    sumBattery: number;
    count: number;
  }>();

  for (const row of rows) {
    const minuteKey = row.timestamp.slice(0, 16);
    const bucket = buckets.get(minuteKey) ?? {
      sumTemp: 0,
      sumPm25: 0,
      sumHumidity: 0,
      sumBattery: 0,
      count: 0
    };
    bucket.sumTemp += row.temperature_c;
    bucket.sumPm25 += row.pm2_5_ug_m3;
    bucket.sumHumidity += row.relative_humidity_pct;
    bucket.sumBattery += row.battery_voltage;
    bucket.count += 1;
    buckets.set(minuteKey, bucket);
  }

  const trendRows: TrendRow[] = [];
  for (const [minute, bucket] of buckets.entries()) {
    trendRows.push({
      minute_key: minute,
      avg_temp: bucket.count > 0 ? bucket.sumTemp / bucket.count : 0,
      avg_pm25: bucket.count > 0 ? bucket.sumPm25 / bucket.count : 0,
      avg_humidity: bucket.count > 0 ? bucket.sumHumidity / bucket.count : 0,
      avg_battery: bucket.count > 0 ? bucket.sumBattery / bucket.count : 0,
      samples: bucket.count
    });
  }

  return trendRows.sort((a, b) => a.minute_key.localeCompare(b.minute_key));
}

function summarizeRows(rows: ObservatoryRow[]): SummaryRow {
  if (rows.length === 0) {
    return {
      samples: 0,
      instrument_count: 0,
      site_count: 0,
      avg_temp: 0,
      avg_pm25: 0,
      max_pm25: 0
    } satisfies SummaryRow;
  }

  const instruments = new Set<string>();
  const sites = new Set<string>();
  let totalTemp = 0;
  let totalPm25 = 0;
  let maxPm25 = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    totalTemp += row.temperature_c;
    totalPm25 += row.pm2_5_ug_m3;
    if (row.pm2_5_ug_m3 > maxPm25) {
      maxPm25 = row.pm2_5_ug_m3;
    }
    if (row.instrument_id) {
      instruments.add(row.instrument_id);
    }
    if (row.site) {
      sites.add(row.site);
    }
  }

  return {
    samples: rows.length,
    instrument_count: instruments.size,
    site_count: sites.size,
    avg_temp: rows.length > 0 ? totalTemp / rows.length : 0,
    avg_pm25: rows.length > 0 ? totalPm25 / rows.length : 0,
    max_pm25: rows.length > 0 ? maxPm25 : 0
  } satisfies SummaryRow;
}

async function writeArtifact(filePath: string, content: string): Promise<number> {
  await writeFile(filePath, content, 'utf8');
  const stats = await stat(filePath);
  return stats.size;
}

function buildSvgPath(rows: TrendRow[], accessor: (row: TrendRow) => number): string {
  if (rows.length === 0) {
    return '';
  }
  const values = rows.map((row) => accessor(row));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 640;
  const height = 240;
  const margin = 32;
  const xScale = (index: number) => {
    if (rows.length === 1) {
      return margin + (width - 2 * margin) / 2;
    }
    return margin + (index / (rows.length - 1)) * (width - 2 * margin);
  };
  const yScale = (value: number) => {
    const ratio = (value - min) / range;
    return height - margin - ratio * (height - 2 * margin);
  };
  const segments = rows.map((row, index) => {
    const x = xScale(index);
    const y = yScale(accessor(row));
    const command = index === 0 ? 'M' : 'L';
    return `${command}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return segments.join(' ');
}

function buildTemperatureSvg(rows: TrendRow[]): string {
  const pathData = buildSvgPath(rows, (row) => row.avg_temp);
  if (!pathData) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="18">No data available</text></svg>';
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240" viewBox="0 0 640 240">
  <rect width="640" height="240" fill="#0b1d2a" />
  <path d="${pathData}" fill="none" stroke="#5bd1ff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
  <text x="20" y="30" fill="#ffffff" font-family="sans-serif" font-size="16">Average Temperature (°C)</text>
</svg>`;
}

function buildPm25Svg(rows: TrendRow[]): string {
  const pathData = buildSvgPath(rows, (row) => row.avg_pm25);
  if (!pathData) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="18">No data available</text></svg>';
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240" viewBox="0 0 640 240">
  <rect width="640" height="240" fill="#1b0b2a" />
  <path d="${pathData}" fill="none" stroke="#ff9f1c" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
  <text x="20" y="30" fill="#ffffff" font-family="sans-serif" font-size="16">Average PM2.5 (µg/m³)</text>
</svg>`;
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  const parameters = parseParameters(context.parameters);
  const { startIso, endIso } = computeTimeRange(parameters.partitionKey, parameters.lookbackMinutes);
  const partitionPlotsKey = parameters.partitionKey.replace(':', '-');
  const partitionPlotsDir = path.resolve(parameters.plotsDir, partitionPlotsKey);
  await mkdir(partitionPlotsDir, { recursive: true });

  const rows = await queryTimestore(parameters, startIso, endIso);
  context.logger('Fetched observations from Timestore', {
    rows: rows.length,
    startIso,
    endIso
  });
  const trendRows = bucketByMinute(rows);
  const summary = summarizeRows(rows);

  const generatedAt = new Date().toISOString();
  const metrics: VisualizationMetrics = {
    samples: summary.samples,
    instrumentCount: summary.instrument_count,
    siteCount: summary.site_count,
    averageTemperatureC: summary.avg_temp,
    averagePm25: summary.avg_pm25,
    maxPm25: summary.max_pm25,
    partitionKey: parameters.partitionKey,
    lookbackMinutes: parameters.lookbackMinutes,
    siteFilter: parameters.siteFilter || undefined
  } satisfies VisualizationMetrics;

  const temperatureSvg = buildTemperatureSvg(trendRows);
  const temperaturePath = path.resolve(partitionPlotsDir, 'temperature_trend.svg');
  const temperatureSize = await writeArtifact(temperaturePath, temperatureSvg);

  const pm25Svg = buildPm25Svg(trendRows);
  const pm25Path = path.resolve(partitionPlotsDir, 'pm25_trend.svg');
  const pm25Size = await writeArtifact(pm25Path, pm25Svg);

  const metricsPath = path.resolve(partitionPlotsDir, 'metrics.json');
  const metricsSize = await writeArtifact(metricsPath, JSON.stringify(metrics, null, 2));

  const artifacts: VisualizationAssetPayload['artifacts'] = [
    {
      relativePath: path.relative(partitionPlotsDir, temperaturePath),
      mediaType: 'image/svg+xml',
      description: 'Average temperature trend',
      sizeBytes: temperatureSize
    },
    {
      relativePath: path.relative(partitionPlotsDir, pm25Path),
      mediaType: 'image/svg+xml',
      description: 'Average PM2.5 trend',
      sizeBytes: pm25Size
    },
    {
      relativePath: path.relative(partitionPlotsDir, metricsPath),
      mediaType: 'application/json',
      description: 'Visualization metrics JSON',
      sizeBytes: metricsSize
    }
  ];

  const payload: VisualizationAssetPayload = {
    generatedAt,
    partitionKey: parameters.partitionKey,
    plotsDir: partitionPlotsDir,
    lookbackMinutes: parameters.lookbackMinutes,
    artifacts,
    metrics
  } satisfies VisualizationAssetPayload;

  await context.update({
    samples: metrics.samples,
    instruments: metrics.instrumentCount
  });

  return {
    status: 'succeeded',
    result: {
      partitionKey: parameters.partitionKey,
      visualization: payload,
      assets: [
        {
          assetId: 'observatory.visualizations.minute',
          partitionKey: parameters.partitionKey,
          producedAt: generatedAt,
          payload
        }
      ]
    }
  } satisfies JobRunResult;
}

export default handler;

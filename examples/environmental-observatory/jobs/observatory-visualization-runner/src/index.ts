import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import duckdb from 'duckdb';

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
  warehousePath: string;
  plotsDir: string;
  partitionKey: string;
  lookbackMinutes: number;
  siteFilter?: string;
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
  const warehousePath = ensureString(raw.warehousePath ?? raw.warehouse_path);
  const plotsDir = ensureString(raw.plotsDir ?? raw.plots_dir ?? raw.outputDir);
  const partitionKey = ensureString(raw.partitionKey ?? raw.partition_key);
  if (!warehousePath || !plotsDir || !partitionKey) {
    throw new Error('warehousePath, plotsDir, and partitionKey parameters are required');
  }
  const lookbackMinutes = Math.max(1, ensureNumber(raw.lookbackMinutes ?? raw.lookback_minutes ?? raw.lookbackHours ?? raw.lookback_hours, 180));
  const siteFilter = ensureString(raw.siteFilter ?? raw.site_filter ?? '');
  return {
    warehousePath,
    plotsDir,
    partitionKey,
    lookbackMinutes,
    siteFilter: siteFilter || undefined
  } satisfies VisualizationParameters;
}

type DuckDbConnection = {
  run: (sql: string, callback: (err: Error | null) => void) => void;
  all: (sql: string, callback: (err: Error | null, rows?: unknown[]) => void) => void;
  close: () => void;
};

function allRows<T>(connection: DuckDbConnection, sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    connection.all(sql, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve((rows ?? []) as T[]);
    });
  });
}

function escapeLiteral(value: string): string {
  return value.split("'").join("''");
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
  const normalizedEndIso = endDate.toISOString().slice(0, 19) + 'Z';
  return { startIso, endIso: normalizedEndIso };
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

async function writeArtifact(filePath: string, content: string): Promise<number> {
  await writeFile(filePath, content, 'utf8');
  const stats = await stat(filePath);
  return stats.size;
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
  const absoluteWarehousePath = path.resolve(parameters.warehousePath);
  const partitionPlotsKey = parameters.partitionKey.replace(':', '-');
  const partitionPlotsDir = path.resolve(parameters.plotsDir, partitionPlotsKey);
  await mkdir(partitionPlotsDir, { recursive: true });

  const db = new duckdb.Database(absoluteWarehousePath);
  const connection = db.connect();

  try {
    await new Promise<void>((resolve, reject) => {
      connection.run(
        `CREATE TABLE IF NOT EXISTS readings (
          timestamp TIMESTAMP,
          instrument_id VARCHAR,
          site VARCHAR,
          temperature_c DOUBLE,
          relative_humidity_pct DOUBLE,
          pm2_5_ug_m3 DOUBLE,
          battery_voltage DOUBLE
        )`,
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        }
      );
    });

    const rangePredicate = `timestamp BETWEEN '${escapeLiteral(startIso)}'::TIMESTAMPTZ AND '${escapeLiteral(endIso)}'::TIMESTAMPTZ`;
    const sitePredicate = parameters.siteFilter
      ? ` AND site = '${escapeLiteral(parameters.siteFilter)}'`
      : '';

    const trendSql = `
      SELECT
        strftime(date_trunc('minute', timestamp AT TIME ZONE 'UTC'), '%Y-%m-%dT%H:%M') AS minute_key,
        avg(temperature_c) AS avg_temp,
        avg(pm2_5_ug_m3) AS avg_pm25,
        avg(relative_humidity_pct) AS avg_humidity,
        avg(battery_voltage) AS avg_battery,
        COUNT(*) AS samples
      FROM readings
      WHERE ${rangePredicate}${sitePredicate}
      GROUP BY minute_key
      ORDER BY minute_key
    `;
    const trendRows = await allRows<TrendRow>(connection, trendSql);

    const summarySql = `
      SELECT
        COUNT(*) AS samples,
        COUNT(DISTINCT instrument_id) AS instrument_count,
        COUNT(DISTINCT site) AS site_count,
        avg(temperature_c) AS avg_temp,
        avg(pm2_5_ug_m3) AS avg_pm25,
        max(pm2_5_ug_m3) AS max_pm25
      FROM readings
      WHERE ${rangePredicate}${sitePredicate}
    `;
    const summaryRows = await allRows<SummaryRow>(connection, summarySql);
    const summary = summaryRows[0] ?? {
      samples: 0,
      instrument_count: 0,
      site_count: 0,
      avg_temp: 0,
      avg_pm25: 0,
      max_pm25: 0
    };

    const generatedAt = new Date().toISOString();
    const metrics: VisualizationMetrics = {
      samples: ensureNumber(summary.samples, 0),
      instrumentCount: ensureNumber(summary.instrument_count, 0),
      siteCount: ensureNumber(summary.site_count, 0),
      averageTemperatureC: ensureNumber(summary.avg_temp, 0),
      averagePm25: ensureNumber(summary.avg_pm25, 0),
      maxPm25: ensureNumber(summary.max_pm25, 0),
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
  } finally {
    connection.close();
    db.close();
  }
}

export default handler;

import { FilestoreClient } from '@apphub/filestore-client';
import {
  ensureFilestoreHierarchy,
  ensureResolvedBackendId,
  uploadTextFile,
  DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY
} from '../../shared/filestore';
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

type AggregatorParameters = {
  partitionKey: string;
  lookbackMinutes: number;
  timestoreBaseUrl: string;
  timestoreDatasetSlug: string;
  timestoreAuthToken?: string;
  filestoreBaseUrl: string;
  filestoreBackendId: number | null;
  filestoreBackendKey: string;
  filestoreToken?: string;
  filestorePrincipal?: string;
  reportsPrefix: string;
  overviewPrefix: string;
};

type TimestoreQueryResponse = {
  rows: Array<Record<string, unknown>>;
  columns?: string[];
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

type InstrumentAggregate = {
  instrumentId: string;
  samples: number;
  averageTemperatureC: number;
  averagePm25: number;
  averageHumidityPct: number;
  averageBatteryVoltage: number;
  maxPm25: number;
  siteCount: number;
};

type SiteAggregate = {
  site: string;
  samples: number;
  averagePm25: number;
  averageTemperatureC: number;
};

type TrendPoint = {
  minute: string;
  avgTemp: number;
  avgPm25: number;
  samples: number;
};

const MAX_ROWS = 50000;
const DATASET_READY_MAX_ATTEMPTS = 24;
const DATASET_READY_DELAY_MS = 1000;

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
    return Number.isFinite(converted) ? converted : fallback;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function parseParameters(raw: unknown): AggregatorParameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }
  const partitionKey = ensureString(raw.partitionKey ?? raw.partition_key);
  const timestoreBaseUrl = ensureString(
    raw.timestoreBaseUrl ?? raw.timestore_base_url ?? 'http://127.0.0.1:4200'
  ).replace(/\/$/, '');
  const timestoreDatasetSlug = ensureString(
    raw.timestoreDatasetSlug ?? raw.timestore_dataset_slug ?? raw.datasetSlug
  );
  const lookbackMinutes = Math.max(
    5,
    ensureNumber(raw.lookbackMinutes ?? raw.lookback_minutes ?? 720, 720)
  );
  if (!partitionKey || !timestoreDatasetSlug) {
    throw new Error('partitionKey and timestoreDatasetSlug parameters are required');
  }
  const timestoreAuthToken = ensureString(raw.timestoreAuthToken ?? raw.timestore_auth_token ?? '');
  const filestoreBaseUrl = ensureString(
    raw.filestoreBaseUrl ??
      raw.filestore_base_url ??
      process.env.OBSERVATORY_FILESTORE_BASE_URL ??
      process.env.FILESTORE_BASE_URL ??
      ''
  );
  if (!filestoreBaseUrl) {
    throw new Error('filestoreBaseUrl parameter is required');
  }
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
  const backendIdCandidate = backendRaw ? Number(backendRaw) : Number.NaN;
  const filestoreBackendId = Number.isFinite(backendIdCandidate) && backendIdCandidate > 0
    ? backendIdCandidate
    : null;
  const filestoreToken = ensureString(raw.filestoreToken ?? raw.filestore_token ?? '');
  const filestorePrincipal = ensureString(raw.filestorePrincipal ?? raw.filestore_principal ?? '');
  const reportsPrefix = ensureString(
    raw.reportsPrefix ??
      raw.reports_prefix ??
      raw.reportsDir ??
      raw.reports_dir ??
      process.env.OBSERVATORY_REPORTS_PREFIX ?? ''
  );
  if (!reportsPrefix) {
    throw new Error('reportsPrefix parameter is required');
  }
  const overviewPrefix = ensureString(
    raw.overviewPrefix ??
      raw.overview_prefix ??
      `${reportsPrefix.replace(/\/+$/g, '')}/${ensureString(raw.overviewDirName ?? raw.overview_dir_name ?? 'overview')}`
  );

  return {
    partitionKey,
    lookbackMinutes,
    timestoreBaseUrl,
    timestoreDatasetSlug,
    timestoreAuthToken: timestoreAuthToken || undefined,
    filestoreBaseUrl,
    filestoreBackendId,
    filestoreBackendKey,
    filestoreToken: filestoreToken || undefined,
    filestorePrincipal: filestorePrincipal || undefined,
    reportsPrefix: reportsPrefix.replace(/\/+$/g, ''),
    overviewPrefix: overviewPrefix.replace(/\/+$/g, '')
  } satisfies AggregatorParameters;
}

function resolveTimeWindow(partitionKey: string, lookbackMinutes: number) {
  const partitionIso = partitionKey.endsWith(':00Z') ? partitionKey : `${partitionKey}:00Z`;
  const endDate = new Date(partitionIso);
  if (Number.isNaN(endDate.getTime())) {
    throw new Error(`Invalid partitionKey '${partitionKey}'. Expected format YYYY-MM-DDTHH:mm`);
  }
  const endWindow = new Date(endDate.getTime() + 59 * 1000 + 999);
  const startDate = new Date(endDate.getTime() - (lookbackMinutes - 1) * 60 * 1000);
  return {
    startIso: startDate.toISOString().replace(/Z$/, '') + 'Z',
    endIso: endWindow.toISOString().replace(/Z$/, '') + 'Z'
  };
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDatasetReady(
  params: AggregatorParameters,
  logger: JobRunContext['logger'],
  attempts: number = DATASET_READY_MAX_ATTEMPTS,
  delayMs: number = DATASET_READY_DELAY_MS
): Promise<boolean> {
  const headers: Record<string, string> = {
    accept: 'application/json'
  };
  if (params.timestoreAuthToken) {
    headers.authorization = `Bearer ${params.timestoreAuthToken}`;
  }
  const datasetUrl = `${params.timestoreBaseUrl}/datasets/${encodeURIComponent(params.timestoreDatasetSlug)}`;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(datasetUrl, { headers });
    if (response.ok) {
      return true;
    }
    if (response.status === 404) {
      if (attempt === attempts - 1) {
        break;
      }
      logger('Timestore dataset not yet available; waiting before aggregation', {
        datasetSlug: params.timestoreDatasetSlug,
        partitionKey: params.partitionKey,
        attempt: attempt + 1,
        remainingAttempts: attempts - attempt - 1
      });
      await sleep(delayMs);
      continue;
    }

    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Dataset readiness check failed with status ${response.status}: ${errorText}`);
  }

  return false;
}

async function queryTimestore(
  params: AggregatorParameters,
  windowStart: string,
  windowEnd: string
): Promise<ObservatoryRow[]> {
  const url = `${params.timestoreBaseUrl}/datasets/${encodeURIComponent(params.timestoreDatasetSlug)}/query`;
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };
  if (params.timestoreAuthToken) {
    headers.authorization = `Bearer ${params.timestoreAuthToken}`;
  }
  const body = {
    timeRange: { start: windowStart, end: windowEnd },
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
    const timestamp = ensureString(row.timestamp ?? row.window_start ?? '');
    if (!timestamp) {
      continue;
    }
    const instrumentId = ensureString(row.instrument_id ?? row.instrumentId ?? '');
    const site = ensureString(row.site ?? '');
    normalized.push({
      timestamp: new Date(timestamp).toISOString(),
      instrument_id: instrumentId,
      site,
      temperature_c: ensureNumber(row.temperature_c, 0),
      relative_humidity_pct: ensureNumber(row.relative_humidity_pct, 0),
      pm2_5_ug_m3: ensureNumber(row.pm2_5_ug_m3, 0),
      battery_voltage: ensureNumber(row.battery_voltage, 0)
    });
  }

  return normalized;
}

function aggregateInstruments(rows: ObservatoryRow[]): InstrumentAggregate[] {
  const buckets = new Map<string, {
    sumTemp: number;
    sumPm25: number;
    sumHumidity: number;
    sumBattery: number;
    count: number;
    maxPm25: number;
    sites: Set<string>;
  }>();

  for (const row of rows) {
    const key = row.instrument_id || 'unknown';
    const bucket = buckets.get(key) ?? {
      sumTemp: 0,
      sumPm25: 0,
      sumHumidity: 0,
      sumBattery: 0,
      count: 0,
      maxPm25: Number.NEGATIVE_INFINITY,
      sites: new Set<string>()
    };
    bucket.sumTemp += row.temperature_c;
    bucket.sumPm25 += row.pm2_5_ug_m3;
    bucket.sumHumidity += row.relative_humidity_pct;
    bucket.sumBattery += row.battery_voltage;
    bucket.count += 1;
    bucket.maxPm25 = Math.max(bucket.maxPm25, row.pm2_5_ug_m3);
    if (row.site) {
      bucket.sites.add(row.site);
    }
    buckets.set(key, bucket);
  }

  return Array.from(buckets.entries()).map(([instrumentId, bucket]) => ({
    instrumentId,
    samples: bucket.count,
    averageTemperatureC: bucket.count > 0 ? bucket.sumTemp / bucket.count : 0,
    averagePm25: bucket.count > 0 ? bucket.sumPm25 / bucket.count : 0,
    averageHumidityPct: bucket.count > 0 ? bucket.sumHumidity / bucket.count : 0,
    averageBatteryVoltage: bucket.count > 0 ? bucket.sumBattery / bucket.count : 0,
    maxPm25: bucket.count > 0 ? bucket.maxPm25 : 0,
    siteCount: bucket.sites.size
  }));
}

function aggregateSites(rows: ObservatoryRow[]): SiteAggregate[] {
  const buckets = new Map<string, {
    sumPm25: number;
    sumTemp: number;
    count: number;
  }>();

  for (const row of rows) {
    const key = row.site || 'unknown';
    const bucket = buckets.get(key) ?? {
      sumPm25: 0,
      sumTemp: 0,
      count: 0
    };
    bucket.sumPm25 += row.pm2_5_ug_m3;
    bucket.sumTemp += row.temperature_c;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.entries()).map(([site, bucket]) => ({
    site,
    samples: bucket.count,
    averagePm25: bucket.count > 0 ? bucket.sumPm25 / bucket.count : 0,
    averageTemperatureC: bucket.count > 0 ? bucket.sumTemp / bucket.count : 0
  }));
}

function buildTrends(rows: ObservatoryRow[]): TrendPoint[] {
  const buckets = new Map<string, {
    sumTemp: number;
    sumPm25: number;
    count: number;
  }>();

  for (const row of rows) {
    const minute = row.timestamp.slice(0, 16);
    const bucket = buckets.get(minute) ?? { sumTemp: 0, sumPm25: 0, count: 0 };
    bucket.sumTemp += row.temperature_c;
    bucket.sumPm25 += row.pm2_5_ug_m3;
    bucket.count += 1;
    buckets.set(minute, bucket);
  }

  return Array.from(buckets.entries())
    .map(([minute, bucket]) => ({
      minute,
      avgTemp: bucket.count > 0 ? bucket.sumTemp / bucket.count : 0,
      avgPm25: bucket.count > 0 ? bucket.sumPm25 / bucket.count : 0,
      samples: bucket.count
    }))
    .sort((a, b) => a.minute.localeCompare(b.minute));
}

function computeSummary(rows: ObservatoryRow[]) {
  if (rows.length === 0) {
    return {
      samples: 0,
      instrumentCount: 0,
      siteCount: 0,
      averageTemperatureC: 0,
      averagePm25: 0,
      maxPm25: 0
    };
  }
  const instruments = new Set<string>();
  const sites = new Set<string>();
  let totalTemp = 0;
  let totalPm25 = 0;
  let maxPm25 = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    if (row.instrument_id) {
      instruments.add(row.instrument_id);
    }
    if (row.site) {
      sites.add(row.site);
    }
    totalTemp += row.temperature_c;
    totalPm25 += row.pm2_5_ug_m3;
    maxPm25 = Math.max(maxPm25, row.pm2_5_ug_m3);
  }

  return {
    samples: rows.length,
    instrumentCount: instruments.size,
    siteCount: sites.size,
    averageTemperatureC: totalTemp / rows.length,
    averagePm25: totalPm25 / rows.length,
    maxPm25
  };
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  const parameters = parseParameters(context.parameters);
  const window = resolveTimeWindow(parameters.partitionKey, parameters.lookbackMinutes);
  const observatoryEvents = createObservatoryEventPublisher({
    source: 'observatory.dashboard-aggregator'
  });
  const filestoreClient = new FilestoreClient({
    baseUrl: parameters.filestoreBaseUrl,
    token: parameters.filestoreToken,
    userAgent: 'observatory-dashboard-aggregator/0.2.0'
  });
  const backendMountId = await ensureResolvedBackendId(filestoreClient, parameters);
  const generatedAt = new Date().toISOString();

  try {
    const datasetReady = await waitForDatasetReady(parameters, context.logger);
    if (!datasetReady) {
      throw new Error(
        `Timestore dataset ${parameters.timestoreDatasetSlug} not ready after waiting ${
          DATASET_READY_MAX_ATTEMPTS * DATASET_READY_DELAY_MS
        }ms`
      );
    }

    const rows = await queryTimestore(parameters, window.startIso, window.endIso);
    context.logger('Fetched rows from Timestore for dashboard aggregation', {
      samples: rows.length,
      window
    });

    const instruments = aggregateInstruments(rows).sort((a, b) => b.samples - a.samples);
    const sites = aggregateSites(rows).sort((a, b) => b.samples - a.samples);
    const trends = buildTrends(rows);
    const summary = computeSummary(rows);

    await ensureFilestoreHierarchy(
      filestoreClient,
      backendMountId,
      parameters.overviewPrefix,
      parameters.filestorePrincipal
    );
    const normalizedOverviewPrefix = parameters.overviewPrefix.replace(/\/+$/g, '');
    const dashboardJsonPath = `${normalizedOverviewPrefix}/dashboard.json`;
    const dashboardHtmlPath = `${normalizedOverviewPrefix}/index.html`;

    const dashboardData = {
      generatedAt,
      partitionKey: parameters.partitionKey,
      lookbackMinutes: parameters.lookbackMinutes,
      window,
      summary,
      instruments,
      sites,
      trends
    } satisfies Record<string, unknown>;

    const [dataNode, htmlNode] = await Promise.all([
      uploadTextFile({
        client: filestoreClient,
        backendMountId,
        backendMountKey: parameters.filestoreBackendKey,
        path: dashboardJsonPath,
        content: JSON.stringify(dashboardData, null, 2),
        contentType: 'application/json',
        principal: parameters.filestorePrincipal,
        metadata: {
          partitionKey: parameters.partitionKey,
          lookbackMinutes: parameters.lookbackMinutes,
          kind: 'dashboard-data'
        }
      }),
      (async () => {
        const html = buildDashboardHtml(dashboardData);
        return uploadTextFile({
          client: filestoreClient,
          backendMountId,
          backendMountKey: parameters.filestoreBackendKey,
          path: dashboardHtmlPath,
          content: html,
          contentType: 'text/html; charset=utf-8',
          principal: parameters.filestorePrincipal,
          metadata: {
            partitionKey: parameters.partitionKey,
            lookbackMinutes: parameters.lookbackMinutes,
            kind: 'dashboard-html'
          }
        });
      })()
    ]);

    context.logger('Uploaded dashboard artifacts', {
      dashboardHtmlPath,
      dashboardJsonPath,
      htmlSize: htmlNode.sizeBytes ?? null,
      dataSize: dataNode.sizeBytes ?? null
    });

    await context.update({
      generatedAt,
      samples: summary.samples,
      instrumentCount: summary.instrumentCount,
      siteCount: summary.siteCount,
      dashboardPath: htmlNode.path ?? dashboardHtmlPath,
      dataPath: dataNode.path ?? dashboardJsonPath,
      dashboardNodeId: htmlNode.id ?? null,
      dataNodeId: dataNode.id ?? null
    });

    await observatoryEvents.publish({
      type: 'observatory.dashboard.updated',
      payload: {
        generatedAt,
        partitionKey: parameters.partitionKey,
        lookbackMinutes: parameters.lookbackMinutes,
        dashboard: {
          path: htmlNode.path ?? dashboardHtmlPath,
          nodeId: htmlNode.id ?? null,
          sizeBytes: htmlNode.sizeBytes ?? null,
          checksum: htmlNode.checksum ?? null
        },
        data: {
          path: dataNode.path ?? dashboardJsonPath,
          nodeId: dataNode.id ?? null,
          sizeBytes: dataNode.sizeBytes ?? null,
          checksum: dataNode.checksum ?? null
        },
        overviewPrefix: normalizedOverviewPrefix,
        metrics: summary,
        window
      },
      occurredAt: generatedAt
    });

    return {
      status: 'succeeded',
      result: {
        generatedAt,
        samples: summary.samples,
        instrumentCount: summary.instrumentCount,
        siteCount: summary.siteCount,
        dashboard: {
          path: htmlNode.path ?? dashboardHtmlPath,
          nodeId: htmlNode.id ?? null,
          mediaType: 'text/html',
          sizeBytes: htmlNode.sizeBytes ?? null,
          checksum: htmlNode.checksum ?? null
        },
        data: {
          path: dataNode.path ?? dashboardJsonPath,
          nodeId: dataNode.id ?? null,
          mediaType: 'application/json',
          sizeBytes: dataNode.sizeBytes ?? null,
          checksum: dataNode.checksum ?? null
        },
        overviewPrefix: normalizedOverviewPrefix
      }
    } satisfies JobRunResult;
  } finally {
    await observatoryEvents.close().catch(() => undefined);
  }
}

function buildDashboardHtml(data: Record<string, unknown>): string {
  const serialized = JSON.stringify(data);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Observatory Aggregate Dashboard</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js" integrity="sha384-+XZ+YhXkUV20Urd7O0cu7No2JTDZwTAJ/9JfnYo9i9yodT5neCBvtUDr+YaR8man" crossorigin="anonymous"></script>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #040b18; color: #e6f1ff; }
      header { padding: 2.5rem 3rem 1.5rem; background: radial-gradient(circle at top left, rgba(97, 216, 255, 0.2), transparent 55%), #050d1f; border-bottom: 1px solid rgba(255,255,255,0.05); }
      h1 { margin: 0; font-size: 2.2rem; color: #7ddcff; }
      p.meta { margin: 0.5rem 0 0; color: #9fb9d0; }
      main { padding: 2rem 3rem 3rem; display: grid; grid-template-columns: minmax(280px, 360px) 1fr; gap: 2rem; }
      .panel { background: rgba(13, 24, 45, 0.92); border-radius: 16px; padding: 1.75rem; box-shadow: 0 20px 45px rgba(0, 0, 0, 0.35); border: 1px solid rgba(255,255,255,0.04); }
      .panel h2 { margin: 0 0 1.25rem; font-size: 1.1rem; text-transform: uppercase; letter-spacing: 0.08em; color: #8ee5ff; }
      .summary-grid { display: grid; gap: 1rem; }
      .summary-card { background: rgba(9, 17, 33, 0.9); border-radius: 12px; padding: 1rem 1.25rem; border: 1px solid rgba(255,255,255,0.06); }
      .summary-card h3 { margin: 0; font-size: 0.85rem; color: #97b4cc; text-transform: uppercase; letter-spacing: 0.05em; }
      .summary-card p { margin: 0.4rem 0 0; font-size: 1.6rem; font-weight: 600; color: #ffffff; }
      .chart-grid { display: grid; gap: 1.5rem; }
      canvas { background: #0b1426; border-radius: 12px; padding: 1rem; }
      table { width: 100%; border-collapse: collapse; margin-top: 1.25rem; font-size: 0.95rem; }
      th, td { padding: 0.65rem 0.75rem; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.06); }
      th { text-transform: uppercase; font-size: 0.78rem; letter-spacing: 0.08em; color: #8fa8c9; }
      tbody tr:hover { background: rgba(97, 216, 255, 0.08); }
      footer { text-align: center; padding: 1rem 0 2rem; color: #6f86a2; font-size: 0.85rem; }
      @media (max-width: 1120px) { main { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <header>
      <h1>Observatory Aggregate Dashboard</h1>
      <p class="meta">Generated at <span id="generatedAt"></span> · Window <span id="windowRange"></span> · Lookback <span id="lookback"></span></p>
    </header>
    <main>
      <section class="panel" aria-labelledby="summary-heading">
        <h2 id="summary-heading">Summary</h2>
        <div class="summary-grid">
          <div class="summary-card"><h3>Samples</h3><p id="summary-samples">0</p></div>
          <div class="summary-card"><h3>Instruments</h3><p id="summary-instruments">0</p></div>
          <div class="summary-card"><h3>Sites</h3><p id="summary-sites">0</p></div>
          <div class="summary-card"><h3>Avg Temp (°C)</h3><p id="summary-temp">0</p></div>
          <div class="summary-card"><h3>Avg PM₂.₅</h3><p id="summary-pm25">0</p></div>
          <div class="summary-card"><h3>Max PM₂.₅</h3><p id="summary-max-pm25">0</p></div>
        </div>
      </section>
      <section class="panel" aria-labelledby="charts-heading">
        <h2 id="charts-heading">Trends & Insights</h2>
        <div class="chart-grid">
          <canvas id="trendTemperature" height="320"></canvas>
          <canvas id="instrumentPm25" height="320"></canvas>
          <table aria-label="Instrument aggregates">
            <thead><tr><th>Instrument</th><th>Samples</th><th>Avg Temp (°C)</th><th>Avg PM₂.₅</th><th>Max PM₂.₅</th><th>Sites</th></tr></thead>
            <tbody id="instrument-table"></tbody>
          </table>
        </div>
      </section>
    </main>
    <footer>Data aggregated from AppHub Timestore · ${new Date().getFullYear()}</footer>
    <script>
      const DASHBOARD_DATA = ${serialized};
      const summary = DASHBOARD_DATA.summary || {};
      document.getElementById('generatedAt').textContent = new Date(DASHBOARD_DATA.generatedAt || '').toLocaleString();
      document.getElementById('windowRange').textContent =
        new Date(DASHBOARD_DATA.window.start).toLocaleString() +
        ' → ' +
        new Date(DASHBOARD_DATA.window.end).toLocaleString();
      document.getElementById('lookback').textContent = String(DASHBOARD_DATA.lookbackMinutes) + ' minutes';
      const setElm = (id, value, fraction = 0) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = typeof value === 'number' ? value.toFixed(fraction) : value;
      };
      setElm('summary-samples', summary.samples || 0);
      setElm('summary-instruments', summary.instrumentCount || 0);
      setElm('summary-sites', summary.siteCount || 0);
      setElm('summary-temp', summary.averageTemperatureC || 0, 2);
      setElm('summary-pm25', summary.averagePm25 || 0, 2);
      setElm('summary-max-pm25', summary.maxPm25 || 0, 2);

      const instruments = DASHBOARD_DATA.instruments || [];
      const tbody = document.getElementById('instrument-table');
      if (tbody) {
        tbody.innerHTML = instruments
          .map(function(row) {
            return '<tr>' +
              '<td>' + row.instrumentId + '</td>' +
              '<td>' + row.samples + '</td>' +
              '<td>' + row.averageTemperatureC.toFixed(2) + '</td>' +
              '<td>' + row.averagePm25.toFixed(2) + '</td>' +
              '<td>' + row.maxPm25.toFixed(2) + '</td>' +
              '<td>' + row.siteCount + '</td>' +
            '</tr>';
          })
          .join('');
      }

      const trends = DASHBOARD_DATA.trends || [];
      const trendCtx = document.getElementById('trendTemperature');
      if (trendCtx && window.Chart && trends.length > 0) {
        const labels = trends.map((row) => row.minute.slice(11));
        const lineGradient = trendCtx.getContext('2d').createLinearGradient(0, 0, 0, 400);
        lineGradient.addColorStop(0, 'rgba(97, 216, 255, 0.9)');
        lineGradient.addColorStop(1, 'rgba(97, 216, 255, 0.2)');
        new Chart(trendCtx, {
          type: 'line',
          data: {
            labels,
            datasets: [
              {
                label: 'Average Temperature °C',
                data: trends.map((row) => row.avgTemp),
                fill: true,
                backgroundColor: lineGradient,
                borderColor: '#61d8ff',
                tension: 0.34,
                borderWidth: 2
              },
              {
                label: 'Average PM₂.₅',
                data: trends.map((row) => row.avgPm25),
                fill: false,
                borderDash: [6, 6],
                borderColor: '#ff9f43',
                tension: 0.25,
                borderWidth: 2,
                yAxisID: 'pm25'
              }
            ]
          },
          options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            stacked: false,
            maintainAspectRatio: false,
            plugins: {
              legend: { labels: { color: '#dbe7ff' } },
              tooltip: { callbacks: { title: (items) => 'Minute ' + items[0].label } }
            },
            scales: {
              x: { ticks: { color: '#8ea7c6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
              y: { ticks: { color: '#8ea7c6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
              pm25: {
                position: 'right',
                ticks: { color: '#f7cf97' },
                grid: { display: false }
              }
            }
          }
        });
      }

      const instrumentCtx = document.getElementById('instrumentPm25');
      if (instrumentCtx && window.Chart && instruments.length > 0) {
        new Chart(instrumentCtx, {
          type: 'bar',
          data: {
            labels: instruments.map((row) => row.instrumentId),
            datasets: [
              {
                label: 'Avg PM₂.₅',
                data: instruments.map((row) => row.averagePm25),
                backgroundColor: 'rgba(255, 159, 67, 0.65)',
                borderColor: '#ff9f43',
                borderWidth: 1.5
              },
              {
                label: 'Samples',
                data: instruments.map((row) => row.samples),
                backgroundColor: 'rgba(97, 216, 255, 0.3)',
                borderColor: '#61d8ff',
                borderWidth: 1.5,
                yAxisID: 'samples'
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { labels: { color: '#dbe7ff' } },
              tooltip: { mode: 'index', intersect: false }
            },
            scales: {
              x: { ticks: { color: '#8ea7c6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
              y: { ticks: { color: '#f7cf97' }, grid: { color: 'rgba(255,255,255,0.05)' }, title: { display: true, text: 'Avg PM₂.₅', color: '#f7cf97' } },
              samples: {
                position: 'right',
                ticks: { color: '#61d8ff' },
                grid: { display: false }
              }
            }
          }
        });
      }
    </script>
  </body>
</html>`;
}

export default handler;

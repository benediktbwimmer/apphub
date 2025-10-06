import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import {
  createJobHandler,
  inheritModuleSettings,
  inheritModuleSecrets,
  selectEventBus,
  selectFilestore,
  selectCoreWorkflows,
  selectTimestore,
  sanitizeIdentifier,
  type FilestoreCapability,
  type JobContext,
  type CoreWorkflowsCapability,
  type WorkflowAssetSummary
} from '@apphub/module-sdk';
import { ensureFilestoreHierarchy, ensureResolvedBackendId, uploadTextFile } from '@apphub/module-sdk';
import { DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY } from '../runtime';
import { createObservatoryEventPublisher } from '../runtime/events';
import type { ObservatorySecrets, ObservatorySettings } from '../config/settings';

type SelectedTimestore = NonNullable<ReturnType<typeof selectTimestore>>;

const MAX_ROWS = 10_000;
const DATASET_READY_MAX_ATTEMPTS = 24;
const DATASET_READY_DELAY_MS = 1_000;
const FLUSH_CHECK_MAX_ATTEMPTS = 10;
const FLUSH_CHECK_DELAY_MS = 1_000;
const DEFAULT_SNAPSHOT_FRESHNESS_MS = 60_000;

const parametersSchema = z
  .object({
    partitionKey: z.string().min(1, 'partitionKey is required').optional(),
    lookbackMinutes: z.number().int().positive().optional(),
    timestoreDatasetSlug: z.string().min(1).optional(),
    burstReason: z.string().optional(),
    burstFinishedAt: z.string().optional()
  })
  .strip();

export type DashboardAggregatorParameters = z.infer<typeof parametersSchema>;

type DashboardAggregatorContext = JobContext<
  ObservatorySettings,
  ObservatorySecrets,
  DashboardAggregatorParameters
>;

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

type BurstContext = {
  reason: string | null;
  finishedAt: string | null;
};

type DashboardSummary = {
  samples: number;
  instrumentCount: number;
  siteCount: number;
  averageTemperatureC: number;
  averagePm25: number;
  maxPm25: number;
};

type DashboardSnapshotNode = {
  path: string;
  nodeId: number | null;
  mediaType: string;
  sizeBytes: number | null;
  checksum: string | null;
};

type DashboardSnapshotAssetPayload = {
  generatedAt: string;
  partitionKey: string;
  lookbackMinutes: number;
  overviewPrefix: string;
  dashboard: DashboardSnapshotNode;
  data: DashboardSnapshotNode;
  summary: DashboardSummary;
  window: {
    start: string;
    end: string;
    startIso: string;
    endIso: string;
  };
  burst: BurstContext;
};

type DashboardAggregatorResult = {
  generatedAt: string;
  samples: number;
  instrumentCount: number;
  siteCount: number;
  dashboard: DashboardSnapshotNode;
  data: DashboardSnapshotNode;
  overviewPrefix: string;
  burst: BurstContext;
  assets: Array<{
    assetId: string;
    partitionKey: string;
    producedAt: string;
    freshness: { ttlMs: number | null } | null;
    payload: DashboardSnapshotAssetPayload;
  }>;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function resolveTimeWindow(
  partitionKey: string,
  lookbackMinutes: number
): { start: string; end: string; startIso: string; endIso: string } {
  const partitionIso = partitionKey.endsWith(':00Z') ? partitionKey : `${partitionKey}:00Z`;
  const endDate = new Date(partitionIso);
  if (Number.isNaN(endDate.getTime())) {
    throw new Error(`Invalid partitionKey '${partitionKey}'. Expected format YYYY-MM-DDTHH:mm`);
  }
  const endWindow = new Date(endDate.getTime() + 59_000 + 999);
  const startDate = new Date(endDate.getTime() - (lookbackMinutes - 1) * 60_000);
  const startIso = startDate.toISOString().replace(/Z$/, '') + 'Z';
  const endIso = endWindow.toISOString().replace(/Z$/, '') + 'Z';
  return {
    start: startIso,
    end: endIso,
    startIso,
    endIso
  };
}

function aggregateInstruments(rows: ObservatoryRow[]): InstrumentAggregate[] {
  const buckets = new Map<
    string,
    {
      sumTemp: number;
      sumPm25: number;
      sumHumidity: number;
      sumBattery: number;
      count: number;
      maxPm25: number;
      sites: Set<string>;
    }
  >();

  for (const row of rows) {
    const instrumentKey = row.instrument_id || 'unknown';
    const bucket = buckets.get(instrumentKey) ?? {
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
    buckets.set(instrumentKey, bucket);
  }

  return Array.from(buckets.entries()).map(([instrumentId, bucket]) => ({
    instrumentId,
    samples: bucket.count,
    averageTemperatureC: bucket.count ? bucket.sumTemp / bucket.count : 0,
    averagePm25: bucket.count ? bucket.sumPm25 / bucket.count : 0,
    averageHumidityPct: bucket.count ? bucket.sumHumidity / bucket.count : 0,
    averageBatteryVoltage: bucket.count ? bucket.sumBattery / bucket.count : 0,
    maxPm25: bucket.count ? bucket.maxPm25 : 0,
    siteCount: bucket.sites.size
  }));
}

function aggregateSites(rows: ObservatoryRow[]): SiteAggregate[] {
  const buckets = new Map<string, { sumPm25: number; sumTemp: number; count: number }>();

  for (const row of rows) {
    const siteKey = row.site || 'unknown';
    const bucket = buckets.get(siteKey) ?? { sumPm25: 0, sumTemp: 0, count: 0 };
    bucket.sumPm25 += row.pm2_5_ug_m3;
    bucket.sumTemp += row.temperature_c;
    bucket.count += 1;
    buckets.set(siteKey, bucket);
  }

  return Array.from(buckets.entries()).map(([site, bucket]) => ({
    site,
    samples: bucket.count,
    averagePm25: bucket.count ? bucket.sumPm25 / bucket.count : 0,
    averageTemperatureC: bucket.count ? bucket.sumTemp / bucket.count : 0
  }));
}

function buildTrends(rows: ObservatoryRow[]): TrendPoint[] {
  const buckets = new Map<string, { sumTemp: number; sumPm25: number; count: number }>();

  for (const row of rows) {
    const minuteKey = row.timestamp.slice(0, 16);
    const bucket = buckets.get(minuteKey) ?? { sumTemp: 0, sumPm25: 0, count: 0 };
    bucket.sumTemp += row.temperature_c;
    bucket.sumPm25 += row.pm2_5_ug_m3;
    bucket.count += 1;
    buckets.set(minuteKey, bucket);
  }

  return Array.from(buckets.entries())
    .map(([minute, bucket]) => ({
      minute,
      avgTemp: bucket.count ? bucket.sumTemp / bucket.count : 0,
      avgPm25: bucket.count ? bucket.sumPm25 / bucket.count : 0,
      samples: bucket.count
    }))
    .sort((a, b) => a.minute.localeCompare(b.minute));
}

function computeSummary(rows: ObservatoryRow[]): DashboardSummary {
  if (!rows.length) {
    return {
      samples: 0,
      instrumentCount: 0,
      siteCount: 0,
      averageTemperatureC: 0,
      averagePm25: 0,
      maxPm25: 0
    } satisfies DashboardSummary;
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
  } satisfies DashboardSummary;
}

function buildDashboardHtml(data: Record<string, unknown>): string {
  const serialized = JSON.stringify(data);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Environmental Observatory Dashboard</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet" />
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js" defer></script>
    <style>
      :root { color-scheme: dark; font-family: 'Inter', system-ui, sans-serif; background: #050910; color: #dbe7ff; }
      body { margin: 0; padding: 24px; }
      header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
      h1 { font-size: 28px; margin: 0; }
      .summary-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
      .summary-card { background: #0e1726; padding: 16px; border-radius: 12px; border: 1px solid rgba(120, 156, 255, 0.1); }
      .summary-card h3 { margin: 0 0 8px; font-size: 14px; color: #86a1d8; text-transform: uppercase; letter-spacing: 0.08em; }
      .summary-card p { margin: 0; font-size: 20px; font-weight: 600; }
      .panel { background: #0e1726; border-radius: 12px; border: 1px solid rgba(120, 156, 255, 0.08); padding: 24px; margin-top: 24px; }
      .panel h2 { margin-top: 0; }
      .chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px; align-items: stretch; }
      canvas { background: rgba(15, 22, 36, 0.8); border-radius: 8px; padding: 12px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid rgba(120, 156, 255, 0.1); }
      th { text-transform: uppercase; font-size: 12px; letter-spacing: 0.05em; color: #8ea7c6; }
      footer { margin-top: 32px; color: #7489b1; font-size: 13px; text-align: center; }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h1>Environmental Observatory Dashboard</h1>
        <p id="generatedAt">Generated</p>
      </div>
      <div>
        <strong id="windowRange">Window</strong><br />
        <span id="lookback"></span>
      </div>
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
        new Date(DASHBOARD_DATA.window.start).toLocaleString() + ' → ' + new Date(DASHBOARD_DATA.window.end).toLocaleString();
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
          .map(function (row) {
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
        const ctx = trendCtx.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, 'rgba(97, 216, 255, 0.9)');
        gradient.addColorStop(1, 'rgba(97, 216, 255, 0.2)');
        new Chart(trendCtx, {
          type: 'line',
          data: {
            labels,
            datasets: [
              {
                label: 'Average Temperature °C',
                data: trends.map((row) => row.avgTemp),
                fill: true,
                backgroundColor: gradient,
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
                backgroundColor: 'rgba(97, 216, 255, 0.45)',
                borderColor: '#61d8ff',
                borderWidth: 1.5,
                type: 'line'
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: { ticks: { color: '#8ea7c6' } },
              y: { ticks: { color: '#8ea7c6' } }
            },
            plugins: {
              legend: { labels: { color: '#dbe7ff' } }
            }
          }
        });
      }

    </script>
  </body>
</html>`;
}

async function waitForDatasetReady(
  context: DashboardAggregatorContext,
  timestore: SelectedTimestore,
  datasetSlug: string
): Promise<boolean> {
  for (let attempt = 0; attempt < DATASET_READY_MAX_ATTEMPTS; attempt += 1) {
    const dataset = await timestore.getDataset({ datasetSlug, principal: context.settings.principals.dashboardAggregator });
    if (dataset) {
      return true;
    }
    if (attempt < DATASET_READY_MAX_ATTEMPTS - 1) {
      context.logger.warn('Timestore dataset not yet available; retrying', {
        datasetSlug,
        attempt: attempt + 1,
        remainingAttempts: DATASET_READY_MAX_ATTEMPTS - attempt - 1
      });
      await delay(DATASET_READY_DELAY_MS);
    }
  }
  return false;
}

async function waitForFlushCompletion(
  context: DashboardAggregatorContext,
  coreWorkflows: CoreWorkflowsCapability,
  partitionKey: string,
  principal: string | undefined
): Promise<WorkflowAssetSummary | null> {
  const ingestWorkflowSlug = context.settings.reprocess.ingestWorkflowSlug;
  const ingestAssetId = context.settings.reprocess.ingestAssetId;
  let lastSummary: WorkflowAssetSummary | null = null;

  for (let attempt = 0; attempt < FLUSH_CHECK_MAX_ATTEMPTS; attempt += 1) {
    let summary: WorkflowAssetSummary | null = null;
    try {
      summary = await coreWorkflows.getLatestAsset({
        workflowSlug: ingestWorkflowSlug,
        assetId: ingestAssetId,
        partitionKey,
        principal
      });
    } catch (error) {
      context.logger.error('Failed to load ingest asset summary', {
        partitionKey,
        error: error instanceof Error ? error.message : String(error)
      });
      return lastSummary;
    }

    if (summary) {
      lastSummary = summary;
      const payload = toRecord(summary.payload);
      const flushPending = payload?.flushPending === true;
      if (!flushPending) {
        return summary;
      }

      if (attempt < FLUSH_CHECK_MAX_ATTEMPTS - 1) {
        context.logger.info('Timestore ingestion flush pending; waiting before aggregation', {
          partitionKey,
          attempt: attempt + 1,
          remainingAttempts: FLUSH_CHECK_MAX_ATTEMPTS - attempt - 1
        });
      }
    } else if (attempt < FLUSH_CHECK_MAX_ATTEMPTS - 1) {
      context.logger.warn('Ingest asset summary not yet available; retrying before aggregation', {
        partitionKey,
        attempt: attempt + 1,
        remainingAttempts: FLUSH_CHECK_MAX_ATTEMPTS - attempt - 1
      });
    }

    if (attempt < FLUSH_CHECK_MAX_ATTEMPTS - 1) {
      await delay(FLUSH_CHECK_DELAY_MS);
    }
  }

  if (lastSummary) {
    context.logger.warn('Proceeding with dashboard aggregation despite flush still pending', {
      partitionKey
    });
  } else {
    context.logger.warn('Proceeding with dashboard aggregation without ingest asset summary', {
      partitionKey
    });
  }

  return lastSummary;
}

function normalizeRows(rows: Record<string, unknown>[]): ObservatoryRow[] {
  const normalized: ObservatoryRow[] = [];
  for (const row of rows) {
    const timestamp = typeof row.timestamp === 'string' ? row.timestamp : undefined;
    if (!timestamp) {
      continue;
    }
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      continue;
    }
    normalized.push({
      timestamp: parsed.toISOString(),
      instrument_id: typeof row.instrument_id === 'string' ? row.instrument_id : '',
      site: typeof row.site === 'string' ? row.site : '',
      temperature_c: typeof row.temperature_c === 'number' ? row.temperature_c : Number(row.temperature_c) || 0,
      relative_humidity_pct:
        typeof row.relative_humidity_pct === 'number'
          ? row.relative_humidity_pct
          : Number(row.relative_humidity_pct) || 0,
      pm2_5_ug_m3: typeof row.pm2_5_ug_m3 === 'number' ? row.pm2_5_ug_m3 : Number(row.pm2_5_ug_m3) || 0,
      battery_voltage: typeof row.battery_voltage === 'number' ? row.battery_voltage : Number(row.battery_voltage) || 0
    });
  }
  return normalized;
}

export const dashboardAggregatorJob = createJobHandler<
  ObservatorySettings,
  ObservatorySecrets,
  DashboardAggregatorResult,
  DashboardAggregatorParameters,
  ['filestore', 'timestore', 'events.default', 'coreWorkflows']
>({
  name: 'observatory-dashboard-aggregator',
  settings: inheritModuleSettings(),
  secrets: inheritModuleSecrets(),
  requires: ['filestore', 'timestore', 'events.default', 'coreWorkflows'] as const,
  parameters: {
    resolve: (raw) => parametersSchema.parse(raw ?? {})
  },
  handler: async (context: DashboardAggregatorContext): Promise<DashboardAggregatorResult> => {
    const filestoreCapabilityCandidate = selectFilestore(context.capabilities);
    if (!filestoreCapabilityCandidate) {
      throw new Error('Filestore capability is required for dashboard aggregation');
    }
    const filestore: FilestoreCapability = filestoreCapabilityCandidate;

    const timestore = selectTimestore(context.capabilities);
    if (!timestore) {
      throw new Error('Timestore capability is required for dashboard aggregation');
    }

    const coreWorkflows = selectCoreWorkflows(context.capabilities);
    if (!coreWorkflows) {
      throw new Error('Core workflows capability is required for dashboard aggregation');
    }

    const principal = context.settings.principals.dashboardAggregator?.trim() || undefined;
    const partitionKeyInput = context.parameters.partitionKey?.trim();
    const partitionKey = partitionKeyInput && partitionKeyInput.length > 0
      ? partitionKeyInput
      : new Date().toISOString().slice(0, 16);
    const lookbackMinutes = context.parameters.lookbackMinutes ?? context.settings.dashboard.lookbackMinutes;
    const ingestAssetSummary = await waitForFlushCompletion(context, coreWorkflows, partitionKey, principal);
    const ingestAssetPayload = toRecord(ingestAssetSummary?.payload);
    const datasetSlug =
      context.parameters.timestoreDatasetSlug ??
      (typeof ingestAssetPayload?.datasetSlug === 'string' ? ingestAssetPayload.datasetSlug : undefined) ??
      context.settings.timestore.datasetSlug;
    const burst: BurstContext = {
      reason: context.parameters.burstReason?.trim() || null,
      finishedAt: context.parameters.burstFinishedAt?.trim() || null
    };

    const backendParams = {
      filestoreBackendId: context.settings.filestore.backendId,
      filestoreBackendKey: context.settings.filestore.backendKey ?? DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY
    } satisfies {
      filestoreBackendId?: number | null;
      filestoreBackendKey?: string | null;
    };
    const backendMountId = await ensureResolvedBackendId(filestore, backendParams);

    const timeWindow = resolveTimeWindow(partitionKey, lookbackMinutes);
    const generatedAt = new Date().toISOString();

    const datasetReady = await waitForDatasetReady(context, timestore, datasetSlug);
    if (!datasetReady) {
      throw new Error(
        `Timestore dataset ${datasetSlug} not ready after waiting ${
          DATASET_READY_MAX_ATTEMPTS * DATASET_READY_DELAY_MS
        }ms`
      );
    }

    const queryResult = await timestore.queryDataset({
      datasetSlug,
      timeRange: { start: timeWindow.startIso, end: timeWindow.endIso },
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
      limit: MAX_ROWS,
      principal
    }) as { rows?: Array<Record<string, unknown>> };

    const rows = normalizeRows(queryResult.rows ?? []);
    context.logger.info('Aggregated timestore rows for dashboard', {
      datasetSlug,
      partitionKey,
      samples: rows.length
    });

    const instruments = aggregateInstruments(rows).sort((a, b) => b.samples - a.samples);
    const sites = aggregateSites(rows).sort((a, b) => b.samples - a.samples);
    const trends = buildTrends(rows);
    const summary = computeSummary(rows);

    const normalizedOverviewPrefix = context.settings.filestore.overviewPrefix.replace(/\/+$/g, '');
    await ensureFilestoreHierarchy(filestore, backendMountId, normalizedOverviewPrefix, principal);

    const dashboardData = {
      generatedAt,
      partitionKey,
      lookbackMinutes,
      window: timeWindow,
      summary,
      instruments,
      sites,
      trends,
      burst
    } satisfies Record<string, unknown>;

    const dashboardJsonPath = `${normalizedOverviewPrefix}/dashboard.json`;
    const dashboardHtmlPath = `${normalizedOverviewPrefix}/index.html`;

    const idempotencySuffix = sanitizeIdentifier(partitionKey) || 'partition';

    const [dataNode, htmlNode] = await Promise.all([
      uploadTextFile({
        filestore,
        backendMountId,
        backendMountKey: context.settings.filestore.backendKey ?? undefined,
        defaultBackendKey: DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY,
        path: dashboardJsonPath,
        content: JSON.stringify(dashboardData, null, 2),
        contentType: 'application/json',
        principal,
        idempotencyKey: `dashboard-json-${idempotencySuffix}`,
        metadata: {
          partitionKey,
          lookbackMinutes,
          type: 'observatory.dashboard.data'
        }
      }),
      uploadTextFile({
        filestore,
        backendMountId,
        backendMountKey: context.settings.filestore.backendKey ?? undefined,
        defaultBackendKey: DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY,
        path: dashboardHtmlPath,
        content: buildDashboardHtml(dashboardData),
        contentType: 'text/html; charset=utf-8',
        principal,
        idempotencyKey: `dashboard-html-${idempotencySuffix}`,
        metadata: {
          partitionKey,
          lookbackMinutes,
          type: 'observatory.dashboard.html'
        }
      })
    ]);

    const eventsCapability = selectEventBus(context.capabilities, 'default');
    if (!eventsCapability) {
      throw new Error('Event bus capability is required for dashboard aggregation');
    }

    const publisher = createObservatoryEventPublisher({ capability: eventsCapability, source: context.settings.events.source });

    const dashboardSnapshotPayload: DashboardSnapshotAssetPayload = {
      generatedAt,
      partitionKey,
      lookbackMinutes,
      overviewPrefix: normalizedOverviewPrefix,
      dashboard: {
        path: htmlNode.path,
        nodeId: htmlNode.node?.id ?? htmlNode.nodeId ?? null,
        mediaType: 'text/html',
        sizeBytes: htmlNode.node?.sizeBytes ?? null,
        checksum: htmlNode.node?.checksum ?? null
      },
      data: {
        path: dataNode.path,
        nodeId: dataNode.node?.id ?? dataNode.nodeId ?? null,
        mediaType: 'application/json',
        sizeBytes: dataNode.node?.sizeBytes ?? null,
        checksum: dataNode.node?.checksum ?? null
      },
      summary,
      window: timeWindow,
      burst
    };

    const configuredSnapshotTtl = context.settings.dashboard.snapshotFreshnessMs;
    const snapshotFreshnessTtl =
      typeof configuredSnapshotTtl === 'number' && Number.isFinite(configuredSnapshotTtl)
        ? configuredSnapshotTtl
        : DEFAULT_SNAPSHOT_FRESHNESS_MS;
    const snapshotAsset = {
      assetId: 'observatory.dashboard.snapshot',
      partitionKey,
      producedAt: generatedAt,
      freshness: { ttlMs: snapshotFreshnessTtl },
      payload: dashboardSnapshotPayload
    } satisfies DashboardAggregatorResult['assets'][number];

    try {
      await publisher.publish({
        type: 'observatory.dashboard.updated',
        occurredAt: generatedAt,
        payload: {
          generatedAt,
          partitionKey,
          lookbackMinutes,
          overviewPrefix: normalizedOverviewPrefix,
          dashboard: {
            path: htmlNode.path,
            nodeId: htmlNode.node?.id ?? htmlNode.nodeId ?? null,
            mediaType: 'text/html',
            sizeBytes: htmlNode.node?.sizeBytes ?? null,
            checksum: htmlNode.node?.checksum ?? null
          },
          data: {
            path: dataNode.path,
            nodeId: dataNode.node?.id ?? dataNode.nodeId ?? null,
            mediaType: 'application/json',
            sizeBytes: dataNode.node?.sizeBytes ?? null,
            checksum: dataNode.node?.checksum ?? null
          },
          metrics: summary,
          window: timeWindow,
          burst
        }
      });
    } finally {
      await publisher.close().catch(() => undefined);
    }

    context.logger.info('Dashboard aggregation completed', {
      overviewPrefix: normalizedOverviewPrefix,
      dashboardPath: htmlNode.path,
      dataPath: dataNode.path
    });

    return {
      generatedAt,
      samples: summary.samples,
      instrumentCount: summary.instrumentCount,
      siteCount: summary.siteCount,
      dashboard: dashboardSnapshotPayload.dashboard,
      data: dashboardSnapshotPayload.data,
      overviewPrefix: normalizedOverviewPrefix,
      burst,
      assets: [snapshotAsset]
    } satisfies DashboardAggregatorResult;
  }
});

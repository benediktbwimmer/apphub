import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadObservatoryConfig } from '@observatory/shared-config';

type VisualizationArtifact = {
  relativePath: string;
  mediaType?: string;
  description?: string;
  sizeBytes?: number;
};

type ReportSummary = {
  instrumentCount: number;
  siteCount: number;
  alertCount: number;
};

type ReportMetrics = {
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

type ReportStatusFile = {
  generatedAt: string;
  metrics: ReportMetrics;
  summary: ReportSummary;
  artifacts?: VisualizationArtifact[];
};

type DashboardOverviewSummary = {
  samples: number;
  instrumentCount: number;
  siteCount: number;
  averageTemperatureC: number;
  averagePm25: number;
  maxPm25: number;
};

type DashboardOverviewFile = {
  generatedAt: string;
  partitionKey: string;
  lookbackMinutes: number;
  window?: { start: string; end: string };
  summary?: DashboardOverviewSummary;
};

type ReportEntry = {
  partitionDir: string;
  partitionName: string;
  payload: ReportStatusFile;
  updatedAt: string;
};

const config = loadObservatoryConfig();
const DEFAULT_REPORTS_DIR = config.paths.reports;
const reportsDir = path.resolve(
  process.env.OBSERVATORY_REPORTS_DIR ?? process.env.REPORTS_DIR ?? DEFAULT_REPORTS_DIR
);
const overviewDirName = config.workflows.dashboard?.overviewDirName ?? 'overview';
const refreshIntervalMs = Math.max(1000, Number(process.env.DASHBOARD_REFRESH_MS ?? '10000') || 10000);

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info'
  }
});

async function listReportPartitions(limit = 10): Promise<ReportEntry[]> {
  let entries: string[];
  try {
    const dirEntries = await readdir(reportsDir, { withFileTypes: true });
    entries = dirEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return [];
    }
    fastify.log.error({ err: error }, 'Failed to read reports directory');
    return [];
  }

  if (entries.length === 0) {
    return [];
  }

  const sorted = entries.sort((a, b) => b.localeCompare(a));
  const results: ReportEntry[] = [];

  for (const partitionName of sorted) {
    if (results.length >= limit) {
      break;
    }
    const partitionDir = path.resolve(reportsDir, partitionName);
    const statusPath = path.resolve(partitionDir, 'status.json');
    try {
      const file = await readFile(statusPath, 'utf8');
      const payload = JSON.parse(file) as ReportStatusFile;
      if (!payload?.metrics?.partitionKey) {
        continue;
      }
      const stats = await stat(statusPath).catch(() => null);
      results.push({
        partitionDir,
        partitionName,
        payload,
        updatedAt: stats ? stats.mtime.toISOString() : payload.generatedAt
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        continue;
      }
      fastify.log.warn({ err: error, partitionName }, 'Skipping invalid report partition');
    }
  }

  return results;
}

async function readOverviewStatus(): Promise<{
  generatedAt: string;
  partitionKey: string;
  lookbackMinutes: number;
  window: { start: string; end: string } | null;
  summary: DashboardOverviewSummary | null;
  dashboardPath: string;
  dataPath: string;
  updatedAt: string;
} | null> {
  const overviewDir = path.resolve(reportsDir, overviewDirName);
  const jsonPath = path.resolve(overviewDir, 'dashboard.json');
  const htmlPath = path.resolve(overviewDir, 'index.html');

  try {
    const file = await readFile(jsonPath, 'utf8');
    const payload = JSON.parse(file) as DashboardOverviewFile;
    const htmlStats = await stat(htmlPath);
    const relative = path.relative(reportsDir, overviewDir).split(path.sep).join('/');
    const dashboardPath = `/reports/${relative}/index.html`;
    const dataPath = `/reports/${relative}/dashboard.json`;
    return {
      generatedAt: payload.generatedAt,
      partitionKey: payload.partitionKey,
      lookbackMinutes: payload.lookbackMinutes,
      window: payload.window ?? null,
      summary: payload.summary ?? null,
      dashboardPath,
      dataPath,
      updatedAt: htmlStats.mtime.toISOString()
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      fastify.log.debug({ err: error }, 'Overview dashboard unavailable');
    }
    return null;
  }
}

fastify.register(fastifyStatic, {
  root: reportsDir,
  prefix: '/reports/',
  decorateReply: false,
  cacheControl: false,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store');
  }
});

fastify.get('/healthz', async () => ({ status: 'ok', reportsDir }));

fastify.get('/api/status', async (request, reply) => {
  const [overview, reports] = await Promise.all([
    readOverviewStatus(),
    listReportPartitions(12)
  ]);

  reply.header('Cache-Control', 'no-store');

  const overviewPayload = overview
    ? {
        state: 'ready' as const,
        generatedAt: overview.generatedAt,
        partitionKey: overview.partitionKey,
        lookbackMinutes: overview.lookbackMinutes,
        window: overview.window,
        summary: overview.summary,
        dashboardPath: overview.dashboardPath,
        dataPath: overview.dataPath,
        updatedAt: overview.updatedAt
      }
    : {
        state: 'missing' as const,
        overviewDirName
      };

  const recentReports = reports.map((entry) => ({
    partitionName: entry.partitionName,
    partitionKey: entry.payload.metrics.partitionKey,
    generatedAt: entry.payload.generatedAt,
    updatedAt: entry.updatedAt,
    summary: entry.payload.summary,
    metrics: entry.payload.metrics,
    reportPaths: {
      html: `/reports/${entry.partitionName}/status.html`,
      markdown: `/reports/${entry.partitionName}/status.md`,
      json: `/reports/${entry.partitionName}/status.json`
    }
  }));

  const latest = reports[0] ?? null;

  if (!latest) {
    return {
      state: 'empty' as const,
      reportsDir,
      refreshIntervalMs,
      overview: overviewPayload,
      recentReports
    };
  }

  const partitionStat = await stat(latest.partitionDir).catch(() => null);
  const partitionUpdatedAt = partitionStat?.mtime.toISOString() ?? latest.payload.generatedAt;

  const reportPaths = {
    html: `/reports/${latest.partitionName}/status.html`,
    markdown: `/reports/${latest.partitionName}/status.md`,
    json: `/reports/${latest.partitionName}/status.json`
  } as const;

  return {
    state: 'ready' as const,
    partitionKey: latest.payload.metrics.partitionKey,
    generatedAt: latest.payload.generatedAt,
    partitionUpdatedAt,
    summary: latest.payload.summary,
    metrics: latest.payload.metrics,
    artifacts: latest.payload.artifacts ?? [],
    reportPaths,
    refreshIntervalMs,
    overview: overviewPayload,
    recentReports
  };
});

fastify.get('/', async (request, reply) => {
  reply.header('Cache-Control', 'no-store');
  const configPayload = { refreshIntervalMs } as const;

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Observatory Dashboard</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: dark; }
      body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; background: #050b18; color: #e9f1ff; }
      header { padding: 2rem 2.5rem 1.5rem; border-bottom: 1px solid rgba(255, 255, 255, 0.08); background: radial-gradient(circle at top left, rgba(97, 216, 255, 0.18), transparent 55%), #0b1426; }
      h1 { margin: 0; font-size: 2rem; color: #61d8ff; }
      header p { margin: 0.75rem 0 0; color: #96b2d1; }
      main { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem; padding: 1.75rem 2.5rem 2.5rem; min-height: calc(100vh - 94px); }
      .panel { background: #0f1b30; border-radius: 14px; padding: 1.75rem; box-shadow: 0 18px 44px rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.04); }
      .panel h2 { margin-top: 0; font-size: 1.05rem; color: #8ae3ff; letter-spacing: 0.05em; text-transform: uppercase; }
      .status-grid { display: grid; gap: 1rem; }
      .status-card { background: rgba(17, 26, 44, 0.6); border-radius: 10px; padding: 1rem; border: 1px solid rgba(255, 255, 255, 0.04); }
      .status-card h3 { margin: 0; font-size: 0.9rem; color: #9fb9d0; text-transform: uppercase; letter-spacing: 0.05em; }
      .status-card p { margin: 0.35rem 0 0; font-size: 1.6rem; font-weight: 600; color: #ffffff; }
      .summary { margin-top: 1.5rem; color: #9fb9d0; font-size: 0.95rem; line-height: 1.5; }
      .summary strong { color: #ffffff; }
      .placeholder { padding: 1.25rem; background: rgba(15, 27, 48, 0.65); border-radius: 12px; border: 1px dashed rgba(255, 255, 255, 0.1); color: #96adc9; font-size: 0.95rem; }
      #recent-reports { list-style: none; margin: 1.5rem 0 0; padding: 0; display: grid; gap: 0.65rem; }
      #recent-reports li { background: rgba(14, 24, 44, 0.65); border: 1px solid rgba(255,255,255,0.05); border-radius: 10px; padding: 0.75rem 1rem; display: flex; flex-direction: column; gap: 0.25rem; }
      #recent-reports li a { color: #7ddcff; text-decoration: none; font-size: 0.85rem; }
      #recent-reports li a:hover { text-decoration: underline; }
      iframe { width: 100%; height: 100%; min-height: 520px; border: none; border-radius: 12px; background: #ffffff; }
      .hidden { display: none !important; }
      footer { padding: 1rem 2.5rem 2rem; font-size: 0.85rem; color: #6b7c93; background: #0b1426; border-top: 1px solid rgba(255, 255, 255, 0.08); }
      @media (max-width: 960px) { main { grid-template-columns: 1fr; padding: 1.5rem; } }
    </style>
  </head>
  <body>
    <header>
      <h1>Observatory Dashboard</h1>
      <p id="subtitle">Awaiting latest report&hellip;</p>
    </header>
    <main>
      <section class="panel" id="summary-panel" aria-labelledby="metrics-heading">
        <h2 id="metrics-heading">Latest metrics</h2>
        <div id="status-grid" class="status-grid"></div>
        <div id="summary" class="summary"></div>
        <div>
          <h3 style="margin: 1.5rem 0 0.75rem; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: #8fa8c9;">Recent reports</h3>
          <ul id="recent-reports"></ul>
        </div>
      </section>
      <section class="panel" id="overview-panel" aria-labelledby="overview-heading">
        <h2 id="overview-heading">Aggregate overview</h2>
        <p id="overview-meta" class="summary"></p>
        <div id="overview-placeholder" class="placeholder">Aggregate dashboard will appear after the first partitions are ingested.</div>
        <iframe id="overview-frame" class="hidden" title="Observatory aggregate dashboard"></iframe>
      </section>
      <section class="panel" id="report-panel" aria-labelledby="report-heading">
        <h2 id="report-heading">Status report</h2>
        <iframe id="report-frame" title="Observatory status report"></iframe>
      </section>
    </main>
    <footer>
      Auto-refresh interval: <span id="interval"></span> · Reports directory: <code>${reportsDir}</code>
    </footer>
    <script>
      const CONFIG = ${JSON.stringify(configPayload)};
      const statusGrid = document.getElementById('status-grid');
      const summaryEl = document.getElementById('summary');
      const subtitleEl = document.getElementById('subtitle');
      const reportFrame = document.getElementById('report-frame');
      const overviewFrame = document.getElementById('overview-frame');
      const overviewMeta = document.getElementById('overview-meta');
      const overviewPlaceholder = document.getElementById('overview-placeholder');
      const recentList = document.getElementById('recent-reports');
      const intervalEl = document.getElementById('interval');
      intervalEl.textContent = Math.round(CONFIG.refreshIntervalMs / 1000) + 's';

      function renderEmpty() {
        statusGrid.innerHTML = '<div class="status-card"><h3>Status</h3><p>No reports yet</p></div>';
        summaryEl.textContent = 'Waiting for the first ingestion run to publish reports.';
        subtitleEl.textContent = 'Awaiting latest report…';
        reportFrame.src = 'about:blank';
      }

      function renderSummary(metrics, summary) {
        if (!metrics) {
          renderEmpty();
          return;
        }
        const cards = [
          { label: 'Samples', value: metrics.samples.toLocaleString() },
          { label: 'Instruments', value: metrics.instrumentCount.toString() },
          { label: 'Sites', value: metrics.siteCount.toString() },
          { label: 'Avg Temp (°C)', value: metrics.averageTemperatureC.toFixed(2) },
          { label: 'Avg PM₂.₅', value: metrics.averagePm25.toFixed(2) },
          { label: 'Max PM₂.₅', value: metrics.maxPm25.toFixed(2) }
        ];
        statusGrid.innerHTML = cards.map(function (card) {
          return '<div class="status-card"><h3>' + card.label + '</h3><p>' + card.value + '</p></div>';
        }).join('');

        if (summary) {
          summaryEl.innerHTML = 'Latest report covers <strong>' + summary.alertCount + '</strong> alerts with '
            '<strong>' + summary.instrumentCount + '</strong> instruments across ' +
            '<strong>' + summary.siteCount + '</strong> sites.';
        } else {
          summaryEl.textContent = '';
        }
      }

      function renderOverview(overview) {
        if (!overview || overview.state !== 'ready') {
          overviewFrame.classList.add('hidden');
          overviewPlaceholder.classList.remove('hidden');
          overviewMeta.textContent = 'Aggregate dashboard pending.';
          return;
        }
        const generated = new Date(overview.generatedAt).toLocaleString();
        const windowText = overview.window
          ? new Date(overview.window.start).toLocaleString() + ' → ' + new Date(overview.window.end).toLocaleString()
          : 'N/A';
        overviewMeta.textContent = 'Updated ' + generated + ' · Lookback ' + overview.lookbackMinutes + ' minutes · Window ' + windowText;
        overviewPlaceholder.classList.add('hidden');
        overviewFrame.classList.remove('hidden');
        overviewFrame.src = overview.dashboardPath + '?t=' + Date.now();
      }

      function renderRecentReports(items) {
        if (!recentList) { return; }
        if (!items || items.length === 0) {
          recentList.innerHTML = '<li class="placeholder">No report snapshots yet.</li>';
          return;
        }
        recentList.innerHTML = items.map(function (item) {
          const generated = new Date(item.generatedAt).toLocaleString();
          return '<li>' +
            '<strong>' + item.partitionKey + '</strong>' +
            '<span style="color:#8fa8c9; font-size:0.9rem;">Generated ' + generated + '</span>' +
            '<div style="display:flex; gap:0.75rem; flex-wrap:wrap;">' +
              '<a href="' + item.reportPaths.html + '" target="_blank" rel="noopener">HTML</a>' +
              '<a href="' + item.reportPaths.markdown + '" target="_blank" rel="noopener">Markdown</a>' +
              '<a href="' + item.reportPaths.json + '" target="_blank" rel="noopener">JSON</a>' +
            '</div>' +
          '</li>';
        }).join('');
      }

      async function refreshStatus() {
        try {
          const response = await fetch('/api/status', { headers: { 'cache-control': 'no-store' } });
          if (!response.ok) {
            throw new Error('Status request failed');
          }
          const data = await response.json();
          renderOverview(data.overview);
          renderRecentReports(data.recentReports);

          if (data.state === 'empty') {
            renderEmpty();
            setTimeout(refreshStatus, CONFIG.refreshIntervalMs);
            return;
          }

          renderSummary(data.metrics, data.summary);
          subtitleEl.textContent = 'Latest partition ' + data.partitionKey + ' · Updated ' + new Date(data.partitionUpdatedAt).toLocaleTimeString();
          reportFrame.src = data.reportPaths.html + '?t=' + Date.now();
        } catch (error) {
          console.error('Dashboard status refresh failed', error);
          renderEmpty();
        } finally {
          setTimeout(refreshStatus, CONFIG.refreshIntervalMs);
        }
      }

      refreshStatus();
    </script>
  </body>
</html>`;

  reply.type('text/html');
  return html;
});


const port = Number(process.env.PORT ?? '4311');
const host = process.env.HOST ?? '0.0.0.0';

fastify
  .listen({ port, host })
  .then(() => {
    fastify.log.info({ port, host, reportsDir }, 'Observatory dashboard ready');
  })
  .catch((error) => {
    fastify.log.error({ err: error }, 'Failed to start observatory dashboard');
    process.exit(1);
  });

const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
for (const signal of shutdownSignals) {
  process.on(signal, () => {
    fastify.log.info({ signal }, 'Received shutdown signal');
    fastify
      .close()
      .then(() => {
        process.exit(0);
      })
      .catch((error) => {
        fastify.log.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      });
  });
}

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadObservatoryConfig } from '../../shared/config';

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

type LatestReport = {
  partitionDir: string;
  partitionName: string;
  payload: ReportStatusFile;
};

const config = loadObservatoryConfig();
const DEFAULT_REPORTS_DIR = config.paths.reports;
const reportsDir = path.resolve(
  process.env.OBSERVATORY_REPORTS_DIR ?? process.env.REPORTS_DIR ?? DEFAULT_REPORTS_DIR
);
const refreshIntervalMs = Math.max(1000, Number(process.env.DASHBOARD_REFRESH_MS ?? '10000') || 10000);

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info'
  }
});

async function findLatestReport(): Promise<LatestReport | null> {
  let entries: string[];
  try {
    const dirEntries = await readdir(reportsDir, { withFileTypes: true });
    entries = dirEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return null;
    }
    fastify.log.error({ err: error }, 'Failed to read reports directory');
    return null;
  }

  if (entries.length === 0) {
    return null;
  }

  const sorted = entries.sort((a, b) => b.localeCompare(a));

  for (const partitionName of sorted) {
    const partitionDir = path.resolve(reportsDir, partitionName);
    const statusPath = path.resolve(partitionDir, 'status.json');
    try {
      const file = await readFile(statusPath, 'utf8');
      const payload = JSON.parse(file) as ReportStatusFile;
      if (!payload?.metrics?.partitionKey) {
        continue;
      }
      return { partitionDir, partitionName, payload } satisfies LatestReport;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        continue;
      }
      fastify.log.warn({ err: error, partitionName }, 'Skipping invalid report partition');
    }
  }

  return null;
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
  const latest = await findLatestReport();
  reply.header('Cache-Control', 'no-store');
  if (!latest) {
    return {
      state: 'empty' as const,
      reportsDir,
      refreshIntervalMs
    };
  }

  const partitionStat = await stat(latest.partitionDir);
  const partitionUpdatedAt = partitionStat.mtime.toISOString();

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
    refreshIntervalMs
  };
});

fastify.get('/', async (request, reply) => {
  reply.header('Cache-Control', 'no-store');
  const config = {
    refreshIntervalMs
  } as const;

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Observatory Dashboard</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: dark; }
      body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; background: #050b18; color: #e9f1ff; }
      header { padding: 1.5rem 2rem; border-bottom: 1px solid rgba(255, 255, 255, 0.08); background: #0b1426; }
      h1 { margin: 0; font-size: 1.75rem; color: #61d8ff; }
      main { display: grid; grid-template-columns: minmax(260px, 320px) 1fr; gap: 1.5rem; padding: 1.5rem; min-height: calc(100vh - 82px); }
      .panel { background: #0f1b30; border-radius: 12px; padding: 1.5rem; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35); }
      .panel h2 { margin-top: 0; font-size: 1.1rem; color: #8ae3ff; letter-spacing: 0.04em; text-transform: uppercase; }
      .status-grid { display: grid; gap: 1rem; }
      .status-card { background: rgba(17, 26, 44, 0.6); border-radius: 10px; padding: 1rem; border: 1px solid rgba(255, 255, 255, 0.04); }
      .status-card h3 { margin: 0; font-size: 0.9rem; color: #9fb9d0; text-transform: uppercase; letter-spacing: 0.05em; }
      .status-card p { margin: 0.35rem 0 0; font-size: 1.6rem; font-weight: 600; color: #ffffff; }
      .summary { margin-top: 1.5rem; color: #9fb9d0; font-size: 0.95rem; line-height: 1.5; }
      .summary strong { color: #ffffff; }
      iframe { width: 100%; height: 100%; min-height: 520px; border: none; border-radius: 12px; background: #ffffff; }
      footer { padding: 1rem 2rem; font-size: 0.85rem; color: #6b7c93; background: #0b1426; border-top: 1px solid rgba(255, 255, 255, 0.08); }
      .alert { color: #ff9f43; font-weight: 600; }
      @media (max-width: 960px) { main { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <header>
      <h1>Observatory Dashboard</h1>
      <p id="subtitle">Awaiting latest report&hellip;</p>
    </header>
    <main>
      <section class="panel" aria-labelledby="metrics-heading">
        <h2 id="metrics-heading">Latest metrics</h2>
        <div id="status-grid" class="status-grid"></div>
        <div id="summary" class="summary"></div>
      </section>
      <section class="panel" aria-labelledby="report-heading">
        <h2 id="report-heading">Status report</h2>
        <iframe id="report-frame" title="Observatory status report"></iframe>
      </section>
    </main>
    <footer>
      Auto-refresh interval: <span id="interval"></span> · Reports directory: <code>${reportsDir}</code>
    </footer>
    <script>
      const CONFIG = ${JSON.stringify(config)};
      const statusGrid = document.getElementById('status-grid');
      const summaryEl = document.getElementById('summary');
      const subtitleEl = document.getElementById('subtitle');
      const reportFrame = document.getElementById('report-frame');
      const intervalEl = document.getElementById('interval');
      intervalEl.textContent = Math.round(CONFIG.refreshIntervalMs / 1000) + 's';

      function renderEmpty() {
        statusGrid.innerHTML = '<div class="status-card"><h3>Status</h3><p>No reports yet</p></div>';
        summaryEl.textContent = 'Waiting for the first ingestion run to publish reports.';
        subtitleEl.textContent = 'Awaiting latest report…';
        reportFrame.src = 'about:blank';
      }

      function renderStatus(data) {
        const { metrics, summary, partitionKey, generatedAt, reportPaths } = data;
        subtitleEl.textContent = 'Partition ' + partitionKey + ' · generated ' + new Date(generatedAt).toLocaleString();

        const cards = [
          { label: 'Samples', value: metrics.samples.toLocaleString() },
          { label: 'Instruments', value: metrics.instrumentCount.toLocaleString() },
          { label: 'Sites', value: metrics.siteCount.toLocaleString() },
          { label: 'Avg Temp', value: metrics.averageTemperatureC.toFixed(2) + ' °C' },
          { label: 'Avg PM2.5', value: metrics.averagePm25.toFixed(2) + ' µg/m³' },
          { label: 'Peak PM2.5', value: metrics.maxPm25.toFixed(2) + ' µg/m³' }
        ];
        statusGrid.innerHTML = cards
          .map(function (card) {
            return '<div class="status-card"><h3>' + card.label + '</h3><p>' + card.value + '</p></div>';
          })
          .join('');

        const alertText = summary.alertCount > 0
          ? '<span class="alert">Alert threshold exceeded</span>'
          : 'No alerts triggered';

        summaryEl.innerHTML = [
          '<p><strong>Lookback:</strong> last ' + metrics.lookbackMinutes + ' minutes</p>',
          '<p><strong>Site filter:</strong> ' + (metrics.siteFilter ?? 'All sites') + '</p>',
          '<p>' + alertText + '</p>',
          '<p><a href="' + reportPaths.json + '" target="_blank" rel="noopener">Download JSON</a> · ' +
            '<a href="' + reportPaths.markdown + '" target="_blank" rel="noopener">View Markdown</a></p>'
        ].join('');

        const cacheBuster = String(Date.now());
        reportFrame.src = reportPaths.html + '?t=' + cacheBuster;
      }

      async function refresh() {
        try {
          const response = await fetch('/api/status', { cache: 'no-store' });
          if (!response.ok) {
            throw new Error('Failed to load status');
          }
          const data = await response.json();
          if (data.state === 'empty') {
            renderEmpty();
            return;
          }
          renderStatus(data);
        } catch (error) {
          console.error(error);
          subtitleEl.textContent = 'Failed to load latest report';
        }
      }

      refresh();
      setInterval(refresh, CONFIG.refreshIntervalMs);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          refresh();
        }
      });
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

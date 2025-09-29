import Fastify from 'fastify';
import { FilestoreClient, FilestoreClientError } from '@apphub/filestore-client';
import { loadObservatoryConfig } from '@observatory/shared-config';

const config = loadObservatoryConfig();
const filestoreClient = new FilestoreClient({
  baseUrl: config.filestore.baseUrl,
  token: config.filestore.token,
  userAgent: 'observatory-dashboard-service/0.2.0'
});
const filestoreBackendId = config.filestore.backendMountId;
const filestorePrincipal = process.env.OBSERVATORY_DASHBOARD_PRINCIPAL?.trim() || undefined;

const reportsPrefix = (config.filestore.reportsPrefix ?? 'datasets/observatory/reports').replace(/\/+$/g, '');
const overviewPrefix = (
  config.workflows.dashboard?.overviewPrefix ?? `${reportsPrefix}/overview`
).replace(/\/+$/g, '');
const refreshIntervalMs = Math.max(1000, Number(process.env.DASHBOARD_REFRESH_MS ?? '10000') || 10000);

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info'
  }
});

function normalizeFilestorePath(target: string): string {
  return target.replace(/^\/+/, '').replace(/\/+$/g, '');
}

type ReportStatusFile = {
  generatedAt: string;
  metrics?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  reportFiles?: Array<Record<string, unknown>>;
  plotsReferenced?: Array<Record<string, unknown>>;
};

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
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

async function readJsonFromFilestore(path: string): Promise<{ nodeId: number | null; payload: unknown; path: string } | null> {
  try {
    const normalized = normalizeFilestorePath(path);
    const node = await filestoreClient.getNodeByPath({ backendMountId: filestoreBackendId, path: normalized });
    const download = await filestoreClient.downloadFile(node.id, { principal: filestorePrincipal });
    const body = await streamToString(download.stream);
    return {
      nodeId: node.id,
      payload: JSON.parse(body),
      path: node.path
    };
  } catch (error) {
    if (error instanceof FilestoreClientError && error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

function toReportUrl(filestorePath: string): string {
  const normalized = normalizeFilestorePath(filestorePath);
  if (normalized.startsWith(reportsPrefix)) {
    const relative = normalized.slice(reportsPrefix.length).replace(/^\/+/, '');
    return `/reports/${relative}`;
  }
  return `/reports?path=${encodeURIComponent(normalized)}`;
}

async function listReportPartitions(limit = 10): Promise<
  Array<{
    partitionName: string;
    partitionKey: string;
    generatedAt: string;
    updatedAt: string;
    reportPaths: {
      html: string;
      markdown: string;
      json: string;
    };
    summary: Record<string, unknown> | undefined;
    metrics: Record<string, unknown> | undefined;
    artifacts: unknown;
  }>
> {
  try {
    const result = await filestoreClient.listNodes({
      backendMountId: filestoreBackendId,
      path: reportsPrefix,
      depth: 1,
      kinds: ['directory'],
      limit: 200
    });

    const overviewNormalized = normalizeFilestorePath(overviewPrefix);
    const candidates = result.nodes
      .filter((node) => node.kind === 'directory')
      .map((node) => node.path)
      .filter((path) => normalizeFilestorePath(path) !== overviewNormalized)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, limit);

    const entries: Array<{
      partitionName: string;
      partitionKey: string;
      generatedAt: string;
      updatedAt: string;
      reportPaths: {
        html: string;
        markdown: string;
        json: string;
      };
      summary: Record<string, unknown> | undefined;
      metrics: Record<string, unknown> | undefined;
      artifacts: unknown;
    }> = [];

    for (const fullPath of candidates) {
      const normalizedPath = normalizeFilestorePath(fullPath);
      const partitionName = normalizedPath.slice(reportsPrefix.length).replace(/^\/+/, '');
      const statusPath = `${normalizedPath}/status.json`;
      const record = await readJsonFromFilestore(statusPath);
      if (!record) {
        continue;
      }
      const payload = record.payload as ReportStatusFile;
      const generatedAt = typeof payload.generatedAt === 'string' ? payload.generatedAt : new Date().toISOString();
      const htmlPath = `${normalizedPath}/status.html`;
      const markdownPath = `${normalizedPath}/status.md`;

      entries.push({
        partitionName,
        partitionKey:
          typeof payload.metrics?.partitionKey === 'string'
            ? (payload.metrics?.partitionKey as string)
            : partitionName,
        generatedAt,
        updatedAt: generatedAt,
        reportPaths: {
          html: toReportUrl(htmlPath),
          markdown: toReportUrl(markdownPath),
          json: toReportUrl(statusPath)
        },
        summary: (payload.summary as Record<string, unknown>) ?? undefined,
        metrics: (payload.metrics as Record<string, unknown>) ?? undefined,
        artifacts: payload.reportFiles ?? []
      });
    }

    return entries;
  } catch (error) {
    fastify.log.error({ err: error }, 'Failed to list report partitions from Filestore');
    return [];
  }
}

async function readOverviewStatus(): Promise<{
  generatedAt: string;
  partitionKey: string;
  lookbackMinutes: number;
  window: { start: string; end: string } | null;
  summary: Record<string, unknown> | null;
  dashboardPath: string;
  dataPath: string;
  updatedAt: string;
} | null> {
  const jsonPath = `${overviewPrefix}/dashboard.json`;
  const htmlPath = `${overviewPrefix}/index.html`;
  const record = await readJsonFromFilestore(jsonPath);
  if (!record) {
    return null;
  }
  const payload = record.payload as Record<string, unknown>;
  const generatedAt = typeof payload.generatedAt === 'string' ? payload.generatedAt : new Date().toISOString();
  const partitionKey = typeof payload.partitionKey === 'string' ? payload.partitionKey : 'unknown';
  const lookbackMinutes = Number(payload.lookbackMinutes ?? 0) || 0;
  const window =
    payload.window && typeof payload.window === 'object'
      ? {
          start: String((payload.window as Record<string, unknown>).start ?? generatedAt),
          end: String((payload.window as Record<string, unknown>).end ?? generatedAt)
        }
      : null;

  return {
    generatedAt,
    partitionKey,
    lookbackMinutes,
    window,
    summary: (payload.summary as Record<string, unknown>) ?? null,
    dashboardPath: toReportUrl(htmlPath),
    dataPath: toReportUrl(jsonPath),
    updatedAt: generatedAt
  };
}

function guessContentType(path: string): string {
  if (path.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }
  if (path.endsWith('.json')) {
    return 'application/json';
  }
  if (path.endsWith('.md')) {
    return 'text/markdown; charset=utf-8';
  }
  if (path.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  if (path.endsWith('.csv')) {
    return 'text/csv; charset=utf-8';
  }
  return 'application/octet-stream';
}

fastify.get('/healthz', async () => ({
  status: 'ok',
  reportsPrefix,
  overviewPrefix
}));

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
        overviewPrefix
      };

  const latest = reports[0] ?? null;

  if (!latest) {
    return {
      state: 'empty' as const,
      reportsPrefix,
      refreshIntervalMs,
      overview: overviewPayload,
      recentReports: reports
    };
  }

  return {
    state: 'ready' as const,
    partitionKey: latest.partitionKey,
    generatedAt: latest.generatedAt,
    partitionUpdatedAt: latest.updatedAt,
    summary: latest.summary ?? null,
    metrics: latest.metrics ?? null,
    artifacts: latest.artifacts ?? [],
    reportPaths: latest.reportPaths,
    refreshIntervalMs,
    overview: overviewPayload,
    recentReports: reports
  };
});

fastify.get('/reports/*', async (request, reply) => {
  const suffix = String((request.params as Record<string, string>)['*'] ?? '').replace(/^\/+/, '');
  const targetPathParam = (request.query as Record<string, string | undefined>)?.path;
  const filestorePath = normalizeFilestorePath(
    targetPathParam && targetPathParam.trim().length > 0
      ? targetPathParam
      : `${reportsPrefix}/${suffix}`
  );

  try {
    const node = await filestoreClient.getNodeByPath({ backendMountId: filestoreBackendId, path: filestorePath });
    const download = await filestoreClient.downloadFile(node.id, { principal: filestorePrincipal });
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Type', download.contentType ?? guessContentType(filestorePath));
    reply.header('Content-Length', download.totalSize ?? download.contentLength ?? undefined);
    return reply.send(download.stream);
  } catch (error) {
    if (error instanceof FilestoreClientError && error.statusCode === 404) {
      reply.status(404);
      return { error: 'not_found', path: filestorePath };
    }
    fastify.log.error({ err: error, path: filestorePath }, 'Failed to proxy report asset');
    reply.status(500);
    return { error: 'internal_error' };
  }
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
      Auto-refresh interval: <span id="interval"></span> · Reports prefix: <code>${reportsPrefix}</code>
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
          { label: 'Samples', value: metrics.samples?.toLocaleString?.() ?? metrics.samples ?? 0 },
          { label: 'Instruments', value: metrics.instrumentCount ?? 0 },
          { label: 'Sites', value: metrics.siteCount ?? 0 },
          { label: 'Avg Temp (°C)', value: Number(metrics.averageTemperatureC ?? 0).toFixed(2) },
          { label: 'Avg PM₂.₅', value: Number(metrics.averagePm25 ?? 0).toFixed(2) },
          { label: 'Max PM₂.₅', value: Number(metrics.maxPm25 ?? 0).toFixed(2) }
        ];
        statusGrid.innerHTML = cards
          .map(function (card) {
            return '<div class="status-card"><h3>' + card.label + '</h3><p>' + card.value + '</p></div>';
          })
          .join('');

        if (summary) {
          summaryEl.innerHTML = 'Latest report covers <strong>' + (summary.alertCount ?? 0) + '</strong> alerts with '
            + '<strong>' + (summary.instrumentCount ?? 0) + '</strong> instruments across '
            + '<strong>' + (summary.siteCount ?? 0) + '</strong> sites.';
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

      async function refresh() {
        try {
          const response = await fetch('/api/status', { cache: 'no-store' });
          const payload = await response.json();
          if (payload.state === 'ready') {
            subtitleEl.textContent = 'Partition ' + payload.partitionKey + ' generated ' + new Date(payload.generatedAt).toLocaleString();
            if (payload.reportPaths && payload.reportPaths.html) {
              reportFrame.src = payload.reportPaths.html + '?t=' + Date.now();
            }
            renderSummary(payload.metrics, payload.summary);
          } else {
            renderEmpty();
          }
          renderRecentReports(payload.recentReports);
          renderOverview(payload.overview);
        } catch (error) {
          console.error('Failed to refresh dashboard status', error);
        } finally {
          setTimeout(refresh, CONFIG.refreshIntervalMs);
        }
      }

      refresh();
    </script>
  </body>
</html>`;
  reply.type('text/html').send(html);
});

fastify.listen({ port: Number(process.env.PORT ?? 4177), host: process.env.HOST ?? '0.0.0.0' }).catch((error) => {
  fastify.log.error(error, 'Failed to start dashboard service');
  process.exit(1);
});

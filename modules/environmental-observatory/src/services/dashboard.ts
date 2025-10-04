import { createService, selectFilestore, type ServiceLifecycle } from '@apphub/module-sdk';
import Fastify, { type FastifyInstance } from 'fastify';

import type { FilestoreCapability, FilestoreDownloadStream } from '@apphub/module-sdk';
import type { ObservatoryModuleSecrets, ObservatoryModuleSettings } from '../runtime/settings';
import { defaultObservatorySettings } from '../runtime/settings';

function normalizePath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/g, '');
}

async function streamToString(stream: FilestoreDownloadStream): Promise<string> {
  const candidate = stream as ReadableStream<Uint8Array> & {
    getReader?: () => ReadableStreamDefaultReader<Uint8Array>;
  };
  if (typeof candidate?.getReader === 'function') {
    const reader = candidate.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        chunks.push(value);
      }
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
  }

  const nodeStream = stream as NodeJS.ReadableStream;
  const buffers: Buffer[] = [];
  for await (const chunk of nodeStream) {
    buffers.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(buffers).toString('utf8');
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

type ReportStatusFile = {
  generatedAt: string;
  metrics?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  reportFiles?: Array<Record<string, unknown>>;
  plotsReferenced?: Array<Record<string, unknown>>;
};

function countPathSegments(path: string): number {
  return path.split('/').filter(Boolean).length;
}

function coerceMetrics(payload: ReportStatusFile, fallbackPartition: string): Record<string, unknown> | undefined {
  if (payload.metrics && typeof payload.metrics === 'object') {
    return payload.metrics as Record<string, unknown>;
  }
  if (payload.summary && typeof payload.summary === 'object') {
    const summary = payload.summary as Record<string, unknown>;
    return {
      partitionKey: fallbackPartition,
      instrumentCount: summary.instrumentCount ?? null,
      siteCount: summary.siteCount ?? null,
      alertCount: summary.alertCount ?? null
    };
  }
  return undefined;
}

export const dashboardService = createService<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets,
  ServiceLifecycle
>({
  name: 'observatory-dashboard-service',
  registration: {
    slug: 'observatory-dashboard',
    kind: 'dashboard',
    healthEndpoint: '/healthz',
    defaultPort: 4311,
    basePath: '/',
    tags: ['observatory', 'dashboard'],
    env: {
      HOST: '0.0.0.0',
      PORT: '{{port}}',
      OBSERVATORY_CONFIG_PATH: '${OBSERVATORY_CONFIG_PATH}',
      OBSERVATORY_DATA_ROOT: '${OBSERVATORY_DATA_ROOT}',
      DASHBOARD_REFRESH_MS: '${DASHBOARD_REFRESH_MS}'
    },
    ui: {
      previewPath: '/',
      spa: true
    }
  },
  settings: {
    defaults: defaultObservatorySettings
  },
  handler: (context) => {
    const filestoreCapabilityCandidate = selectFilestore(context.capabilities);
    if (!filestoreCapabilityCandidate) {
      throw new Error('Filestore capability is required for the observatory dashboard service');
    }
    const filestoreCapability: FilestoreCapability = filestoreCapabilityCandidate;

    const backendMountIdValue = context.settings.filestore.backendId;
    if (!backendMountIdValue || backendMountIdValue <= 0) {
      throw new Error('A valid filestore backend id is required for the observatory dashboard service');
    }
    const backendMountId = backendMountIdValue;

    const filestorePrincipal = context.settings.principals.dashboardAggregator?.trim() || undefined;
    const reportsPrefix = normalizePath(context.settings.filestore.reportsPrefix);
    const overviewPrefix = normalizePath(context.settings.filestore.overviewPrefix);
    const refreshIntervalMs = Math.max(1000, Number(process.env.DASHBOARD_REFRESH_MS ?? '10000') || 10000);

    const fastify: FastifyInstance = Fastify({ logger: false });

    async function readJsonFromFilestore(path: string): Promise<{
      nodeId: number | null;
      payload: unknown;
      path: string;
    } | null> {
      try {
        const normalized = normalizePath(path);
        const node = await filestoreCapability.getNodeByPath({
          backendMountId,
          path: normalized,
          principal: filestorePrincipal
        });
        const download = await filestoreCapability.downloadFile({
          nodeId: node.id,
          principal: filestorePrincipal
        });
        const body = await streamToString(download.stream);
        return {
          nodeId: node.id,
          payload: JSON.parse(body),
          path: node.path
        };
      } catch (error) {
        if (error instanceof Error && 'status' in error && (error as { status?: number }).status === 404) {
          return null;
        }
        throw error;
      }
    }

    function toReportUrl(targetPath: string): string {
      const normalized = normalizePath(targetPath);
      if (normalized.startsWith(reportsPrefix)) {
        const relative = normalized.slice(reportsPrefix.length).replace(/^\/+/, '');
        return `/reports/${relative}`;
      }
      return `/reports?path=${encodeURIComponent(normalized)}`;
    }

    async function listReportPartitions(limit = 10) {
      try {
        const result = await filestoreCapability.listNodes({
          backendMountId,
          path: reportsPrefix,
          depth: 2,
          kinds: ['directory'],
          limit: Math.max(limit * 8, 100),
          principal: filestorePrincipal
        });

        const overviewNormalized = overviewPrefix;
        const prefixDepth = countPathSegments(reportsPrefix);
        const candidates = result.nodes
          .filter((node) => node.kind === 'directory')
          .map((node) => normalizePath(node.path))
          .filter((path) => path !== overviewNormalized)
          .filter((path) => countPathSegments(path) === prefixDepth + 2);

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
          const partitionName = fullPath.slice(reportsPrefix.length).replace(/^\/+/, '');
          const statusPath = `${fullPath}/status.json`;
          const record = await readJsonFromFilestore(statusPath);
          if (!record) {
            continue;
          }
          const payload = record.payload as ReportStatusFile;
          const generatedAt =
            typeof payload.generatedAt === 'string' ? payload.generatedAt : new Date().toISOString();
          const htmlPath = `${fullPath}/status.html`;
          const markdownPath = `${fullPath}/status.md`;
          const metrics = coerceMetrics(payload, partitionName);

          entries.push({
            partitionName,
            partitionKey:
              typeof metrics?.partitionKey === 'string'
                ? (metrics.partitionKey as string)
                : partitionName,
            generatedAt,
            updatedAt: generatedAt,
            reportPaths: {
              html: toReportUrl(htmlPath),
              markdown: toReportUrl(markdownPath),
              json: toReportUrl(statusPath)
            },
            summary: (payload.summary as Record<string, unknown>) ?? undefined,
            metrics,
            artifacts: payload.reportFiles ?? []
          });
        }

        return entries
          .sort((left, right) => {
            const leftTime = Date.parse(left.generatedAt);
            const rightTime = Date.parse(right.generatedAt);
            if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
              return rightTime - leftTime;
            }
            return right.partitionName.localeCompare(left.partitionName);
          })
          .slice(0, limit);
      } catch (error) {
        context.logger.error('Failed to list report partitions from Filestore', { error });
        return [];
      }
    }

    async function readOverviewStatus() {
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

    fastify.get('/healthz', async () => ({
      status: 'ok',
      reportsPrefix,
      overviewPrefix
    }));

    fastify.get('/api/status', async (_, reply) => {
      const [overview, reports] = await Promise.all([readOverviewStatus(), listReportPartitions(12)]);

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
      const filestorePath = normalizePath(
        targetPathParam && targetPathParam.trim().length > 0
          ? targetPathParam
          : `${reportsPrefix}/${suffix}`
      );

      try {
        const node = await filestoreCapability.getNodeByPath({
          backendMountId,
          path: filestorePath,
          principal: filestorePrincipal
        });
        const download = await filestoreCapability.downloadFile({
          nodeId: node.id,
          principal: filestorePrincipal
        });
        reply.header('Cache-Control', 'no-store');
        reply.header('Content-Type', download.contentType ?? guessContentType(filestorePath));
        if (download.totalSize ?? download.contentLength) {
          reply.header('Content-Length', download.totalSize ?? download.contentLength ?? undefined);
        }
        return reply.send(download.stream);
      } catch (error) {
        if (error instanceof Error && 'status' in error && (error as { status?: number }).status === 404) {
          reply.status(404);
          return { error: 'not_found', path: filestorePath };
        }
        context.logger.error('Failed to proxy report asset from Filestore', { error, path: filestorePath });
        reply.status(500);
        return { error: 'internal_error' };
      }
    });

    fastify.get('/', async (_, reply) => {
      reply.header('Cache-Control', 'no-store');
      const configPayload = { refreshIntervalMs } as const;
      const html = buildDashboardHtml(reportsPrefix, configPayload);
      reply.header('Content-Type', 'text/html; charset=utf-8');
      return reply.send(html);
    });

    const lifecycle: ServiceLifecycle = {
      async start() {
        const host = process.env.HOST ?? '0.0.0.0';
        const port = Number(process.env.PORT ?? '4311');
        await fastify.listen({ host, port });
        context.logger.info('Observatory dashboard service listening', { host, port });
      },
      async stop() {
        await fastify.close();
      }
    };

    return lifecycle;
  }
});

function buildDashboardHtml(reportsPrefix: string, config: { refreshIntervalMs: number }): string {
  return `<!DOCTYPE html>
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
      const CONFIG = ${JSON.stringify(config)};
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
          { label: 'Instrument count', value: metrics.instrumentCount ?? '—' },
          { label: 'Site count', value: metrics.siteCount ?? '—' },
          { label: 'Alerts', value: metrics.alertCount ?? 0 }
        ];
        statusGrid.innerHTML = cards
          .map((card) =>
            '<div class="status-card"><h3>' + card.label + '</h3><p>' + card.value + '</p></div>'
          )
          .join('');
        summaryEl.textContent = summary?.text ?? 'Latest observatory report.';
      }

      async function refresh() {
        try {
          const response = await fetch('/api/status', { cache: 'no-store' });
          if (!response.ok) {
            throw new Error('Status fetch failed');
          }
          const data = await response.json();
          if (data.state === 'empty') {
            renderEmpty();
            overviewPlaceholder.classList.remove('hidden');
            overviewFrame.classList.add('hidden');
            recentList.innerHTML = '';
            return;
          }

          subtitleEl.textContent = 'Latest partition: ' + (data.partitionKey ?? 'unknown');
          renderSummary(data.metrics, data.summary);

          if (data.reportPaths?.html) {
            reportFrame.src = data.reportPaths.html;
          }

          if (data.overview?.state === 'ready') {
            overviewMeta.textContent =
              'Window: ' +
              (data.overview.window?.start ?? 'n/a') +
              ' → ' +
              (data.overview.window?.end ?? 'n/a');
            overviewFrame.src = data.overview.dashboardPath;
            overviewFrame.classList.remove('hidden');
            overviewPlaceholder.classList.add('hidden');
          } else {
            overviewFrame.classList.add('hidden');
            overviewPlaceholder.classList.remove('hidden');
          }

          if (Array.isArray(data.recentReports)) {
            recentList.innerHTML = data.recentReports
              .map((entry) => {
                const generatedAt = entry.generatedAt ?? '';
                const reportLink = entry.reportPaths?.html ?? '#';
                return (
                  '<li><strong>' +
                  (entry.partitionKey ?? 'unknown') +
                  '</strong><span style="color:#7c92af;font-size:0.8rem">' +
                  generatedAt +
                  '</span><a href="' +
                  reportLink +
                  '" target="_blank" rel="noopener">Open report</a></li>'
                );
              })
              .join('');
          }
        } catch (error) {
          console.error('Failed to refresh dashboard status', error);
          renderEmpty();
        }
      }

      refresh();
      setInterval(refresh, CONFIG.refreshIntervalMs);
    </script>
  </body>
</html>`;
}

import { FilestoreClient } from '@apphub/filestore-client';
import {
  ensureFilestoreHierarchy,
  ensureResolvedBackendId,
  uploadTextFile,
  DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY
} from '../../shared/filestore';
import { enforceScratchOnlyWrites } from '../../shared/scratchGuard';

enforceScratchOnlyWrites();

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

type VisualizationArtifact = {
  path: string;
  nodeId: number | null;
  mediaType: string;
  description?: string;
  sizeBytes?: number | null;
  checksum?: string | null;
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
  instrumentId?: string;
};

type VisualizationAsset = {
  generatedAt: string;
  partitionKey: string;
  storagePrefix: string;
  lookbackMinutes: number;
  artifacts: VisualizationArtifact[];
  metrics: VisualizationMetrics;
};

type ReportPublisherParameters = {
  reportsPrefix: string;
  partitionKey: string;
  instrumentId?: string;
  reportTemplate?: string;
  visualizationAsset: VisualizationAsset;
  filestoreBaseUrl: string;
  filestoreBackendId: number | null;
  filestoreBackendKey: string;
  filestoreToken?: string;
  filestorePrincipal?: string;
  metastoreBaseUrl?: string;
  metastoreAuthToken?: string;
  metastoreNamespace?: string;
};

type ReportFile = {
  path: string;
  nodeId: number | null;
  mediaType: string;
  sizeBytes: number | null;
  checksum?: string | null;
};

type ReportAssetPayload = {
  generatedAt: string;
  storagePrefix: string;
  reportFiles: ReportFile[];
  summary: {
    instrumentCount: number;
    siteCount: number;
    alertCount: number;
  };
  plotsReferenced: Array<{ path: string; altText: string }>;
  instrumentId?: string;
};

const DEFAULT_METASTORE_NAMESPACE = 'observatory.reports';
const DEFAULT_METASTORE_BASE_URL = '';

function sanitizeRecordKey(key: string): string {
  return key ? key.replace(/[^a-zA-Z0-9._-]/g, '-') : '';
}

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

function parseVisualizationAsset(raw: unknown): VisualizationAsset {
  if (!isRecord(raw)) {
    throw new Error('visualizationAsset parameter must be an object');
  }
  const generatedAt = ensureString(raw.generatedAt ?? raw.generated_at);
  const partitionKey = ensureString(raw.partitionKey ?? raw.partition_key);
  const storagePrefix = ensureString(raw.storagePrefix ?? raw.storage_prefix ?? raw.plotsDir ?? raw.plots_dir ?? '');
  const lookbackMinutesRaw = raw.lookbackMinutes ?? raw.lookback_minutes ?? raw.lookbackHours ?? raw.lookback_hours;
  const lookbackMinutes =
    typeof lookbackMinutesRaw === 'number' ? lookbackMinutesRaw : Number(lookbackMinutesRaw ?? 0) || 0;

  const artifactsRaw = Array.isArray(raw.artifacts) ? (raw.artifacts as unknown[]) : [];
  const artifacts: VisualizationArtifact[] = [];
  for (const entry of artifactsRaw) {
    if (!isRecord(entry)) {
      continue;
    }
    const pathValue = ensureString(entry.path ?? entry.filestorePath ?? entry.relativePath ?? entry.relative_path ?? '');
    if (!pathValue) {
      continue;
    }
    const nodeIdValue =
      typeof entry.nodeId === 'number' && Number.isFinite(entry.nodeId)
        ? entry.nodeId
        : typeof entry.node_id === 'number' && Number.isFinite(entry.node_id)
          ? entry.node_id
          : null;
    const sizeValue =
      typeof entry.sizeBytes === 'number' && Number.isFinite(entry.sizeBytes)
        ? entry.sizeBytes
        : typeof entry.size_bytes === 'number' && Number.isFinite(entry.size_bytes)
          ? entry.size_bytes
          : null;
    const mediaType = ensureString(entry.mediaType ?? entry.media_type ?? 'application/octet-stream') || 'application/octet-stream';
    artifacts.push({
      path: pathValue,
      nodeId: nodeIdValue,
      mediaType,
      description: ensureString(entry.description ?? '' ) || undefined,
      sizeBytes: sizeValue,
      checksum: ensureString(entry.checksum ?? '') || undefined
    });
  }

  const metricsRaw = isRecord(raw.metrics) ? raw.metrics : {};
  const metrics: VisualizationMetrics = {
    samples: Number(metricsRaw.samples ?? 0) || 0,
    instrumentCount: Number(metricsRaw.instrumentCount ?? metricsRaw.instrument_count ?? 0) || 0,
    siteCount: Number(metricsRaw.siteCount ?? metricsRaw.site_count ?? 0) || 0,
    averageTemperatureC: Number(metricsRaw.averageTemperatureC ?? metricsRaw.average_temperature_c ?? 0) || 0,
    averagePm25: Number(metricsRaw.averagePm25 ?? metricsRaw.average_pm25 ?? 0) || 0,
    maxPm25: Number(metricsRaw.maxPm25 ?? metricsRaw.max_pm25 ?? 0) || 0,
    partitionKey: ensureString(metricsRaw.partitionKey ?? metricsRaw.partition_key ?? partitionKey),
    lookbackMinutes:
      Number(metricsRaw.lookbackMinutes ?? metricsRaw.lookback_minutes ?? lookbackMinutes) || 0,
    siteFilter: ensureString(metricsRaw.siteFilter ?? metricsRaw.site_filter ?? '') || undefined,
    instrumentId: ensureString(metricsRaw.instrumentId ?? metricsRaw.instrument_id ?? '') || undefined
  } satisfies VisualizationMetrics;

  if (!generatedAt || !partitionKey || !storagePrefix) {
    throw new Error('visualizationAsset must include generatedAt, partitionKey, and storagePrefix');
  }

  return {
    generatedAt,
    partitionKey,
    storagePrefix: storagePrefix.replace(/\/+$/g, ''),
    lookbackMinutes,
    artifacts,
    metrics
  } satisfies VisualizationAsset;
}

function parseParameters(raw: unknown): ReportPublisherParameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }
  const partitionKey = ensureString(raw.partitionKey ?? raw.partition_key);
  const instrumentId = ensureString(raw.instrumentId ?? raw.instrument_id ?? '');
  if (!partitionKey) {
    throw new Error('partitionKey parameter is required');
  }
  const reportTemplate = ensureString(raw.reportTemplate ?? raw.report_template ?? '');
  const visualizationAsset = parseVisualizationAsset(raw.visualizationAsset ?? raw.visualization_asset);
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
  const metastoreBaseUrlRaw = ensureString(raw.metastoreBaseUrl ?? raw.metastore_base_url ?? DEFAULT_METASTORE_BASE_URL);
  const metastoreBaseUrl = metastoreBaseUrlRaw ? metastoreBaseUrlRaw.replace(/\/$/, '') : '';
  const metastoreAuthToken = ensureString(raw.metastoreAuthToken ?? raw.metastore_auth_token ?? '');
  const metastoreNamespace = ensureString(raw.metastoreNamespace ?? raw.metastore_namespace ?? DEFAULT_METASTORE_NAMESPACE);

  return {
    reportsPrefix: reportsPrefix.replace(/\/+$/g, ''),
    partitionKey,
    instrumentId: instrumentId || undefined,
    reportTemplate: reportTemplate || undefined,
    visualizationAsset,
    filestoreBaseUrl,
    filestoreBackendId,
    filestoreBackendKey,
    filestoreToken: filestoreToken || undefined,
    filestorePrincipal: filestorePrincipal || undefined,
    metastoreBaseUrl: metastoreBaseUrl || undefined,
    metastoreAuthToken: metastoreAuthToken || undefined,
    metastoreNamespace: metastoreNamespace || DEFAULT_METASTORE_NAMESPACE
  } satisfies ReportPublisherParameters;
}

function buildMarkdown(metrics: VisualizationMetrics, artifacts: VisualizationArtifact[]): string {
  const chartList = artifacts
    .filter((artifact) => artifact.mediaType?.startsWith('image/'))
    .map((artifact) => `- ![${artifact.description ?? artifact.path}](${artifact.path})`)
    .join('\n');

  const instrumentLine = metrics.instrumentId ? `- Instrument source: **${metrics.instrumentId}**\n` : '';

  return `# Observatory Status Report (${metrics.partitionKey})

- Samples analysed: **${metrics.samples}**
- Instruments reporting: **${metrics.instrumentCount}**
- Sites covered: **${metrics.siteCount}**
- Average temperature: **${metrics.averageTemperatureC.toFixed(2)} °C**
- Average PM2.5: **${metrics.averagePm25.toFixed(2)} µg/m³**
- Peak PM2.5: **${metrics.maxPm25.toFixed(2)} µg/m³**
${instrumentLine}

${chartList || '_No charts generated for this window._'}
`;
}

function buildHtml(template: string | undefined, markdownContent: string, metrics: VisualizationMetrics): string {
  const defaultTemplate = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Observatory Status Report - ${metrics.partitionKey}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 2rem; background-color: #0c111b; color: #f5f7fa; }
      h1 { color: #5bd1ff; }
      img { max-width: 100%; margin: 1rem 0; border-radius: 4px; }
      a { color: #ff9f1c; }
      .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; }
      .summary div { background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; }
      .summary strong { display: block; font-size: 1.8rem; color: #ffffff; }
      pre { background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 6px; overflow: auto; }
    </style>
  </head>
  <body>
    <header>
      <h1>Observatory Status Report</h1>
      <p>Window ${metrics.partitionKey} · Lookback ${metrics.lookbackMinutes} minutes${metrics.siteFilter ? ` · Site ${metrics.siteFilter}` : ''}</p>
    </header>
    <main>
      <section class="summary">
        ${metrics.instrumentId ? `<div><span>Instrument</span><strong>${metrics.instrumentId}</strong></div>` : ''}
        <div>
          <span>Samples analysed</span>
          <strong>${metrics.samples}</strong>
        </div>
        <div>
          <span>Instruments reporting</span>
          <strong>${metrics.instrumentCount}</strong>
        </div>
        <div>
          <span>Sites covered</span>
          <strong>${metrics.siteCount}</strong>
        </div>
        <div>
          <span>Average temperature</span>
          <strong>${metrics.averageTemperatureC.toFixed(2)} °C</strong>
        </div>
        <div>
          <span>Average PM2.5</span>
          <strong>${metrics.averagePm25.toFixed(2)} µg/m³</strong>
        </div>
        <div>
          <span>Peak PM2.5</span>
          <strong>${metrics.maxPm25.toFixed(2)} µg/m³</strong>
        </div>
      </section>
      <section>
        ${markdownContent
          .split('\n')
          .map((line) => (line.startsWith('- ') ? `<p>${line.slice(2)}</p>` : `<p>${line}</p>`))
          .join('\n')}
      </section>
    </main>
  </body>
</html>`;

  if (!template) {
    return defaultTemplate;
  }

  return template
    .replace('{{partitionKey}}', metrics.partitionKey)
    .replace('{{lookbackMinutes}}', String(metrics.lookbackMinutes))
    .replace('{{siteFilter}}', metrics.siteFilter ?? '')
    .replace('{{markdown}}', markdownContent);
}

async function uploadReports(
  client: FilestoreClient,
  params: ReportPublisherParameters,
  generatedAt: string,
  markdown: string,
  html: string,
  summary: ReportAssetPayload['summary'],
  plotsReferenced: Array<{ path: string; altText: string }>
): Promise<{ storagePrefix: string; files: ReportFile[] }> {
  const instrumentSegment = params.instrumentId
    ? params.instrumentId.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '') || 'unknown'
    : 'all';
  const partitionSafe = params.partitionKey.replace(/:/g, '-');
  const storagePrefix = `${params.reportsPrefix}/${instrumentSegment}/${partitionSafe}`.replace(/\/+$/g, '');

  await ensureFilestoreHierarchy(
    client,
    {
      backendMountId: params.filestoreBackendId ?? undefined,
      backendMountKey: params.filestoreBackendKey
    },
    storagePrefix,
    params.filestorePrincipal
  );

  const markdownPath = `${storagePrefix}/status.md`;
  const htmlPath = `${storagePrefix}/status.html`;
  const jsonPath = `${storagePrefix}/status.json`;

  const [markdownNode, htmlNode] = await Promise.all([
    uploadTextFile({
      client,
      backendMountId: params.filestoreBackendId ?? undefined,
      backendMountKey: params.filestoreBackendKey,
      path: markdownPath,
      content: markdown,
      contentType: 'text/markdown; charset=utf-8',
      principal: params.filestorePrincipal,
      metadata: {
        partitionKey: params.partitionKey,
        instrumentId: params.instrumentId ?? null,
        variant: 'status-markdown'
      }
    }),
    uploadTextFile({
      client,
      backendMountId: params.filestoreBackendId ?? undefined,
      backendMountKey: params.filestoreBackendKey,
      path: htmlPath,
      content: html,
      contentType: 'text/html; charset=utf-8',
      principal: params.filestorePrincipal,
      metadata: {
        partitionKey: params.partitionKey,
        instrumentId: params.instrumentId ?? null,
        variant: 'status-html'
      }
    })
  ]);

  const files: ReportFile[] = [
    {
      path: markdownNode.path ?? markdownPath,
      nodeId: markdownNode.id ?? null,
      mediaType: 'text/markdown',
      sizeBytes: markdownNode.sizeBytes ?? null,
      checksum: markdownNode.checksum ?? null
    },
    {
      path: htmlNode.path ?? htmlPath,
      nodeId: htmlNode.id ?? null,
      mediaType: 'text/html',
      sizeBytes: htmlNode.sizeBytes ?? null,
      checksum: htmlNode.checksum ?? null
    }
  ];

  const summaryJson = {
    generatedAt,
    storagePrefix,
    partitionKey: params.partitionKey,
    instrumentId: params.instrumentId ?? params.visualizationAsset.metrics.instrumentId ?? null,
    lookbackMinutes: params.visualizationAsset.lookbackMinutes,
    siteFilter: params.visualizationAsset.metrics.siteFilter ?? null,
    summary,
    plotsReferenced,
    visualization: {
      storagePrefix: params.visualizationAsset.storagePrefix,
      artifacts: params.visualizationAsset.artifacts
    },
    reports: files
  } satisfies Record<string, unknown>;

  const jsonNode = await uploadTextFile({
    client,
    backendMountId: params.filestoreBackendId ?? undefined,
    backendMountKey: params.filestoreBackendKey,
    path: jsonPath,
    content: JSON.stringify(summaryJson, null, 2),
    contentType: 'application/json',
    principal: params.filestorePrincipal,
    metadata: {
      partitionKey: params.partitionKey,
      instrumentId: params.instrumentId ?? null,
      variant: 'status-json'
    }
  });

  files.push({
    path: jsonNode.path ?? jsonPath,
    nodeId: jsonNode.id ?? null,
    mediaType: 'application/json',
    sizeBytes: jsonNode.sizeBytes ?? null,
    checksum: jsonNode.checksum ?? null
  });

  return { storagePrefix, files };
}

function buildSummary(metrics: VisualizationMetrics): ReportAssetPayload['summary'] {
  return {
    instrumentCount: metrics.instrumentCount,
    siteCount: metrics.siteCount,
    alertCount: metrics.maxPm25 > 35 ? 1 : 0
  } satisfies ReportAssetPayload['summary'];
}

function buildPlotsReferenced(artifacts: VisualizationArtifact[]): Array<{ path: string; altText: string }> {
  return artifacts
    .filter((artifact) => artifact.mediaType?.startsWith('image/'))
    .map((artifact) => ({
      path: artifact.path,
      altText: artifact.description ?? artifact.path
    }));
}

async function upsertMetastoreRecord(
  params: ReportPublisherParameters,
  payload: ReportAssetPayload
): Promise<void> {
  if (!params.metastoreBaseUrl) {
    return;
  }

  const namespace = params.metastoreNamespace ?? DEFAULT_METASTORE_NAMESPACE;
  const baseUrl = params.metastoreBaseUrl.replace(/\/$/, '');
  const rawPartitionIdentifier = params.instrumentId
    ? `${params.instrumentId}::${params.partitionKey}`
    : params.partitionKey;
  const recordKey = sanitizeRecordKey(rawPartitionIdentifier);
  const url = `${baseUrl}/records/${encodeURIComponent(namespace)}/${encodeURIComponent(recordKey)}`;
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };
  if (params.metastoreAuthToken) {
    headers.authorization = `Bearer ${params.metastoreAuthToken}`;
  }

  const metadata = {
    partitionKey: params.partitionKey,
    instrumentId: params.instrumentId ?? params.visualizationAsset.metrics.instrumentId ?? null,
    recordKey,
    generatedAt: payload.generatedAt,
    summary: payload.summary,
    reportFiles: payload.reportFiles,
    plotsReferenced: payload.plotsReferenced,
    storagePrefix: payload.storagePrefix,
    visualizationPartition: params.visualizationAsset.partitionKey,
    visualizationMetrics: params.visualizationAsset.metrics,
    lookbackMinutes: params.visualizationAsset.lookbackMinutes,
    siteFilter: params.visualizationAsset.metrics.siteFilter ?? null
  } satisfies Record<string, unknown>;

  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ metadata })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to upsert metastore record (${namespace}/${recordKey}): ${errorText}`);
  }
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  const parameters = parseParameters(context.parameters);
  const filestoreClient = new FilestoreClient({
    baseUrl: parameters.filestoreBaseUrl,
    token: parameters.filestoreToken,
    userAgent: 'observatory-report-publisher/0.2.0'
  });
  const backendMountId = await ensureResolvedBackendId(filestoreClient, parameters);
  const markdown = buildMarkdown(parameters.visualizationAsset.metrics, parameters.visualizationAsset.artifacts);
  const html = buildHtml(parameters.reportTemplate, markdown, parameters.visualizationAsset.metrics);

  const summary = buildSummary(parameters.visualizationAsset.metrics);
  const plotsReferenced = buildPlotsReferenced(parameters.visualizationAsset.artifacts);
  const generatedAt = new Date().toISOString();
  const { storagePrefix, files: reportFiles } = await uploadReports(
    filestoreClient,
    parameters,
    generatedAt,
    markdown,
    html,
    summary,
    plotsReferenced
  );

  const assetPartitionKey = parameters.instrumentId
    ? `${parameters.instrumentId}::${parameters.partitionKey}`
    : parameters.partitionKey;
  const payload: ReportAssetPayload = {
    generatedAt,
    storagePrefix,
    reportFiles,
    summary,
    plotsReferenced,
    instrumentId: parameters.instrumentId || undefined
  } satisfies ReportAssetPayload;

  await context.update({
    reportFiles: reportFiles.length,
    instruments: summary.instrumentCount,
    instrumentId: parameters.instrumentId || null,
    storagePrefix
  });

  await upsertMetastoreRecord(parameters, payload);

  return {
    status: 'succeeded',
      result: {
      partitionKey: assetPartitionKey,
      report: payload,
      assets: [
        {
          assetId: 'observatory.reports.status',
          partitionKey: assetPartitionKey,
          producedAt: generatedAt,
          payload
        }
      ]
    }
  } satisfies JobRunResult;
}

export default handler;

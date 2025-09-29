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

type VisualizationArtifact = {
  relativePath: string;
  mediaType?: string;
  description?: string;
  sizeBytes?: number;
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
  plotsDir: string;
  lookbackMinutes: number;
  artifacts: VisualizationArtifact[];
  metrics: VisualizationMetrics;
};

type ReportPublisherParameters = {
  reportsDir: string;
  plotsDir: string;
  partitionKey: string;
  instrumentId?: string;
  reportTemplate?: string;
  visualizationAsset: VisualizationAsset;
  metastoreBaseUrl?: string;
  metastoreAuthToken?: string;
  metastoreNamespace?: string;
};

type ReportFile = {
  relativePath: string;
  mediaType: string;
  sizeBytes: number;
};

type ReportAssetPayload = {
  generatedAt: string;
  reportsDir: string;
  reportFiles: ReportFile[];
  summary: {
    instrumentCount: number;
    siteCount: number;
    alertCount: number;
  };
  plotsReferenced: Array<{ relativePath: string; altText: string }>;
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
  const plotsDir = ensureString(raw.plotsDir ?? raw.plots_dir ?? raw.outputDir);
  const lookbackMinutesRaw = raw.lookbackMinutes ?? raw.lookback_minutes ?? raw.lookbackHours ?? raw.lookback_hours;
  const lookbackMinutes =
    typeof lookbackMinutesRaw === 'number' ? lookbackMinutesRaw : Number(lookbackMinutesRaw ?? 0) || 0;

  const artifactsRaw = Array.isArray(raw.artifacts) ? (raw.artifacts as unknown[]) : [];
  const artifacts: VisualizationArtifact[] = [];
  for (const entry of artifactsRaw) {
    if (!isRecord(entry)) {
      continue;
    }
    const relativePath = ensureString(entry.relativePath ?? entry.relative_path ?? entry.path);
    if (!relativePath) {
      continue;
    }
    artifacts.push({
      relativePath,
      mediaType: ensureString(entry.mediaType ?? entry.media_type ?? 'application/octet-stream'),
      description: ensureString(entry.description ?? ''),
      sizeBytes: typeof entry.sizeBytes === 'number' ? entry.sizeBytes : undefined
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

  if (!generatedAt || !partitionKey || !plotsDir) {
    throw new Error('visualizationAsset must include generatedAt, partitionKey, and plotsDir');
  }

  return {
    generatedAt,
    partitionKey,
    plotsDir,
    lookbackMinutes,
    artifacts,
    metrics
  } satisfies VisualizationAsset;
}

function parseParameters(raw: unknown): ReportPublisherParameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }
  const reportsDir = ensureString(raw.reportsDir ?? raw.reports_dir ?? raw.outputDir);
  const plotsDir = ensureString(raw.plotsDir ?? raw.plots_dir ?? raw.visualizationsDir);
  const partitionKey = ensureString(raw.partitionKey ?? raw.partition_key);
  const instrumentId = ensureString(raw.instrumentId ?? raw.instrument_id ?? '');
  if (!reportsDir || !plotsDir || !partitionKey) {
    throw new Error('reportsDir, plotsDir, and partitionKey parameters are required');
  }
  const reportTemplate = ensureString(raw.reportTemplate ?? raw.report_template ?? '');
  const visualizationAsset = parseVisualizationAsset(raw.visualizationAsset ?? raw.visualization_asset);
  const metastoreBaseUrlRaw = ensureString(raw.metastoreBaseUrl ?? raw.metastore_base_url ?? DEFAULT_METASTORE_BASE_URL);
  const metastoreBaseUrl = metastoreBaseUrlRaw ? metastoreBaseUrlRaw.replace(/\/$/, '') : '';
  const metastoreAuthToken = ensureString(raw.metastoreAuthToken ?? raw.metastore_auth_token ?? '');
  const metastoreNamespace = ensureString(raw.metastoreNamespace ?? raw.metastore_namespace ?? DEFAULT_METASTORE_NAMESPACE);

  return {
    reportsDir,
    plotsDir,
    partitionKey,
    instrumentId: instrumentId || undefined,
    reportTemplate: reportTemplate || undefined,
    visualizationAsset,
    metastoreBaseUrl: metastoreBaseUrl || undefined,
    metastoreAuthToken: metastoreAuthToken || undefined,
    metastoreNamespace: metastoreNamespace || DEFAULT_METASTORE_NAMESPACE
  } satisfies ReportPublisherParameters;
}

async function writeTextFile(filePath: string, content: string): Promise<number> {
  await writeFile(filePath, content, 'utf8');
  const stats = await stat(filePath);
  return stats.size;
}

function buildMarkdown(metrics: VisualizationMetrics, artifacts: VisualizationArtifact[]): string {
  const chartList = artifacts
    .filter((artifact) => artifact.mediaType?.startsWith('image/'))
    .map((artifact) => `- ![${artifact.description ?? artifact.relativePath}](${artifact.relativePath})`)
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

async function writeReports(
  params: ReportPublisherParameters,
  markdown: string,
  html: string,
  summary: ReportAssetPayload['summary']
): Promise<ReportFile[]> {
  const instrumentSegment = params.instrumentId
    ? params.instrumentId.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '') || 'unknown'
    : 'all';
  const partitionDir = path.resolve(
    params.reportsDir,
    `${instrumentSegment}_${params.partitionKey.replace(':', '-')}`
  );
  await mkdir(partitionDir, { recursive: true });

  const markdownPath = path.resolve(partitionDir, 'status.md');
  const htmlPath = path.resolve(partitionDir, 'status.html');
  const jsonPath = path.resolve(partitionDir, 'status.json');

  const markdownSize = await writeTextFile(markdownPath, markdown);
  const htmlSize = await writeTextFile(htmlPath, html);

  const reportFiles: ReportFile[] = [
    {
      relativePath: path.relative(params.reportsDir, markdownPath),
      mediaType: 'text/markdown',
      sizeBytes: markdownSize
    },
    {
      relativePath: path.relative(params.reportsDir, htmlPath),
      mediaType: 'text/html',
      sizeBytes: htmlSize
    }
  ];

  const summaryJson = {
    generatedAt: new Date().toISOString(),
    partitionKey: params.partitionKey,
    lookbackMinutes: params.visualizationAsset.lookbackMinutes,
    siteFilter: params.visualizationAsset.metrics.siteFilter ?? null,
    summary,
    visualization: {
      metrics: params.visualizationAsset.metrics,
      artifacts: params.visualizationAsset.artifacts
    },
    reports: reportFiles
  } satisfies Record<string, unknown>;

  const jsonBytes = await writeTextFile(jsonPath, JSON.stringify(summaryJson, null, 2));
  reportFiles.push({
    relativePath: path.relative(params.reportsDir, jsonPath),
    mediaType: 'application/json',
    sizeBytes: jsonBytes
  });

  return reportFiles;
}

function buildSummary(metrics: VisualizationMetrics): ReportAssetPayload['summary'] {
  return {
    instrumentCount: metrics.instrumentCount,
    siteCount: metrics.siteCount,
    alertCount: metrics.maxPm25 > 35 ? 1 : 0
  } satisfies ReportAssetPayload['summary'];
}

function buildPlotsReferenced(artifacts: VisualizationArtifact[]): Array<{ relativePath: string; altText: string }> {
  return artifacts
    .filter((artifact) => artifact.mediaType?.startsWith('image/'))
    .map((artifact) => ({
      relativePath: artifact.relativePath,
      altText: artifact.description ?? artifact.relativePath
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
    reportsDir: payload.reportsDir,
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
  const markdown = buildMarkdown(parameters.visualizationAsset.metrics, parameters.visualizationAsset.artifacts);
  const html = buildHtml(parameters.reportTemplate, markdown, parameters.visualizationAsset.metrics);

  const summary = buildSummary(parameters.visualizationAsset.metrics);
  const reportFiles = await writeReports(parameters, markdown, html, summary);
  const plotsReferenced = buildPlotsReferenced(parameters.visualizationAsset.artifacts);

  const generatedAt = new Date().toISOString();
  const assetPartitionKey = parameters.instrumentId
    ? `${parameters.instrumentId}::${parameters.partitionKey}`
    : parameters.partitionKey;
  const payload: ReportAssetPayload = {
    generatedAt,
    reportsDir: parameters.reportsDir,
    reportFiles,
    summary,
    plotsReferenced,
    instrumentId: parameters.instrumentId || undefined
  } satisfies ReportAssetPayload;

  await context.update({
    reportFiles: reportFiles.length,
    instruments: summary.instrumentCount,
    instrumentId: parameters.instrumentId || null
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

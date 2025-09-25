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
  reportTemplate?: string;
  visualizationAsset: VisualizationAsset;
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
    siteFilter: ensureString(metricsRaw.siteFilter ?? metricsRaw.site_filter ?? '') || undefined
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
  if (!reportsDir || !plotsDir || !partitionKey) {
    throw new Error('reportsDir, plotsDir, and partitionKey parameters are required');
  }
  const reportTemplate = ensureString(raw.reportTemplate ?? raw.report_template ?? '');
  const visualizationAsset = parseVisualizationAsset(raw.visualizationAsset ?? raw.visualization_asset);
  return {
    reportsDir,
    plotsDir,
    partitionKey,
    reportTemplate: reportTemplate || undefined,
    visualizationAsset
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

  return `# Observatory Status Report (${metrics.partitionKey})

- Samples analysed: **${metrics.samples}**
- Instruments reporting: **${metrics.instrumentCount}**
- Sites covered: **${metrics.siteCount}**
- Average temperature: **${metrics.averageTemperatureC.toFixed(2)} °C**
- Average PM2.5: **${metrics.averagePm25.toFixed(2)} µg/m³**
- Peak PM2.5: **${metrics.maxPm25.toFixed(2)} µg/m³**

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
      .summary div { background: #111a2c; padding: 1rem; border-radius: 6px; }
    </style>
  </head>
  <body>
    <h1>Observatory Status Report &mdash; ${metrics.partitionKey}</h1>
    <section class="summary">
      <div><strong>Samples</strong><br />${metrics.samples}</div>
      <div><strong>Instruments</strong><br />${metrics.instrumentCount}</div>
      <div><strong>Sites</strong><br />${metrics.siteCount}</div>
      <div><strong>Average Temp</strong><br />${metrics.averageTemperatureC.toFixed(2)} °C</div>
      <div><strong>Average PM2.5</strong><br />${metrics.averagePm25.toFixed(2)} µg/m³</div>
      <div><strong>Peak PM2.5</strong><br />${metrics.maxPm25.toFixed(2)} µg/m³</div>
    </section>
    <section>
      <pre>${markdownContent.replace(/</g, '&lt;')}</pre>
    </section>
  </body>
</html>`;

  const trimmedTemplate = template?.trim();
  if (!trimmedTemplate) {
    return defaultTemplate;
  }
  return trimmedTemplate
    .replace(/{{\s*content\s*}}/gi, markdownContent)
    .replace(/{{\s*partitionKey\s*}}/gi, metrics.partitionKey)
    .replace(/{{\s*samples\s*}}/gi, String(metrics.samples))
    .replace(/{{\s*instrumentCount\s*}}/gi, String(metrics.instrumentCount))
    .replace(/{{\s*siteCount\s*}}/gi, String(metrics.siteCount))
    .replace(/{{\s*averageTemperatureC\s*}}/gi, metrics.averageTemperatureC.toFixed(2))
    .replace(/{{\s*averagePm25\s*}}/gi, metrics.averagePm25.toFixed(2))
    .replace(/{{\s*maxPm25\s*}}/gi, metrics.maxPm25.toFixed(2));
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  const parameters = parseParameters(context.parameters);
  const reportsPartitionKey = parameters.partitionKey.replace(':', '-');
  const reportsPartitionDir = path.resolve(parameters.reportsDir, reportsPartitionKey);
  await mkdir(reportsPartitionDir, { recursive: true });

  const markdown = buildMarkdown(parameters.visualizationAsset.metrics, parameters.visualizationAsset.artifacts);
  const markdownPath = path.resolve(reportsPartitionDir, 'status.md');
  const markdownSize = await writeTextFile(markdownPath, markdown);

  const html = buildHtml(parameters.reportTemplate, markdown, parameters.visualizationAsset.metrics);
  const htmlPath = path.resolve(reportsPartitionDir, 'status.html');
  const htmlSize = await writeTextFile(htmlPath, html);

  const summary = {
    instrumentCount: parameters.visualizationAsset.metrics.instrumentCount,
    siteCount: parameters.visualizationAsset.metrics.siteCount,
    alertCount: parameters.visualizationAsset.metrics.maxPm25 > 35 ? 1 : 0
  };

  const jsonPayload = {
    generatedAt: new Date().toISOString(),
    metrics: parameters.visualizationAsset.metrics,
    artifacts: parameters.visualizationAsset.artifacts,
    summary
  };
  const jsonPath = path.resolve(reportsPartitionDir, 'status.json');
  const jsonSize = await writeTextFile(jsonPath, JSON.stringify(jsonPayload, null, 2));

  const reportFiles: ReportFile[] = [
    { relativePath: path.relative(reportsPartitionDir, markdownPath), mediaType: 'text/markdown', sizeBytes: markdownSize },
    { relativePath: path.relative(reportsPartitionDir, htmlPath), mediaType: 'text/html', sizeBytes: htmlSize },
    { relativePath: path.relative(reportsPartitionDir, jsonPath), mediaType: 'application/json', sizeBytes: jsonSize }
  ];

  const plotsReferenced = parameters.visualizationAsset.artifacts
    .filter((artifact) => artifact.mediaType?.startsWith('image/'))
    .map((artifact) => ({
      relativePath: artifact.relativePath,
      altText: artifact.description || artifact.relativePath
    }));

  const payload: ReportAssetPayload = {
    generatedAt: jsonPayload.generatedAt,
    reportsDir: reportsPartitionDir,
    reportFiles,
    summary,
    plotsReferenced
  } satisfies ReportAssetPayload;

  await context.update({
    alertCount: summary.alertCount,
    instruments: parameters.visualizationAsset.metrics.instrumentCount
  });

  return {
    status: 'succeeded',
    result: {
      partitionKey: parameters.partitionKey,
      report: payload,
      assets: [
        {
          assetId: 'observatory.reports.status',
          partitionKey: parameters.partitionKey,
          producedAt: jsonPayload.generatedAt,
          payload
        }
      ]
    }
  } satisfies JobRunResult;
}

export default handler;

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
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

type PartitionSummary = {
  partitionKey: string;
  totals: {
    units: number;
    revenue: number;
    averageOrderValue: number;
  };
  byCategory: Array<{ category: string; units: number; revenue: number }>;
  byRegion: Array<{ region: string; revenue: number }>;
  channels: Array<{ channel: string; revenue: number }>;
  parquetFile: string;
  summaryFile: string;
};

type Parameters = {
  warehouseDir: string;
  outputDir: string;
  reportTitle: string;
  lookback?: number;
};

type AggregateMetrics = {
  partitions: number;
  totalRevenue: number;
  totalUnits: number;
  averageOrderValue: number;
  topCategories: Array<{ category: string; revenue: number; share: number }>;
  topRegions: Array<{ region: string; revenue: number; share: number }>;
  revenueSeries: Array<{ partitionKey: string; revenue: number }>;
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

function ensureNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function parseParameters(raw: unknown): Parameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }
  const warehouseDir = ensureString(raw.warehouseDir ?? raw.inputDir);
  if (!warehouseDir) {
    throw new Error('warehouseDir parameter is required');
  }
  const outputDir = ensureString(raw.outputDir ?? raw.publishDir ?? raw.destinationDir);
  if (!outputDir) {
    throw new Error('outputDir parameter is required');
  }
  const reportTitle = ensureString(raw.reportTitle ?? 'Retail Sales Report');
  let lookback: number | undefined;
  if (typeof raw.lookback === 'number' && Number.isFinite(raw.lookback)) {
    lookback = Math.max(1, Math.min(90, Math.floor(raw.lookback)));
  }
  return { warehouseDir, outputDir, reportTitle, lookback } satisfies Parameters;
}

function parsePartitionSummary(raw: unknown): PartitionSummary | null {
  if (!isRecord(raw)) {
    return null;
  }
  const partitionKey = ensureString(raw.partitionKey ?? raw.partition_key);
  if (!partitionKey) {
    return null;
  }
  const totalsRaw = isRecord(raw.totals) ? raw.totals : {};
  const totals = {
    units: ensureNumber(totalsRaw.units),
    revenue: ensureNumber(totalsRaw.revenue),
    averageOrderValue: ensureNumber(totalsRaw.averageOrderValue ?? totalsRaw.avgOrderValue)
  };
  const readGroup = <T extends { [key: string]: unknown }>(
    value: unknown,
    getKey: (entry: Record<string, unknown>) => string,
    shape: (entry: Record<string, unknown>) => T
  ): T[] => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((entry) => (isRecord(entry) ? entry : null))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => shape(entry));
  };

  const byCategory = readGroup(raw.byCategory, (entry) => ensureString(entry.category), (entry) => ({
    category: ensureString(entry.category),
    units: ensureNumber(entry.units),
    revenue: ensureNumber(entry.revenue)
  }));
  const byRegion = readGroup(raw.byRegion, (entry) => ensureString(entry.region), (entry) => ({
    region: ensureString(entry.region),
    revenue: ensureNumber(entry.revenue)
  }));
  const channels = readGroup(raw.channels, (entry) => ensureString(entry.channel), (entry) => ({
    channel: ensureString(entry.channel),
    revenue: ensureNumber(entry.revenue)
  }));

  return {
    partitionKey,
    totals,
    byCategory,
    byRegion,
    channels,
    parquetFile: ensureString(raw.parquetFile ?? raw.parquet_path ?? raw.parquet),
    summaryFile: ensureString(raw.summaryFile ?? raw.summary_path ?? raw.summary)
  } satisfies PartitionSummary;
}

async function loadPartitionSummaries(directory: string, lookback?: number): Promise<PartitionSummary[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const summaries: PartitionSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.summary.json')) {
      continue;
    }
    const filePath = path.resolve(directory, entry.name);
    try {
      const content = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(content);
      const summary = parsePartitionSummary(parsed);
      if (summary) {
        summaries.push(summary);
      }
    } catch {
      // Skip invalid files but continue processing others
      continue;
    }
  }
  summaries.sort((a, b) => (a.partitionKey < b.partitionKey ? -1 : 1));
  if (lookback && summaries.length > lookback) {
    return summaries.slice(-lookback);
  }
  return summaries;
}

function aggregate(summaries: PartitionSummary[]): AggregateMetrics {
  if (summaries.length === 0) {
    return {
      partitions: 0,
      totalRevenue: 0,
      totalUnits: 0,
      averageOrderValue: 0,
      topCategories: [],
      topRegions: [],
      revenueSeries: []
    } satisfies AggregateMetrics;
  }

  const totalRevenue = summaries.reduce((acc, summary) => acc + summary.totals.revenue, 0);
  const totalUnits = summaries.reduce((acc, summary) => acc + summary.totals.units, 0);
  const averageOrderValue = totalUnits > 0 ? totalRevenue / totalUnits : 0;

  const categoryMap = new Map<string, number>();
  const regionMap = new Map<string, number>();

  for (const summary of summaries) {
    for (const entry of summary.byCategory) {
      const previous = categoryMap.get(entry.category) ?? 0;
      categoryMap.set(entry.category, previous + entry.revenue);
    }
    for (const entry of summary.byRegion) {
      const previous = regionMap.get(entry.region) ?? 0;
      regionMap.set(entry.region, previous + entry.revenue);
    }
  }

  const topCategories = Array.from(categoryMap.entries())
    .map(([category, revenue]) => ({
      category,
      revenue,
      share: totalRevenue > 0 ? revenue / totalRevenue : 0
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const topRegions = Array.from(regionMap.entries())
    .map(([region, revenue]) => ({
      region,
      revenue,
      share: totalRevenue > 0 ? revenue / totalRevenue : 0
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const revenueSeries = summaries.map((summary) => ({
    partitionKey: summary.partitionKey,
    revenue: summary.totals.revenue
  }));

  return {
    partitions: summaries.length,
    totalRevenue,
    totalUnits,
    averageOrderValue,
    topCategories,
    topRegions,
    revenueSeries
  } satisfies AggregateMetrics;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

function renderRevenueSvg(series: AggregateMetrics['revenueSeries']): string {
  if (series.length === 0) {
    return '<svg width="640" height="320" xmlns="http://www.w3.org/2000/svg"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="monospace" fill="#666">No data</text></svg>';
  }

  const width = 640;
  const height = 320;
  const padding = 50;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  const maxRevenue = Math.max(...series.map((entry) => entry.revenue));
  const points = series.map((entry, index) => {
    const x = padding + (usableWidth / Math.max(1, series.length - 1)) * index;
    const y = padding + usableHeight * (1 - entry.revenue / (maxRevenue || 1));
    return `${x},${y}`;
  });

  const labels = series
    .map((entry, index) => {
      const x = padding + (usableWidth / Math.max(1, series.length - 1)) * index;
      return `<text x="${x}" y="${height - padding + 18}" font-size="12" text-anchor="middle" fill="#555">${entry.partitionKey}</text>`;
    })
    .join('');

  const revenueRange = [0, maxRevenue];
  const axis = revenueRange
    .map((value) => {
      const y = padding + usableHeight * (1 - value / (maxRevenue || 1));
      return `<line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" stroke="#e0e0e0" stroke-width="1" />
<text x="${padding - 10}" y="${y + 4}" text-anchor="end" font-family="monospace" font-size="12" fill="#777">${formatCurrency(value)}</text>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />
  ${axis}
  <polyline points="${points.join(' ')}" fill="none" stroke="#2563eb" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
  ${labels}
</svg>`;
}

function renderHtml(title: string, metrics: AggregateMetrics, svgContent: string, generatedAt: string): string {
  const categoryRows = metrics.topCategories
    .map(
      (entry) => `<tr><td>${entry.category}</td><td>${formatCurrency(entry.revenue)}</td><td>${(entry.share * 100).toFixed(1)}%</td></tr>`
    )
    .join('');
  const regionRows = metrics.topRegions
    .map((entry) => `<tr><td>${entry.region}</td><td>${formatCurrency(entry.revenue)}</td><td>${(entry.share * 100).toFixed(1)}%</td></tr>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${title}</title>
    <style>
      body { font-family: 'Inter', system-ui, -apple-system, sans-serif; background: #f5f5f7; color: #111; margin: 0; padding: 24px; }
      main { max-width: 960px; margin: 0 auto; background: #fff; padding: 32px; border-radius: 16px; box-shadow: 0 10px 40px rgba(15, 23, 42, 0.12); }
      h1 { font-size: 2rem; margin-bottom: 0; }
      h2 { font-size: 1.25rem; margin-top: 2rem; }
      .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 24px 0; }
      .summary-item { background: #fafafa; padding: 16px; border-radius: 12px; border: 1px solid #e5e7eb; }
      .summary-item .label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; }
      .summary-item .value { font-size: 1.4rem; font-weight: 600; margin-top: 8px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
      th { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; background: #f9fafb; }
      .chart-container { margin-top: 16px; background: #f9fafb; padding: 24px; border-radius: 12px; border: 1px solid #e5e7eb; }
      footer { margin-top: 32px; font-size: 0.8rem; color: #6b7280; }
      code { font-family: 'JetBrains Mono', monospace; background: #f3f4f6; padding: 2px 4px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>Generated ${generatedAt}</p>
      <section class="summary">
        <div class="summary-item"><div class="label">Total Revenue</div><div class="value">${formatCurrency(metrics.totalRevenue)}</div></div>
        <div class="summary-item"><div class="label">Total Units</div><div class="value">${formatNumber(metrics.totalUnits)}</div></div>
        <div class="summary-item"><div class="label">Average Order Value</div><div class="value">${formatCurrency(metrics.averageOrderValue)}</div></div>
        <div class="summary-item"><div class="label">Partitions</div><div class="value">${metrics.partitions}</div></div>
      </section>
      <section class="chart-container">
        <h2>Revenue Trend</h2>
        <div>${svgContent}</div>
      </section>
      <section>
        <h2>Top Categories</h2>
        <table>
          <thead><tr><th>Category</th><th>Revenue</th><th>Share</th></tr></thead>
          <tbody>${categoryRows || '<tr><td colspan="3">No category data found</td></tr>'}</tbody>
        </table>
      </section>
      <section>
        <h2>Top Regions</h2>
        <table>
          <thead><tr><th>Region</th><th>Revenue</th><th>Share</th></tr></thead>
          <tbody>${regionRows || '<tr><td colspan="3">No regional data found</td></tr>'}</tbody>
        </table>
      </section>
      <footer>
        <p>Artifacts are available on disk. Use the workflow asset payload to locate original Parquet files.</p>
      </footer>
    </main>
  </body>
</html>`;
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  let parameters: Parameters;
  try {
    parameters = parseParameters(context.parameters);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid parameters';
    return { status: 'failed', errorMessage: message };
  }

  await mkdir(parameters.outputDir, { recursive: true });

  const summaries = await loadPartitionSummaries(parameters.warehouseDir, parameters.lookback);
  if (summaries.length === 0) {
    return {
      status: 'failed',
      errorMessage: `No partition summaries found in ${parameters.warehouseDir}`
    };
  }

  const metrics = aggregate(summaries);
  const generatedAt = new Date().toISOString();
  const svgContent = renderRevenueSvg(metrics.revenueSeries);

  const plotPath = path.resolve(parameters.outputDir, 'revenue-trend.svg');
  const htmlPath = path.resolve(parameters.outputDir, 'index.html');
  const metricsPath = path.resolve(parameters.outputDir, 'metrics.json');

  await writeFile(plotPath, svgContent, 'utf8');
  await writeFile(metricsPath, JSON.stringify({ generatedAt, metrics }, null, 2), 'utf8');
  await writeFile(htmlPath, renderHtml(parameters.reportTitle, metrics, svgContent, generatedAt), 'utf8');

  await context.update({
    metrics: {
      partitions: metrics.partitions,
      reportRevenue: metrics.totalRevenue
    }
  });

  const artifacts = [
    {
      path: htmlPath,
      relativePath: 'index.html',
      mediaType: 'text/html',
      description: 'Static sales dashboard',
      sizeBytes: (await stat(htmlPath)).size
    },
    {
      path: plotPath,
      relativePath: 'revenue-trend.svg',
      mediaType: 'image/svg+xml',
      description: 'Revenue trend SVG plot',
      sizeBytes: (await stat(plotPath)).size
    },
    {
      path: metricsPath,
      relativePath: 'metrics.json',
      mediaType: 'application/json',
      description: 'Aggregated metrics',
      sizeBytes: (await stat(metricsPath)).size
    }
  ];

  const producedAt = new Date().toISOString();

  return {
    status: 'succeeded',
    result: {
      generatedAt,
      metrics,
      artifacts,
      assets: [
        {
          assetId: 'retail.sales.report',
          producedAt,
          payload: {
            reportTitle: parameters.reportTitle,
            generatedAt,
            partitions: metrics.partitions,
            totalRevenue: Math.round(metrics.totalRevenue * 100) / 100,
            totalUnits: metrics.totalUnits,
            averageOrderValue: Math.round(metrics.averageOrderValue * 100) / 100,
            revenueSeries: metrics.revenueSeries,
            topCategories: metrics.topCategories,
            topRegions: metrics.topRegions,
            artifacts: artifacts.map((artifact) => ({
              relativePath: artifact.relativePath,
              mediaType: artifact.mediaType,
              description: artifact.description,
              sizeBytes: artifact.sizeBytes
            }))
          }
        }
      ]
    }
  } satisfies JobRunResult;
}

export default handler;

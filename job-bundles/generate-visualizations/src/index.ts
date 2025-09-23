import { mkdir, stat, writeFile } from 'node:fs/promises';
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

type ExtensionStat = {
  extension: string;
  count: number;
  totalSize: number;
};

type SizeBucketStat = {
  bucket: string;
  count: number;
  totalSize: number;
};

type DirectoryBySize = {
  relativePath: string;
  totalSize: number;
  totalFileCount: number;
};

type FileEntry = {
  relativePath: string;
  path?: string;
  size: number;
  extension?: string;
  modifiedAt?: string | null;
};

type ScanSummary = {
  totalFiles: number;
  totalDirectories: number;
  totalSize: number;
  averageFileSize: number;
  maxDepth: number;
  earliestModifiedAt: string | null;
  latestModifiedAt: string | null;
  truncated: boolean;
  maxEntries: number;
};

type ScanData = {
  rootPath: string | null;
  generatedAt: string | null;
  durationMs: number | null;
  summary: ScanSummary;
  extensionStats: ExtensionStat[];
  sizeDistribution: SizeBucketStat[];
  directoriesBySize: DirectoryBySize[];
  largestFiles: FileEntry[];
  directories: DirectoryBySize[];
  issues: Array<{ path: string; message: string }>;
};

type VisualizationParameters = {
  outputDir: string;
  reportTitle: string;
  scanData: ScanData;
};

type FileArtifact = {
  path: string;
  relativePath: string;
  mediaType: string;
  description: string;
  sizeBytes: number;
};

const numberFormatter = new Intl.NumberFormat('en-US');

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toNumber(value: unknown, fallback = 0): number {
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

function ensureString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  return fallback;
}

function normalizeExtensionStats(input: unknown): ExtensionStat[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const entries: ExtensionStat[] = [];
  for (const entry of input) {
    if (!isRecord(entry)) {
      continue;
    }
    const extension = ensureString(entry.extension ?? entry.ext ?? '').trim() || '[no-ext]';
    const count = Math.max(0, Math.trunc(toNumber(entry.count, 0)));
    const totalSize = Math.max(0, toNumber(entry.totalSize, 0));
    entries.push({ extension, count, totalSize });
  }
  return entries;
}

function normalizeSizeBuckets(input: unknown): SizeBucketStat[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const entries: SizeBucketStat[] = [];
  for (const entry of input) {
    if (!isRecord(entry)) {
      continue;
    }
    const bucket = ensureString(entry.bucket ?? entry.label ?? '').trim();
    if (!bucket) {
      continue;
    }
    entries.push({
      bucket,
      count: Math.max(0, Math.trunc(toNumber(entry.count, 0))),
      totalSize: Math.max(0, toNumber(entry.totalSize, 0))
    });
  }
  return entries;
}

function normalizeDirectoryEntries(input: unknown): DirectoryBySize[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const entries: DirectoryBySize[] = [];
  for (const entry of input) {
    if (!isRecord(entry)) {
      continue;
    }
    const relativePath = ensureString(entry.relativePath ?? entry.path ?? '').trim();
    if (!relativePath) {
      continue;
    }
    entries.push({
      relativePath,
      totalSize: Math.max(0, toNumber(entry.totalSize, 0)),
      totalFileCount: Math.max(0, Math.trunc(toNumber(entry.totalFileCount ?? entry.fileCount, 0)))
    });
  }
  return entries;
}

function normalizeFileEntries(input: unknown): FileEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const entries: FileEntry[] = [];
  for (const entry of input) {
    if (!isRecord(entry)) {
      continue;
    }
    const relativePath = ensureString(entry.relativePath ?? entry.path ?? '').trim();
    if (!relativePath) {
      continue;
    }
    entries.push({
      relativePath,
      path: ensureString(entry.path ?? relativePath) || undefined,
      size: Math.max(0, toNumber(entry.size, 0)),
      extension: ensureString(entry.extension ?? entry.ext ?? '').trim() || undefined,
      modifiedAt: ensureString(entry.modifiedAt ?? entry.mtime ?? '') || null
    });
  }
  return entries;
}

function normalizeIssues(input: unknown): Array<{ path: string; message: string }> {
  if (!Array.isArray(input)) {
    return [];
  }
  const entries: Array<{ path: string; message: string }> = [];
  for (const entry of input) {
    if (!isRecord(entry)) {
      continue;
    }
    const pathValue = ensureString(entry.path ?? '').trim();
    const messageValue = ensureString(entry.message ?? entry.error ?? '').trim();
    if (!pathValue && !messageValue) {
      continue;
    }
    entries.push({ path: pathValue || '(unknown)', message: messageValue || '(no message)' });
  }
  return entries;
}

function normalizeScanData(raw: unknown): ScanData {
  if (!isRecord(raw)) {
    throw new Error('scanData must be an object');
  }

  const summaryRaw = raw.summary;
  if (!isRecord(summaryRaw)) {
    throw new Error('scanData.summary is missing');
  }

  const summary: ScanSummary = {
    totalFiles: Math.max(0, Math.trunc(toNumber(summaryRaw.totalFiles, 0))),
    totalDirectories: Math.max(0, Math.trunc(toNumber(summaryRaw.totalDirectories, 0))),
    totalSize: Math.max(0, toNumber(summaryRaw.totalSize, 0)),
    averageFileSize: Math.max(0, toNumber(summaryRaw.averageFileSize, 0)),
    maxDepth: Math.max(0, Math.trunc(toNumber(summaryRaw.maxDepth, 0))),
    earliestModifiedAt: ensureString(summaryRaw.earliestModifiedAt ?? '') || null,
    latestModifiedAt: ensureString(summaryRaw.latestModifiedAt ?? '') || null,
    truncated: Boolean(summaryRaw.truncated),
    maxEntries: Math.max(0, Math.trunc(toNumber(summaryRaw.maxEntries, 0)))
  } satisfies ScanSummary;

  const directoriesBySize = normalizeDirectoryEntries(raw.directoriesBySize ?? raw.directories);

  return {
    rootPath: ensureString(raw.rootPath ?? '').trim() || null,
    generatedAt: ensureString(raw.generatedAt ?? '').trim() || null,
    durationMs: Number.isFinite(toNumber(raw.durationMs, NaN)) ? toNumber(raw.durationMs, 0) : null,
    summary,
    extensionStats: normalizeExtensionStats(raw.extensionStats),
    sizeDistribution: normalizeSizeBuckets(raw.sizeDistribution),
    directoriesBySize,
    largestFiles: normalizeFileEntries(raw.largestFiles),
    directories: directoriesBySize,
    issues: normalizeIssues(raw.issues)
  } satisfies ScanData;
}

function normalizeParameters(raw: unknown): VisualizationParameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }
  const outputDirRaw = raw.outputDir ?? raw.outDir ?? raw.directory;
  if (typeof outputDirRaw !== 'string' || outputDirRaw.trim().length === 0) {
    throw new Error('outputDir parameter is required');
  }
  const reportTitleRaw = raw.reportTitle ?? raw.title ?? 'Directory Visualization Report';
  const scanDataRaw = raw.scanData ?? raw.data ?? null;
  if (!scanDataRaw) {
    throw new Error('scanData payload is required');
  }

  return {
    outputDir: outputDirRaw,
    reportTitle: typeof reportTitleRaw === 'string' && reportTitleRaw.trim()
      ? reportTitleRaw.trim()
      : 'Directory Visualization Report',
    scanData: normalizeScanData(scanDataRaw)
  } satisfies VisualizationParameters;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let value = size;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatNumber(value: number): string {
  return numberFormatter.format(Math.max(0, Math.floor(value)));
}

async function createArtifact(
  filePath: string,
  baseDir: string,
  mediaType: string,
  description: string
): Promise<FileArtifact> {
  const stats = await stat(filePath).catch(() => ({ size: 0 }));
  const relativePath = path.relative(baseDir, filePath) || path.basename(filePath);
  return {
    path: filePath,
    relativePath,
    mediaType,
    description,
    sizeBytes: Number(stats.size ?? 0) || 0
  } satisfies FileArtifact;
}

function buildHtmlDocument(title: string, scan: ScanData): string {
  const safeTitle = escapeHtml(title || 'Directory Visualization Report');
  const rootPath = escapeHtml(scan.rootPath ?? '');
  const generatedAt = scan.generatedAt ? escapeHtml(scan.generatedAt) : new Date().toISOString();
  const summary = scan.summary;
  const summaryItems = [
    { label: 'Total Files', value: formatNumber(summary.totalFiles) },
    { label: 'Total Directories', value: formatNumber(summary.totalDirectories) },
    { label: 'Total Size', value: formatBytes(summary.totalSize) },
    { label: 'Average File Size', value: formatBytes(summary.averageFileSize) },
    { label: 'Max Depth', value: formatNumber(summary.maxDepth) },
    {
      label: 'Last Modified',
      value: summary.latestModifiedAt ? escapeHtml(summary.latestModifiedAt) : '—'
    },
    {
      label: 'Truncated',
      value: summary.truncated
        ? `Yes (limit ${formatNumber(summary.maxEntries)})`
        : 'No'
    }
  ];

  const topExtensions = scan.extensionStats.slice(0, 10);
  const topDirectories = scan.directoriesBySize.slice(0, 10);
  const topFiles = scan.largestFiles.slice(0, 10);

  const topExtensionsTableRows = topExtensions
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.extension)}</td><td>${formatNumber(entry.count)}</td><td>${formatBytes(entry.totalSize)}</td></tr>`
    )
    .join('') || '<tr><td colspan="3">No data available</td></tr>';

  const topDirectoriesTableRows = topDirectories
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.relativePath)}</td><td>${formatBytes(entry.totalSize)}</td><td>${formatNumber(entry.totalFileCount)}</td></tr>`
    )
    .join('') || '<tr><td colspan="3">No data available</td></tr>';

  const topFilesTableRows = topFiles
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.relativePath)}</td><td>${formatBytes(entry.size)}</td><td>${escapeHtml(entry.extension ?? 'n/a')}</td></tr>`
    )
    .join('') || '<tr><td colspan="3">No data available</td></tr>';

  const issuesSection = scan.issues.length
    ? `<section class="section">
        <h2>Scan Notes</h2>
        <ul class="issues">
          ${scan.issues
            .slice(0, 10)
            .map(
              (issue) =>
                `<li><strong>${escapeHtml(issue.path)}</strong><span>${escapeHtml(issue.message)}</span></li>`
            )
            .join('')}
        </ul>
      </section>`
    : '';

  const dataJson = JSON.stringify(scan).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <link rel="preconnect" href="https://cdn.jsdelivr.net" />
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js" defer></script>
    <style>
      :root {
        color-scheme: light dark;
        font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: #0f172a;
        color: #e2e8f0;
      }
      body {
        margin: 0;
        padding: 0;
        background: linear-gradient(180deg, #0f172a 0%, #111827 40%, #0f172a 100%);
      }
      .container {
        max-width: 1200px;
        margin: 0 auto;
        padding: 2.5rem 1.5rem 4rem;
      }
      header {
        margin-bottom: 2rem;
      }
      header h1 {
        font-size: clamp(2.25rem, 2.5vw, 3rem);
        margin: 0 0 0.75rem 0;
        color: #f8fafc;
      }
      header p {
        margin: 0.25rem 0;
        color: #cbd5f5;
      }
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 1rem;
        margin-bottom: 2.5rem;
      }
      .summary-card {
        background: rgba(30, 41, 59, 0.65);
        border: 1px solid rgba(148, 163, 184, 0.15);
        border-radius: 16px;
        padding: 1rem 1.25rem;
        backdrop-filter: blur(14px);
      }
      .summary-card h3 {
        margin: 0;
        font-size: 0.9rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #94a3b8;
      }
      .summary-card p {
        margin: 0.35rem 0 0;
        font-size: 1.3rem;
        color: #f8fafc;
      }
      .section {
        margin-bottom: 3rem;
      }
      .section h2 {
        margin: 0 0 1rem;
        font-size: 1.6rem;
        color: #e0f2fe;
      }
      .chart-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 1.5rem;
      }
      .chart-card {
        background: rgba(148, 163, 184, 0.1);
        border: 1px solid rgba(148, 163, 184, 0.15);
        border-radius: 18px;
        padding: 1.25rem;
        backdrop-filter: blur(18px);
        min-height: 320px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        background: rgba(148, 163, 184, 0.08);
        border-radius: 12px;
        overflow: hidden;
      }
      table thead th {
        text-align: left;
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #cbd5f5;
        padding: 0.75rem 1rem;
        background: rgba(15, 23, 42, 0.55);
      }
      table tbody td {
        padding: 0.7rem 1rem;
        border-top: 1px solid rgba(148, 163, 184, 0.12);
      }
      .issues {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 0.75rem;
      }
      .issues li {
        background: rgba(239, 68, 68, 0.12);
        border: 1px solid rgba(248, 113, 113, 0.3);
        border-radius: 12px;
        padding: 0.85rem 1.1rem;
        color: #fecaca;
        display: grid;
        gap: 0.35rem;
      }
      footer {
        margin-top: 3rem;
        text-align: center;
        color: #64748b;
        font-size: 0.8rem;
      }
      @media (max-width: 640px) {
        .container {
          padding: 2rem 1rem 3rem;
        }
        .chart-card {
          min-height: 260px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <header>
        <h1>${safeTitle}</h1>
        ${rootPath ? `<p><strong>Directory:</strong> <code>${rootPath}</code></p>` : ''}
        <p><strong>Generated:</strong> ${escapeHtml(generatedAt)}</p>
      </header>
      <section class="summary-grid">
        ${summaryItems
          .map(
            (item) =>
              `<div class="summary-card"><h3>${escapeHtml(item.label)}</h3><p>${escapeHtml(item.value)}</p></div>`
          )
          .join('')}
      </section>
      <section class="section">
        <h2>Visual Analytics</h2>
        <div class="chart-grid">
          <div class="chart-card">
            <canvas id="extensionCountChart" aria-label="File count by extension" role="img"></canvas>
          </div>
          <div class="chart-card">
            <canvas id="extensionSizeChart" aria-label="Total size by extension" role="img"></canvas>
          </div>
          <div class="chart-card">
            <canvas id="directorySizeChart" aria-label="Largest directories" role="img"></canvas>
          </div>
          <div class="chart-card">
            <canvas id="largestFilesChart" aria-label="Largest files" role="img"></canvas>
          </div>
        </div>
      </section>
      <section class="section">
        <h2>Key Tables</h2>
        <div class="chart-grid">
          <div class="chart-card" style="min-height:auto;">
            <h3>Top Extensions</h3>
            <table>
              <thead><tr><th>Extension</th><th>Files</th><th>Total Size</th></tr></thead>
              <tbody>${topExtensionsTableRows}</tbody>
            </table>
          </div>
          <div class="chart-card" style="min-height:auto;">
            <h3>Largest Directories</h3>
            <table>
              <thead><tr><th>Directory</th><th>Total Size</th><th>Files</th></tr></thead>
              <tbody>${topDirectoriesTableRows}</tbody>
            </table>
          </div>
          <div class="chart-card" style="min-height:auto;">
            <h3>Largest Files</h3>
            <table>
              <thead><tr><th>File</th><th>Size</th><th>Extension</th></tr></thead>
              <tbody>${topFilesTableRows}</tbody>
            </table>
          </div>
        </div>
      </section>
      ${issuesSection}
      <footer>
        Generated by AppHub visualization workflow • ${escapeHtml(new Date().toISOString())}
      </footer>
    </div>
    <script id="scan-data" type="application/json">${dataJson}</script>
    <script defer>
      document.addEventListener('DOMContentLoaded', () => {
        const dataElement = document.getElementById('scan-data');
        let scanData;
        try {
          scanData = dataElement ? JSON.parse(dataElement.textContent || '{}') : {};
        } catch (err) {
          console.error('Failed to parse scan data', err);
          scanData = {};
        }

        const palette = ['#60a5fa', '#a855f7', '#34d399', '#f97316', '#fbbf24', '#38bdf8', '#f472b6', '#c084fc', '#f87171', '#14b8a6'];
        const extensionStats = (scanData.extensionStats || []).slice(0, 12);
        const directories = (scanData.directoriesBySize || []).slice(0, 12);
        const largestFiles = (scanData.largestFiles || []).slice(0, 12);

        const ctxOrNull = (id) => {
          const canvas = document.getElementById(id);
          return canvas && canvas.getContext ? canvas.getContext('2d') : null;
        };

        const extensionCountCtx = ctxOrNull('extensionCountChart');
        if (extensionCountCtx && window.Chart) {
          new window.Chart(extensionCountCtx, {
            type: 'bar',
            data: {
              labels: extensionStats.map((entry) => entry.extension),
              datasets: [
                {
                  label: 'Files',
                  data: extensionStats.map((entry) => entry.count),
                  backgroundColor: extensionStats.map((_, index) => palette[index % palette.length])
                }
              ]
            },
            options: {
              responsive: true,
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label(context) {
                      return context.parsed.y.toLocaleString() + ' files';
                    }
                  }
                }
              },
              scales: {
                x: { ticks: { color: '#cbd5f5' } },
                y: { ticks: { color: '#cbd5f5' }, beginAtZero: true }
              }
            }
          });
        }

        const extensionSizeCtx = ctxOrNull('extensionSizeChart');
        if (extensionSizeCtx && window.Chart) {
          new window.Chart(extensionSizeCtx, {
            type: 'pie',
            data: {
              labels: extensionStats.map((entry) => entry.extension),
              datasets: [
                {
                  label: 'Size (MB)',
                  data: extensionStats.map((entry) => entry.totalSize / (1024 * 1024) || 0.0001),
                  backgroundColor: extensionStats.map((_, index) => palette[index % palette.length])
                }
              ]
            },
            options: {
              responsive: true,
              plugins: {
                tooltip: {
                  callbacks: {
                    label(context) {
                      const value = context.raw || 0;
                      return context.label + ': ' + value.toFixed(2) + ' MB';
                    }
                  }
                }
              }
            }
          });
        }

        const directorySizeCtx = ctxOrNull('directorySizeChart');
        if (directorySizeCtx && window.Chart) {
          new window.Chart(directorySizeCtx, {
            type: 'bar',
            data: {
              labels: directories.map((entry) => entry.relativePath),
              datasets: [
                {
                  label: 'Size (MB)',
                  data: directories.map((entry) => entry.totalSize / (1024 * 1024)),
                  backgroundColor: directories.map((_, index) => palette[index % palette.length])
                }
              ]
            },
            options: {
              responsive: true,
              indexAxis: 'y',
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label(context) {
                      const value = context.parsed.x || 0;
                      return value.toFixed(2) + ' MB';
                    }
                  }
                }
              },
              scales: {
                x: { ticks: { color: '#cbd5f5' } },
                y: { ticks: { color: '#cbd5f5' } }
              }
            }
          });
        }

        const largestFilesCtx = ctxOrNull('largestFilesChart');
        if (largestFilesCtx && window.Chart) {
          new window.Chart(largestFilesCtx, {
            type: 'bar',
            data: {
              labels: largestFiles.map((entry) => entry.relativePath),
              datasets: [
                {
                  label: 'Size (MB)',
                  data: largestFiles.map((entry) => entry.size / (1024 * 1024)),
                  backgroundColor: largestFiles.map((_, index) => palette[(index + 3) % palette.length])
                }
              ]
            },
            options: {
              responsive: true,
              indexAxis: 'y',
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label(context) {
                      const value = context.parsed.x || 0;
                      return value.toFixed(2) + ' MB';
                    }
                  }
                }
              },
              scales: {
                x: { ticks: { color: '#cbd5f5' } },
                y: { ticks: { color: '#cbd5f5' } }
              }
            }
          });
        }
      });
    </script>
  </body>
</html>`;
}

function buildSummaryMarkdown(title: string, scan: ScanData): string {
  const summary = scan.summary;
  const topExtension = scan.extensionStats[0];
  const topDirectory = scan.directoriesBySize[0];
  const topFile = scan.largestFiles[0];

  const lines = [
    `# ${title}`,
    '',
    `- **Directory:** ${scan.rootPath ?? 'n/a'}`,
    `- **Generated at:** ${scan.generatedAt ?? new Date().toISOString()}`,
    `- **Total files:** ${formatNumber(summary.totalFiles)}`,
    `- **Total directories:** ${formatNumber(summary.totalDirectories)}`,
    `- **Total size:** ${formatBytes(summary.totalSize)}`,
    `- **Max depth:** ${summary.maxDepth}`,
    `- **Truncated:** ${summary.truncated ? `Yes (limit ${formatNumber(summary.maxEntries)})` : 'No'}`
  ];

  if (topExtension) {
    lines.push(`- **Top extension:** ${topExtension.extension} (${formatNumber(topExtension.count)} files, ${formatBytes(topExtension.totalSize)})`);
  }
  if (topDirectory) {
    lines.push(`- **Largest directory:** ${topDirectory.relativePath} (${formatBytes(topDirectory.totalSize)})`);
  }
  if (topFile) {
    lines.push(`- **Largest file:** ${topFile.relativePath} (${formatBytes(topFile.size)})`);
  }

  if (scan.issues.length) {
    lines.push('', '## Scan Notes');
    for (const issue of scan.issues.slice(0, 10)) {
      lines.push(`- ${issue.path}: ${issue.message}`);
    }
  }

  return `${lines.join('\n')}
`;
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  let params: VisualizationParameters;
  try {
    params = normalizeParameters(context.parameters);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid parameters';
    return { status: 'failed', errorMessage: message } satisfies JobRunResult;
  }

  const outputDir = path.resolve(params.outputDir);
  await mkdir(outputDir, { recursive: true });

  context.logger('visualization:generate:start', {
    outputDir,
    reportTitle: params.reportTitle,
    totalFiles: params.scanData.summary.totalFiles
  });

  const artifacts: FileArtifact[] = [];

  const dataPath = path.join(outputDir, 'scan-data.json');
  await writeFile(dataPath, JSON.stringify(params.scanData, null, 2), 'utf8');
  artifacts.push(await createArtifact(dataPath, outputDir, 'application/json', 'Raw scan dataset'));

  const htmlPath = path.join(outputDir, 'index.html');
  const htmlContents = buildHtmlDocument(params.reportTitle, params.scanData);
  await writeFile(htmlPath, htmlContents, 'utf8');
  artifacts.push(await createArtifact(htmlPath, outputDir, 'text/html', 'Interactive visualization report'));

  const summaryPath = path.join(outputDir, 'summary.md');
  const summaryMarkdown = buildSummaryMarkdown(params.reportTitle, params.scanData);
  await writeFile(summaryPath, summaryMarkdown, 'utf8');
  artifacts.push(await createArtifact(summaryPath, outputDir, 'text/markdown', 'Human-readable summary of scan insights'));

  context.logger('visualization:generate:complete', {
    outputDir,
    artifacts: artifacts.length
  });

  await context.update({ metrics: { filesCreated: artifacts.length } });

  return {
    status: 'succeeded',
    result: {
      files: artifacts,
      count: artifacts.length
    }
  } satisfies JobRunResult;
}

export default handler;

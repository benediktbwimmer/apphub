import Fastify from 'fastify';
import chokidar from 'chokidar';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

type DropStatus = 'queued' | 'launching' | 'completed' | 'failed';

type DropRecord = {
  dropId: string;
  minute: string;
  minuteKey: string;
  sourceFiles: string[];
  status: DropStatus;
  observedAt: string;
  updatedAt: string;
  attempts: number;
  runId?: string;
  errorMessage?: string | null;
};

type DropActivityEntry = {
  dropId: string;
  minute: string;
  status: DropStatus;
  runId: string | null;
  fileCount: number;
  updatedAt: string;
  note: string | null;
  error: string | null;
};

type Metrics = {
  startedAt: string;
  filesObserved: number;
  triggerAttempts: number;
  launches: number;
  triggerFailures: number;
  completions: number;
  runFailures: number;
  lastEventAt: string | null;
  lastError: string | null;
};

type StatsSnapshot = {
  config: {
    watchRoot: string;
    stagingDir: string;
    archiveDir: string;
    timestoreBaseUrl: string;
    timestoreDatasetSlug: string;
    timestoreDatasetName: string;
    timestoreTableName: string;
    timestoreStorageTargetId: string;
    workflowSlug: string;
    publicationWorkflowSlug: string;
    visualizationAssetId: string;
    plotsDir: string;
    reportsDir: string;
    apiBaseUrl: string;
    maxAttempts: number;
  };
  watcher: {
    ready: boolean;
    activeDrops: number;
  };
  metrics: Metrics;
  totals: Record<DropStatus, number>;
  recent: DropActivityEntry[];
};

const ROOT_DIR = path.resolve(process.cwd());
const DEFAULT_WATCH_ROOT = path.resolve(ROOT_DIR, '..', '..', 'data', 'inbox');
const DEFAULT_STAGING_DIR = path.resolve(ROOT_DIR, '..', '..', 'data', 'staging');
const DEFAULT_ARCHIVE_DIR = path.resolve(ROOT_DIR, '..', '..', 'data', 'archive');
const DEFAULT_PLOTS_DIR = path.resolve(ROOT_DIR, '..', '..', 'data', 'plots');
const DEFAULT_REPORTS_DIR = path.resolve(ROOT_DIR, '..', '..', 'data', 'reports');
const DEFAULT_TIMESTORE_BASE_URL = 'http://127.0.0.1:4200';
const DEFAULT_TIMESTORE_DATASET_SLUG = 'observatory-timeseries';
const DEFAULT_TIMESTORE_DATASET_NAME = 'Observatory Time Series';
const DEFAULT_TIMESTORE_TABLE_NAME = 'observations';

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function extractMinuteFromFilename(relativePath: string): string | null {
  const match = relativePath.match(/_(\d{12})\.csv$/i);
  if (!match) {
    return null;
  }
  const timestamp = match[1];
  const year = timestamp.slice(0, 4);
  const month = timestamp.slice(4, 6);
  const day = timestamp.slice(6, 8);
  const hour = timestamp.slice(8, 10);
  const minute = timestamp.slice(10, 12);
  if (!year || !month || !day || !hour || !minute) {
    return null;
  }
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

const watchRoot = path.resolve(process.env.FILE_WATCH_ROOT ?? DEFAULT_WATCH_ROOT);
const stagingDir = path.resolve(process.env.FILE_WATCH_STAGING_DIR ?? DEFAULT_STAGING_DIR);
const archiveDir = path.resolve(process.env.FILE_ARCHIVE_DIR ?? DEFAULT_ARCHIVE_DIR);
const timestoreBaseUrl = (process.env.TIMESTORE_BASE_URL ?? DEFAULT_TIMESTORE_BASE_URL)
  .trim()
  .replace(/\/$/, '');
const timestoreDatasetSlug = (process.env.TIMESTORE_DATASET_SLUG ?? DEFAULT_TIMESTORE_DATASET_SLUG).trim();
const timestoreDatasetName = (process.env.TIMESTORE_DATASET_NAME ?? DEFAULT_TIMESTORE_DATASET_NAME).trim();
const timestoreTableName = (process.env.TIMESTORE_TABLE_NAME ?? DEFAULT_TIMESTORE_TABLE_NAME).trim();
const timestoreStorageTargetId = (process.env.TIMESTORE_STORAGE_TARGET_ID ?? '').trim();
const timestoreAuthToken = (process.env.TIMESTORE_API_TOKEN ?? '').trim() || null;
const workflowSlug = (
  process.env.OBSERVATORY_WORKFLOW_SLUG ??
  process.env.FILE_DROP_WORKFLOW_SLUG ??
  'observatory-minute-ingest'
).trim();
const publicationWorkflowSlug = (
  process.env.OBSERVATORY_PUBLICATION_WORKFLOW_SLUG ?? 'observatory-daily-publication'
).trim();
const visualizationAssetId = (
  process.env.OBSERVATORY_VISUALIZATION_ASSET_ID ?? 'observatory.visualizations.minute'
).trim();
const plotsRoot = path.resolve(
  process.env.OBSERVATORY_PLOTS_DIR ?? process.env.PLOTS_DIR ?? DEFAULT_PLOTS_DIR
);
const reportsRoot = path.resolve(
  process.env.OBSERVATORY_REPORTS_DIR ?? process.env.REPORTS_DIR ?? DEFAULT_REPORTS_DIR
);
const metastoreBaseUrl = (process.env.METASTORE_BASE_URL ?? '').trim().replace(/\/$/, '');
const metastoreAuthToken = (process.env.METASTORE_API_TOKEN ?? '').trim() || null;
const metastoreNamespace = (process.env.METASTORE_NAMESPACE ?? 'observatory.reports').trim();
const lookbackMinutes = Math.max(
  1,
  Number.parseInt(process.env.OBSERVATORY_LOOKBACK_MINUTES ?? '180', 10) || 180
);
const apiBaseUrl = (process.env.CATALOG_API_BASE_URL ?? 'http://127.0.0.1:4000')
  .trim()
  .replace(/\/$/, '');
const apiToken = (process.env.CATALOG_API_TOKEN ?? '').trim() || null;
const resumeExisting = parseBoolean(process.env.FILE_WATCH_RESUME_EXISTING, true);
const debounceMs = Math.max(
  200,
  Math.min(5000, Number.parseInt(process.env.FILE_WATCH_DEBOUNCE_MS ?? '750', 10) || 750)
);
const maxLaunchAttempts = Math.max(
  1,
  Math.min(10, Number.parseInt(process.env.FILE_WATCH_MAX_ATTEMPTS ?? '3', 10) || 3)
);
const maxFiles = Math.max(1, Number.parseInt(process.env.FILE_WATCH_MAX_FILES ?? '64', 10) || 64);
const autoComplete = parseBoolean(
  process.env.OBSERVATORY_AUTO_COMPLETE ?? process.env.FILE_WATCH_AUTO_COMPLETE,
  true
);
const port = Number.parseInt(process.env.PORT ?? '4310', 10) || 4310;
const host = process.env.HOST ?? '0.0.0.0';

const app = Fastify({ logger: true });

const drops = new Map<string, DropRecord>();
const sourceToDropId = new Map<string, string>();
const pendingLaunchTimers = new Map<string, NodeJS.Timeout>();
const recentActivity: DropActivityEntry[] = [];

const metrics: Metrics = {
  startedAt: new Date().toISOString(),
  filesObserved: 0,
  triggerAttempts: 0,
  launches: 0,
  triggerFailures: 0,
  completions: 0,
  runFailures: 0,
  lastEventAt: null,
  lastError: null
};

let watcherReady = false;

function recordActivity(record: DropRecord, note: string | null = null) {
  const entry: DropActivityEntry = {
    dropId: record.dropId,
    minute: record.minute,
    status: record.status,
    runId: record.runId ?? null,
    fileCount: record.sourceFiles.length,
    updatedAt: record.updatedAt,
    note,
    error: record.errorMessage ?? null
  };
  recentActivity.unshift(entry);
  if (recentActivity.length > 25) {
    recentActivity.length = 25;
  }
}

function releaseRecord(record: DropRecord) {
  drops.delete(record.dropId);
  const pendingTimer = pendingLaunchTimers.get(record.dropId);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingLaunchTimers.delete(record.dropId);
  }
  for (const filePath of record.sourceFiles) {
    sourceToDropId.delete(filePath);
  }
}

async function ensureDirectoryExists(target: string): Promise<void> {
  await mkdir(target, { recursive: true });
}

async function enqueueExistingFiles(targetDir: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(targetDir, { withFileTypes: true });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      app.log.warn({ err, targetDir }, 'Failed to read directory during startup scan');
    }
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const absolutePath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await enqueueExistingFiles(absolutePath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    await registerFile(absolutePath, 'startup');
  }
}

async function registerFile(filePath: string, source: 'startup' | 'watch'): Promise<void> {
  const absolute = path.resolve(filePath);
  if (!absolute.startsWith(watchRoot)) {
    return;
  }
  if (sourceToDropId.has(absolute)) {
    return;
  }

  try {
    const stats = await stat(absolute);
    if (!stats.isFile()) {
      return;
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      app.log.warn({ err, filePath: absolute }, 'Failed to stat file');
    }
    return;
  }

  const relativePath = path.relative(watchRoot, absolute);
  if (relativePath.startsWith('..')) {
    return;
  }
  const normalizedRelative = toPosix(relativePath);
  const minute = extractMinuteFromFilename(normalizedRelative);
  if (!minute) {
    app.log.warn({ filePath: absolute }, 'Skipping file without minute timestamp');
    return;
  }

  const minuteKey = minute.replace(/:/g, '-');
  const dropId = `observatory-${minuteKey}`;
  sourceToDropId.set(absolute, dropId);

  const existing = drops.get(dropId);
  if (existing) {
    if (!existing.sourceFiles.includes(absolute)) {
      existing.sourceFiles.push(absolute);
      recordActivity(existing, 'Observed additional instrument file');
    }
    return;
  }

  const timestamp = new Date().toISOString();
  const record: DropRecord = {
    dropId,
    minute,
    minuteKey,
    sourceFiles: [absolute],
    status: 'queued',
    observedAt: timestamp,
    updatedAt: timestamp,
    attempts: 0
  };

  drops.set(dropId, record);
  metrics.filesObserved += 1;
  metrics.lastEventAt = record.observedAt;
  recordActivity(record, source === 'startup' ? 'Queued existing files on startup' : 'Detected new instrument file');
  scheduleLaunch(record, source === 'startup' ? 250 : 50, 1);
}

function scheduleLaunch(record: DropRecord, delayMs: number, attempt: number): void {
  const existingTimer = pendingLaunchTimers.get(record.dropId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  record.status = 'queued';
  record.updatedAt = new Date().toISOString();
  record.attempts = attempt - 1;

  const timer = setTimeout(() => {
    pendingLaunchTimers.delete(record.dropId);
    void launchWorkflow(record, attempt);
  }, delayMs);
  pendingLaunchTimers.set(record.dropId, timer);
}

async function seedPublicationPartitionParameters(partitionKey: string): Promise<void> {
  if (!publicationWorkflowSlug || !visualizationAssetId) {
    return;
  }

  const parameters: Record<string, unknown> = {
    plotsDir: plotsRoot,
    reportsDir: reportsRoot,
    timestoreBaseUrl,
    timestoreDatasetSlug,
    lookbackMinutes
  };
  if (metastoreBaseUrl) {
    parameters.metastoreBaseUrl = metastoreBaseUrl;
  }
  if (metastoreNamespace) {
    parameters.metastoreNamespace = metastoreNamespace;
  }
  if (metastoreAuthToken) {
    parameters.metastoreAuthToken = metastoreAuthToken;
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };
  if (apiToken) {
    headers.authorization = `Bearer ${apiToken}`;
  }

  try {
    const response = await fetch(
      `${apiBaseUrl}/workflows/${encodeURIComponent(publicationWorkflowSlug)}/assets/${encodeURIComponent(visualizationAssetId)}/partition-parameters`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ partitionKey, parameters })
      }
    );
    if (!response.ok) {
      throw new Error(`API responded with status ${response.status}`);
    }
    app.log.info(
      {
        partitionKey,
        workflowSlug: publicationWorkflowSlug,
        assetId: visualizationAssetId,
        plotsDir: plotsRoot,
        reportsDir: reportsRoot
      },
      'Seeded publication partition parameters'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    app.log.warn(
      {
        partitionKey,
        workflowSlug: publicationWorkflowSlug,
        assetId: visualizationAssetId,
        error: message
      },
      'Failed to seed publication partition parameters'
    );
  }
}

async function launchWorkflow(record: DropRecord, attempt: number): Promise<void> {
  record.status = 'launching';
  record.updatedAt = new Date().toISOString();
  record.attempts = attempt;
  recordActivity(record, attempt > 1 ? `Retrying launch (#${attempt})` : 'Launching workflow');
  metrics.triggerAttempts += 1;

  const relativeFiles = record.sourceFiles.map((file) => toPosix(path.relative(watchRoot, file)));
  const parameters: Record<string, unknown> = {
    minute: record.minute,
    inboxDir: watchRoot,
    stagingDir,
    archiveDir,
    timestoreBaseUrl,
    timestoreDatasetSlug,
    timestoreDatasetName,
    timestoreTableName,
    timestoreStorageTargetId: timestoreStorageTargetId || undefined,
    timestoreAuthToken: timestoreAuthToken ?? undefined,
    maxFiles
  };

  const body = {
    partitionKey: record.minute,
    parameters,
    triggeredBy: 'observatory-file-watcher',
    trigger: {
      type: 'file-drop',
      options: {
        minute: record.minute,
        files: relativeFiles
      }
    }
  } satisfies Record<string, unknown>;

  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };
  if (apiToken) {
    headers.authorization = `Bearer ${apiToken}`;
  }

  try {
    await seedPublicationPartitionParameters(record.minute);

    const response = await fetch(`${apiBaseUrl}/workflows/${workflowSlug}/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`API responded with status ${response.status}`);
    }
    const payload = (await response.json()) as { data?: { id?: string; status?: string } };
    record.runId = typeof payload?.data?.id === 'string' ? payload.data.id : undefined;
    record.errorMessage = null;
    record.updatedAt = new Date().toISOString();
    metrics.launches += 1;
    metrics.lastEventAt = record.updatedAt;

    if (autoComplete) {
      record.status = 'completed';
      metrics.completions += 1;
      recordActivity(record, 'Workflow run launched');
      releaseRecord(record);
    } else {
      record.status = 'launching';
      recordActivity(record, 'Workflow run launched (awaiting completion)');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    metrics.triggerFailures += 1;
    metrics.lastError = message;
    record.errorMessage = message;
    record.updatedAt = new Date().toISOString();
    if (attempt < maxLaunchAttempts) {
      scheduleLaunch(record, Math.min(10_000, 1_500 * attempt), attempt + 1);
      app.log.warn({ dropId: record.dropId, attempt, error: message }, 'Retrying observatory ingest launch');
      return;
    }
    record.status = 'failed';
    recordActivity(record, `Launch failed permanently: ${message}`);
    releaseRecord(record);
    app.log.error({ dropId: record.dropId, error: message }, 'Failed to launch observatory workflow after retries');
  }
}

function buildStatsSnapshot(): StatsSnapshot {
  const totals: Record<DropStatus, number> = {
    queued: 0,
    launching: 0,
    completed: 0,
    failed: 0
  };
  for (const record of drops.values()) {
    totals[record.status] += 1;
  }
  const activeDrops = totals.launching;

  return {
    config: {
      watchRoot,
      stagingDir,
      archiveDir,
      timestoreBaseUrl,
      timestoreDatasetSlug,
      timestoreDatasetName,
      timestoreTableName,
      timestoreStorageTargetId,
      workflowSlug,
      publicationWorkflowSlug,
      visualizationAssetId,
      plotsDir: plotsRoot,
      reportsDir: reportsRoot,
      apiBaseUrl,
      maxAttempts: maxLaunchAttempts
    },
    watcher: {
      ready: watcherReady,
      activeDrops
    },
    metrics,
    totals,
    recent: recentActivity.slice(0, 20)
  };
}

app.get('/healthz', async () => ({
  status: 'ok',
  watcher: {
    ready: watcherReady,
    observed: metrics.filesObserved,
    lastError: metrics.lastError
  }
}));

app.get('/api/stats', async () => buildStatsSnapshot());

function renderDashboard(snapshot: StatsSnapshot): string {
  const totals = snapshot.totals;
  const counts = Object.entries(totals)
    .map(([status, value]) => `<li><strong>${value}</strong> ${status}</li>`)
    .join('');

  const metricsTable = `
    <table class="metrics">
      <tbody>
        <tr><th>Watcher ready</th><td>${snapshot.watcher.ready ? 'yes' : 'no'}</td></tr>
        <tr><th>Observed files</th><td>${metrics.filesObserved}</td></tr>
        <tr><th>Launch attempts</th><td>${metrics.triggerAttempts}</td></tr>
        <tr><th>Successful launches</th><td>${metrics.launches}</td></tr>
        <tr><th>Failures</th><td>${metrics.triggerFailures + metrics.runFailures}</td></tr>
        <tr><th>Last event</th><td>${metrics.lastEventAt ?? '—'}</td></tr>
        <tr><th>Workflow slug</th><td><code>${snapshot.config.workflowSlug}</code></td></tr>
      </tbody>
    </table>
  `;

  const recentRows = snapshot.recent
    .map((entry) => {
      const note = entry.note ? `<span class="note">${entry.note}</span>` : '';
      const error = entry.error ? `<span class="error">${entry.error}</span>` : '';
      return `
        <tr>
          <td class="mono">${entry.dropId}</td>
          <td>${entry.status}</td>
          <td>${entry.minute}</td>
          <td>${entry.fileCount}</td>
          <td>${entry.runId ?? '—'}</td>
          <td>${entry.updatedAt}</td>
          <td>${note}${error}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Observatory Ingest Watcher</title>
        <style>
          :root { color-scheme: dark; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; background: #050b18; color: #e2e8f0; }
          h1 { margin-bottom: 0.25rem; }
          .subtitle { color: #94a3b8; margin-bottom: 1.5rem; }
          table.metrics { border-collapse: collapse; width: 100%; max-width: 640px; margin-bottom: 1.5rem; }
          table.metrics th { text-align: left; padding: 0.5rem; width: 220px; color: #cbd5f5; }
          table.metrics td { padding: 0.5rem; background: rgba(15, 23, 42, 0.6); border-bottom: 1px solid rgba(148, 163, 184, 0.2); }
          ul.totals { list-style: none; padding: 0; display: flex; gap: 1rem; margin-bottom: 2rem; }
          ul.totals li { background: rgba(30, 41, 59, 0.75); padding: 0.5rem 0.75rem; border-radius: 0.5rem; }
          table.recent { width: 100%; border-collapse: collapse; margin-top: 1rem; }
          table.recent th, table.recent td { padding: 0.5rem; border-bottom: 1px solid rgba(148, 163, 184, 0.15); }
          table.recent th { text-align: left; font-size: 0.875rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.08em; }
          table.recent td { font-size: 0.9rem; background: rgba(15, 23, 42, 0.4); }
          .mono { font-family: "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 0.8rem; }
          .note { display: block; color: #38bdf8; font-size: 0.8rem; }
          .error { display: block; color: #f87171; font-size: 0.8rem; }
        </style>
      </head>
      <body>
        <h1>Observatory Ingest Watcher</h1>
        <p class="subtitle">Monitoring <code>${snapshot.config.watchRoot}</code> → staging <code>${snapshot.config.stagingDir}</code></p>
        ${metricsTable}
        <ul class="totals">${counts || '<li>No drops yet</li>'}</ul>
        <section>
          <h2>Recent activity</h2>
          <table class="recent">
            <thead>
              <tr>
                <th>Drop</th>
                <th>Status</th>
                <th>Partition</th>
                <th>Files</th>
                <th>Run ID</th>
                <th>Updated</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${recentRows || '<tr><td colspan="7">No activity yet.</td></tr>'}
            </tbody>
          </table>
        </section>
      </body>
    </html>
  `;
}

app.get('/', async (_request, reply) => {
  const snapshot = buildStatsSnapshot();
  reply.header('content-type', 'text/html; charset=utf-8');
  return reply.send(renderDashboard(snapshot));
});

async function bootstrapWatcher(): Promise<void> {
  await ensureDirectoryExists(watchRoot);
  await ensureDirectoryExists(stagingDir);
  await ensureDirectoryExists(archiveDir);
  await ensureDirectoryExists(plotsRoot);
  await ensureDirectoryExists(reportsRoot);

  if (resumeExisting) {
    await enqueueExistingFiles(watchRoot);
  }

  const watcher = chokidar.watch(watchRoot, {
    ignoreInitial: true,
    persistent: true,
    depth: Infinity,
    awaitWriteFinish: {
      stabilityThreshold: debounceMs,
      pollInterval: 200
    }
  });

  watcher.on('add', (filePath) => {
    void registerFile(filePath, 'watch');
  });

  watcher.on('ready', () => {
    watcherReady = true;
    app.log.info(
      {
        watchRoot,
        stagingDir,
        archiveDir,
        plotsDir: plotsRoot,
        reportsDir: reportsRoot,
        publicationWorkflowSlug,
        visualizationAssetId
      },
      'Observatory watcher initialised'
    );
  });

  watcher.on('error', (err) => {
    metrics.lastError = err instanceof Error ? err.message : String(err);
    app.log.error({ err }, 'Watcher error');
  });

  const shutdown = async () => {
    try {
      await watcher.close();
      await app.close();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function start(): Promise<void> {
  await bootstrapWatcher();
  try {
    await app.listen({ port, host });
    app.log.info({ port, host }, 'Observatory file watcher listening');
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start service');
    process.exit(1);
  }
}

void start();

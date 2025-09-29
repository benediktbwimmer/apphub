import Fastify from 'fastify';
import chokidar from 'chokidar';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

type DropStatus = 'queued' | 'launching' | 'launched' | 'completed' | 'failed';

type DropRecord = {
  dropId: string;
  sourcePath: string;
  sourceFiles: string[];
  relativePath: string;
  destinationDir: string;
  destinationFilename: string;
  status: DropStatus;
  observedAt: string;
  updatedAt: string;
  attempts: number;
  runId?: string;
  errorMessage?: string | null;
  success?: {
    destinationPath?: string | null;
    bytesMoved?: number | null;
    durationMs?: number | null;
  };
  observatoryMinute?: string;
};

type DropActivityEntry = {
  dropId: string;
  status: DropStatus;
  runId: string | null;
  source: string;
  destination: string | null;
  bytesMoved: number | null;
  attempts: number;
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
    archiveRoot: string;
    workflowSlug: string;
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
const DEFAULT_ARCHIVE_ROOT = path.resolve(ROOT_DIR, '..', '..', 'data', 'archive');

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function toPosixRelative(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function buildDropId(relativePath: string): string {
  const slug = relativePath
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const idComponent = slug.length > 0 ? slug : 'file';
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `${idComponent}-${Date.now().toString(36)}-${randomSuffix}`;
}

function extractObservatoryMinute(relativePath: string): string | null {
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
const archiveRoot = path.resolve(process.env.FILE_ARCHIVE_DIR ?? DEFAULT_ARCHIVE_ROOT);
const workflowSlug = (process.env.FILE_DROP_WORKFLOW_SLUG ?? 'file-drop-relocation').trim();
const apiBaseUrlRaw = (process.env.CATALOG_API_BASE_URL ?? 'http://127.0.0.1:4000').trim().replace(/\/$/, '');
const apiToken = (process.env.CATALOG_API_TOKEN ?? process.env.FILE_DROP_API_TOKEN ?? '').trim() || null;
const resumeExisting = parseBoolean(process.env.FILE_WATCH_RESUME_EXISTING, true);
const debounceMs = Math.max(200, Math.min(5000, Number.parseInt(process.env.FILE_WATCH_DEBOUNCE_MS ?? '750', 10) || 750));
const maxLaunchAttempts = Math.max(1, Math.min(10, Number.parseInt(process.env.FILE_WATCH_MAX_ATTEMPTS ?? '3', 10) || 3));
const port = Number.parseInt(process.env.PORT ?? '4310', 10) || 4310;
const host = process.env.HOST ?? '0.0.0.0';
const strategy = (process.env.FILE_WATCH_STRATEGY ?? 'relocation').trim().toLowerCase();
const observatoryStagingDir = path.resolve(
  process.env.FILE_WATCH_STAGING_DIR ?? path.join(watchRoot, '..', 'staging')
);
const observatoryTimestoreBaseUrl = (
  process.env.TIMESTORE_BASE_URL ?? 'http://127.0.0.1:4200'
)
  .trim()
  .replace(/\/$/, '');
const observatoryTimestoreDatasetSlug = (
  process.env.TIMESTORE_DATASET_SLUG ?? 'observatory-timeseries'
).trim();
const observatoryTimestoreDatasetName = (
  process.env.TIMESTORE_DATASET_NAME ?? 'Observatory Time Series'
).trim();
const observatoryTimestoreTableName = (
  process.env.TIMESTORE_TABLE_NAME ?? 'observations'
).trim();
const observatoryTimestoreStorageTargetId = (
  process.env.TIMESTORE_STORAGE_TARGET_ID ?? ''
).trim();
const observatoryTimestoreAuthToken = (
  process.env.TIMESTORE_API_TOKEN ?? ''
).trim() || null;
const observatoryMaxFiles = Math.max(
  1,
  Number.parseInt(process.env.FILE_WATCH_MAX_FILES ?? '64', 10) || 64
);
const autoCompleteOnLaunch = parseBoolean(
  process.env.FILE_WATCH_AUTO_COMPLETE,
  strategy === 'observatory'
);

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
    status: record.status,
    runId: record.runId ?? null,
    source: record.relativePath,
    destination: record.success?.destinationPath ?? null,
    bytesMoved: record.success?.bytesMoved ?? null,
    attempts: record.attempts,
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
  releaseRecord(record);
  for (const filePath of record.sourceFiles) {
    sourceToDropId.delete(filePath);
  }
}

async function ensureDirectoryExists(target: string) {
  await mkdir(target, { recursive: true });
}

async function enqueueExistingFiles(targetDir: string) {
  try {
    const entries = await readdir(targetDir, { withFileTypes: true });
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
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return;
    }
    app.log.warn({ err, targetDir }, 'Failed to scan directory for existing files');
  }
}

async function registerFile(filePath: string, source: 'startup' | 'watch') {
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
      app.log.warn({ err, filePath: absolute }, 'Failed to stat candidate file');
    }
    return;
  }

  const relative = path.relative(watchRoot, absolute);
  if (relative.startsWith('..')) {
    return;
  }
  const normalizedRelative = toPosixRelative(relative);
  let dropId = buildDropId(normalizedRelative);
  let observatoryMinute: string | undefined;
  let observatoryMinuteKey: string | undefined;

  if (strategy === 'observatory') {
    const minute = extractObservatoryMinute(normalizedRelative);
    if (!minute) {
      app.log.warn({ filePath: absolute }, 'Skipping file: unable to extract minute partition for observatory workflow');
      return;
    }
    observatoryMinute = minute;
    observatoryMinuteKey = minute.replace(/:/g, '-');
    dropId = `observatory-${observatoryMinuteKey}`;
  }

  sourceToDropId.set(absolute, dropId);

  const existing = drops.get(dropId);
  if (existing) {
    if (!existing.sourceFiles.includes(absolute)) {
      existing.sourceFiles.push(absolute);
    }
    recordActivity(existing, source === 'startup' ? 'Observed additional file for queued drop' : 'Detected additional file for drop');
    return;
  }

  const timestamp = new Date().toISOString();
  const record: DropRecord = {
    dropId,
    sourcePath: absolute,
    sourceFiles: [absolute],
    relativePath: normalizedRelative,
    destinationDir: strategy === 'observatory' ? observatoryStagingDir : archiveRoot,
    destinationFilename: strategy === 'observatory'
      ? `${observatoryMinuteKey ?? path.basename(absolute).replace(/\.csv$/i, '')}.csv`
      : path.basename(absolute),
    status: 'queued',
    observedAt: timestamp,
    updatedAt: timestamp,
    attempts: 0,
    observatoryMinute
  };

  drops.set(dropId, record);
  metrics.filesObserved += 1;
  metrics.lastEventAt = record.observedAt;
  recordActivity(record, source === 'startup' ? 'Queued existing file' : 'Detected new file');

  scheduleLaunch(record, source === 'startup' ? 250 : 50, 1);
}

function scheduleLaunch(record: DropRecord, delayMs: number, attempt: number) {
  const existing = pendingLaunchTimers.get(record.dropId);
  if (existing) {
    clearTimeout(existing);
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

async function launchWorkflow(record: DropRecord, attempt: number) {
  record.status = 'launching';
  record.updatedAt = new Date().toISOString();
  record.attempts = attempt;
  recordActivity(record, attempt > 1 ? `Retrying workflow launch (#${attempt})` : 'Launching workflow');
  metrics.triggerAttempts += 1;

  let body: Record<string, unknown>;
  if (strategy === 'observatory') {
    const minute = record.observatoryMinute ?? extractObservatoryMinute(record.relativePath) ?? new Date().toISOString().slice(0, 16);
    const parameters: Record<string, unknown> = {
      minute,
      inboxDir: watchRoot,
      stagingDir: observatoryStagingDir,
      archiveDir: archiveRoot,
      timestoreBaseUrl: observatoryTimestoreBaseUrl,
      timestoreDatasetSlug: observatoryTimestoreDatasetSlug,
      timestoreDatasetName: observatoryTimestoreDatasetName,
      timestoreTableName: observatoryTimestoreTableName,
      timestoreStorageTargetId: observatoryTimestoreStorageTargetId || undefined,
      timestoreAuthToken: observatoryTimestoreAuthToken ?? undefined,
      maxFiles: observatoryMaxFiles
    };
    const relativeFiles = record.sourceFiles.map((file) =>
      toPosixRelative(path.relative(watchRoot, file))
    );
    body = {
      partitionKey: minute,
      parameters,
      triggeredBy: 'filestore-ingest-watcher',
      trigger: {
        type: 'file-drop',
        options: {
          minute,
          files: relativeFiles
        }
      }
    } satisfies Record<string, unknown>;
  } else {
    body = {
      parameters: {
        dropId: record.dropId,
        sourcePath: record.sourcePath,
        relativePath: record.relativePath,
        destinationDir: record.destinationDir,
        destinationFilename: record.destinationFilename
      },
      triggeredBy: 'file-drop-watcher',
      trigger: {
        type: 'file-drop',
        options: {
          dropId: record.dropId,
          relativePath: record.relativePath
        }
      }
    } satisfies Record<string, unknown>;
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };
  if (apiToken) {
    headers.authorization = `Bearer ${apiToken}`;
  }

  try {
    const response = await fetch(`${apiBaseUrlRaw}/workflows/${workflowSlug}/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`API responded with status ${response.status}`);
    }
    const payload = (await response.json()) as { data?: { id?: string; status?: string } };
    record.runId = typeof payload?.data?.id === 'string' ? payload.data.id : undefined;
    record.updatedAt = new Date().toISOString();
    record.errorMessage = null;
    metrics.launches += 1;
    metrics.lastEventAt = record.updatedAt;
    if (autoCompleteOnLaunch) {
      record.status = 'completed';
      metrics.completions += 1;
      recordActivity(record, 'Workflow run launched (auto-completed)');
      releaseRecord(record);
    } else {
      record.status = 'launched';
      recordActivity(record, 'Workflow run launched');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    metrics.triggerFailures += 1;
    metrics.lastError = message;
    record.errorMessage = message;
    record.updatedAt = new Date().toISOString();
    if (attempt < maxLaunchAttempts) {
      scheduleLaunch(record, Math.min(10_000, 1_500 * attempt), attempt + 1);
      app.log.warn({ dropId: record.dropId, attempt, error: message }, 'Retrying workflow launch');
      return;
    }
    record.status = 'failed';
    recordActivity(record, `Launch failed permanently: ${message}`);
    releaseRecord(record);
    app.log.error({ dropId: record.dropId, error: message }, 'Failed to launch workflow after retries');
  }
}

function buildStatsSnapshot(): StatsSnapshot {
  const totals: Record<DropStatus, number> = {
    queued: 0,
    launching: 0,
    launched: 0,
    completed: 0,
    failed: 0
  };
  for (const record of drops.values()) {
    totals[record.status] += 1;
  }
  const activeDrops = totals.launching + totals.launched;

  return {
    config: {
      watchRoot,
      archiveRoot,
      workflowSlug,
      apiBaseUrl: apiBaseUrlRaw,
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

app.get('/healthz', async () => {
  return {
    status: 'ok',
    watcher: {
      ready: watcherReady,
      observed: metrics.filesObserved,
      lastError: metrics.lastError
    }
  };
});

app.get('/api/stats', async () => buildStatsSnapshot());

app.post('/api/drops/:dropId/complete', async (request, reply) => {
  const params = request.params as { dropId?: string };
  const dropId = (params.dropId ?? '').trim();
  if (!dropId) {
    reply.status(400);
    return { error: 'dropId is required' };
  }
  const record = drops.get(dropId);
  if (!record) {
    reply.status(404);
    return { error: 'drop not found' };
  }

  const body = (request.body ?? {}) as {
    runId?: string;
    status?: string;
    file?: {
      destinationPath?: string;
      bytesMoved?: number;
      durationMs?: number;
    };
  };

  const outcome = typeof body.status === 'string' ? body.status.trim().toLowerCase() : 'succeeded';
  const success = outcome === 'succeeded' || outcome === 'success' || outcome === 'completed';

  record.status = success ? 'completed' : 'failed';
  record.runId = typeof body.runId === 'string' ? body.runId : record.runId;
  record.success = {
    destinationPath:
      typeof body.file?.destinationPath === 'string'
        ? body.file.destinationPath
        : record.success?.destinationPath ?? record.destinationDir,
    bytesMoved: typeof body.file?.bytesMoved === 'number' ? body.file.bytesMoved : record.success?.bytesMoved ?? null,
    durationMs: typeof body.file?.durationMs === 'number' ? body.file.durationMs : record.success?.durationMs ?? null
  };
  record.errorMessage = success ? null : record.errorMessage ?? 'Workflow reported failure';
  record.updatedAt = new Date().toISOString();
  if (success) {
    metrics.completions += 1;
  } else {
    metrics.runFailures += 1;
    metrics.lastError = record.errorMessage;
  }
  metrics.lastEventAt = record.updatedAt;
  sourceToDropId.delete(record.sourcePath);
  recordActivity(record, success ? 'Relocation complete' : 'Workflow reported failure');

  const pendingTimer = pendingLaunchTimers.get(record.dropId);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingLaunchTimers.delete(record.dropId);
  }

  return { ok: true };
});

function renderDashboard(snapshot: StatsSnapshot): string {
  const totals = snapshot.totals;
  const metricsTable = `
    <table class="metrics">
      <tbody>
        <tr><th>Watched directory</th><td>${snapshot.config.watchRoot}</td></tr>
        <tr><th>Archive directory</th><td>${snapshot.config.archiveRoot}</td></tr>
        <tr><th>Workflow slug</th><td>${snapshot.config.workflowSlug}</td></tr>
        <tr><th>API base URL</th><td>${snapshot.config.apiBaseUrl}</td></tr>
        <tr><th>Files observed</th><td>${snapshot.metrics.filesObserved}</td></tr>
        <tr><th>Runs launched</th><td>${snapshot.metrics.launches}</td></tr>
        <tr><th>Trigger attempts</th><td>${snapshot.metrics.triggerAttempts}</td></tr>
        <tr><th>Trigger failures</th><td>${snapshot.metrics.triggerFailures}</td></tr>
        <tr><th>Run failures</th><td>${snapshot.metrics.runFailures}</td></tr>
        <tr><th>Completions</th><td>${snapshot.metrics.completions}</td></tr>
        <tr><th>Active drops</th><td>${snapshot.watcher.activeDrops}</td></tr>
        <tr><th>Watcher ready</th><td>${snapshot.watcher.ready ? 'yes' : 'no'}</td></tr>
        <tr><th>Last event</th><td>${snapshot.metrics.lastEventAt ?? '—'}</td></tr>
        <tr><th>Last error</th><td>${snapshot.metrics.lastError ?? '—'}</td></tr>
      </tbody>
    </table>
  `;

  const countsList = `
    <ul class="totals">
      <li>Queued: ${totals.queued}</li>
      <li>Launching: ${totals.launching}</li>
      <li>Launched: ${totals.launched}</li>
      <li>Completed: ${totals.completed}</li>
      <li>Failed: ${totals.failed}</li>
    </ul>
  `;

  const recentRows = snapshot.recent
    .map((entry) => {
      const note = entry.note ? `<span class="note">${entry.note}</span>` : '';
      const error = entry.error ? `<span class="error">${entry.error}</span>` : '';
      return `
        <tr>
          <td class="mono">${entry.dropId}</td>
          <td>${entry.status}</td>
          <td>${entry.source}</td>
          <td>${entry.destination ?? '—'}</td>
          <td>${entry.bytesMoved ?? '—'}</td>
          <td>${entry.runId ?? '—'}</td>
          <td>${entry.attempts}</td>
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
        <title>File Drop Watcher</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; background: #0f172a; color: #e2e8f0; }
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
        <h1>File Drop Watcher</h1>
        <p class="subtitle">Monitoring <code>${snapshot.config.watchRoot}</code> → <code>${snapshot.config.archiveRoot}</code></p>
        ${metricsTable}
        ${countsList}
        <section>
          <h2>Recent activity</h2>
          <table class="recent">
            <thead>
              <tr>
                <th>Drop</th>
                <th>Status</th>
                <th>Source</th>
                <th>Destination</th>
                <th>Bytes</th>
                <th>Run ID</th>
                <th>Attempts</th>
                <th>Updated</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${recentRows || '<tr><td colspan="9">No activity yet.</td></tr>'}
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

async function bootstrapWatcher() {
  await ensureDirectoryExists(watchRoot);
  await ensureDirectoryExists(archiveRoot);

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
    app.log.info({ watchRoot, archiveRoot }, 'File watcher initialised');
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

async function start() {
  await bootstrapWatcher();
  try {
    await app.listen({ port, host });
    app.log.info({ port, host }, 'File drop watcher service listening');
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start service');
    process.exit(1);
  }
}

void start();

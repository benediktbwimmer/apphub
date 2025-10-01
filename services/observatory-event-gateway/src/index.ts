import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import chokidar from 'chokidar';
import pino from 'pino';
import { FilestoreClient, FilestoreClientError } from '@apphub/filestore-client';

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

const logLevel = process.env.LOG_LEVEL ?? 'info';
const logger = pino({ level: logLevel });

const watchRoot = path.resolve(process.env.WATCH_ROOT ?? path.join(process.cwd(), 'data', 'ingest'));
const archiveRoot = process.env.WATCH_ARCHIVE_DIR ? path.resolve(process.env.WATCH_ARCHIVE_DIR) : null;
const deleteAfterUpload = parseBoolean(process.env.WATCH_DELETE_AFTER_UPLOAD, false);
const overwriteExisting = parseBoolean(process.env.WATCH_OVERWRITE ?? process.env.WATCH_OVERWRITE_EXISTING, false);
const stabilityMs = Number.parseInt(process.env.WATCH_STABILITY_MS ?? '750', 10) || 750;
const maxConcurrency = Math.max(1, Number.parseInt(process.env.WATCH_CONCURRENCY ?? '4', 10) || 4);
const host = process.env.HOST ?? '0.0.0.0';
const port = Number.parseInt(process.env.PORT ?? '4310', 10) || 4310;
const targetPrefixRaw = process.env.FILESTORE_TARGET_PREFIX ?? '';
const targetPrefix = targetPrefixRaw.replace(/^\/+|\/+$/g, '');
const principal = process.env.FILESTORE_PRINCIPAL?.trim();

const backendMountId = Number.parseInt(process.env.FILESTORE_BACKEND_ID ?? '', 10);
if (!Number.isFinite(backendMountId)) {
  logger.error('FILESTORE_BACKEND_ID must be set to a numeric backend mount id');
  process.exit(1);
}

const filestoreBaseUrl = process.env.FILESTORE_BASE_URL ?? process.env.APPHUB_FILESTORE_BASE_URL ?? 'http://127.0.0.1:4300';
const filestoreToken = process.env.FILESTORE_TOKEN ?? process.env.APPHUB_FILESTORE_TOKEN;

const client = new FilestoreClient({
  baseUrl: filestoreBaseUrl,
  token: filestoreToken ? filestoreToken.trim() : undefined,
  userAgent: 'observatory-event-gateway/0.1.0'
});

const ensuredRemoteDirectories = new Set<string>();

const metrics = {
  startedAt: new Date().toISOString(),
  filesQueued: 0,
  filesUploaded: 0,
  bytesUploaded: 0,
  filesFailed: 0,
  lastError: null as null | { message: string; path?: string; at: string },
  lastUpload: null as null | { path: string; at: string; size: number },
  queueDepth: 0
};

const recentUploads: Array<{ path: string; size: number; uploadedAt: string }> = [];
const maxRecent = 25;

const queue: string[] = [];
const active = new Set<string>();

async function ensureLocalDirectories(): Promise<void> {
  await mkdir(watchRoot, { recursive: true });
  if (archiveRoot) {
    await mkdir(archiveRoot, { recursive: true });
  }
}

async function ensureRemoteDirectory(targetPath: string): Promise<void> {
  const parent = path.posix.dirname(targetPath);
  if (!parent || parent === '.' || ensuredRemoteDirectories.has(parent)) {
    return;
  }
  const segments = parent.split('/').filter((segment) => segment.length > 0);
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (ensuredRemoteDirectories.has(current)) {
      continue;
    }
    try {
      await client.createDirectory({
        backendMountId,
        path: current,
        idempotencyKey: `watcher-${backendMountId}-${current}`,
        principal
      });
    } catch (error) {
      if (error instanceof FilestoreClientError && error.code === 'NODE_EXISTS') {
        // Idempotent - ignore.
      } else {
        throw error;
      }
    }
    ensuredRemoteDirectories.add(current);
  }
}

function recordUpload(pathRelative: string, sizeBytes: number): void {
  metrics.filesUploaded += 1;
  metrics.bytesUploaded += sizeBytes;
  metrics.lastUpload = {
    path: pathRelative,
    at: new Date().toISOString(),
    size: sizeBytes
  };
  recentUploads.unshift({ path: pathRelative, size: sizeBytes, uploadedAt: metrics.lastUpload.at });
  while (recentUploads.length > maxRecent) {
    recentUploads.pop();
  }
}

function recordError(message: string, filePath?: string, error?: unknown): void {
  const details = error instanceof Error ? error.message : error;
  metrics.filesFailed += 1;
  metrics.lastError = {
    message: message + (details ? `: ${details}` : ''),
    path: filePath,
    at: new Date().toISOString()
  };
  logger.error({ filePath, err: error }, message);
}

async function archiveOrDelete(filePath: string, relativePath: string): Promise<void> {
  if (archiveRoot) {
    const destination = path.resolve(archiveRoot, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(filePath, destination);
    return;
  }
  if (deleteAfterUpload) {
    await unlink(filePath).catch((err) => {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    });
  }
}

async function uploadFile(filePath: string): Promise<void> {
  let stats;
  try {
    stats = await stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }

  if (!stats.isFile()) {
    return;
  }

  const relativePath = path.relative(watchRoot, filePath);
  if (relativePath.startsWith('..')) {
    return;
  }
  const normalizedRelative = toPosix(relativePath);
  const baseSegments = targetPrefix
    ? targetPrefix.split('/').filter((segment) => segment.length > 0)
    : [];
  const targetPath = [...baseSegments, ...normalizedRelative.split('/').filter((segment) => segment.length > 0)].join('/');

  await ensureRemoteDirectory(targetPath);

  const stream = createReadStream(filePath);
  await client.uploadFile({
    backendMountId,
    path: targetPath,
    content: stream,
    contentLength: stats.size,
    overwrite: overwriteExisting,
    principal
  });

  recordUpload(normalizedRelative, Number(stats.size));
  await archiveOrDelete(filePath, relativePath);
}

function enqueue(filePath: string): void {
  if (queue.includes(filePath) || active.has(filePath)) {
    return;
  }
  queue.push(filePath);
  metrics.filesQueued += 1;
  metrics.queueDepth = queue.length + active.size;
  void processQueue();
}

async function processQueue(): Promise<void> {
  while (active.size < maxConcurrency && queue.length > 0) {
    const nextPath = queue.shift();
    if (!nextPath) {
      break;
    }
    active.add(nextPath);
    metrics.queueDepth = queue.length + active.size;
    void (async () => {
      try {
        await uploadFile(nextPath);
      } catch (error) {
        recordError('Failed to upload file', nextPath, error);
      } finally {
        active.delete(nextPath);
        metrics.queueDepth = queue.length + active.size;
        void processQueue();
      }
    })();
  }
}

async function startWatcher(): Promise<void> {
  await ensureLocalDirectories();
  logger.info({ watchRoot, archiveRoot, maxConcurrency, targetPrefix }, 'Starting observatory event gateway');

  const watcher = chokidar.watch(watchRoot, {
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: stabilityMs,
      pollInterval: 200
    }
  });

  watcher.on('add', (filePath: string) => enqueue(path.resolve(filePath)));
  watcher.on('error', (error: Error) => {
    recordError('Watcher encountered an error', undefined, error);
  });
  watcher.on('ready', () => {
    logger.info('Initial filesystem scan complete');
  });

  const shutdown = async () => {
    await watcher.close().catch(() => undefined);
    logger.info('Watcher shut down');
  };

  process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));
}

async function startServer(): Promise<void> {
  const app = Fastify({ logger });

  app.get('/healthz', async () => ({ status: 'ok', queueDepth: metrics.queueDepth, lastError: metrics.lastError }));
  app.get('/status', async () => ({
    config: {
      watchRoot,
      archiveRoot,
      backendMountId,
      targetPrefix,
      baseUrl: filestoreBaseUrl,
      deleteAfterUpload,
      overwriteExisting,
      maxConcurrency
    },
    metrics,
    recentUploads
  }));

  await app.listen({ host, port });
  logger.info({ host, port }, 'HTTP status server listening');
}

async function main(): Promise<void> {
  await Promise.all([startWatcher(), startServer()]);
}

main().catch((error) => {
  logger.error({ err: error }, 'observatory event gateway failed to start');
  process.exitCode = 1;
});

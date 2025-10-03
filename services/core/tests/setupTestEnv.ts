import { randomUUID } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import EmbeddedPostgres from 'embedded-postgres';

const ipcDir = path.join(tmpdir(), 'apphub-tsx-ipc');
try {
  fs.mkdirSync(ipcDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(ipcDir, 0o700);
} catch {
  // best effort
}

process.env.APPHUB_EVENTS_MODE = 'inline';
process.env.APPHUB_ALLOW_INLINE_MODE = '1';
process.env.REDIS_URL = 'inline';
process.env.TSX_UNSAFE_HOOKS = '1';
process.env.TSX_IPC_HOOK_PATH = path.join(ipcDir, `ipc-${randomUUID()}.sock`);
process.env.APPHUB_DISABLE_ANALYTICS = '1';
process.env.APPHUB_ANALYTICS_INTERVAL_MS = '0';
process.env.APPHUB_DISABLE_SERVICE_POLLING = '1';

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

let shuttingDown = false;
let embeddedPostgres: EmbeddedPostgres | null = null;
let embeddedCleanup: (() => Promise<void>) | null = null;
let embeddedReady: Promise<void> | null = null;
let clientModulePromise: Promise<typeof import('../src/db/client')> | null = null;
let eventsModulePromise: Promise<typeof import('../src/events')> | null = null;

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address) {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to determine available port')));
      }
    });
  });
}

async function startEmbeddedPostgres(): Promise<void> {
  if (embeddedPostgres) {
    return;
  }

  const dataRoot = await mkdtemp(path.join(tmpdir(), 'apphub-core-pg-'));
  const port = await findAvailablePort();

  const postgres = new EmbeddedPostgres({
    databaseDir: dataRoot,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false
  });

  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('apphub');

  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.PGPOOL_MAX = process.env.PGPOOL_MAX ?? '8';

  embeddedCleanup = async () => {
    try {
      await postgres.stop();
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  };
  embeddedPostgres = postgres;
}

export function ensureEmbeddedPostgres(): Promise<void> {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
    return Promise.resolve();
  }
  if (!embeddedReady) {
    embeddedReady = startEmbeddedPostgres().catch((error) => {
      // eslint-disable-next-line no-console
      console.error('[tests] failed to start embedded postgres', error);
      throw error;
    });
  }
  return embeddedReady;
}

async function shutdownResources(): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  try {
    await embeddedReady;
  } catch {
    // ignore startup failures on shutdown
  }
  try {
    if (!eventsModulePromise) {
      eventsModulePromise = import('../src/events');
    }
    const { shutdownApphubEvents } = await eventsModulePromise;
    await shutdownApphubEvents();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[tests] failed to shutdown event bus cleanly', error);
  }
  try {
    if (!clientModulePromise) {
      clientModulePromise = import('../src/db/client');
    }
    const { closePool } = await clientModulePromise;
    await closePool();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[tests] failed to close postgres pool cleanly', error);
  }
  try {
    const cleanup = embeddedCleanup;
    embeddedCleanup = null;
    embeddedPostgres = null;
    if (cleanup) {
      await cleanup();
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[tests] failed to stop embedded postgres cleanly', error);
  }
}

process.once('beforeExit', () => {
  void shutdownResources();
});

after(async () => {
  await shutdownResources();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdownResources().finally(() => {
      process.exit();
    });
  });
}

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

export type TimestoreTestServer = {
  port: number;
  url: string;
  storageRoot: string;
  close: () => Promise<void>;
};

async function findAvailablePort(): Promise<number> {
  const net = await import('node:net');
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

function applyEnv(updates: Record<string, string>): () => void {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(updates)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  return () => {
    for (const [key, prev] of Object.entries(previous)) {
      if (prev === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev;
      }
    }
  };
}

export async function startTimestoreTestServer(options: {
  databaseUrl: string;
  redisUrl?: string;
  keepStorageRoot?: boolean;
}): Promise<TimestoreTestServer> {
  const port = await findAvailablePort();
  const storageRoot = await mkdtemp(path.join(tmpdir(), 'timestore-storage-test-'));
  const schema = `timestore_test_${randomUUID().slice(0, 8)}`;
  const envRestore = applyEnv({
    TIMESTORE_HOST: '127.0.0.1',
    TIMESTORE_PORT: String(port),
    TIMESTORE_LOG_LEVEL: 'fatal',
    TIMESTORE_DATABASE_URL: options.databaseUrl,
    TIMESTORE_PG_SCHEMA: schema,
    TIMESTORE_PGPOOL_MAX: '4',
    TIMESTORE_STORAGE_ROOT: storageRoot,
    TIMESTORE_STORAGE_DRIVER: 'local',
    TIMESTORE_LIFECYCLE_ENABLED: '0',
    TIMESTORE_LIFECYCLE_EXPORTS_ENABLED: '0'
  });
  const restoreRedis = options.redisUrl
    ? applyEnv({ REDIS_URL: options.redisUrl })
    : () => {};

  try {
    const { resetCachedServiceConfig, loadServiceConfig } = await import('../../../services/timestore/src/config/serviceConfig');
    resetCachedServiceConfig();
    const config = loadServiceConfig();
    const { default: fastify } = await import('fastify');
    const app: FastifyInstance = fastify({ logger: false });

    const [{ registerHealthRoutes }, { registerIngestionRoutes }, { registerQueryRoutes }, { registerAdminRoutes }] = await Promise.all([
      import('../../../services/timestore/src/routes/health'),
      import('../../../services/timestore/src/routes/ingest'),
      import('../../../services/timestore/src/routes/query'),
      import('../../../services/timestore/src/routes/admin')
    ]);

    const [{ ensureSchemaExists }, { runMigrations }, { ensureDefaultStorageTarget }] = await Promise.all([
      import('../../../services/timestore/src/db/schema'),
      import('../../../services/timestore/src/db/migrations'),
      import('../../../services/timestore/src/service/bootstrap')
    ]);

    const [{ closePool }] = await Promise.all([import('../../../services/timestore/src/db/client')]);
    const { closeLifecycleQueue } = await import('../../../services/timestore/src/lifecycle/queue');

    await registerHealthRoutes(app);
    await registerIngestionRoutes(app);
    await registerQueryRoutes(app);
    await registerAdminRoutes(app);

    app.addHook('onClose', async () => {
      await Promise.all([closeLifecycleQueue(), closePool()]);
    });

    await ensureSchemaExists(config.database.schema);
    await runMigrations();
    await ensureDefaultStorageTarget();

    await app.listen({ port: config.port, host: config.host });

    return {
      port,
      url: `http://${config.host}:${config.port}`,
      storageRoot,
      close: async () => {
        try {
          await app.close();
        } finally {
          resetCachedServiceConfig();
          if (!options.keepStorageRoot) {
            await rm(storageRoot, { recursive: true, force: true });
          }
          envRestore();
          restoreRedis();
        }
      }
    } satisfies TimestoreTestServer;
  } catch (err) {
    envRestore();
    restoreRedis();
    await rm(storageRoot, { recursive: true, force: true });
    throw err;
  }
}

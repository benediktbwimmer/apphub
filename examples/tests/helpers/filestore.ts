import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

export type FilestoreTestServer = {
  port: number;
  url: string;
  schema: string;
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
        server.close(() => reject(new Error('Failed to resolve port for filestore test server')));
      }
    });
  });
}

function applyEnv(values: Record<string, string>): () => void {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  return () => {
    for (const [key, original] of Object.entries(previous)) {
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  };
}

export async function startFilestoreTestServer(options: {
  databaseUrl: string;
  redisUrl?: string;
}): Promise<FilestoreTestServer> {
  const eventsMode = options.redisUrl && options.redisUrl.trim().toLowerCase() !== 'inline' ? 'redis' : 'inline';
  const port = await findAvailablePort();
  const schema = `filestore_test_${Date.now().toString(36)}`;
  const envRestore = applyEnv({
    FILESTORE_HOST: '127.0.0.1',
    FILESTORE_PORT: String(port),
    FILESTORE_LOG_LEVEL: process.env.FILESTORE_LOG_LEVEL ?? 'fatal',
    FILESTORE_DATABASE_URL: options.databaseUrl,
    FILESTORE_PG_SCHEMA: schema,
    FILESTORE_PGPOOL_MAX: '4',
    FILESTORE_METRICS_ENABLED: '0',
    FILESTORE_REDIS_URL: options.redisUrl ?? 'inline',
    FILESTORE_EVENTS_MODE: eventsMode
  });

  const [dbClientModule, serviceConfigModule] = await Promise.all([
    import('../../../services/filestore/src/db/client'),
    import('../../../services/filestore/src/config/serviceConfig')
  ]);
  await dbClientModule.resetPool();
  const config = dbClientModule.getActiveConfig();

  const [{ buildApp }] = await Promise.all([
    import('../../../services/filestore/src/app')
  ]);

  const { app } = await buildApp({ config });

  const { closePool } = dbClientModule;

  await app.listen({ host: config.host, port: config.port });

  return {
    port: config.port,
    url: `http://${config.host}:${config.port}`,
    schema,
    close: async () => {
      try {
        await app.close();
      } finally {
        try {
          await closePool();
        } catch (error) {
          if (!(error instanceof Error) || !/Called end on pool more than once/i.test(error.message)) {
            throw error;
          }
        }
        serviceConfigModule.resetCachedServiceConfig();
        envRestore();
      }
    }
  } satisfies FilestoreTestServer;
}

import fastify from 'fastify';
import { closePool, POSTGRES_SCHEMA } from './db/client';
import { ensureSchemaExists } from './db/schema';
import { runMigrations } from './db/migrations';
import { loadServiceConfig } from './config/serviceConfig';
import { registerHealthRoutes } from './routes/health';
import { registerIngestionRoutes } from './routes/ingest';
import { registerQueryRoutes } from './routes/query';
import { ensureDefaultStorageTarget } from './service/bootstrap';

async function start(): Promise<void> {
  const config = loadServiceConfig();
  const app = fastify({
    logger: {
      level: config.logLevel
    }
  });

  await registerHealthRoutes(app);
  await registerIngestionRoutes(app);
  await registerQueryRoutes(app);

  app.addHook('onClose', async () => {
    await closePool();
  });

  await ensureSchemaExists(POSTGRES_SCHEMA);
  await runMigrations();
  await ensureDefaultStorageTarget();

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(
      {
        host: config.host,
        port: config.port,
        schema: POSTGRES_SCHEMA,
        storage: config.storage
      },
      'timestore service listening'
    );
  } catch (err) {
    app.log.error({ err }, 'failed to start timestore');
    await app.close();
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down timestore');
    try {
      await app.close();
    } catch (closeErr) {
      app.log.error({ err: closeErr }, 'error during shutdown');
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

start().catch(async (err) => {
  console.error('[timestore] fatal startup error', err);
  try {
    await closePool();
  } catch (closeErr) {
    console.error('[timestore] failed to close postgres pool after startup failure', closeErr);
  }
  process.exit(1);
});

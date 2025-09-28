import fastify from 'fastify';
import { closePool, POSTGRES_SCHEMA } from './db/client';
import { ensureSchemaExists } from './db/schema';
import { runMigrations } from './db/migrations';
import { loadServiceConfig } from './config/serviceConfig';
import { registerHealthRoutes } from './routes/health';
import { registerIngestionRoutes } from './routes/ingest';
import { registerQueryRoutes } from './routes/query';
import { registerAdminRoutes } from './routes/admin';
import { registerSqlRoutes } from './routes/sql';
import { ensureDefaultStorageTarget } from './service/bootstrap';
import { closeLifecycleQueue } from './lifecycle/queue';
import { timestoreMetricsPlugin } from './observability/metricsPlugin';
import { setupTracing } from './observability/tracing';
import { initializeFilestoreActivity, shutdownFilestoreActivity } from './filestore/consumer';
import { shutdownManifestCache } from './cache/manifestCache';
import { initializeIngestionConnectors, shutdownIngestionConnectors } from './ingestion/connectors';

async function start(): Promise<void> {
  const config = loadServiceConfig();
  setupTracing(config.observability.tracing);
  const app = fastify({
    logger: {
      level: config.logLevel
    }
  });

  await app.register(timestoreMetricsPlugin, {
    metrics: {
      enabled: config.observability.metrics.enabled,
      collectDefaultMetrics: config.observability.metrics.collectDefaultMetrics,
      prefix: config.observability.metrics.prefix,
      scope: config.observability.metrics.scope
    }
  });

  await registerHealthRoutes(app);
  await registerIngestionRoutes(app);
  await registerQueryRoutes(app);
  await registerAdminRoutes(app);
  await registerSqlRoutes(app);

  app.addHook('onClose', async () => {
    await closePool();
    await closeLifecycleQueue();
    await shutdownManifestCache();
    await shutdownFilestoreActivity();
    await shutdownIngestionConnectors();
  });

  await ensureSchemaExists(POSTGRES_SCHEMA);
  await runMigrations();
  await ensureDefaultStorageTarget();
  await initializeFilestoreActivity({ config, logger: app.log });
  await initializeIngestionConnectors({ config, logger: app.log });

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

import fastify from 'fastify';
import { loadServiceConfig, type ServiceConfig } from './config/serviceConfig';
import { metricsPlugin } from './plugins/metrics';
import { registerSystemRoutes } from './routes/system';
import { ensureSchemaExists } from './db/schema';
import { POSTGRES_SCHEMA, closePool } from './db/client';
import { runMigrationsWithConnection } from './db/migrations';

export type BuildAppOptions = {
  config?: ServiceConfig;
};

export async function buildApp(options?: BuildAppOptions) {
  const config = options?.config ?? loadServiceConfig();

  const app = fastify({
    logger: {
      level: config.logLevel
    }
  });

  await app.register(metricsPlugin, { enabled: config.metricsEnabled });
  await registerSystemRoutes(app);

  app.addHook('onReady', async () => {
    await ensureSchemaExists(POSTGRES_SCHEMA);
    await runMigrationsWithConnection();
  });

  app.addHook('onClose', async () => {
    await closePool();
  });

  return { app, config };
}

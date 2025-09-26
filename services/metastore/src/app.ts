import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { loadServiceConfig } from './config/serviceConfig';
import { authPlugin } from './auth/plugin';
import { metricsPlugin } from './plugins/metrics';
import { registerSystemRoutes } from './routes/system';
import { closePool, ensureSchemaReady } from './db/client';
import { openApiDocument } from './openapi/document';
import { registerRecordRoutes } from './routes/records';
import { registerAdminRoutes } from './routes/admin';

export type BuildAppOptions = {
  config?: ReturnType<typeof loadServiceConfig>;
};

export async function buildApp(options?: BuildAppOptions) {
  const config = options?.config ?? loadServiceConfig();

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info'
    }
  });

  await app.register(cors, {
    origin: true,
    credentials: true
  });

  await app.register(swagger, {
    mode: 'static',
    specification: {
      document: openApiDocument
    }
  });

  await app.register(swaggerUI, {
    routePrefix: '/docs',
    staticCSP: true,
    uiConfig: {
      docExpansion: 'list'
    }
  });

  await app.register(authPlugin, { config });
  await app.register(metricsPlugin, { enabled: config.metricsEnabled });

  await registerSystemRoutes(app);
  await registerRecordRoutes(app);
  await registerAdminRoutes(app);

  app.get('/openapi.json', async () => openApiDocument);

  app.addHook('onReady', async () => {
    await ensureSchemaReady();
  });

  app.addHook('onClose', async () => {
    await closePool();
  });

  return { app, config };
}

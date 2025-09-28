import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import { loadServiceConfig } from './config/serviceConfig';
import { authPlugin } from './auth/plugin';
import { metricsPlugin } from './plugins/metrics';
import { registerSystemRoutes } from './routes/system';
import { closePool, ensureSchemaReady } from './db/client';
import { openApiDocument } from './openapi/document';
import { registerRecordRoutes } from './routes/records';
import { registerNamespaceRoutes } from './routes/namespaces';
import { registerAdminRoutes } from './routes/admin';
import { registerStreamRoutes } from './routes/stream';
import { registerFilestoreRoutes } from './routes/filestore';
import { initializeFilestoreSync, shutdownFilestoreSync } from './filestore/consumer';
import { registerSchemaRoutes } from './routes/schemas';
import {
  configureSchemaRegistry,
  startSchemaRegistryRefresh,
  stopSchemaRegistryRefresh
} from './schemaRegistry/service';

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

  await app.register(websocket, {
    options: {
      maxPayload: 1_048_576
    }
  });

  await app.register(authPlugin, { config });
  await app.register(metricsPlugin, { enabled: config.metricsEnabled });

  configureSchemaRegistry({
    ttlMs: config.schemaRegistry.cacheTtlMs,
    refreshAheadMs: config.schemaRegistry.refreshAheadMs,
    refreshIntervalMs: config.schemaRegistry.refreshIntervalMs,
    negativeTtlMs: config.schemaRegistry.negativeCacheTtlMs
  });

  await registerSystemRoutes(app);
  await registerRecordRoutes(app, config);
  await registerNamespaceRoutes(app);
  await registerAdminRoutes(app);
  await registerFilestoreRoutes(app);
  await registerStreamRoutes(app);
  await registerSchemaRoutes(app, config);

  app.get('/openapi.json', async () => openApiDocument);

  app.addHook('onReady', async () => {
    await ensureSchemaReady();
    await initializeFilestoreSync({ config, logger: app.log, metrics: app.metrics });
    startSchemaRegistryRefresh(app.log);
  });

  app.addHook('onClose', async () => {
    await shutdownFilestoreSync();
    stopSchemaRegistryRefresh();
    await closePool();
  });

  return { app, config };
}

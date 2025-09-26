import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { initializeServiceRegistry } from './serviceRegistry';
import { stopAnalyticsSnapshots } from './events';
import { registerCoreRoutes } from './routes/core';
import { registerAuthRoutes } from './routes/auth';
import { registerJobRoutes } from './routes/jobs';
import { registerJobBundleRoutes } from './routes/jobBundles';
import { registerJobImportRoutes } from './routes/jobImports';
import { registerAiRoutes } from './routes/ai';
import { registerWorkflowRoutes } from './routes/workflows';
import { registerAssetRoutes } from './routes/assets';
import { registerServiceRoutes } from './routes/services';
import { registerRepositoryRoutes } from './routes/repositories';
import { registerAdminRoutes } from './routes/admin';
import { openApiDocument } from './openapi/document';
import { registerServiceProxyRoutes } from './routes/serviceProxy';

export async function buildServer() {
  const app = Fastify();

  await app.register(cors, {
    origin: true,
    credentials: true
  });

  await app.register(cookie);

  await app.register(websocket, {
    options: {
      maxPayload: 1_048_576
    }
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
      docExpansion: 'list',
      deepLinking: true
    }
  });

  const registry = await initializeServiceRegistry();

  app.addHook('onClose', async () => {
    registry.stop();
    stopAnalyticsSnapshots();
  });

  app.get('/openapi.json', async () => openApiDocument);

  await app.register(async (instance) => registerCoreRoutes(instance));
  await app.register(async (instance) => registerAuthRoutes(instance));
  await app.register(async (instance) => registerJobRoutes(instance));
  await app.register(async (instance) => registerJobBundleRoutes(instance));
  await app.register(async (instance) => registerJobImportRoutes(instance));
  await app.register(async (instance) => registerAiRoutes(instance));
  await app.register(async (instance) => registerWorkflowRoutes(instance));
  await app.register(async (instance) => registerAssetRoutes(instance));
  await app.register(async (instance) => registerServiceRoutes(instance, { registry }));
  await app.register(async (instance) =>
    registerServiceProxyRoutes(instance, [
      {
        slug: 'metastore',
        basePath: '/metastore',
        forwardedScopes: ['metastore:read', 'metastore:write', 'metastore:delete', 'metastore:admin']
      },
      {
        slug: 'timestore',
        basePath: '/timestore',
        forwardedScopes: [
          'timestore:read',
          'timestore:write',
          'timestore:admin',
          'timestore:sql:read',
          'timestore:sql:exec',
          'timestore:metrics'
        ]
      },
      {
        slug: 'filestore',
        basePath: '/filestore',
        forwardedScopes: ['filestore:read', 'filestore:write', 'filestore:admin']
      }
    ])
  );
  await app.register(async (instance) => registerRepositoryRoutes(instance));
  await app.register(async (instance) => registerAdminRoutes(instance));

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? '::';

  buildServer()
    .then((app) => {
      app
        .listen({ port, host })
        .then(() => {
          app.log.info(`Catalog API listening on http://${host}:${port}`);
        })
        .catch((err) => {
          app.log.error(err);
          process.exit(1);
        });
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

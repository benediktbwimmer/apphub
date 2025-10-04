import { promises as fs } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';

process.env.APPHUB_ALLOW_INLINE_MODE = process.env.APPHUB_ALLOW_INLINE_MODE ?? 'true';
process.env.APPHUB_EVENTS_MODE = process.env.APPHUB_EVENTS_MODE ?? 'inline';
process.env.APPHUB_DISABLE_ANALYTICS = process.env.APPHUB_DISABLE_ANALYTICS ?? 'true';

async function generateOpenApiSpec() {
  const app = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        strict: false
      }
    }
  });

  const [
    { registerOpenApi },
    { registerCoreRoutes },
    { registerAuthRoutes },
    { registerJobRoutes },
    { registerJobBundleRoutes },
    { registerJobImportRoutes },
    { registerModuleRoutes },
    { registerAiRoutes },
    { registerWorkflowRoutes },
    { registerAssetRoutes },
    { registerServiceRoutes },
    { registerRepositoryRoutes },
    { registerAdminRoutes },
    { registerServiceProxyRoutes },
    { registerSavedSearchRoutes },
    { registerEventSavedViewRoutes },
    { registerObservatoryRoutes }
  ] = await Promise.all([
    import('../src/openapi/plugin'),
    import('../src/routes/core'),
    import('../src/routes/auth'),
    import('../src/routes/jobs'),
    import('../src/routes/jobBundles'),
    import('../src/routes/jobImports'),
    import('../src/routes/modules'),
    import('../src/routes/ai'),
    import('../src/routes/workflows'),
    import('../src/routes/assets'),
    import('../src/routes/services'),
    import('../src/routes/repositories'),
    import('../src/routes/admin'),
    import('../src/routes/serviceProxy'),
    import('../src/routes/savedSearches'),
    import('../src/routes/eventSavedViews'),
    import('../src/routes/observatory')
  ]);

  const { getFeatureFlags } = await import('../src/config/featureFlags');
  const featureFlags = getFeatureFlags();

  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  });
  await app.register(cookie);
  await app.register(websocket, {
    options: {
      maxPayload: 1_048_576
    }
  });

  await registerOpenApi(app);

  await app.register(async (instance) => registerCoreRoutes(instance, { featureFlags }));
  await app.register(async (instance) => registerAuthRoutes(instance));
  await app.register(async (instance) => registerJobRoutes(instance));
  await app.register(async (instance) => registerJobBundleRoutes(instance));
  await app.register(async (instance) => registerJobImportRoutes(instance));
  await app.register(async (instance) => registerModuleRoutes(instance));
  await app.register(async (instance) => registerAiRoutes(instance));
  await app.register(async (instance) => registerWorkflowRoutes(instance));
  await app.register(async (instance) => registerAssetRoutes(instance));
  await app.register(async (instance) =>
    registerServiceRoutes(instance, {
      registry: {
        importManifestModule: async () => ({ servicesApplied: 0, networksApplied: 0 })
      }
    })
  );
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
  await app.register(async (instance) => registerSavedSearchRoutes(instance));
  await app.register(async (instance) => registerEventSavedViewRoutes(instance));
  await app.register(async (instance) => registerAdminRoutes(instance));
  await app.register(async (instance) => registerObservatoryRoutes(instance));

  await app.ready();

  const document = app.swagger();
  const outputPath = path.resolve(__dirname, '..', 'openapi.json');
  const serialized = JSON.stringify(document, null, 2);
  await fs.writeFile(outputPath, `${serialized}\n`, 'utf8');

  await app.close();

  return outputPath;
}

generateOpenApiSpec()
  .then((outputPath) => {
    process.stdout.write(`OpenAPI schema written to ${outputPath}\n`);
  })
  .catch((error) => {
    console.error('Failed to generate OpenAPI schema', error);
    process.exitCode = 1;
  });

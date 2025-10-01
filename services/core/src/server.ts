import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { initializeServiceRegistry } from './serviceRegistry';
import { registerDefaultServices } from './startup/registerDefaultServices';
import { stopAnalyticsSnapshots, verifyEventBusConnectivity } from './events';
import { registerCoreRoutes } from './routes/core';
import { registerAuthRoutes } from './routes/auth';
import { registerJobRoutes } from './routes/jobs';
import { registerJobBundleRoutes } from './routes/jobBundles';
import { registerJobImportRoutes } from './routes/jobImports';
import { registerExampleRoutes } from './routes/examples';
import { registerAiRoutes } from './routes/ai';
import { registerWorkflowRoutes } from './routes/workflows';
import { registerAssetRoutes } from './routes/assets';
import { registerServiceRoutes } from './routes/services';
import { registerRepositoryRoutes } from './routes/repositories';
import { registerAdminRoutes } from './routes/admin';
import { registerOpenApi } from './openapi/plugin';
import { registerServiceProxyRoutes } from './routes/serviceProxy';
import { registerSavedSearchRoutes } from './routes/savedSearches';
import { registerEventSavedViewRoutes } from './routes/eventSavedViews';
import { registerObservatoryRoutes } from './routes/observatory';
import { registerEventProxyRoutes } from './routes/eventProxy';
import './queue';
import { queueManager } from './queueManager';
import { checkKubectlDiagnostics } from './kubernetes/toolingDiagnostics';

type SerializablePrimitive = string | number | boolean | null;

function sanitizePayload(value: unknown, depth = 0): unknown {
  if (value === null) {
    return null;
  }

  if (depth > 2) {
    return '[Truncated]';
  }

  if (typeof value === 'string') {
    return value.length > 2048 ? `${value.slice(0, 2048)}…` : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value as SerializablePrimitive;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizePayload(entry, depth + 1));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    let count = 0;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = sanitizePayload(entry, depth + 1);
      count += 1;
      if (count >= 20) {
        result['__truncated__'] = true;
        break;
      }
    }
    return result;
  }

  return '[Unserializable]';
}

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL?.trim() || 'info'
    }
  });

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

  await registerDefaultServices(app.log);

  try {
    const diagnostics = await checkKubectlDiagnostics();
    if (diagnostics.status === 'ok') {
      app.log.info(
        {
          kubectlVersion: diagnostics.version ?? 'unknown'
        },
        'kubectl client detected'
      );
    } else {
      app.log.warn(
        {
          error: diagnostics.error,
          exitCode: diagnostics.result.exitCode,
          stderr: diagnostics.result.stderr.trim() || undefined
        },
        'kubectl client unavailable'
      );
    }
    for (const warning of diagnostics.warnings) {
      app.log.warn({ warning }, 'Kubernetes tooling warning');
    }
  } catch (err) {
    app.log.warn({ err }, 'kubectl diagnostics check failed');
  }

  try {
    await queueManager.verifyConnectivity();
    await verifyEventBusConnectivity();
  } catch (err) {
    app.log.error({ err }, 'Redis connectivity check failed during startup');
    throw err;
  }

  const registry = await initializeServiceRegistry();

  app.addHook('onClose', async () => {
    registry.stop();
    stopAnalyticsSnapshots();
  });
  await app.register(async (instance) => registerCoreRoutes(instance));
  await app.register(async (instance) => registerAuthRoutes(instance));
  await app.register(async (instance) => registerJobRoutes(instance));
  await app.register(async (instance) => registerJobBundleRoutes(instance));
  await app.register(async (instance) => registerJobImportRoutes(instance));
  await app.register(async (instance) => registerExampleRoutes(instance));
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
  await app.register(async (instance) => registerSavedSearchRoutes(instance));
  await app.register(async (instance) => registerEventSavedViewRoutes(instance));
  await app.register(async (instance) => registerEventProxyRoutes(instance));
  await app.register(async (instance) => registerAdminRoutes(instance));
  await app.register(async (instance) => registerObservatoryRoutes(instance));

  app.setErrorHandler((error, request, reply) => {
    const explicitStatus = (error as { statusCode?: number }).statusCode;
    const derivedStatus = typeof explicitStatus === 'number' && explicitStatus >= 400 ? explicitStatus : reply.statusCode;
    const statusCode = derivedStatus >= 400 ? derivedStatus : 500;

    const logPayload = {
      err: error,
      request: {
        id: request.id,
        method: request.method,
        url: request.url,
        route: request.routeOptions?.url,
        params: sanitizePayload(request.params),
        query: sanitizePayload(request.query),
        body: sanitizePayload(request.body)
      }
    };

    if (statusCode >= 500) {
      request.log.error(logPayload, 'Unhandled request error');
    } else {
      request.log.warn(logPayload, 'Request failed with handled error');
    }

    if (reply.raw.headersSent) {
      return;
    }

    reply.status(statusCode);

    if (statusCode >= 500) {
      void reply.send({ error: 'Internal Server Error' });
      return;
    }

    const message = typeof (error as { message?: string }).message === 'string' && (error as { message?: string }).message?.length
      ? (error as { message: string }).message
      : 'Request failed';
    void reply.send({ error: message });
  });

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
          app.log.info(`Core API listening on http://${host}:${port}`);
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

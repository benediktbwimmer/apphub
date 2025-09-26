import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  getMetrics,
  getMetricsRegistry,
  metricsEnabled,
  observeHttpRequest,
  setupMetrics,
  type MetricsOptions
} from './metrics';
import { authorizeMetricsAccess } from '../service/iam';

declare module 'fastify' {
  interface FastifyInstance {
    observability: {
      metricsEnabled: boolean;
    };
  }

  interface FastifyRequest {
    metricsStart?: bigint;
  }
}

interface MetricsPluginOptions {
  metrics: MetricsOptions & { scope: string | null };
}

export const timestoreMetricsPlugin = fp<MetricsPluginOptions>(async (app, options) => {
  setupMetrics(options.metrics);

  app.decorate('observability', {
    metricsEnabled: metricsEnabled()
  });

  if (!metricsEnabled()) {
    app.get('/metrics', async (_request, reply) => {
      reply.code(503).type('text/plain').send('metrics disabled');
    });
    return;
  }

  app.addHook('onRequest', async (request) => {
    request.metricsStart = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (request, reply) => {
    recordHttpMetrics(request, reply);
  });

  app.get('/metrics', async (request, reply) => {
    await authorizeMetricsAccess(request as FastifyRequest, options.metrics.scope);
    const registry = getMetricsRegistry();
    if (!registry) {
      reply.code(503).type('text/plain');
      return 'metrics unavailable';
    }
    reply.type('text/plain; version=0.0.4; charset=utf-8');
    return registry.metrics();
  });
});

function recordHttpMetrics(request: FastifyRequest, reply: FastifyReply): void {
  const state = getMetrics();
  if (!state?.enabled || !request.metricsStart) {
    return;
  }
  const durationNs = Number(process.hrtime.bigint() - request.metricsStart);
  const durationSeconds = durationNs / 1_000_000_000;
  const route = request.routeOptions?.url ?? request.raw.url ?? 'unknown';
  observeHttpRequest({
    method: request.method,
    route,
    statusCode: reply.statusCode,
    durationSeconds
  });
}

import fp from 'fastify-plugin';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

declare module 'fastify' {
  interface FastifyInstance {
    metrics: {
      registry: Registry;
      httpRequestsTotal: Counter<string>;
      httpRequestDurationSeconds: Histogram<string>;
      enabled: boolean;
    };
  }

  interface FastifyRequest {
    metricsStart?: bigint;
  }
}

type MetricsPluginOptions = {
  enabled: boolean;
};

export const metricsPlugin = fp<MetricsPluginOptions>(async (app, options) => {
  const registry = new Registry();
  const enabled = options.enabled;

  if (enabled) {
    collectDefaultMetrics({ register: registry, prefix: 'filestore_' });
  }

  const httpRequestsTotal = new Counter({
    name: 'filestore_http_requests_total',
    help: 'Total number of HTTP requests received by filestore',
    labelNames: ['method', 'route', 'status'],
    registers: enabled ? [registry] : undefined
  });

  const httpRequestDurationSeconds = new Histogram({
    name: 'filestore_http_request_duration_seconds',
    help: 'Duration of HTTP requests processed by filestore',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: enabled ? [registry] : undefined
  });

  app.decorate('metrics', {
    registry,
    httpRequestsTotal,
    httpRequestDurationSeconds,
    enabled
  });

  app.addHook('onRequest', async (request) => {
    if (!enabled) {
      return;
    }
    request.metricsStart = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (request, reply) => {
    if (!enabled) {
      return;
    }

    const start = request.metricsStart;
    const method = request.method;
    const route = request.routeOptions?.url ?? request.raw.url ?? 'unknown';
    const status = reply.statusCode;

    app.metrics.httpRequestsTotal.labels(method, route, String(status)).inc();

    if (start) {
      const durationNs = Number(process.hrtime.bigint() - start);
      const durationSeconds = durationNs / 1_000_000_000;
      app.metrics.httpRequestDurationSeconds
        .labels(method, route, String(status))
        .observe(durationSeconds);
    }
  });

  app.get('/metrics', async (request, reply) => {
    if (!enabled) {
      reply.code(503).type('text/plain').send('metrics disabled');
      return;
    }

    reply.type('text/plain; version=0.0.4');
    return app.metrics.registry.metrics();
  });
});

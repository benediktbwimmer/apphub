import fp from 'fastify-plugin';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

export type MetastoreMetrics = {
  registry: Registry;
  httpRequestsTotal: Counter<string>;
  httpRequestDurationSeconds: Histogram<string>;
  namespaceRecords: Gauge<string>;
  namespaceDeletedRecords: Gauge<string>;
  searchResponseBytes: Histogram<string>;
  recordStreamSubscribers: Gauge<string>;
  filestoreLagSeconds: Gauge<string>;
  filestoreStalled: Gauge<string>;
  filestoreRetryTotal: Counter<string>;
  enabled: boolean;
};

declare module 'fastify' {
  interface FastifyInstance {
    metrics: MetastoreMetrics;
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
    collectDefaultMetrics({ register: registry, prefix: 'metastore_' });
  }

  const httpRequestsTotal = new Counter({
    name: 'metastore_http_requests_total',
    help: 'Total number of HTTP requests received',
    labelNames: ['method', 'route', 'status'],
    registers: registry ? [registry] : undefined
  });

  const httpRequestDurationSeconds = new Histogram({
    name: 'metastore_http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: registry ? [registry] : undefined
  });

  const namespaceRecords = new Gauge({
    name: 'metastore_namespace_records',
    help: 'Total number of records per namespace',
    labelNames: ['namespace'],
    registers: registry ? [registry] : undefined
  });

  const namespaceDeletedRecords = new Gauge({
    name: 'metastore_namespace_deleted_records',
    help: 'Soft-deleted records per namespace',
    labelNames: ['namespace'],
    registers: registry ? [registry] : undefined
  });

  const searchResponseBytes = new Histogram({
    name: 'metastore_search_response_bytes',
    help: 'Size of metastore search responses in bytes',
    labelNames: ['namespace', 'mode'],
    buckets: [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072],
    registers: registry ? [registry] : undefined
  });

  const recordStreamSubscribers = new Gauge({
    name: 'metastore_record_stream_subscribers',
    help: 'Active metastore record stream subscribers by transport',
    labelNames: ['transport'],
    registers: registry ? [registry] : undefined
  });

  const filestoreLagSeconds = new Gauge({
    name: 'metastore_filestore_lag_seconds',
    help: 'Age in seconds of the most recent filestore event observed by the metastore',
    registers: registry ? [registry] : undefined
  });

  const filestoreStalled = new Gauge({
    name: 'metastore_filestore_consumer_stalled',
    help: 'Indicator that the filestore consumer is stalled beyond the configured threshold',
    registers: registry ? [registry] : undefined
  });

  const filestoreRetryTotal = new Counter({
    name: 'metastore_filestore_retry_total',
    help: 'Total number of retry attempts performed by the filestore consumer',
    labelNames: ['kind'],
    registers: registry ? [registry] : undefined
  });

  recordStreamSubscribers.labels('sse').set(0);
  recordStreamSubscribers.labels('websocket').set(0);
  recordStreamSubscribers.labels('total').set(0);
  filestoreLagSeconds.set(0);
  filestoreStalled.set(0);
  filestoreRetryTotal.labels('connect').inc(0);
  filestoreRetryTotal.labels('processing').inc(0);

  app.decorate('metrics', {
    registry,
    httpRequestsTotal,
    httpRequestDurationSeconds,
    namespaceRecords,
    namespaceDeletedRecords,
    searchResponseBytes,
    recordStreamSubscribers,
    filestoreLagSeconds,
    filestoreStalled,
    filestoreRetryTotal,
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
      app.metrics.httpRequestDurationSeconds
        .labels(method, route, String(status))
        .observe(durationNs / 1_000_000_000);
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

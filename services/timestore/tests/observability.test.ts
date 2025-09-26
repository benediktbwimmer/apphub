import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import fastify from 'fastify';
import {
  observeIngestion,
  observeQuery,
  resetMetrics,
  setupMetrics,
  getMetricsRegistry
} from '../src/observability/metrics';
import { timestoreMetricsPlugin } from '../src/observability/metricsPlugin';

beforeEach(() => {
  resetMetrics();
});

afterEach(() => {
  resetMetrics();
});

test('timestore metrics capture ingestion and query events', async () => {
  setupMetrics({
    enabled: true,
    collectDefaultMetrics: false,
    prefix: 'timestore_'
  });

  observeIngestion({
    datasetSlug: 'ds-metrics',
    mode: 'inline',
    result: 'success',
    durationSeconds: 0.2
  });

  observeQuery({
    datasetSlug: 'ds-metrics',
    mode: 'raw',
    result: 'failure',
    durationSeconds: 0.1,
    rowCount: 0,
    remotePartitions: 2,
    cacheEnabled: true
  });

  const registry = getMetricsRegistry();
  assert.ok(registry, 'registry is initialised');
  const output = await registry!.metrics();

  assert.match(
    output,
    /timestore_ingest_requests_total\{dataset="ds-metrics",result="success",mode="inline"\} 1/
  );
  assert.match(
    output,
    /timestore_query_requests_total\{dataset="ds-metrics",mode="raw",result="failure"\} 1/
  );
  assert.match(
    output,
    /timestore_query_remote_partitions_total\{dataset="ds-metrics",cache_enabled="true"\} 2/
  );
});

test('metrics endpoint enforces scope requirements', async () => {
  const app = fastify();
  await app.register(timestoreMetricsPlugin, {
    metrics: {
      enabled: true,
      collectDefaultMetrics: false,
      prefix: 'timestore_',
      scope: 'metrics:read'
    }
  });

  const unauthorized = await app.inject({
    method: 'GET',
    url: '/metrics'
  });
  assert.equal(unauthorized.statusCode, 403);

  const authorized = await app.inject({
    method: 'GET',
    url: '/metrics',
    headers: {
      'x-iam-scopes': 'metrics:read',
      'x-iam-user': 'tester'
    }
  });
  assert.equal(authorized.statusCode, 200);
  assert.match(authorized.body, /timestore_/);

  await app.close();
});

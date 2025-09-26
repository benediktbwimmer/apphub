/// <reference path="../src/types/embeddedPostgres.d.ts" />

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
import { resetCachedServiceConfig } from '../src/config/serviceConfig';

let schemaModule: typeof import('../src/db/schema');
let clientModule: typeof import('../src/db/client');
let migrationsModule: typeof import('../src/db/migrations');
let bootstrapModule: typeof import('../src/service/bootstrap');
let ingestionModule: typeof import('../src/ingestion/processor');
let ingestionTypesModule: typeof import('../src/ingestion/types');
let queryPlannerModule: typeof import('../src/query/planner');
let queryExecutorModule: typeof import('../src/query/executor');

let postgres: EmbeddedPostgres | null = null;
let dataDirectory: string | null = null;
let storageRoot: string | null = null;

before(async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'timestore-query-pg-'));
  dataDirectory = dataRoot;
  const port = 56000 + Math.floor(Math.random() * 1000);
  const embedded = new EmbeddedPostgres({
    databaseDir: dataRoot,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    postgresFlags: ['-c', 'dynamic_shared_memory_type=posix'],
    onError(message) {
      console.error('[embedded-postgres:query]', message);
    }
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('apphub');
  postgres = embedded;

  storageRoot = await mkdtemp(path.join(tmpdir(), 'timestore-query-storage-'));

  process.env.TIMESTORE_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.TIMESTORE_PG_SCHEMA = `timestore_test_${randomUUID().slice(0, 8)}`;
  process.env.TIMESTORE_PGPOOL_MAX = '4';
  process.env.TIMESTORE_STORAGE_ROOT = storageRoot;
  process.env.REDIS_URL = 'inline';

  resetCachedServiceConfig();

  schemaModule = await import('../src/db/schema');
  clientModule = await import('../src/db/client');
  migrationsModule = await import('../src/db/migrations');
  bootstrapModule = await import('../src/service/bootstrap');
  ingestionModule = await import('../src/ingestion/processor');
  ingestionTypesModule = await import('../src/ingestion/types');
  queryPlannerModule = await import('../src/query/planner');
  queryExecutorModule = await import('../src/query/executor');

  await schemaModule.ensureSchemaExists(clientModule.POSTGRES_SCHEMA);
  await migrationsModule.runMigrations();
  await bootstrapModule.ensureDefaultStorageTarget();
  await seedDataset();
});

after(async () => {
  if (clientModule) {
    await clientModule.closePool();
  }
  if (postgres) {
    await postgres.stop();
  }
  if (dataDirectory) {
    await rm(dataDirectory, { recursive: true, force: true });
  }
  if (storageRoot) {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

async function seedDataset(): Promise<void> {
  const payload = ingestionTypesModule.ingestionJobPayloadSchema.parse({
    datasetSlug: 'observatory-timeseries',
    datasetName: 'Observatory Time Series',
    tableName: 'observations',
    schema: {
      fields: [
        { name: 'timestamp', type: 'timestamp' },
        { name: 'temperature_c', type: 'double' },
        { name: 'humidity_percent', type: 'double' }
      ]
    },
    partition: {
      key: { window: '2024-01-01', dataset: 'observatory' },
      timeRange: {
        start: '2024-01-01T00:00:00.000Z',
        end: '2024-01-01T01:00:00.000Z'
      }
    },
    rows: Array.from({ length: 6 }).map((_, index) => ({
      timestamp: new Date(Date.UTC(2024, 0, 1, 0, index * 10)).toISOString(),
      temperature_c: 20 + index,
      humidity_percent: 60 - index
    })),
    idempotencyKey: `seed-${randomUUID()}`,
    receivedAt: new Date().toISOString()
  });

  await ingestionModule.processIngestionJob(payload);
}

test('execute raw query over dataset partitions', async () => {
  const plan = await queryPlannerModule.buildQueryPlan('observatory-timeseries', {
    timeRange: {
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-01-01T02:00:00.000Z'
    },
    columns: ['timestamp', 'temperature_c', 'humidity_percent'],
    timestampColumn: 'timestamp'
  });

  const result = await queryExecutorModule.executeQueryPlan(plan);

  assert.equal(result.mode, 'raw');
  assert.deepEqual(result.columns, ['timestamp', 'temperature_c', 'humidity_percent']);
  assert.equal(result.rows.length, 6);
  assert.equal(result.rows[0]?.timestamp, '2024-01-01T00:00:00.000Z');
});

test('execute downsampled query with aggregations', async () => {
  const plan = await queryPlannerModule.buildQueryPlan('observatory-timeseries', {
    timeRange: {
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-01-01T02:00:00.000Z'
    },
    timestampColumn: 'timestamp',
    downsample: {
      intervalUnit: 'hour',
      intervalSize: 1,
      aggregations: [
        { column: 'temperature_c', fn: 'avg', alias: 'avg_temp' },
        { column: 'humidity_percent', fn: 'min', alias: 'min_humidity' }
      ]
    }
  });

  const result = await queryExecutorModule.executeQueryPlan(plan);

  assert.equal(result.mode, 'downsampled');
  assert.deepEqual(result.columns, ['timestamp', 'avg_temp', 'min_humidity']);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.avg_temp, 22.5);
});

test('execute downsampled query with count and percentile', async () => {
  const plan = await queryPlannerModule.buildQueryPlan('observatory-timeseries', {
    timeRange: {
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-01-01T02:00:00.000Z'
    },
    timestampColumn: 'timestamp',
    downsample: {
      intervalUnit: 'hour',
      intervalSize: 1,
      aggregations: [
        { fn: 'count' },
        { fn: 'percentile', column: 'temperature_c', percentile: 0.5, alias: 'p50_temp' }
      ]
    }
  });

  const result = await queryExecutorModule.executeQueryPlan(plan);

  assert.equal(result.mode, 'downsampled');
  assert.deepEqual(result.columns, ['timestamp', 'count', 'p50_temp']);
  assert.equal(result.rows.length, 1);
  assert.equal(Number(result.rows[0]?.count), 6);
  assert.equal(Number(result.rows[0]?.p50_temp), 22);
});

test('returns empty result when no partitions match', async () => {
  const plan = await queryPlannerModule.buildQueryPlan('observatory-timeseries', {
    timeRange: {
      start: '2025-01-01T00:00:00.000Z',
      end: '2025-01-01T02:00:00.000Z'
    },
    columns: ['timestamp', 'temperature_c']
  });

  const result = await queryExecutorModule.executeQueryPlan(plan);

  assert.equal(result.mode, 'raw');
  assert.deepEqual(result.columns, ['timestamp', 'temperature_c']);
  assert.equal(result.rows.length, 0);
});

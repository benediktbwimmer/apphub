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

const observationSchema = {
  fields: [
    { name: 'timestamp', type: 'timestamp' as const },
    { name: 'temperature_c', type: 'double' as const },
    { name: 'humidity_percent', type: 'double' as const }
  ]
};

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
    schema: observationSchema,
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

interface ObservationRow {
  timestamp: string;
  temperature_c: number;
  humidity_percent: number;
}

interface ObservationPartitionInput {
  datasetSlug: string;
  datasetName?: string;
  partitionKey: Record<string, string>;
  timeRange: { start: string; end: string };
  rows: ObservationRow[];
  tableName?: string;
}

async function ingestObservationPartition(input: ObservationPartitionInput): Promise<void> {
  const payload = ingestionTypesModule.ingestionJobPayloadSchema.parse({
    datasetSlug: input.datasetSlug,
    datasetName: input.datasetName ?? input.datasetSlug,
    tableName: input.tableName ?? 'observations',
    schema: observationSchema,
    partition: {
      key: input.partitionKey,
      timeRange: input.timeRange
    },
    rows: input.rows,
    idempotencyKey: `partition-${randomUUID()}`,
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

test('query fills missing columns with nulls after additive schema evolution', async () => {
  const datasetSlug = `observatory-timeseries-evolved-${randomUUID().slice(0, 8)}`;
  await ingestObservationPartition({
    datasetSlug,
    datasetName: 'Observatory Time Series Evolved',
    tableName: 'observations',
    partitionKey: { window: '2024-01-01', dataset: 'observatory' },
    timeRange: {
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-01-01T00:20:00.000Z'
    },
    rows: [
      {
        timestamp: '2024-01-01T00:00:00.000Z',
        temperature_c: 20,
        humidity_percent: 60
      },
      {
        timestamp: '2024-01-01T00:10:00.000Z',
        temperature_c: 21,
        humidity_percent: 59
      }
    ]
  });

  const additivePayload = ingestionTypesModule.ingestionJobPayloadSchema.parse({
    datasetSlug,
    datasetName: 'Observatory Time Series Evolved',
    tableName: 'observations',
    schema: {
      fields: [
        { name: 'timestamp', type: 'timestamp' as const },
        { name: 'temperature_c', type: 'double' as const },
        { name: 'humidity_percent', type: 'double' as const },
        { name: 'wind_speed_mps', type: 'double' as const }
      ],
      evolution: {
        backfill: false
      }
    },
    partition: {
      key: { window: '2024-01-01', dataset: 'observatory', batch: 'expanded' },
      timeRange: {
        start: '2024-01-01T00:30:00.000Z',
        end: '2024-01-01T00:40:00.000Z'
      }
    },
    rows: [
      {
        timestamp: '2024-01-01T00:35:00.000Z',
        temperature_c: 24.6,
        humidity_percent: 55.1,
        wind_speed_mps: 5.8
      }
    ],
    idempotencyKey: `schema-additive-${randomUUID()}`,
    receivedAt: new Date().toISOString()
  });

  await ingestionModule.processIngestionJob(additivePayload);

  const plan = await queryPlannerModule.buildQueryPlan(datasetSlug, {
    timeRange: {
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-01-02T00:00:00.000Z'
    },
    columns: ['timestamp', 'temperature_c', 'humidity_percent', 'wind_speed_mps'],
    timestampColumn: 'timestamp'
  });

  const result = await queryExecutorModule.executeQueryPlan(plan);

  assert.ok(result.columns.includes('wind_speed_mps'));
  assert.equal(result.rows.length, 3);

  const firstRow = result.rows.find((row) => row.timestamp === '2024-01-01T00:00:00.000Z');
  assert.ok(firstRow);
  assert.equal(firstRow?.wind_speed_mps, null);

  const evolvedRow = result.rows.find((row) => row.timestamp === '2024-01-01T00:35:00.000Z');
  assert.ok(evolvedRow);
  assert.equal(evolvedRow?.wind_speed_mps, 5.8);
});

test('union query spans multiple published partitions', async () => {
  const datasetSlug = `observations-${randomUUID().slice(0, 8)}`;
  const datasetName = 'Telemetry Windowed Series';
  const base = Date.UTC(2024, 0, 1, 0, 0, 0);

  await ingestObservationPartition({
    datasetSlug,
    datasetName,
    partitionKey: { window: '2024-01-01T00', region: 'east' },
    timeRange: {
      start: new Date(base).toISOString(),
      end: new Date(base + 60 * 60 * 1000).toISOString()
    },
    rows: [
      {
        timestamp: new Date(base).toISOString(),
        temperature_c: 18,
        humidity_percent: 64
      },
      {
        timestamp: new Date(base + 30 * 60 * 1000).toISOString(),
        temperature_c: 19,
        humidity_percent: 63
      }
    ]
  });

  await ingestObservationPartition({
    datasetSlug,
    datasetName,
    partitionKey: { window: '2024-01-01T01', region: 'central' },
    timeRange: {
      start: new Date(base + 60 * 60 * 1000).toISOString(),
      end: new Date(base + 2 * 60 * 60 * 1000).toISOString()
    },
    rows: [
      {
        timestamp: new Date(base + 60 * 60 * 1000).toISOString(),
        temperature_c: 20,
        humidity_percent: 58
      },
      {
        timestamp: new Date(base + 90 * 60 * 1000).toISOString(),
        temperature_c: 21,
        humidity_percent: 57
      }
    ]
  });

  await ingestObservationPartition({
    datasetSlug,
    datasetName,
    partitionKey: { window: '2024-01-01T02', region: 'west' },
    timeRange: {
      start: new Date(base + 2 * 60 * 60 * 1000).toISOString(),
      end: new Date(base + 3 * 60 * 60 * 1000).toISOString()
    },
    rows: [
      {
        timestamp: new Date(base + 2 * 60 * 60 * 1000).toISOString(),
        temperature_c: 22,
        humidity_percent: 55
      },
      {
        timestamp: new Date(base + 150 * 60 * 1000).toISOString(),
        temperature_c: 23,
        humidity_percent: 54
      }
    ]
  });

  const plan = await queryPlannerModule.buildQueryPlan(datasetSlug, {
    timeRange: {
      start: new Date(base).toISOString(),
      end: new Date(base + 3 * 60 * 60 * 1000).toISOString()
    },
    columns: ['timestamp', 'temperature_c', 'humidity_percent'],
    timestampColumn: 'timestamp'
  });

  assert.equal(plan.partitions.length, 3);

  const result = await queryExecutorModule.executeQueryPlan(plan);

  assert.equal(result.mode, 'raw');
  assert.equal(result.rows.length, 6);
  assert.deepEqual(
    result.rows.map((row) => row.temperature_c),
    [18, 19, 20, 21, 22, 23]
  );
});

test('query planner applies partition key filters', async () => {
  const datasetSlug = `filtered-${randomUUID().slice(0, 8)}`;
  const datasetName = 'Filtered Observations';
  const base = Date.UTC(2024, 0, 1, 0, 0, 0);

  await ingestObservationPartition({
    datasetSlug,
    datasetName,
    partitionKey: {
      region: 'east',
      shard: '1',
      captured_at: new Date(base).toISOString()
    },
    timeRange: {
      start: new Date(base).toISOString(),
      end: new Date(base + 60 * 60 * 1000).toISOString()
    },
    rows: [
      {
        timestamp: new Date(base + 5 * 60 * 1000).toISOString(),
        temperature_c: 16,
        humidity_percent: 68
      }
    ]
  });

  await ingestObservationPartition({
    datasetSlug,
    datasetName,
    partitionKey: {
      region: 'west',
      shard: '2',
      captured_at: new Date(base + 60 * 60 * 1000).toISOString()
    },
    timeRange: {
      start: new Date(base + 60 * 60 * 1000).toISOString(),
      end: new Date(base + 2 * 60 * 60 * 1000).toISOString()
    },
    rows: [
      {
        timestamp: new Date(base + 70 * 60 * 1000).toISOString(),
        temperature_c: 17,
        humidity_percent: 62
      },
      {
        timestamp: new Date(base + 85 * 60 * 1000).toISOString(),
        temperature_c: 18,
        humidity_percent: 61
      }
    ]
  });

  await ingestObservationPartition({
    datasetSlug,
    datasetName,
    partitionKey: {
      region: 'west',
      shard: '3',
      captured_at: new Date(base + 2 * 60 * 60 * 1000).toISOString()
    },
    timeRange: {
      start: new Date(base + 2 * 60 * 60 * 1000).toISOString(),
      end: new Date(base + 3 * 60 * 60 * 1000).toISOString()
    },
    rows: [
      {
        timestamp: new Date(base + 130 * 60 * 1000).toISOString(),
        temperature_c: 19,
        humidity_percent: 59
      }
    ]
  });

  const plan = await queryPlannerModule.buildQueryPlan(datasetSlug, {
    timeRange: {
      start: new Date(base).toISOString(),
      end: new Date(base + 3 * 60 * 60 * 1000).toISOString()
    },
    columns: ['timestamp', 'temperature_c'],
    timestampColumn: 'timestamp',
    filters: {
      partitionKey: {
        region: { type: 'string', eq: 'west' },
        shard: { type: 'number', gte: 2, lt: 3 },
        captured_at: {
          type: 'timestamp',
          gte: new Date(base + 60 * 60 * 1000).toISOString(),
          lt: new Date(base + 2 * 60 * 60 * 1000).toISOString()
        }
      }
    }
  });

  assert.equal(plan.partitions.length, 1);

  const result = await queryExecutorModule.executeQueryPlan(plan);

  assert.equal(result.rows.length, 2);
  assert.deepEqual(
    result.rows.map((row) => row.temperature_c),
    [17, 18]
  );
});

test('planner restricts partitions to shards covering the requested window', async () => {
  await ingestObservationPartition({
    datasetSlug: 'observatory-timeseries',
    partitionKey: { window: '2024-01-02', dataset: 'observatory' },
    timeRange: {
      start: '2024-01-02T00:00:00.000Z',
      end: '2024-01-02T00:30:00.000Z'
    },
    rows: [
      { timestamp: '2024-01-02T00:05:00.000Z', temperature_c: 18, humidity_percent: 55 }
    ]
  });

  await ingestObservationPartition({
    datasetSlug: 'observatory-timeseries',
    partitionKey: { window: '2024-01-03', dataset: 'observatory' },
    timeRange: {
      start: '2024-01-03T00:00:00.000Z',
      end: '2024-01-03T00:30:00.000Z'
    },
    rows: [
      { timestamp: '2024-01-03T00:05:00.000Z', temperature_c: 19, humidity_percent: 53 }
    ]
  });

  const dayTwoPlan = await queryPlannerModule.buildQueryPlan('observatory-timeseries', {
    timeRange: {
      start: '2024-01-02T00:00:00.000Z',
      end: '2024-01-02T23:59:59.000Z'
    },
    columns: ['timestamp'],
    timestampColumn: 'timestamp'
  });

  assert.equal(dayTwoPlan.partitions.length, 1);
  assert.ok(dayTwoPlan.partitions[0]?.startTime.toISOString().startsWith('2024-01-02'));

  const multiDayPlan = await queryPlannerModule.buildQueryPlan('observatory-timeseries', {
    timeRange: {
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-01-03T12:00:00.000Z'
    },
    columns: ['timestamp'],
    timestampColumn: 'timestamp'
  });

  assert.equal(multiDayPlan.partitions.length, 3);
  const shardStarts = multiDayPlan.partitions.map((partition) => partition.startTime.toISOString().slice(0, 10));
  assert.deepEqual(shardStarts.sort(), ['2024-01-01', '2024-01-02', '2024-01-03']);
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

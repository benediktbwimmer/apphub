/// <reference path="../src/types/embeddedPostgres.d.ts" />

import './testEnv';

import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, mkdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, afterEach, before, test } from 'node:test';
import type EmbeddedPostgres from 'embedded-postgres';
import { createEmbeddedPostgres, stopEmbeddedPostgres } from './utils/embeddedPostgres';
import fastify from 'fastify';
import { loadServiceConfig, resetCachedServiceConfig } from '../src/config/serviceConfig';

let schemaModule: typeof import('../src/db/schema');
let clientModule: typeof import('../src/db/client');
let migrationsModule: typeof import('../src/db/migrations');
let bootstrapModule: typeof import('../src/service/bootstrap');
let ingestionModule: typeof import('../src/ingestion/processor');
let ingestionTypesModule: typeof import('../src/ingestion/types');
let queryPlannerModule: typeof import('../src/query/planner');
let queryExecutorModule: typeof import('../src/query/executor');
let manifestCacheModule: typeof import('../src/cache/manifestCache');
let queryRoutesModule: typeof import('../src/routes/query');
let openApiModule: typeof import('../src/openapi/plugin');
let metadataModule: typeof import('../src/db/metadata');
let stagingManagerModule: typeof import('../src/ingestion/stagingManager');
let stagingRegistryModule: typeof import('../src/db/stagingSchemaRegistry');

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
  const embedded = createEmbeddedPostgres({
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
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';
  process.env.TIMESTORE_PARTITION_INDEX_COLUMNS = 'temperature_c,humidity_percent';
  process.env.TIMESTORE_PARTITION_BLOOM_COLUMNS = 'temperature_c,humidity_percent';
  process.env.TIMESTORE_PARTITION_HISTOGRAM_COLUMNS = 'temperature_c';
  process.env.TIMESTORE_REQUIRE_SCOPE = 'query-scope';
  process.env.TIMESTORE_QUERY_EXECUTION_DEFAULT = 'duckdb-local';
  process.env.TIMESTORE_QUERY_EXECUTION_BACKENDS = JSON.stringify([
    { name: 'duckdb-local', kind: 'duckdb_local' },
    { name: 'duckdb-cluster', kind: 'duckdb_cluster', maxPartitionFanout: 2 }
  ]);

  resetCachedServiceConfig();

  schemaModule = await import('../src/db/schema');
  clientModule = await import('../src/db/client');
  migrationsModule = await import('../src/db/migrations');
  bootstrapModule = await import('../src/service/bootstrap');
  ingestionModule = await import('../src/ingestion/processor');
  ingestionTypesModule = await import('../src/ingestion/types');
  queryPlannerModule = await import('../src/query/planner');
  queryExecutorModule = await import('../src/query/executor');
  manifestCacheModule = await import('../src/cache/manifestCache');
  queryRoutesModule = await import('../src/routes/query');
  openApiModule = await import('../src/openapi/plugin');
  metadataModule = await import('../src/db/metadata');
  stagingManagerModule = await import('../src/ingestion/stagingManager');
  stagingRegistryModule = await import('../src/db/stagingSchemaRegistry');
  manifestCacheModule.__resetManifestCacheForTests();

  await schemaModule.ensureSchemaExists(clientModule.POSTGRES_SCHEMA);
  await migrationsModule.runMigrations();
  await bootstrapModule.ensureDefaultStorageTarget();
  await seedDataset();
});

afterEach(async () => {
  if (manifestCacheModule) {
    manifestCacheModule.__resetManifestCacheForTests();
  }
  if (stagingManagerModule) {
    await stagingManagerModule.resetStagingWriteManager();
  }
});

after(async () => {
  if (clientModule) {
    await clientModule.closePool();
  }
  await stopEmbeddedPostgres(postgres);
  postgres = null;
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

async function writeParquetFile(
  filePath: string,
  tableName: string,
  schema: typeof observationSchema.fields,
  rows: Record<string, unknown>[]
): Promise<void> {
  const { loadDuckDb, isCloseable } = await import('@apphub/shared');
  const duckdb = loadDuckDb();
  const db = new duckdb.Database(':memory:');
  const connection = db.connect();

  try {
    const columns = schema
      .map((field) => `${quoteIdentifier(field.name)} ${mapDuckDbType(field.type)}`)
      .join(', ');
    await runSql(connection, `CREATE TABLE ${quoteIdentifier(tableName)} (${columns})`);
    const columnNames = schema.map((field) => field.name);
    const insertSql = `INSERT INTO ${quoteIdentifier(tableName)} (${columnNames.map(quoteIdentifier).join(', ')}) VALUES (${columnNames.map(() => '?').join(', ')})`;
    for (const row of rows) {
      const values = columnNames.map((name) => row[name]);
      await runSql(connection, insertSql, ...values);
    }
    const escapedPath = filePath.replace(/'/g, "''");
    await runSql(connection, `COPY ${quoteIdentifier(tableName)} TO '${escapedPath}' (FORMAT PARQUET)`);
  } finally {
    await closeConnection(connection);
    if (isCloseable(db)) {
      db.close();
    }
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function mapDuckDbType(type: typeof observationSchema.fields[number]['type']): string {
  switch (type) {
    case 'timestamp':
      return 'TIMESTAMP';
    case 'double':
      return 'DOUBLE';
    case 'integer':
      return 'BIGINT';
    case 'boolean':
      return 'BOOLEAN';
    case 'string':
    default:
      return 'VARCHAR';
  }
}

async function runSql(connection: any, sql: string, ...params: unknown[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    connection.run(sql, ...params, (err: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

async function closeConnection(connection: any): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    connection.close((err: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
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


test('merges staged rows with published partitions', async () => {
  const datasetSlug = `staging-merge-${randomUUID().slice(0, 8)}`;
  const base = Date.now();
  const config = loadServiceConfig();

  const storageTarget = await metadataModule.upsertStorageTarget({
    id: `st-${randomUUID()}`,
    name: `local-${randomUUID().slice(0, 8)}`,
    kind: 'local',
    description: 'test target',
    config: {
      root: config.storage.root
    }
  });

  const dataset = await metadataModule.createDataset({
    id: `ds-${randomUUID()}`,
    slug: datasetSlug,
    name: 'Staging Merge Dataset',
    defaultStorageTargetId: storageTarget.id
  });

  const schema = { fields: observationSchema.fields };
  const checksum = createHash('sha1').update(JSON.stringify(schema)).digest('hex');
  const schemaVersion = await metadataModule.createDatasetSchemaVersion({
    id: `dsv-${randomUUID()}`,
    datasetId: dataset.id,
    version: 1,
    description: 'staging merge schema',
    schema,
    checksum
  });

  const partitionId = `part-${randomUUID()}`;
  const partitionWindow = new Date(base).toISOString().slice(0, 10);
  const relativePath = path.posix.join(dataset.slug, `window=${partitionWindow}`, `${partitionId}.parquet`);
  const absolutePath = path.join(config.storage.root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeParquetFile(absolutePath, 'observations', observationSchema.fields, [
    {
      timestamp: new Date(base + 5_000).toISOString(),
      temperature_c: 16,
      humidity_percent: 51
    }
  ]);
  const fileStats = await stat(absolutePath);
  const fileBuffer = await readFile(absolutePath);
  const fileChecksum = createHash('sha1').update(fileBuffer).digest('hex');

  await metadataModule.createDatasetManifest({
    id: `dm-${randomUUID()}`,
    datasetId: dataset.id,
    version: 1,
    status: 'published',
    manifestShard: 'default',
    schemaVersionId: schemaVersion.id,
    createdBy: 'tests',
    partitions: [
      {
        id: partitionId,
        storageTargetId: storageTarget.id,
        fileFormat: 'parquet',
        filePath: relativePath,
        partitionKey: { window: partitionWindow },
        startTime: new Date(base),
        endTime: new Date(base + 60_000),
        fileSizeBytes: fileStats.size,
        rowCount: 1,
        checksum: fileChecksum,
        metadata: {
          tableName: 'observations'
        }
      }
    ]
  });

  await stagingRegistryModule.upsertStagingSchemaRegistry({
    datasetId: dataset.id,
    fields: observationSchema.fields.map((field) => ({
      name: field.name,
      type: field.type,
      nullable: true,
      description: null
    })),
    sourceBatchId: null
  });

  const stagingManager = stagingManagerModule.getStagingWriteManager(config);
  const stagedTimestamp = new Date(base + 70_000).toISOString();
  const stagingResult = await stagingManager.enqueue({
    datasetSlug,
    tableName: 'observations',
    schema: observationSchema.fields,
    rows: [
      {
        timestamp: stagedTimestamp,
        temperature_c: 17,
        humidity_percent: 49
      }
    ],
    partitionKey: { window: stagedTimestamp },
    partitionAttributes: null,
    timeRange: {
      start: stagedTimestamp,
      end: new Date(base + 90_000).toISOString()
    },
    ingestionSignature: `sig-${randomUUID()}`,
    receivedAt: new Date().toISOString(),
    idempotencyKey: null,
    schemaDefaults: null,
    backfillRequested: false
  });

  const { StagingRowSource } = await import('../src/query/rowSources');
  const stagingSource = new StagingRowSource();
  const stagingPreview = await stagingSource.fetchRows({
    dataset,
    timestampColumn: 'timestamp',
    rangeStart: new Date(base - 30_000),
    rangeEnd: new Date(base + 120_000)
  });
  assert.equal(stagingPreview.rows.length, 1, 'expected staged row to be readable');

  await stagingRegistryModule.upsertStagingSchemaRegistry({
    datasetId: dataset.id,
    fields: observationSchema.fields.map((field) => ({
      name: field.name,
      type: field.type,
      nullable: true,
      description: null
    })),
    sourceBatchId: stagingResult.batchId
  });

  const plan = await queryPlannerModule.buildQueryPlan(datasetSlug, {
    timeRange: {
      start: new Date(base - 30_000).toISOString(),
      end: new Date(base + 120_000).toISOString()
    },
    timestampColumn: 'timestamp'
  });

  const result = await queryExecutorModule.executeQueryPlan(plan);

  assert.equal(result.mode, 'raw');
  assert.equal(result.rows.length, 2);
  const temperatures = result.rows.map((row) => Number(row.temperature_c)).sort((a, b) => a - b);
  assert.deepEqual(temperatures, [16, 17]);
  assert.ok(result.sources, 'expected unified row source summary');
  const sources = result.sources!;
  assert.equal(sources.published.rows, 1);
  assert.equal(sources.published.partitions, 1);
  assert.equal(sources.staging.rows, 1);
  assert.equal(sources.hotBuffer.rows, 0);
});

test('query planner honours dataset execution backend overrides', async () => {
  const datasetSlug = 'distributed-timeseries';
  for (let index = 0; index < 4; index += 1) {
    await ingestObservationPartition({
      datasetSlug,
      datasetName: 'Distributed Time Series',
      partitionKey: { window: '2024-01-01', shard: 'west', batch: `b${index}` },
      timeRange: {
        start: new Date(Date.UTC(2024, 0, 1, index, 0)).toISOString(),
        end: new Date(Date.UTC(2024, 0, 1, index, 15)).toISOString()
      },
      rows: Array.from({ length: 3 }).map((_, rowIndex) => ({
        timestamp: new Date(Date.UTC(2024, 0, 1, index, rowIndex * 5)).toISOString(),
        temperature_c: 10 + index + rowIndex,
        humidity_percent: 40 + rowIndex
      }))
    });
  }

  const dataset = await metadataModule.getDatasetBySlug(datasetSlug);
  assert.ok(dataset, 'dataset should exist after ingestion');
  await metadataModule.updateDataset({
    id: dataset.id,
    metadata: {
      ...dataset.metadata,
      execution: {
        backend: 'duckdb-cluster'
      }
    }
  });

  manifestCacheModule.__resetManifestCacheForTests();

  const plan = await queryPlannerModule.buildQueryPlan(datasetSlug, {
    timeRange: {
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-01-01T04:00:00.000Z'
    },
    columns: ['timestamp', 'temperature_c'],
    timestampColumn: 'timestamp'
  });

  assert.equal(plan.execution.backend.name, 'duckdb-cluster');
  assert.equal(plan.execution.backend.kind, 'duckdb_cluster');
  assert.equal(plan.partitions.length, 4);

  const result = await queryExecutorModule.executeQueryPlan(plan);
  assert.equal(result.mode, 'raw');
  assert.equal(result.columns[0], 'timestamp');
  assert.equal(result.rows.length, 12);
  assert.equal(result.rows[0]?.timestamp, '2024-01-01T00:00:00.000Z');
  assert.equal(result.rows[result.rows.length - 1]?.timestamp, '2024-01-01T03:10:00.000Z');
});

test('query planner reflects manifest cache updates after ingestion', async () => {
  const datasetSlug = 'observatory-cache';
  await ingestObservationPartition({
    datasetSlug,
    datasetName: 'Observatory Cache',
    partitionKey: { window: '2024-01-01', dataset: 'observatory' },
    timeRange: {
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-01-01T01:00:00.000Z'
    },
    rows: Array.from({ length: 4 }).map((_, index) => ({
      timestamp: new Date(Date.UTC(2024, 0, 1, 0, index * 10)).toISOString(),
      temperature_c: 24 + index,
      humidity_percent: 58 - index
    }))
  });

  const initialPlan = await queryPlannerModule.buildQueryPlan(datasetSlug, {
    timeRange: {
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-01-01T01:30:00.000Z'
    },
    timestampColumn: 'timestamp'
  });
  assert.equal(initialPlan.partitions.length, 1);

  await ingestObservationPartition({
    datasetSlug,
    partitionKey: { window: '2024-01-01T01', dataset: 'observatory' },
    timeRange: {
      start: '2024-01-01T01:00:00.000Z',
      end: '2024-01-01T02:00:00.000Z'
    },
    rows: Array.from({ length: 3 }).map((_, index) => ({
      timestamp: new Date(Date.UTC(2024, 0, 1, 1, index * 10)).toISOString(),
      temperature_c: 25 + index,
      humidity_percent: 55 - index
    }))
  });

  const planAfter = await queryPlannerModule.buildQueryPlan(datasetSlug, {
    timeRange: {
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-01-01T03:00:00.000Z'
    },
    timestampColumn: 'timestamp'
  });

  assert.equal(planAfter.partitions.length, 2);
});

test('query planner prunes partitions using column filters', async () => {
  const datasetSlug = 'observatory-filters';
  await ingestObservationPartition({
    datasetSlug,
    datasetName: 'Observatory Filters',
    partitionKey: { window: '2024-03-01', segment: 'baseline' },
    timeRange: {
      start: '2024-03-01T00:00:00.000Z',
      end: '2024-03-01T00:30:00.000Z'
    },
    rows: [
      { timestamp: '2024-03-01T00:00:00.000Z', temperature_c: 15, humidity_percent: 45 },
      { timestamp: '2024-03-01T00:10:00.000Z', temperature_c: 16, humidity_percent: 44 }
    ]
  });

  await ingestObservationPartition({
    datasetSlug,
    datasetName: 'Observatory Filters',
    partitionKey: { window: '2024-03-01', segment: 'hot' },
    timeRange: {
      start: '2024-03-01T00:00:00.000Z',
      end: '2024-03-01T00:30:00.000Z'
    },
    rows: [
      { timestamp: '2024-03-01T00:05:00.000Z', temperature_c: 30, humidity_percent: 30 },
      { timestamp: '2024-03-01T00:15:00.000Z', temperature_c: 31, humidity_percent: 29 }
    ]
  });

  const plan = await queryPlannerModule.buildQueryPlan(datasetSlug, {
    timeRange: {
      start: '2024-03-01T00:00:00.000Z',
      end: '2024-03-01T00:30:00.000Z'
    },
    filters: {
      columns: {
        temperature_c: {
          type: 'number',
          eq: 16
        }
      }
    },
    columns: ['timestamp', 'temperature_c']
  });

  assert.equal(plan.partitionSelection.total, 2);
  assert.equal(plan.partitionSelection.selected, 1);
  assert.equal(plan.partitionSelection.pruned, 1);
  assert.equal(plan.partitions.length, 1);

  const result = await queryExecutorModule.executeQueryPlan(plan);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.temperature_c, 16);
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

test('query route returns cumulative rows after multi-batch ingestion', async () => {
  const datasetSlug = `observatory-query-multi-${randomUUID().slice(0, 8)}`;
  const partitionKey = { window: '2024-02-01', dataset: 'observatory' } as const;

  const ingestBatch = async (startMinute: number) => {
    const rows = Array.from({ length: 10 }).map((_, index) => {
      const minute = startMinute + index;
      return {
        timestamp: new Date(Date.UTC(2024, 1, 1, 0, minute)).toISOString(),
        temperature_c: 20 + minute,
        humidity_percent: 50 - index
      };
    });

    await ingestObservationPartition({
      datasetSlug,
      datasetName: 'Observatory Multi Query',
      partitionKey,
      timeRange: {
        start: rows[0]!.timestamp,
        end: rows[rows.length - 1]!.timestamp
      },
      rows
    });
  };

  // Regression: ingest three per-file batches targeting the same partition window.
  await ingestBatch(0);
  await ingestBatch(10);
  await ingestBatch(20);

  const app = fastify();
  await openApiModule.registerOpenApi(app);
  await queryRoutesModule.registerQueryRoutes(app);

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/datasets/${datasetSlug}/query`,
      payload: {
        timeRange: {
          start: '2024-02-01T00:00:00.000Z',
          end: '2024-02-01T00:29:00.000Z'
        },
        timestampColumn: 'timestamp',
        columns: ['timestamp', 'temperature_c'],
        filters: {
          partitionKey: {
            dataset: { type: 'string', eq: 'observatory' },
            window: { type: 'string', eq: '2024-02-01' }
          }
        }
      },
      headers: {
        'x-iam-user': 'query-multi-tester',
        'x-iam-scopes': 'query-scope'
      }
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      rows: Array<Record<string, unknown>>;
      columns: string[];
      mode: string;
    };

    assert.equal(body.mode, 'raw');
    assert.deepEqual(body.columns, ['timestamp', 'temperature_c']);
    assert.equal(body.rows.length, 30);
    const uniqueTimestamps = new Set(body.rows.map((row) => row.timestamp));
    assert.equal(uniqueTimestamps.size, 30);
  } finally {
    await app.close();
  }
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

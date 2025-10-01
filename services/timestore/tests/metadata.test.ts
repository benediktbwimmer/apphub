/// <reference path="../src/types/embeddedPostgres.d.ts" />

import './testEnv';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';

let postgres: EmbeddedPostgres | null = null;
let dataDirectory: string | null = null;

let metadata: typeof import('../src/db/metadata');
let clientModule: typeof import('../src/db/client');
let schemaModule: typeof import('../src/db/schema');
let migrationsModule: typeof import('../src/db/migrations');

before(async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'timestore-pg-'));
  dataDirectory = dataRoot;
  const port = 54000 + Math.floor(Math.random() * 1000);
  const embedded = new EmbeddedPostgres({
    databaseDir: dataRoot,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    postgresFlags: ['-c', 'dynamic_shared_memory_type=posix'],
    onError(message) {
      console.error('[embedded-postgres:metadata]', message);
    }
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('apphub');
  postgres = embedded;

  const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.TIMESTORE_DATABASE_URL = connectionString;
  process.env.TIMESTORE_PG_SCHEMA = `timestore_test_${randomUUID().slice(0, 8)}`;
  process.env.TIMESTORE_PGPOOL_MAX = '4';

  const configModule = await import('../src/config/serviceConfig');
  configModule.resetCachedServiceConfig();

  clientModule = await import('../src/db/client');
  schemaModule = await import('../src/db/schema');
  migrationsModule = await import('../src/db/migrations');
  metadata = await import('../src/db/metadata');

  await schemaModule.ensureSchemaExists(clientModule.POSTGRES_SCHEMA);
  await migrationsModule.runMigrations();
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
});

test('timestore metadata lifecycle', async () => {
  const storageTarget = await metadata.upsertStorageTarget({
    id: `st-${randomUUID()}`,
    name: 'local-default',
    kind: 'local',
    description: 'Local filesystem root',
    config: { root: '/tmp/timestore' }
  });

  assert.equal(storageTarget.kind, 'local');
  assert.equal(storageTarget.name, 'local-default');

  const datasetId = `ds-${randomUUID()}`;
  const dataset = await metadata.createDataset({
    id: datasetId,
    slug: 'observatory-timeseries',
    name: 'Observatory Time Series',
    description: 'Minute-level weather telemetry',
    defaultStorageTargetId: storageTarget.id,
    metadata: { source: 'observatory' }
  });

  assert.equal(dataset.defaultStorageTargetId, storageTarget.id);
  assert.equal(dataset.status, 'active');

  const schemaVersion = await metadata.createDatasetSchemaVersion({
    id: `dsv-${randomUUID()}`,
    datasetId,
    version: 1,
    schema: {
      fields: [
        { name: 'timestamp', type: 'timestamp' },
        { name: 'temperature_c', type: 'float' },
        { name: 'humidity_percent', type: 'float' }
      ]
    }
  });

  assert.equal(schemaVersion.version, 1);

  const now = new Date();
  const manifestShard = now.toISOString().slice(0, 10);
  const manifest = await metadata.createDatasetManifest({
    id: `dm-${randomUUID()}`,
    datasetId,
    version: 1,
    status: 'published',
    manifestShard,
    schemaVersionId: schemaVersion.id,
    summary: { rowsIngested: 240 },
    statistics: { minTimestamp: now.toISOString() },
    metadata: { note: 'Initial load' },
    createdBy: 'ingest-worker',
    partitions: [
      {
        id: `part-${randomUUID()}`,
        storageTargetId: storageTarget.id,
        fileFormat: 'parquet',
        filePath: 'datasets/observatory/2024-01-01.parquet',
        partitionKey: { dataset: 'observatory', window: '2024-01-01' },
        startTime: new Date(now.getTime() - 3_600_000),
        endTime: now,
        fileSizeBytes: 1024,
        rowCount: 120,
        checksum: 'abc123',
        metadata: { columns: 4 }
      },
      {
        id: `part-${randomUUID()}`,
        storageTargetId: storageTarget.id,
        fileFormat: 'parquet',
        filePath: 'datasets/observatory/2024-01-02.parquet',
        partitionKey: { dataset: 'observatory', window: '2024-01-02' },
        startTime: now,
        endTime: new Date(now.getTime() + 3_600_000),
        fileSizeBytes: 2048,
        rowCount: 120,
        checksum: 'def456',
        metadata: { columns: 4 }
      }
    ]
  });

  assert.equal(manifest.partitionCount, 2);
  assert.equal(manifest.totalRows, 240);
  assert.equal(manifest.totalBytes, 3072);
  assert.equal(manifest.partitions.length, 2);

  const latest = await metadata.getLatestPublishedManifest(datasetId);
  assert.ok(latest);
  assert.equal(latest?.id, manifest.id);
  assert.equal(latest?.partitions.length, 2);

  await assert.rejects(
    metadata.createDatasetManifest({
      id: `dm-${randomUUID()}`,
      datasetId,
      version: 1,
      status: 'draft',
      manifestShard,
      partitions: []
    }),
    /Manifest version 1 is not greater/
  );

  const retentionPolicy = await metadata.upsertRetentionPolicy(datasetId, {
    type: 'timeWindow',
    ttlHours: 720,
    coldStorageAfterHours: 168
  });

  assert.equal(retentionPolicy.policy.ttlHours, 720);

  const fetchedPolicy = await metadata.getRetentionPolicy(datasetId);
  assert.ok(fetchedPolicy);
  assert.equal(fetchedPolicy?.policy.coldStorageAfterHours, 168);

  const fetchedDataset = await metadata.getDatasetBySlug('observatory-timeseries');
  assert.ok(fetchedDataset);
  assert.equal(fetchedDataset?.id, datasetId);
});

test('listPartitionsForQuery applies typed partition filters', async () => {
  const storageTarget = await metadata.upsertStorageTarget({
    id: `st-${randomUUID()}`,
    name: `local-${randomUUID().slice(0, 8)}`,
    kind: 'local',
    description: 'Local target for filter testing',
    config: { root: '/tmp/timestore-filters' }
  });

  const datasetId = `ds-${randomUUID()}`;
  const datasetSlug = `partitioned-${randomUUID().slice(0, 8)}`;
  await metadata.createDataset({
    id: datasetId,
    slug: datasetSlug,
    name: 'Partitioned Series',
    defaultStorageTargetId: storageTarget.id
  });

  const baseTime = Date.parse('2024-02-01T00:00:00.000Z');
  const manifestId = `dm-${randomUUID()}`;
  await metadata.createDatasetManifest({
    id: manifestId,
    datasetId,
    version: 1,
    status: 'published',
    manifestShard: '2024-02-01',
    summary: {},
    statistics: {},
    metadata: {},
    partitions: [
      {
        id: `part-${randomUUID()}`,
        storageTargetId: storageTarget.id,
        fileFormat: 'parquet',
        filePath: `datasets/${datasetSlug}/a.parquet`,
        partitionKey: {
          region: 'east',
          shard: 1,
          captured_at: '2024-02-01T00:00:00.000Z'
        },
        startTime: new Date(baseTime),
        endTime: new Date(baseTime + 3_600_000),
        fileSizeBytes: 512,
        rowCount: 100,
        metadata: {}
      },
      {
        id: `part-${randomUUID()}`,
        storageTargetId: storageTarget.id,
        fileFormat: 'parquet',
        filePath: `datasets/${datasetSlug}/b.parquet`,
        partitionKey: {
          region: 'east',
          shard: 3,
          captured_at: '2024-02-01T02:00:00.000Z'
        },
        startTime: new Date(baseTime + 2 * 3_600_000),
        endTime: new Date(baseTime + 3 * 3_600_000),
        fileSizeBytes: 512,
        rowCount: 120,
        metadata: {}
      },
      {
        id: `part-${randomUUID()}`,
        storageTargetId: storageTarget.id,
        fileFormat: 'parquet',
        filePath: `datasets/${datasetSlug}/c.parquet`,
        partitionKey: {
          region: 'west',
          shard: 2,
          captured_at: '2024-02-01T04:00:00.000Z'
        },
        startTime: new Date(baseTime + 4 * 3_600_000),
        endTime: new Date(baseTime + 5 * 3_600_000),
        fileSizeBytes: 512,
        rowCount: 110,
        metadata: {}
      }
    ]
  });

  const rangeStart = new Date(baseTime);
  const rangeEnd = new Date(baseTime + 6 * 3_600_000);

  const allPartitions = await metadata.listPartitionsForQuery(datasetId, rangeStart, rangeEnd);
  assert.equal(allPartitions.length, 3);

  const eastPartitions = await metadata.listPartitionsForQuery(datasetId, rangeStart, rangeEnd, {
    partitionKey: {
      region: { type: 'string', eq: 'east' }
    }
  });
  assert.equal(eastPartitions.length, 2);

  const numericFiltered = await metadata.listPartitionsForQuery(datasetId, rangeStart, rangeEnd, {
    partitionKey: {
      region: { type: 'string', eq: 'east' },
      shard: { type: 'number', gt: 2 }
    }
  });
  assert.equal(numericFiltered.length, 1);
  assert.equal(numericFiltered[0]?.partitionKey.shard, 3);

  const numericSetFiltered = await metadata.listPartitionsForQuery(datasetId, rangeStart, rangeEnd, {
    partitionKey: {
      shard: { type: 'number', in: [2, 3] }
    }
  });
  assert.equal(numericSetFiltered.length, 2);

  const timestampFiltered = await metadata.listPartitionsForQuery(datasetId, rangeStart, rangeEnd, {
    partitionKey: {
      captured_at: {
        type: 'timestamp',
        gte: '2024-02-01T01:00:00.000Z',
        lt: '2024-02-01T03:00:00.000Z'
      }
    }
  });
  assert.equal(timestampFiltered.length, 1);
  assert.equal(timestampFiltered[0]?.partitionKey.captured_at, '2024-02-01T02:00:00.000Z');

  const unmatched = await metadata.listPartitionsForQuery(datasetId, rangeStart, rangeEnd, {
    partitionKey: {
      shard: { type: 'number', gt: 10 }
    }
  });
  assert.equal(unmatched.length, 0);
});

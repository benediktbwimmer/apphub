/// <reference path="../src/types/embeddedPostgres.d.ts" />

import './testEnv';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import EmbeddedPostgres from 'embedded-postgres';
import { loadServiceConfig, resetCachedServiceConfig } from '../src/config/serviceConfig';
import { ensureSchemaExists } from '../src/db/schema';
import { POSTGRES_SCHEMA, closePool, resetPool } from '../src/db/client';
import { runMigrations } from '../src/db/migrations';
import { ensureDefaultStorageTarget } from '../src/service/bootstrap';
import { processIngestionJob } from '../src/ingestion/processor';
import { buildQueryPlan } from '../src/query/planner';
import { executeQueryPlan } from '../src/query/executor';
import { HotBufferStore, setHotBufferTestHarness } from '../src/streaming/hotBuffer';

let postgres: EmbeddedPostgres | null = null;
let dataDirectory: string | null = null;
let storageRoot: string | null = null;

before(async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'timestore-hybrid-pg-'));
  dataDirectory = dataRoot;
  const port = 58000 + Math.floor(Math.random() * 1000);
  const embedded = new EmbeddedPostgres({
    databaseDir: dataRoot,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    postgresFlags: ['-c', 'dynamic_shared_memory_type=posix'],
    onError(message) {
      console.error('[embedded-postgres:hybrid]', message);
    }
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('apphub');
  postgres = embedded;

  storageRoot = await mkdtemp(path.join(tmpdir(), 'timestore-hybrid-storage-'));

  process.env.TIMESTORE_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.TIMESTORE_PG_SCHEMA = `timestore_hybrid_${randomUUID().slice(0, 8)}`;
  process.env.TIMESTORE_PGPOOL_MAX = '4';
  process.env.TIMESTORE_STORAGE_ROOT = storageRoot;
  process.env.REDIS_URL = 'inline';
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';
  process.env.APPHUB_STREAMING_ENABLED = 'true';
  process.env.TIMESTORE_STREAMING_BUFFER_ENABLED = 'true';
  process.env.TIMESTORE_STREAMING_CONNECTORS = '[]';
  process.env.TIMESTORE_STREAMING_BATCHERS = '[]';
  process.env.TIMESTORE_BULK_CONNECTORS = '[]';

  resetCachedServiceConfig();
  await resetPool();
  await ensureSchemaExists(POSTGRES_SCHEMA);
  await runMigrations();
  await ensureDefaultStorageTarget();
});

after(async () => {
  setHotBufferTestHarness(null);
  await closePool();
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

test('hybrid queries merge parquet partitions with streaming buffer rows', async () => {
  const datasetSlug = `hybrid-${randomUUID().slice(0, 8)}`;
  const partitionStart = Date.now();
  const partitionEnd = partitionStart + 60_000;

  await processIngestionJob({
    datasetSlug,
    datasetName: 'Hybrid Dataset',
    tableName: 'observations',
    schema: {
      fields: [
        { name: 'timestamp', type: 'timestamp' },
        { name: 'reading', type: 'double' }
      ]
    },
    partition: {
      key: { window: '2024-01-01T00:00:00Z' },
      attributes: { source: 'hybrid-test' },
      timeRange: {
        start: new Date(partitionStart).toISOString(),
        end: new Date(partitionEnd).toISOString()
      }
    },
    rows: [
      {
        timestamp: new Date(partitionStart + 5_000).toISOString(),
        reading: 10.5
      },
      {
        timestamp: new Date(partitionStart + 20_000).toISOString(),
        reading: 11.1
      }
    ],
    receivedAt: new Date().toISOString()
  });

  const store = new HotBufferStore({
    enabled: true,
    retentionSeconds: 3600,
    maxRowsPerDataset: 100,
    maxTotalRows: undefined,
    refreshWatermarkMs: 5_000,
    fallbackMode: 'parquet_only'
  });

  setHotBufferTestHarness({ store, state: 'ready', enabled: true });
  store.setWatermark(datasetSlug, partitionEnd);
  store.ingest(
    datasetSlug,
    {
      timestamp: new Date(partitionEnd + 10_000).toISOString(),
      reading: 12.2
    },
    partitionEnd + 10_000
  );
  store.ingest(
    datasetSlug,
    {
      timestamp: new Date(partitionEnd + 30_000).toISOString(),
      reading: 12.6
    },
    partitionEnd + 30_000
  );

  const preview = store.query(datasetSlug, {
    rangeStart: new Date(partitionStart - 5_000),
    rangeEnd: new Date(partitionEnd + 30_000),
    timestampColumn: 'timestamp'
  });
  assert.equal(preview.rows.length, 2);

  const config = loadServiceConfig();
  assert.ok(config.streaming.hotBuffer.enabled, 'hot buffer must be enabled for hybrid queries');

  const plan = await buildQueryPlan(datasetSlug, {
    timeRange: {
      start: new Date(partitionStart - 5_000).toISOString(),
      end: new Date(partitionEnd + 30_000).toISOString()
    },
    timestampColumn: 'timestamp'
  });

  const result = await executeQueryPlan(plan);

  assert.ok(result.streaming, 'streaming metadata should be present');
  assert.equal(result.streaming?.bufferState, 'ready');
  assert.equal(result.streaming?.rows, 2);
  assert.equal(result.streaming?.fresh, true);
  assert.ok(result.rows.length >= 4);

  const timestamps = result.rows.map((row) => new Date(String(row.timestamp)).getTime());
  const sorted = [...timestamps].sort((a, b) => a - b);
  assert.deepEqual(timestamps, sorted, 'rows should be sorted by timestamp');

  const streamingValues = result.rows.slice(-2).map((row) => row.reading);
  assert.deepEqual(streamingValues, [12.2, 12.6]);

  setHotBufferTestHarness(null);
});

test('hybrid query errors when buffer unavailable and fallback=error', async () => {
  const datasetSlug = `hybrid-error-${randomUUID().slice(0, 8)}`;
  const partitionStart = Date.now();
  const partitionEnd = partitionStart + 60_000;

  process.env.TIMESTORE_STREAMING_BUFFER_FALLBACK = 'error';
  resetCachedServiceConfig();

  await processIngestionJob({
    datasetSlug,
    datasetName: 'Hybrid Dataset Error Path',
    tableName: 'observations',
    schema: {
      fields: [
        { name: 'timestamp', type: 'timestamp' },
        { name: 'reading', type: 'double' }
      ]
    },
    partition: {
      key: { window: '2024-01-02T00:00:00Z' },
      attributes: { source: 'hybrid-test-error' },
      timeRange: {
        start: new Date(partitionStart).toISOString(),
        end: new Date(partitionEnd).toISOString()
      }
    },
    rows: [
      {
        timestamp: new Date(partitionStart + 5_000).toISOString(),
        reading: 21.5
      }
    ],
    receivedAt: new Date().toISOString()
  });

  const store = new HotBufferStore({
    enabled: true,
    retentionSeconds: 3600,
    maxRowsPerDataset: 100,
    maxTotalRows: undefined,
    refreshWatermarkMs: 5_000,
    fallbackMode: 'error'
  });

  setHotBufferTestHarness({ store, state: 'unavailable', enabled: true });
  store.setWatermark(datasetSlug, partitionEnd);

  const plan = await buildQueryPlan(datasetSlug, {
    timeRange: {
      start: new Date(partitionStart - 5_000).toISOString(),
      end: new Date(partitionEnd + 30_000).toISOString()
    },
    timestampColumn: 'timestamp'
  });

  await assert.rejects(async () => executeQueryPlan(plan), /Streaming hot buffer is unavailable/);

  setHotBufferTestHarness(null);
  delete process.env.TIMESTORE_STREAMING_BUFFER_FALLBACK;
  resetCachedServiceConfig();
});

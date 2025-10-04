/// <reference path="../src/types/embeddedPostgres.d.ts" />

import './testEnv';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
import { loadServiceConfig, resetCachedServiceConfig } from '../src/config/serviceConfig';
import { ensureSchemaExists } from '../src/db/schema';
import { POSTGRES_SCHEMA, closePool, resetPool } from '../src/db/client';
import { runMigrations } from '../src/db/migrations';
import { ensureDefaultStorageTarget } from '../src/service/bootstrap';
import { StreamingBatchProcessor } from '../src/streaming/batchers';
import { getDatasetBySlug, getLatestPublishedManifest, getStreamingWatermark } from '../src/db/metadata';
import type { FastifyBaseLogger } from 'fastify';

let postgres: EmbeddedPostgres | null = null;
let dataDirectory: string | null = null;
let storageRoot: string | null = null;

const logger: FastifyBaseLogger = {
  level: 'info',
  silent: false,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => logger
} as unknown as FastifyBaseLogger;

before(async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'timestore-stream-batcher-pg-'));
  dataDirectory = dataRoot;
  const port = 57000 + Math.floor(Math.random() * 1000);
  const embedded = new EmbeddedPostgres({
    databaseDir: dataRoot,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    postgresFlags: ['-c', 'dynamic_shared_memory_type=posix'],
    onError(message) {
      console.error('[embedded-postgres:streaming-batcher]', message);
    }
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('apphub');
  postgres = embedded;

  storageRoot = await mkdtemp(path.join(tmpdir(), 'timestore-stream-batcher-storage-'));

  process.env.TIMESTORE_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.TIMESTORE_PG_SCHEMA = `timestore_stream_${randomUUID().slice(0, 8)}`;
  process.env.TIMESTORE_PGPOOL_MAX = '4';
  process.env.TIMESTORE_STORAGE_ROOT = storageRoot;
  process.env.REDIS_URL = 'inline';
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';
  process.env.TIMESTORE_STREAMING_CONNECTORS = '[]';
  process.env.TIMESTORE_BULK_CONNECTORS = '[]';
  process.env.TIMESTORE_STREAMING_BATCHERS = '[]';
  process.env.APPHUB_STREAMING_ENABLED = 'true';

  resetCachedServiceConfig();
  await resetPool();
  await ensureSchemaExists(POSTGRES_SCHEMA);
  await runMigrations();
  await ensureDefaultStorageTarget();
});

after(async () => {
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

test('streaming batch processor aggregates windows and records watermarks', async () => {
  const datasetSlug = `stream-${randomUUID().slice(0, 8)}`;
  const config = loadServiceConfig();
  assert.ok(config.streaming.batchers.length === 0);

  const processor = new StreamingBatchProcessor(
    {
      id: 'test-batcher',
      topic: 'apphub.streaming.aggregates',
      groupId: 'test-batcher-group',
      datasetSlug,
      datasetName: 'Streaming Observations',
      tableName: 'streaming_observations',
      schema: {
        fields: [
          { name: 'timestamp', type: 'timestamp' },
          { name: 'user_id', type: 'string' },
          { name: 'total_amount', type: 'double' }
        ]
      },
      timeField: 'timestamp',
      windowSeconds: 60,
      maxRowsPerPartition: 5,
      maxBatchLatencyMs: 250,
      partitionKey: { dataset: datasetSlug },
      partitionAttributes: { source: 'unit_test' },
      startFromEarliest: true
    },
    logger
  );

  const baseTime = new Date('2024-01-01T00:00:00.000Z');
  const events = Array.from({ length: 5 }, (_, index) => ({
    timestamp: new Date(baseTime.getTime() + index * 10_000).toISOString(),
    user_id: `user-${index % 2}`,
    total_amount: 40 + index
  }));

  for (const event of events) {
    await processor.processRecord(event);
  }

  await processor.flushAll('manual');

  const dataset = await getDatasetBySlug(datasetSlug);
  assert.ok(dataset, 'dataset created');

  const manifest = await getLatestPublishedManifest(dataset.id);
  assert.ok(manifest, 'manifest published');
  assert.equal(manifest.partitionCount, 1);
  assert.equal(manifest.totalRows, 5);

  const watermark = await getStreamingWatermark(dataset.id, 'test-batcher');
  assert.ok(watermark, 'watermark persisted');
  assert.equal(watermark.datasetSlug, datasetSlug);
  assert.equal(new Date(watermark.sealedThrough).toISOString(), new Date(baseTime.getTime() + 60_000).toISOString());
  assert.ok(Number(watermark.recordsProcessed) >= 5);

  // Replaying the same events should not create additional partitions.
  for (const event of events) {
    await processor.processRecord(event);
  }
  await processor.flushAll('manual');

  const manifestAfterReplay = await getLatestPublishedManifest(dataset.id);
  assert.ok(manifestAfterReplay);
  assert.equal(manifestAfterReplay.partitionCount, 1);
  assert.equal(manifestAfterReplay.totalRows, 5);

  const watermarkAfterReplay = await getStreamingWatermark(dataset.id, 'test-batcher');
  assert.ok(watermarkAfterReplay);
  assert.equal(new Date(watermarkAfterReplay.sealedThrough).toISOString(), new Date(baseTime.getTime() + 60_000).toISOString());
  assert.ok(Number(watermarkAfterReplay.recordsProcessed) >= 5);
});

/// <reference path="../src/types/embeddedPostgres.d.ts" />

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, appendFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
import { resetCachedServiceConfig, loadServiceConfig } from '../src/config/serviceConfig';
import { initializeIngestionConnectors, shutdownIngestionConnectors } from '../src/ingestion/connectors';
import { ensureSchemaExists } from '../src/db/schema';
import { POSTGRES_SCHEMA, closePool, resetPool } from '../src/db/client';
import { runMigrations } from '../src/db/migrations';
import { ensureDefaultStorageTarget } from '../src/service/bootstrap';
import { getDatasetBySlug, getLatestPublishedManifest } from '../src/db/metadata';
import type { FastifyBaseLogger } from 'fastify';
import { delay } from '../src/ingestion/connectors/utils';

let postgres: EmbeddedPostgres | null = null;
let dataDirectory: string | null = null;
let storageRoot: string | null = null;
let streamingDir: string | null = null;
let bulkDir: string | null = null;

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
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'timestore-connectors-pg-'));
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
      console.error('[embedded-postgres:connectors]', message);
    }
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('apphub');
  postgres = embedded;

  storageRoot = await mkdtemp(path.join(tmpdir(), 'timestore-connectors-storage-'));
  streamingDir = await mkdtemp(path.join(tmpdir(), 'timestore-streaming-'));
  bulkDir = await mkdtemp(path.join(tmpdir(), 'timestore-bulk-'));

  process.env.TIMESTORE_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.TIMESTORE_PG_SCHEMA = `timestore_test_${randomUUID().slice(0, 8)}`;
  process.env.TIMESTORE_PGPOOL_MAX = '4';
  process.env.TIMESTORE_STORAGE_ROOT = storageRoot;
  process.env.REDIS_URL = 'inline';
  process.env.TIMESTORE_PARTITION_INDEX_COLUMNS = '';
  process.env.TIMESTORE_PARTITION_HISTOGRAM_COLUMNS = '';
  process.env.TIMESTORE_PARTITION_BLOOM_COLUMNS = '';
  process.env.TIMESTORE_PARTITION_INDEX_CONFIG = '';
  process.env.TIMESTORE_CONNECTORS_ENABLED = 'false';
  process.env.TIMESTORE_STREAMING_CONNECTORS = '[]';
  process.env.TIMESTORE_BULK_CONNECTORS = '[]';
  process.env.TIMESTORE_CONNECTOR_BACKPRESSURE = JSON.stringify({
    highWatermark: 100,
    lowWatermark: 25,
    minPauseMs: 25,
    maxPauseMs: 200
  });

  resetCachedServiceConfig();
  await resetPool();
  await ensureSchemaExists(POSTGRES_SCHEMA);
  await runMigrations();
  await ensureDefaultStorageTarget();
});

after(async () => {
  await shutdownIngestionConnectors().catch(() => undefined);
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
  if (streamingDir) {
    await rm(streamingDir, { recursive: true, force: true });
  }
  if (bulkDir) {
    await rm(bulkDir, { recursive: true, force: true });
  }
});

function buildStreamingEvent(options: {
  datasetSlug: string;
  timestamp: string;
  temperature: number;
  humidity: number;
  idempotencyKey?: string;
}): Record<string, unknown> {
  return {
    offset: `${options.timestamp}:${options.temperature}`,
    idempotencyKey: options.idempotencyKey,
    ingestion: {
      datasetSlug: options.datasetSlug,
      datasetName: 'Observatory Stream',
      tableName: 'observations',
      schema: {
        fields: [
          { name: 'timestamp', type: 'timestamp' },
          { name: 'temperature_c', type: 'double' },
          { name: 'humidity_percent', type: 'double' }
        ]
      },
      partition: {
        key: { window: options.timestamp.slice(0, 10), dataset: 'observatory' },
        timeRange: {
          start: options.timestamp,
          end: options.timestamp
        }
      },
      rows: [
        {
          timestamp: options.timestamp,
          temperature_c: options.temperature,
          humidity_percent: options.humidity
        }
      ]
    }
  };
}

async function waitFor<T>(fn: () => Promise<T | null | false>, timeoutMs = 5000, intervalMs = 50): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await fn();
    if (result) {
      return result;
    }
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await delay(intervalMs);
  }
}

test('file streaming connector ingests events and respects idempotency', async () => {
  assert.ok(streamingDir);
  const streamPath = path.join(streamingDir!, 'events.ndjson');
  await writeFile(streamPath, '', 'utf8');

  const datasetSlug = `observatory-stream-${randomUUID().slice(0, 8)}`;
  process.env.TIMESTORE_CONNECTORS_ENABLED = 'true';
  process.env.TIMESTORE_STREAMING_CONNECTORS = JSON.stringify([
    {
      id: 'observatory-stream',
      path: streamPath,
      pollIntervalMs: 25,
      batchSize: 10,
      dedupeWindowMs: 60_000,
      startAtOldest: true,
      dlqPath: path.join(streamingDir!, 'stream.dlq')
    }
  ]);
  process.env.TIMESTORE_BULK_CONNECTORS = '[]';
  resetCachedServiceConfig();
  const config = loadServiceConfig();

  await initializeIngestionConnectors({ config, logger });
  try {
    const firstEvent = buildStreamingEvent({
      datasetSlug,
      timestamp: '2024-01-01T00:00:00.000Z',
      temperature: 20.5,
      humidity: 60.2,
      idempotencyKey: 'stream-001'
    });
    const secondEvent = buildStreamingEvent({
      datasetSlug,
      timestamp: '2024-01-01T00:05:00.000Z',
      temperature: 20.9,
      humidity: 59.8,
      idempotencyKey: 'stream-002'
    });

    await appendFile(streamPath, `${JSON.stringify(firstEvent)}\n${JSON.stringify(secondEvent)}\n`, 'utf8');

    const dataset = await waitFor(async () => getDatasetBySlug(datasetSlug));
    assert.equal(dataset.slug, datasetSlug);

    const manifest = await waitFor(async () => {
      const current = await getLatestPublishedManifest(dataset.id);
      if (!current) {
        return null;
      }
      return current.totalRows >= 2 ? current : null;
    });
    assert.equal(manifest.totalRows, 2);
    assert.equal(manifest.partitionCount, 2);

    // Duplicate event should be ignored via idempotency and dedupe tracking.
    await appendFile(streamPath, `${JSON.stringify(firstEvent)}\n`, 'utf8');
    await delay(200);
    const manifestAfterDuplicate = await waitFor(async () => {
      const current = await getLatestPublishedManifest(dataset.id);
      if (!current) {
        return null;
      }
      return current.totalRows === 2 ? current : null;
    });
    assert.equal(manifestAfterDuplicate.totalRows, 2);

    const dlqExists = await stat(path.join(streamingDir!, 'stream.dlq')).then(() => true).catch(() => false);
    assert.equal(dlqExists, false);
  } finally {
    await shutdownIngestionConnectors();
    process.env.TIMESTORE_STREAMING_CONNECTORS = '[]';
    process.env.TIMESTORE_CONNECTORS_ENABLED = 'false';
    resetCachedServiceConfig();
  }
});

test('bulk file loader processes staged files with chunking', async () => {
  assert.ok(bulkDir);
  const datasetSlug = `observatory-bulk-${randomUUID().slice(0, 8)}`;
  const filePath = path.join(bulkDir!, 'batch-001.json');
  const rows = Array.from({ length: 12 }).map((_, index) => ({
    timestamp: new Date(Date.UTC(2024, 1, 1, 0, index * 5)).toISOString(),
    temperature_c: 18 + index * 0.5,
    humidity_percent: 55 - index * 0.3
  }));

  const chunkSize = 5;
  const bulkPayload = {
    ingestion: {
      datasetSlug,
      datasetName: 'Observatory Bulk',
      tableName: 'observations',
      schema: {
        fields: [
          { name: 'timestamp', type: 'timestamp' },
          { name: 'temperature_c', type: 'double' },
          { name: 'humidity_percent', type: 'double' }
        ]
      },
      partition: {
        key: { window: '2024-02-01', dataset: 'observatory' },
        timeRange: {
          start: rows[0]?.timestamp,
          end: rows.at(-1)?.timestamp
        }
      }
    },
    rows,
    chunkSize,
    idempotencyBase: 'bulk-batch-001'
  } satisfies Record<string, unknown>;

  await writeFile(filePath, JSON.stringify(bulkPayload, null, 2), 'utf8');

  process.env.TIMESTORE_CONNECTORS_ENABLED = 'true';
  process.env.TIMESTORE_STREAMING_CONNECTORS = '[]';
  process.env.TIMESTORE_BULK_CONNECTORS = JSON.stringify([
    {
      id: 'observatory-bulk',
      directory: bulkDir!,
      filePattern: '*.json',
      pollIntervalMs: 25,
      chunkSize: 4,
      deleteAfterLoad: false,
      renameOnSuccess: true,
      dlqPath: path.join(bulkDir!, 'bulk.dlq')
    }
  ]);
  resetCachedServiceConfig();
  const config = loadServiceConfig();

  await initializeIngestionConnectors({ config, logger });
  try {
    const dataset = await waitFor(async () => getDatasetBySlug(datasetSlug));
    const manifest = await waitFor(async () => {
      const current = await getLatestPublishedManifest(dataset.id);
      if (!current) {
        return null;
      }
      return current.totalRows === rows.length ? current : null;
    });
    assert.equal(manifest.totalRows, rows.length);
    const expectedPartitions = Math.ceil(rows.length / chunkSize);
    assert.equal(manifest.partitionCount, expectedPartitions);

    const processedFileExists = await waitFor(async () => {
      return stat(`${filePath}.processed`).then(() => true).catch(() => false);
    });
    assert.equal(processedFileExists, true);

    const dlqExists = await stat(path.join(bulkDir!, 'bulk.dlq')).then(() => true).catch(() => false);
    assert.equal(dlqExists, false);
  } finally {
    await shutdownIngestionConnectors();
    process.env.TIMESTORE_BULK_CONNECTORS = '[]';
    process.env.TIMESTORE_CONNECTORS_ENABLED = 'false';
    resetCachedServiceConfig();
  }
});

test('connectors pause when backpressure thresholds exceeded', async () => {
  assert.ok(streamingDir);
  const streamPath = path.join(streamingDir!, 'backpressure.ndjson');
  await writeFile(streamPath, '', 'utf8');

  const datasetSlug = `observatory-backpressure-${randomUUID().slice(0, 8)}`;
  process.env.TIMESTORE_CONNECTORS_ENABLED = 'true';
  process.env.TIMESTORE_STREAMING_CONNECTORS = JSON.stringify([
    {
      id: 'observatory-backpressure',
      path: streamPath,
      pollIntervalMs: 20,
      batchSize: 10,
      dedupeWindowMs: 60_000,
      startAtOldest: true
    }
  ]);
  process.env.TIMESTORE_BULK_CONNECTORS = '[]';
  process.env.TIMESTORE_CONNECTOR_BACKPRESSURE = JSON.stringify({
    highWatermark: 10,
    lowWatermark: 2,
    minPauseMs: 40,
    maxPauseMs: 80
  });
  resetCachedServiceConfig();
  const config = loadServiceConfig();

  let queueDepth = 20;
  await initializeIngestionConnectors(
    { config, logger },
    {
      queueDepthProvider: async () => queueDepth
    }
  );

  try {
    const event = buildStreamingEvent({
      datasetSlug,
      timestamp: '2024-03-01T00:00:00.000Z',
      temperature: 21.5,
      humidity: 58.4,
      idempotencyKey: 'backpressure-1'
    });
    await appendFile(streamPath, `${JSON.stringify(event)}\n`, 'utf8');

    // Allow some time for the connector to observe high queue depth and pause.
    await delay(200);
    const datasetBeforeResume = await getDatasetBySlug(datasetSlug);
    assert.equal(datasetBeforeResume, null);

    // Drop queue depth to allow the connector to resume.
    queueDepth = 0;

    const dataset = await waitFor(async () => getDatasetBySlug(datasetSlug));
    const manifest = await waitFor(async () => getLatestPublishedManifest(dataset.id));
    assert.equal(manifest.totalRows, 1);
  } finally {
    await shutdownIngestionConnectors();
    process.env.TIMESTORE_STREAMING_CONNECTORS = '[]';
    process.env.TIMESTORE_CONNECTORS_ENABLED = 'false';
    process.env.TIMESTORE_CONNECTOR_BACKPRESSURE = JSON.stringify({
      highWatermark: 100,
      lowWatermark: 25,
      minPauseMs: 25,
      maxPauseMs: 200
    });
    resetCachedServiceConfig();
  }
});

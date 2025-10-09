/// <reference path="../src/types/embeddedPostgres.d.ts" />

import './testEnv';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import type EmbeddedPostgres from 'embedded-postgres';
import { createEmbeddedPostgres, stopEmbeddedPostgres } from './utils/embeddedPostgres';
let schemaModule: typeof import('../src/db/schema');
let clientModule: typeof import('../src/db/client');
let migrationsModule: typeof import('../src/db/migrations');
let bootstrapModule: typeof import('../src/service/bootstrap');
let ingestionModule: typeof import('../src/ingestion/processor');
let ingestionTypesModule: typeof import('../src/ingestion/types');
import { resetCachedServiceConfig } from '../src/config/serviceConfig';

let postgres: EmbeddedPostgres | null = null;
let dataDirectory: string | null = null;
let storageRoot: string | null = null;

before(async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'timestore-ingest-pg-'));
  dataDirectory = dataRoot;
  const port = 55000 + Math.floor(Math.random() * 1000);
  const embedded = createEmbeddedPostgres({
    databaseDir: dataRoot,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    postgresFlags: ['-c', 'dynamic_shared_memory_type=posix'],
    onError(message) {
      console.error('[embedded-postgres:ingestion]', message);
    }
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('apphub');
  postgres = embedded;

  storageRoot = await mkdtemp(path.join(tmpdir(), 'timestore-storage-'));

  process.env.TIMESTORE_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.TIMESTORE_PG_SCHEMA = `timestore_test_${randomUUID().slice(0, 8)}`;
  process.env.TIMESTORE_PGPOOL_MAX = '4';
  process.env.TIMESTORE_STORAGE_ROOT = storageRoot;
  process.env.REDIS_URL = 'inline';
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';
  process.env.TIMESTORE_PARTITION_INDEX_COLUMNS = 'temperature_c,humidity_percent';
  process.env.TIMESTORE_PARTITION_BLOOM_COLUMNS = 'temperature_c';
  process.env.TIMESTORE_PARTITION_HISTOGRAM_COLUMNS = 'temperature_c';
  process.env.TIMESTORE_PARTITION_INDEX_HISTOGRAM_BINS = '4';

  resetCachedServiceConfig();

  schemaModule = await import('../src/db/schema');
  clientModule = await import('../src/db/client');
  migrationsModule = await import('../src/db/migrations');
  bootstrapModule = await import('../src/service/bootstrap');
  ingestionModule = await import('../src/ingestion/processor');
  ingestionTypesModule = await import('../src/ingestion/types');

  await schemaModule.ensureSchemaExists(clientModule.POSTGRES_SCHEMA);
  await migrationsModule.runMigrations();
  await bootstrapModule.ensureDefaultStorageTarget();
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

test('processIngestionJob writes partitions and respects idempotency', async () => {
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
    rows: [
      {
        timestamp: '2024-01-01T00:00:00.000Z',
        temperature_c: 20.1,
        humidity_percent: 60.2
      },
      {
        timestamp: '2024-01-01T00:10:00.000Z',
        temperature_c: 20.6,
        humidity_percent: 59.3
      }
    ],
    idempotencyKey: 'batch-001',
    receivedAt: new Date().toISOString()
  });

  const result = await ingestionModule.processIngestionJob(payload);

  assert.equal(result.flushPending, false);
  assert.equal(result.manifest.partitionCount, 1);
  assert.equal(result.manifest.totalRows, 2);
  assert.equal(result.manifest.partitions[0]?.rowCount, 2);
  assert.equal(result.manifest.manifestShard, '2024-01-01');
  const ingestedPartition = result.manifest.partitions[0];
  assert.ok(ingestedPartition);
  const columnStats = (ingestedPartition!.columnStatistics as Record<string, any>) ?? {};
  const temperatureStats = columnStats.temperature_c;
  assert.ok(temperatureStats);
  assert.equal(temperatureStats.type, 'double');
  assert.equal(temperatureStats.rowCount, 2);
  assert.equal(temperatureStats.min, 20.1);
  assert.equal(temperatureStats.max, 20.6);
  const bloomFilters = (ingestedPartition!.columnBloomFilters as Record<string, any>) ?? {};
  assert.ok(bloomFilters.temperature_c);
  assert.equal(typeof bloomFilters.temperature_c.bits, 'string');
  assert.ok(bloomFilters.temperature_c.bits.length > 0);
  assert.equal(ingestedPartition.fileFormat, 'clickhouse');
  assert.ok(typeof ingestedPartition.filePath === 'string');
  assert.ok((ingestedPartition.filePath as string).startsWith('clickhouse://'));

  const repeat = await ingestionModule.processIngestionJob(payload);
  assert.equal(repeat.manifest.id, result.manifest.id);
  assert.equal(repeat.dataset.id, result.dataset.id);
});

test('processIngestionJob deduplicates identical payloads without explicit idempotency key', async () => {
  const datasetSlug = `observatory-dedupe-${randomUUID().slice(0, 8)}`;
  const basePayload = ingestionTypesModule.ingestionJobPayloadSchema.parse({
    datasetSlug,
    datasetName: 'Observatory Dedupe',
    tableName: 'observations',
    schema: {
      fields: [
        { name: 'timestamp', type: 'timestamp' },
        { name: 'temperature_c', type: 'double' },
        { name: 'humidity_percent', type: 'double' }
      ]
    },
    partition: {
      key: { window: '2024-03-01', dataset: 'observatory' },
      timeRange: {
        start: '2024-03-01T00:00:00.000Z',
        end: '2024-03-01T01:00:00.000Z'
      }
    },
    rows: [
      {
        timestamp: '2024-03-01T00:00:00.000Z',
        temperature_c: 18.4,
        humidity_percent: 58.1
      },
      {
        timestamp: '2024-03-01T00:15:00.000Z',
        temperature_c: 18.9,
        humidity_percent: 57.6
      }
    ],
    receivedAt: new Date().toISOString()
  });

  const first = await ingestionModule.processIngestionJob(basePayload);
  assert.equal(first.flushPending, false);
  const second = await ingestionModule.processIngestionJob({
    ...basePayload,
    receivedAt: new Date().toISOString()
  });

  assert.equal(second.flushPending, false);

  assert.equal(second.manifest.id, first.manifest.id);
  assert.equal(second.dataset.id, first.dataset.id);

  const metadataModule = await import('../src/db/metadata');
  const manifest = await metadataModule.getManifestById(first.manifest.id);
  assert.ok(manifest);
  assert.equal(manifest!.partitions.length, 1);
  assert.ok(manifest!.partitions[0]?.ingestionSignature);
});

test('processIngestionJob accumulates rows across multiple batches for a partition window', async () => {
  const metadataModule = await import('../src/db/metadata');
  const datasetSlug = `observatory-multi-batch-${randomUUID().slice(0, 8)}`;
  const partitionKey = { window: '2024-02-01', dataset: 'observatory' };

  const makeBatch = (batchIndex: number) => {
    const startMinute = batchIndex * 10;
    const batchRows = Array.from({ length: 10 }).map((_, rowIndex) => {
      const minute = startMinute + rowIndex;
      const timestamp = new Date(Date.UTC(2024, 1, 1, 0, minute)).toISOString();
      return {
        timestamp,
        temperature_c: 18 + batchIndex,
        humidity_percent: 60 - rowIndex
      } satisfies Record<string, number | string>;
    });

    const rangeStart = new Date(Date.UTC(2024, 1, 1, 0, startMinute)).toISOString();
    const rangeEnd = new Date(Date.UTC(2024, 1, 1, 0, startMinute + 9)).toISOString();

    return ingestionTypesModule.ingestionJobPayloadSchema.parse({
      datasetSlug,
      datasetName: 'Observatory Multi Batch',
      tableName: 'observations',
      schema: {
        fields: [
          { name: 'timestamp', type: 'timestamp' },
          { name: 'temperature_c', type: 'double' },
          { name: 'humidity_percent', type: 'double' }
        ]
      },
      partition: {
        key: partitionKey,
        timeRange: {
          start: rangeStart,
          end: rangeEnd
        }
      },
      rows: batchRows,
      idempotencyKey: `batch-${batchIndex}`,
      receivedAt: rangeStart
    });
  };

  // Regression: ensure consecutive per-file ingestions append rows for the same window instead of overwriting earlier payloads.
  const firstResult = await ingestionModule.processIngestionJob(makeBatch(0));
  assert.equal(firstResult.manifest.totalRows, 10);
  assert.equal(firstResult.manifest.partitionCount, 1);

  const secondResult = await ingestionModule.processIngestionJob(makeBatch(1));
  assert.equal(secondResult.manifest.id, firstResult.manifest.id);
  assert.equal(secondResult.manifest.totalRows, 20);
  assert.equal(secondResult.manifest.partitionCount, 2);

  const thirdResult = await ingestionModule.processIngestionJob(makeBatch(2));
  assert.equal(thirdResult.manifest.id, firstResult.manifest.id);
  assert.equal(thirdResult.manifest.totalRows, 30);
  assert.equal(thirdResult.manifest.partitionCount, 3);
  assert.equal(thirdResult.manifest.partitions.length, 3);
  assert.ok(thirdResult.manifest.partitions.every((partition) => partition.partitionKey.window === '2024-02-01'));
  assert.ok(thirdResult.manifest.partitions.every((partition) => partition.rowCount === 10));

  const storedManifest = await metadataModule.getManifestById(thirdResult.manifest.id);
  assert.ok(storedManifest);
  assert.equal(storedManifest.totalRows, 30);
  assert.equal(storedManifest.partitionCount, 3);
});

test('processIngestionJob shards manifests by partition start date', async () => {
  const metadataModule = await import('../src/db/metadata');

  const dayOnePayload = ingestionTypesModule.ingestionJobPayloadSchema.parse({
    datasetSlug: 'sharded-dataset',
    datasetName: 'Sharded Dataset',
    schema: {
      fields: [
        { name: 'timestamp', type: 'timestamp' },
        { name: 'value', type: 'double' }
      ]
    },
    partition: {
      key: { window: '2024-03-01' },
      timeRange: {
        start: '2024-03-01T00:00:00.000Z',
        end: '2024-03-01T00:30:00.000Z'
      }
    },
    rows: [
      { timestamp: '2024-03-01T00:00:00.000Z', value: 1.23 },
      { timestamp: '2024-03-01T00:10:00.000Z', value: 4.56 }
    ],
    idempotencyKey: 'day-one',
    receivedAt: new Date().toISOString()
  });

  const dayTwoPayload = {
    ...dayOnePayload,
    partition: {
      key: { window: '2024-03-02' },
      timeRange: {
        start: '2024-03-02T00:00:00.000Z',
        end: '2024-03-02T00:30:00.000Z'
      }
    },
    rows: [
      { timestamp: '2024-03-02T00:05:00.000Z', value: 7.89 }
    ],
    idempotencyKey: 'day-two'
  } satisfies typeof dayOnePayload;

  const firstResult = await ingestionModule.processIngestionJob(dayOnePayload);
  const secondResult = await ingestionModule.processIngestionJob(dayTwoPayload);

  assert.equal(firstResult.manifest.manifestShard, '2024-03-01');
  assert.equal(secondResult.manifest.manifestShard, '2024-03-02');
  assert.notEqual(firstResult.manifest.id, secondResult.manifest.id);

  const firstManifest = await metadataModule.getManifestById(firstResult.manifest.id);
  const secondManifest = await metadataModule.getManifestById(secondResult.manifest.id);

  assert.equal(firstManifest?.partitionCount, 1);
  assert.equal(secondManifest?.partitionCount, 1);
});

test('processIngestionJob reuses manifest for additive schema evolution', async () => {
  const metadataModule = await import('../src/db/metadata');

  const basePayload = ingestionTypesModule.ingestionJobPayloadSchema.parse({
    datasetSlug: 'schema-evolution-dataset',
    datasetName: 'Schema Evolution Dataset',
    tableName: 'observations',
    schema: {
      fields: [
        { name: 'timestamp', type: 'timestamp' },
        { name: 'temperature_c', type: 'double' }
      ]
    },
    partition: {
      key: { window: '2024-04-01' },
      timeRange: {
        start: '2024-04-01T00:00:00.000Z',
        end: '2024-04-01T00:30:00.000Z'
      }
    },
    rows: [
      { timestamp: '2024-04-01T00:00:00.000Z', temperature_c: 18.5 },
      { timestamp: '2024-04-01T00:15:00.000Z', temperature_c: 19.1 }
    ],
    idempotencyKey: 'schema-evolution-base',
    receivedAt: new Date().toISOString()
  });

  const initialResult = await ingestionModule.processIngestionJob(basePayload);
  assert.ok(initialResult.manifest.schemaVersionId);

  const additivePayload = {
    ...basePayload,
    schema: {
      fields: [
        { name: 'timestamp', type: 'timestamp' },
        { name: 'temperature_c', type: 'double' },
        { name: 'wind_speed_mps', type: 'double' }
      ],
      evolution: {
        backfill: true,
        defaults: {
          wind_speed_mps: 0
        }
      }
    },
    partition: {
      key: { window: '2024-04-01', batch: 'evening' },
      timeRange: {
        start: '2024-04-01T18:00:00.000Z',
        end: '2024-04-01T18:30:00.000Z'
      }
    },
    rows: [
      {
        timestamp: '2024-04-01T18:05:00.000Z',
        temperature_c: 17.8,
        wind_speed_mps: 4.2
      }
    ],
    idempotencyKey: 'schema-evolution-additive'
  } satisfies typeof basePayload;

  const additiveResult = await ingestionModule.processIngestionJob(additivePayload);

  assert.equal(additiveResult.manifest.id, initialResult.manifest.id);
  assert.notEqual(additiveResult.manifest.schemaVersionId, initialResult.manifest.schemaVersionId);
  assert.equal(additiveResult.manifest.partitionCount, 2);
  assert.equal(additiveResult.manifest.partitions.length, 2);
  assert.equal(
    additiveResult.manifest.partitions[additiveResult.manifest.partitions.length - 1]?.metadata.schemaVersionId,
    additiveResult.manifest.schemaVersionId
  );

  const manifestRecord = await metadataModule.getManifestById(additiveResult.manifest.id);
  assert.ok(manifestRecord);
  const schemaEvolutionMetadata = manifestRecord?.metadata?.schemaEvolution as
    | { status: string; addedColumns: string[]; requestedBackfill: boolean }
    | undefined;
  assert.ok(schemaEvolutionMetadata);
  assert.deepEqual(schemaEvolutionMetadata?.addedColumns, ['wind_speed_mps']);
  assert.equal(schemaEvolutionMetadata?.requestedBackfill, true);
});

test('processIngestionJob rejects incompatible schema changes', async () => {
  const basePayload = ingestionTypesModule.ingestionJobPayloadSchema.parse({
    datasetSlug: 'schema-evolution-incompatible',
    datasetName: 'Schema Evolution Incompatible Dataset',
    schema: {
      fields: [
        { name: 'timestamp', type: 'timestamp' },
        { name: 'temperature_c', type: 'double' }
      ]
    },
    partition: {
      key: { window: '2024-05-01' },
      timeRange: {
        start: '2024-05-01T00:00:00.000Z',
        end: '2024-05-01T00:10:00.000Z'
      }
    },
    rows: [
      { timestamp: '2024-05-01T00:00:00.000Z', temperature_c: 20.2 }
    ],
    idempotencyKey: 'schema-incompat-base',
    receivedAt: new Date().toISOString()
  });

  await ingestionModule.processIngestionJob(basePayload);

  const incompatiblePayload = {
    ...basePayload,
    schema: {
      fields: [
        { name: 'timestamp', type: 'timestamp' },
        { name: 'temperature_c', type: 'string' }
      ]
    },
    partition: {
      key: { window: '2024-05-01', batch: 'evening' },
      timeRange: {
        start: '2024-05-01T18:00:00.000Z',
        end: '2024-05-01T18:10:00.000Z'
      }
    },
    idempotencyKey: 'schema-incompat-change'
  } satisfies typeof basePayload;

  await assert.rejects(async () => {
    await ingestionModule.processIngestionJob(incompatiblePayload);
  }, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'SchemaEvolutionError');
    assert.match(error.message, /incompatible/i);
    return true;
  });
});

test('processIngestionJob stores partition attributes alongside key fields', async () => {
  const payload = ingestionTypesModule.ingestionJobPayloadSchema.parse({
    datasetSlug: 'attributes-dataset',
    datasetName: 'Attributes Dataset',
    schema: {
      fields: [
        { name: 'timestamp', type: 'timestamp' },
        { name: 'reading', type: 'double' }
      ]
    },
    partition: {
      key: { dataset: 'observatory', instrument: 'instrument_alpha', window: '2024-04-01T10:00' },
      attributes: {
        instrumentId: 'instrument_alpha',
        window: '2024-04-01T10:00',
        minuteKey: '2024-04-01T10-00'
      },
      timeRange: {
        start: '2024-04-01T10:00:00.000Z',
        end: '2024-04-01T10:59:59.999Z'
      }
    },
    rows: [
      { timestamp: '2024-04-01T10:00:00.000Z', reading: 42 },
      { timestamp: '2024-04-01T10:01:00.000Z', reading: 43 }
    ],
    receivedAt: '2024-04-01T10:05:00.000Z'
  });

  const result = await ingestionModule.processIngestionJob(payload);
  const [partition] = result.manifest.partitions;
  assert.ok(partition);
  assert.equal(partition.partitionKey.instrument, 'instrument_alpha');
  assert.equal(partition.partitionKey.window, '2024-04-01T10:00');
  assert.equal(partition.metadata?.attributes?.instrumentId, 'instrument_alpha');
  assert.equal(partition.metadata?.attributes?.window, '2024-04-01T10:00');
});

test('partition build job payload requires rows or source file', () => {
  const payload = ingestionTypesModule.partitionBuildJobPayloadSchema.parse({
    datasetSlug: 'payload-test',
    storageTargetId: 'st-123',
    partitionId: 'part-123',
    partitionKey: { window: '2024-01-01' },
    tableName: 'records',
    schema: [
      { name: 'timestamp', type: 'timestamp' },
      { name: 'value', type: 'double' }
    ],
    rows: [
      {
        timestamp: '2024-01-01T00:00:00.000Z',
        value: 42
      }
    ]
  });

  assert.equal(payload.rows?.length, 1);

  assert.throws(() => {
    ingestionTypesModule.partitionBuildJobPayloadSchema.parse({
      datasetSlug: 'payload-test',
      storageTargetId: 'st-123',
      partitionId: 'part-456',
      partitionKey: { window: '2024-01-02' },
      tableName: 'records',
      schema: [
        { name: 'timestamp', type: 'timestamp' }
      ]
    });
  }, /requires rows or a source file path/);
});

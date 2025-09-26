/// <reference path="../src/types/embeddedPostgres.d.ts" />

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
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
  const embedded = new EmbeddedPostgres({
    databaseDir: dataRoot,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false
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

  assert.equal(result.manifest.partitionCount, 1);
  assert.equal(result.manifest.totalRows, 2);
  assert.equal(result.manifest.partitions[0]?.rowCount, 2);
  assert.ok(storageRoot);
  const partitionPath = path.join(
    storageRoot!,
    result.manifest.partitions[0]?.filePath ?? ''
  );
  const stats = await stat(partitionPath);
  assert.ok(stats.size > 0);

  const repeat = await ingestionModule.processIngestionJob(payload);
  assert.equal(repeat.manifest.id, result.manifest.id);
  assert.equal(repeat.dataset.id, result.dataset.id);
});

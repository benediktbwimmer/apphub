import './testEnv';

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import type EmbeddedPostgres from 'embedded-postgres';
import {
  getStagingSchemaRegistry,
  upsertStagingSchemaRegistry
} from '../src/db/stagingSchemaRegistry';
import { createDataset } from '../src/db/metadata';
import { loadServiceConfig, resetCachedServiceConfig } from '../src/config/serviceConfig';
import { getStagingWriteManager, resetStagingWriteManager } from '../src/ingestion/stagingManager';
import { readStagingSchemaFields } from '../src/sql/stagingSchema';
import { createEmbeddedPostgres, stopEmbeddedPostgres } from './utils/embeddedPostgres';

let stagingDir: string | null = null;
let postgres: EmbeddedPostgres | null = null;
let dataDirectory: string | null = null;
let clientModule: typeof import('../src/db/client');
let schemaModule: typeof import('../src/db/schema');
let migrationsModule: typeof import('../src/db/migrations');

before(async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'timestore-registry-pg-'));
  dataDirectory = dataRoot;
  const port = 54000 + Math.floor(Math.random() * 1000);
  const embedded = createEmbeddedPostgres({
    databaseDir: dataRoot,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    postgresFlags: ['-c', 'dynamic_shared_memory_type=posix'],
    onError(message) {
      console.error('[embedded-postgres:staging-schema]', message);
    }
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('apphub');
  postgres = embedded;

  const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.TIMESTORE_DATABASE_URL = connectionString;
  process.env.TIMESTORE_PG_SCHEMA = `timestore_schema_registry_${randomUUID().slice(0, 8)}`;
  process.env.TIMESTORE_PGPOOL_MAX = '4';

  const configModule = await import('../src/config/serviceConfig');
  configModule.resetCachedServiceConfig();

  clientModule = await import('../src/db/client');
  await clientModule.resetPool();
  schemaModule = await import('../src/db/schema');
  migrationsModule = await import('../src/db/migrations');

  await schemaModule.ensureSchemaExists(clientModule.POSTGRES_SCHEMA);
  await migrationsModule.runMigrations();
});

beforeEach(async () => {
  stagingDir = await mkdtemp(path.join(tmpdir(), 'timestore-staging-registry-'));
  process.env.TIMESTORE_STAGING_DIRECTORY = stagingDir;
  resetCachedServiceConfig();
});

afterEach(async () => {
  await resetStagingWriteManager();
  resetCachedServiceConfig();
  if (stagingDir) {
    await rm(stagingDir, { recursive: true, force: true });
    stagingDir = null;
  }
  delete process.env.TIMESTORE_STAGING_DIRECTORY;
});

after(async () => {
  if (clientModule) {
    await clientModule.closePool();
  }
  await stopEmbeddedPostgres(postgres);
  postgres = null;
  if (dataDirectory) {
    await rm(dataDirectory, { recursive: true, force: true });
    dataDirectory = null;
  }
});

test('upsertStagingSchemaRegistry increments version only on schema change', async () => {
  const datasetId = `ds-${randomUUID()}`;
  const dataset = await createDataset({
    id: datasetId,
    slug: `schema-registry-${randomUUID()}`,
    name: 'Schema Registry Test'
  });

  const baseFields = [
    { name: 'timestamp', type: 'timestamp', nullable: true, description: null },
    { name: 'value', type: 'double', nullable: true, description: null }
  ];

  const first = await upsertStagingSchemaRegistry({
    datasetId: dataset.id,
    fields: baseFields,
    sourceBatchId: 'batch-1'
  });
  assert.equal(first.record.schemaVersion, 1);
  assert.equal(first.status, 'created');

  const second = await upsertStagingSchemaRegistry({
    datasetId: dataset.id,
    fields: baseFields,
    sourceBatchId: 'batch-1'
  });
  assert.equal(second.record.schemaVersion, 1);
  assert.equal(second.status, 'unchanged');

  const third = await upsertStagingSchemaRegistry({
    datasetId: dataset.id,
    fields: [
      ...baseFields,
      { name: 'status', type: 'string', nullable: true, description: null }
    ],
    sourceBatchId: 'batch-2'
  });
  assert.equal(third.record.schemaVersion, 2);
  assert.equal(third.record.fields.length, 3);
  assert.equal(third.status, 'updated');

  const loaded = await getStagingSchemaRegistry(dataset.id);
  assert.ok(loaded);
  assert.equal(loaded?.schemaVersion, 2);
  assert.equal(loaded?.fields.length, 3);
});

test('readStagingSchemaFields returns registry fields with caching', async () => {
  const datasetId = `ds-${randomUUID()}`;
  const slug = `registry-read-${randomUUID()}`;
  const dataset = await createDataset({
    id: datasetId,
    slug,
    name: 'Registry Read Test'
  });

  await upsertStagingSchemaRegistry({
    datasetId,
    fields: [
      { name: 'timestamp', type: 'timestamp', nullable: true, description: null },
      { name: 'value', type: 'double', nullable: true, description: null }
    ],
    sourceBatchId: 'batch-1'
  });

  const config = loadServiceConfig();
  const first = await readStagingSchemaFields(dataset, config);
  assert.equal(first.length, 2);
  assert.equal(first[0].name, 'timestamp');

  const second = await readStagingSchemaFields(dataset, config);
  assert.equal(second.length, 2);
});

test('readStagingSchemaFields falls back to pending batches and seeds registry', async () => {
  const datasetId = `ds-${randomUUID()}`;
  const slug = `registry-fallback-${randomUUID()}`;
  const dataset = await createDataset({
    id: datasetId,
    slug,
    name: 'Registry Fallback Test'
  });

  const config = loadServiceConfig();
  const stagingManager = getStagingWriteManager(config);

  await stagingManager.enqueue({
    datasetSlug: slug,
    tableName: 'records',
    schema: [
      { name: 'timestamp', type: 'timestamp' },
      { name: 'value', type: 'double' }
    ],
    rows: [{ timestamp: new Date().toISOString(), value: 42 }],
    partitionKey: { window: new Date().toISOString() },
    partitionAttributes: null,
    timeRange: {
      start: new Date().toISOString(),
      end: new Date().toISOString()
    },
    ingestionSignature: `sig-${randomUUID()}`,
    receivedAt: new Date().toISOString(),
    idempotencyKey: null,
    schemaDefaults: null,
    backfillRequested: false
  });

  const fields = await readStagingSchemaFields(dataset, config);
  assert.equal(fields.length, 2);
  assert.ok(await getStagingSchemaRegistry(dataset.id));
});

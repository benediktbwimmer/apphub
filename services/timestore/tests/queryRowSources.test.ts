/// <reference path="../src/types/embeddedPostgres.d.ts" />

import './testEnv';

import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, mkdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, afterEach, before, describe, test } from 'node:test';
import type EmbeddedPostgres from 'embedded-postgres';
import {
  createEmbeddedPostgres,
  stopEmbeddedPostgres
} from './utils/embeddedPostgres';
import { HotBufferStore, setHotBufferTestHarness } from '../src/streaming/hotBuffer';
import { HotBufferRowSource, StagingRowSource, PublishedRowSource } from '../src/query/rowSources';
import { upsertStorageTarget, createDataset, createDatasetSchemaVersion, createDatasetManifest } from '../src/db/metadata';
import type { DatasetRecord } from '../src/db/metadata';
import { getStagingWriteManager, resetStagingWriteManager } from '../src/ingestion/stagingManager';
import { upsertStagingSchemaRegistry } from '../src/db/stagingSchemaRegistry';
import type { FieldDefinition } from '../src/storage';
import { loadServiceConfig, resetCachedServiceConfig } from '../src/config/serviceConfig';
import { loadDuckDb, isCloseable } from '@apphub/shared';
import { getHotBufferTestStore } from '../src/streaming/hotBuffer';

let postgres: EmbeddedPostgres | null = null;
let dataDir: string | null = null;
let storageRoot: string | null = null;
let stagingDir: string | null = null;
let clientModule: typeof import('../src/db/client');
let schemaModule: typeof import('../src/db/schema');
let migrationsModule: typeof import('../src/db/migrations');

const TIMESTAMP_COLUMN = 'timestamp';

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'timestore-row-sources-pg-'));
  storageRoot = await mkdtemp(path.join(tmpdir(), 'timestore-row-sources-storage-'));
  stagingDir = path.join(storageRoot, 'staging');
  await mkdir(stagingDir, { recursive: true });
  const port = 56000 + Math.floor(Math.random() * 1000);
  const embedded = createEmbeddedPostgres({
    databaseDir: dataDir,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    postgresFlags: ['-c', 'dynamic_shared_memory_type=posix'],
    onError(message) {
      console.error('[embedded-postgres:row-sources]', message);
    }
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('apphub');
  postgres = embedded;

  process.env.TIMESTORE_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.TIMESTORE_PG_SCHEMA = `timestore_row_sources_${randomUUID().slice(0, 8)}`;
  process.env.TIMESTORE_STORAGE_ROOT = storageRoot;
  process.env.TIMESTORE_STAGING_DIRECTORY = stagingDir;
  process.env.TIMESTORE_STREAMING_ENABLED = 'false';

  resetCachedServiceConfig();

  clientModule = await import('../src/db/client');
  await clientModule.resetPool();
  schemaModule = await import('../src/db/schema');
  migrationsModule = await import('../src/db/migrations');

  await schemaModule.ensureSchemaExists(clientModule.POSTGRES_SCHEMA);
  await migrationsModule.runMigrations();
});

after(async () => {
  await resetStagingWriteManager();
  await clientModule.closePool();
  await stopEmbeddedPostgres(postgres);
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true });
  }
  if (storageRoot) {
    await rm(storageRoot, { recursive: true, force: true });
  }
  setHotBufferTestHarness(null);
  postgres = null;
  delete process.env.TIMESTORE_DATABASE_URL;
  delete process.env.TIMESTORE_PG_SCHEMA;
  delete process.env.TIMESTORE_STORAGE_ROOT;
  delete process.env.TIMESTORE_STAGING_DIRECTORY;
  delete process.env.TIMESTORE_STREAMING_ENABLED;
  resetCachedServiceConfig();
});

afterEach(async () => {
  setHotBufferTestHarness(null);
  await resetStagingWriteManager();
  resetCachedServiceConfig();
});

describe('HotBufferRowSource', () => {
  test('returns rows from hot buffer test harness', async () => {
    const dataset = await createDataset({
      id: `ds-${randomUUID()}`,
      slug: `hb-${randomUUID().slice(0, 8)}`,
      name: 'Hot Buffer Dataset'
    });

    const store = new HotBufferStore({
      enabled: true,
      retentionSeconds: 3600,
      watermarkGraceSeconds: 0,
      maxRows: 1000
    });
    setHotBufferTestHarness({ store, state: 'ready', enabled: true });
    const now = Date.now();
    store.ingest(dataset.slug, {
      [TIMESTAMP_COLUMN]: new Date(now - 60000).toISOString(),
      value: 1
    }, now - 60000);
    store.ingest(dataset.slug, {
      [TIMESTAMP_COLUMN]: new Date(now - 30000).toISOString(),
      value: 2
    }, now - 30000);

    const source = new HotBufferRowSource();
    const result = await source.fetchRows({
      dataset,
      timestampColumn: TIMESTAMP_COLUMN,
      rangeStart: new Date(now - 120000),
      rangeEnd: new Date(now),
      limit: 10
    });

    assert.equal(result.source, 'hot_buffer');
    assert.equal(result.rows.length, 2);
    assert.ok(result.metadata);
    assert.equal(result.metadata?.bufferState, 'ready');
    assert.deepEqual(
      result.rows.map((row) => row.value),
      [1, 2]
    );
    assert(getHotBufferTestStore());
  });
});

describe('StagingRowSource', () => {
  test('returns rows from staging DuckDB', async () => {
    const datasetSlug = `staging-${randomUUID().slice(0, 8)}`;
    const dataset = await createDataset({
      id: `ds-${randomUUID()}`,
      slug: datasetSlug,
      name: 'Staging Dataset'
    });
    const fields: FieldDefinition[] = [
      { name: TIMESTAMP_COLUMN, type: 'timestamp' },
      { name: 'value', type: 'double' }
    ];
    await upsertStagingSchemaRegistry({
      datasetId: dataset.id,
      fields: fields.map((field) => ({
        name: field.name,
        type: field.type,
        nullable: true,
        description: null
      })),
      sourceBatchId: null
    });

    const config = loadServiceConfig();
    const stagingManager = getStagingWriteManager(config);
    const receivedAt = new Date().toISOString();
    const timeRange = {
      start: new Date(Date.now() - 60000).toISOString(),
      end: new Date(Date.now() - 30000).toISOString()
    };
    const stageResult = await stagingManager.enqueue({
      datasetSlug,
      tableName: 'records',
      schema: fields,
      rows: [
        { [TIMESTAMP_COLUMN]: new Date(timeRange.start).toISOString(), value: 10 },
        { [TIMESTAMP_COLUMN]: new Date(timeRange.end).toISOString(), value: 15 }
      ],
      partitionKey: { window: timeRange.start },
      partitionAttributes: null,
      timeRange,
      ingestionSignature: `sig-${randomUUID()}`,
      receivedAt,
      idempotencyKey: null,
      schemaDefaults: null,
      backfillRequested: false
    });

    await upsertStagingSchemaRegistry({
      datasetId: dataset.id,
      fields: fields.map((field) => ({
        name: field.name,
        type: field.type,
        nullable: true,
        description: null
      })),
      sourceBatchId: stageResult.batchId
    });

    const source = new StagingRowSource();
    const result = await source.fetchRows({
      dataset,
      timestampColumn: TIMESTAMP_COLUMN,
      rangeStart: new Date(Date.now() - 120000),
      rangeEnd: new Date(),
      limit: 5
    });

    assert.equal(result.source, 'staging');
    assert.equal(result.rows.length, 2);
    const values = result.rows.map((row) => row.value);
    assert.deepEqual(values.sort((a, b) => Number(a) - Number(b)), [10, 15]);
  });
});

describe('PublishedRowSource', () => {
  test('returns rows from published partitions', async () => {
    const config = loadServiceConfig();
    const storageTarget = await upsertStorageTarget({
      id: `st-${randomUUID()}`,
      name: 'local-target',
      kind: 'local',
      description: 'local storage target',
      config: {
        root: config.storage.root
      }
    });

    const datasetSlug = `published-${randomUUID().slice(0, 8)}`;
    const dataset = await createDataset({
      id: `ds-${randomUUID()}`,
      slug: datasetSlug,
      name: 'Published Dataset',
      defaultStorageTargetId: storageTarget.id
    });

    const fields: FieldDefinition[] = [
      { name: TIMESTAMP_COLUMN, type: 'timestamp' },
      { name: 'value', type: 'double' }
    ];
    const schema = { fields };
    const checksum = createHash('sha1').update(JSON.stringify(schema)).digest('hex');
    const schemaVersion = await createDatasetSchemaVersion({
      id: `dsv-${randomUUID()}`,
      datasetId: dataset.id,
      version: 1,
      description: 'test schema',
      schema,
      checksum
    });

    const partitionId = `part-${randomUUID()}`;
    const partitionKey = { window: new Date().toISOString().slice(0, 10) };
    const relativePath = path.posix.join(
      dataset.slug,
      `window=${partitionKey.window}`,
      `${partitionId}.parquet`
    );
    const absolutePath = path.join(config.storage.root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeParquetFile(absolutePath, 'records', fields, [
      { [TIMESTAMP_COLUMN]: new Date(Date.now() - 60000).toISOString(), value: 42 },
      { [TIMESTAMP_COLUMN]: new Date(Date.now() - 30000).toISOString(), value: 43 }
    ]);
    const fileStats = await stat(absolutePath);
    const fileBuffer = await readFile(absolutePath);
    const fileChecksum = createHash('sha1').update(fileBuffer).digest('hex');

    await createDatasetManifest({
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
          partitionKey,
          startTime: new Date(Date.now() - 120000),
          endTime: new Date(),
          fileSizeBytes: fileStats.size,
          rowCount: 2,
          checksum: fileChecksum,
          metadata: {
            tableName: 'records'
          }
        }
      ]
    });

    const source = new PublishedRowSource();
    const result = await source.fetchRows({
      dataset,
      timestampColumn: TIMESTAMP_COLUMN,
      rangeStart: new Date(Date.now() - 3600000),
      rangeEnd: new Date(),
      limit: 10,
      config
    });

    assert.equal(result.source, 'published');
    assert.equal(result.rows.length, 2);
    const values = result.rows.map((row) => row.value);
    assert.deepEqual(values.sort((a, b) => Number(a) - Number(b)), [42, 43]);
  });
});

async function writeParquetFile(
  filePath: string,
  tableName: string,
  schema: FieldDefinition[],
  rows: Record<string, unknown>[]
): Promise<void> {
  const duckdb = loadDuckDb();
  const db = new duckdb.Database(':memory:');
  const connection = db.connect();

  try {
    const columns = schema
      .map((field) => `${quoteIdentifier(field.name)} ${mapDuckDbType(field.type)}`)
      .join(', ');
    await run(connection, `CREATE TABLE ${quoteIdentifier(tableName)} (${columns})`);
    const columnNames = schema.map((field) => field.name);
    const insertSql = `INSERT INTO ${quoteIdentifier(tableName)} (${columnNames.map(quoteIdentifier).join(', ')}) VALUES (${columnNames.map(() => '?').join(', ')})`;
    for (const row of rows) {
      const values = columnNames.map((name) => row[name]);
      await run(connection, insertSql, ...values);
    }
    const escapedPath = filePath.replace(/'/g, "''");
    await run(connection, `COPY ${quoteIdentifier(tableName)} TO '${escapedPath}' (FORMAT PARQUET)`);
  } finally {
    await closeConnection(connection);
    if (isCloseable(db)) {
      db.close();
    }
  }
}

function quoteIdentifier(identifier: string): string {
  return `\"${identifier.replace(/\"/g, '\"\"')}\"`;
}

function mapDuckDbType(type: FieldDefinition['type']): string {
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

function run(connection: any, sql: string, ...params: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.run(sql, ...params, (err: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function closeConnection(connection: any): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.close((err: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

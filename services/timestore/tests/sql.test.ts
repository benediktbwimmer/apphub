/// <reference path="../src/types/embeddedPostgres.d.ts" />

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, describe, test } from 'node:test';
import fastify from 'fastify';
import EmbeddedPostgres from 'embedded-postgres';
import { loadServiceConfig, resetCachedServiceConfig } from '../src/config/serviceConfig';

let postgres: EmbeddedPostgres | null = null;
let dataDirectory: string | null = null;
let storageRoot: string | null = null;
let app: ReturnType<typeof fastify> | null = null;

let clientModule: typeof import('../src/db/client');
let schemaModule: typeof import('../src/db/schema');
let migrationsModule: typeof import('../src/db/migrations');
let metadataModule: typeof import('../src/db/metadata');
let storageModule: typeof import('../src/storage');
let sqlRoutesModule: typeof import('../src/routes/sql');

let datasetSlug: string;

before(async () => {
  process.env.TIMESTORE_SQL_READ_SCOPE = 'sql:read';
  process.env.TIMESTORE_SQL_EXEC_SCOPE = 'sql:exec';
  process.env.REDIS_URL = 'inline';

  dataDirectory = await mkdtemp(path.join(tmpdir(), 'timestore-sql-pg-'));
  storageRoot = await mkdtemp(path.join(tmpdir(), 'timestore-sql-storage-'));
  process.env.TIMESTORE_STORAGE_ROOT = storageRoot;
  process.env.TIMESTORE_STORAGE_DRIVER = 'local';
  const port = 59000 + Math.floor(Math.random() * 1000);

  const embedded = new EmbeddedPostgres({
    databaseDir: dataDirectory,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    postgresFlags: ['-c', 'dynamic_shared_memory_type=posix'],
    onError(message) {
      console.error('[embedded-postgres:sql]', message);
    }
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('apphub');
  postgres = embedded;

  process.env.TIMESTORE_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.TIMESTORE_PG_SCHEMA = `timestore_sql_${randomUUID().slice(0, 8)}`;

  resetCachedServiceConfig();
  delete require.cache[require.resolve('../src/service/iam')];

  clientModule = await import('../src/db/client');
  schemaModule = await import('../src/db/schema');
  migrationsModule = await import('../src/db/migrations');
  metadataModule = await import('../src/db/metadata');
  storageModule = await import('../src/storage');
  sqlRoutesModule = await import('../src/routes/sql');

  await schemaModule.ensureSchemaExists(clientModule.POSTGRES_SCHEMA);
  await migrationsModule.runMigrations();
  await seedSamples();
  await seedDuckDbDataset();

  app = fastify();
  await sqlRoutesModule.registerSqlRoutes(app);
});

after(async () => {
  if (app) {
    await app.close();
  }
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

async function seedSamples(): Promise<void> {
  await clientModule.withConnection(async (client) => {
    await client.query(`
      CREATE TABLE sql_samples (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        score NUMERIC
      )
    `);
    const entries = [
      ['Orion', 42.5],
      ['Lyra', 37.1],
      ['Cygnus', 18.3]
    ];
    for (const [name, score] of entries) {
      await client.query('INSERT INTO sql_samples (name, score) VALUES ($1, $2)', [name, score]);
    }
  });
}

async function seedDuckDbDataset(): Promise<void> {
  const config = loadServiceConfig();
  const storageTarget = await metadataModule.upsertStorageTarget({
    id: `st-${randomUUID()}`,
    name: 'local-test-target',
    kind: 'local',
    description: 'local test storage',
    config: { root: storageRoot }
  });

  const dataset = await metadataModule.createDataset({
    id: `ds-${randomUUID()}`,
    slug: 'observatory_timeseries',
    name: 'Observatory Timeseries',
    description: 'seed dataset for SQL tests',
    defaultStorageTargetId: storageTarget.id,
    metadata: {}
  });
  datasetSlug = dataset.slug;

  const schemaFields = [
    { name: 'timestamp', type: 'timestamp' },
    { name: 'site', type: 'string' },
    { name: 'value', type: 'double' }
  ];

  const schemaVersion = await metadataModule.createDatasetSchemaVersion({
    id: `dsv-${randomUUID()}`,
    datasetId: dataset.id,
    version: 1,
    schema: { fields: schemaFields },
    description: 'seed schema'
  });

  const driver = storageModule.createStorageDriver(config, storageTarget);
  const partitionId = `part-${randomUUID()}`;
  const startTime = new Date('2024-01-01T00:00:00Z');
  const endTime = new Date('2024-01-01T00:10:00Z');
  const rows = [
    { timestamp: startTime, site: 'alpha', value: 42.5 },
    { timestamp: endTime, site: 'beta', value: 37.1 }
  ];

  const writeResult = await driver.writePartition({
    datasetSlug: dataset.slug,
    partitionId,
    partitionKey: { day: '2024-01-01' },
    tableName: 'records',
    schema: schemaFields,
    rows
  });

  await metadataModule.createDatasetManifest({
    id: `dm-${randomUUID()}`,
    datasetId: dataset.id,
    version: 1,
    status: 'published',
    schemaVersionId: schemaVersion.id,
    summary: { note: 'sql test manifest' },
    statistics: {
      rowCount: writeResult.rowCount,
      fileSizeBytes: writeResult.fileSizeBytes,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString()
    },
    metadata: { tableName: 'records' },
    createdBy: 'tests',
    partitions: [
      {
        id: partitionId,
        storageTargetId: storageTarget.id,
        fileFormat: 'duckdb',
        filePath: writeResult.relativePath,
        fileSizeBytes: writeResult.fileSizeBytes,
        rowCount: writeResult.rowCount,
        startTime,
        endTime,
        checksum: writeResult.checksum,
        partitionKey: { day: '2024-01-01' },
        metadata: { tableName: 'records' }
      }
    ]
  });
}

function readHeaders(): Record<string, string> {
  return {
    'x-iam-scopes': 'sql:read',
    'content-type': 'application/json'
  };
}

function execHeaders(): Record<string, string> {
  return {
    'x-iam-scopes': 'sql:exec',
    'content-type': 'application/json'
  };
}

describe('sql routes', () => {
  test('returns DuckDB query as structured json', async () => {
    assert.ok(app);
    const response = await app!.inject({
      method: 'POST',
      url: '/sql/read',
      headers: readHeaders(),
      payload: {
        sql: `SELECT site, value FROM timestore.${datasetSlug} ORDER BY value DESC`
      }
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] ?? '', /application\/json/);
    assert.ok(response.headers['x-sql-execution-id']);
    const payload = response.json() as {
      executionId: string;
      rows: Array<{ site: string; value: number }>;
      columns: Array<{ name: string; type?: string }>;
      warnings?: string[];
      statistics?: { rowCount?: number };
    };
    assert.equal(payload.rows.length, 2);
    assert.deepEqual(
      payload.rows.map((row) => row.site),
      ['alpha', 'beta']
    );
    assert.deepEqual(
      payload.rows.map((row) => row.value),
      [42.5, 37.1]
    );
    assert.deepEqual(
      payload.columns.map((column) => column.name),
      ['site', 'value']
    );
    assert.equal(payload.statistics?.rowCount, 2);
    assert.ok(Array.isArray(payload.warnings));
  });

  test('rejects non-select statements on read endpoint', async () => {
    assert.ok(app);
    const response = await app!.inject({
      method: 'POST',
      url: '/sql/read',
      headers: readHeaders(),
      payload: {
        sql: `DELETE FROM timestore.${datasetSlug}`
      }
    });

    assert.equal(response.statusCode, 400);
    const body = response.json() as { message?: string };
    assert.ok(body.message?.includes('SELECT'));
  });

  test('streams csv output', async () => {
    assert.ok(app);
    const response = await app!.inject({
      method: 'POST',
      url: '/sql/read?format=csv',
      headers: readHeaders(),
      payload: {
        sql: `SELECT site, value FROM timestore.${datasetSlug} ORDER BY value DESC`
      }
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] ?? '', /text\/csv/);
    const lines = response.body.trim().split('\n');
    assert.deepEqual(lines, ['site,value', 'alpha,42.5', 'beta,37.1']);
  });

  test('schema endpoint lists dataset view', async () => {
    assert.ok(app);
    const response = await app!.inject({
      method: 'GET',
      url: '/sql/schema',
      headers: readHeaders()
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json() as {
      tables: Array<{ name: string; columns: Array<{ name: string }> }>;
      warnings?: string[];
    };
    const table = payload.tables.find((entry) => entry.name === `timestore.${datasetSlug}`);
    assert.ok(table, 'expected dataset view to be present');
    assert.equal(table?.columns.length, 3);
  });

  test('exec endpoint streams result rows when present', async () => {
    assert.ok(app);
    const response = await app!.inject({
      method: 'POST',
      url: '/sql/exec?format=table',
      headers: execHeaders(),
      payload: {
        sql: 'SELECT name FROM sql_samples ORDER BY id LIMIT 2'
      }
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] ?? '', /text\/plain/);
    assert.ok(response.body.includes('Orion'));
    assert.ok(response.body.includes('(2 rows)'));
  });

  test('exec endpoint returns row count for mutations', async () => {
    assert.ok(app);
    const response = await app!.inject({
      method: 'POST',
      url: '/sql/exec',
      headers: execHeaders(),
      payload: {
        sql: "INSERT INTO sql_samples (name, score) VALUES ('Lyra-2', 12.4)"
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { rowCount: number; command?: string };
    assert.equal(body.rowCount, 1);
    assert.equal(body.command, 'INSERT');
  });
});

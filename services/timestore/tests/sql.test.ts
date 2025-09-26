/// <reference path="../src/types/embeddedPostgres.d.ts" />

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, describe, test } from 'node:test';
import fastify from 'fastify';
import EmbeddedPostgres from 'embedded-postgres';
import { resetCachedServiceConfig } from '../src/config/serviceConfig';

let postgres: EmbeddedPostgres | null = null;
let dataDirectory: string | null = null;
let app: ReturnType<typeof fastify> | null = null;

let clientModule: typeof import('../src/db/client');
let schemaModule: typeof import('../src/db/schema');
let migrationsModule: typeof import('../src/db/migrations');
let sqlRoutesModule: typeof import('../src/routes/sql');

before(async () => {
  process.env.TIMESTORE_SQL_READ_SCOPE = 'sql:read';
  process.env.TIMESTORE_SQL_EXEC_SCOPE = 'sql:exec';
  process.env.REDIS_URL = 'inline';

  dataDirectory = await mkdtemp(path.join(tmpdir(), 'timestore-sql-pg-'));
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
  sqlRoutesModule = await import('../src/routes/sql');

  await schemaModule.ensureSchemaExists(clientModule.POSTGRES_SCHEMA);
  await migrationsModule.runMigrations();
  await seedSamples();

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
  test('streams select query as json', async () => {
    assert.ok(app);
    const response = await app!.inject({
      method: 'POST',
      url: '/sql/read?format=json',
      headers: readHeaders(),
      payload: {
        sql: 'SELECT id, name, score FROM sql_samples ORDER BY id'
      }
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] ?? '', /application\/json/);
    const payload = JSON.parse(response.body) as Array<{ id: number; name: string; score: number }>;
    assert.equal(payload.length, 3);
    assert.deepEqual(
      payload.map((row) => row.name),
      ['Orion', 'Lyra', 'Cygnus']
    );
  });

  test('rejects non-select statements on read endpoint', async () => {
    assert.ok(app);
    const response = await app!.inject({
      method: 'POST',
      url: '/sql/read',
      headers: readHeaders(),
      payload: {
        sql: 'DELETE FROM sql_samples'
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
        sql: 'SELECT name, score FROM sql_samples ORDER BY id LIMIT 2'
      }
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] ?? '', /text\/csv/);
    const lines = response.body.trim().split('\n');
    assert.deepEqual(lines, ['name,score', 'Orion,42.5', 'Lyra,37.1']);
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

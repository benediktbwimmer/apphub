import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { runE2E } from '@apphub/test-helpers';

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address) {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to determine available port')));
      }
    });
  });
}

type EnvSnapshot = Record<string, string | undefined>;

function snapshotEnv(keys: string[]): EnvSnapshot {
  const snapshot: EnvSnapshot = {};
  for (const key of keys) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

runE2E(async ({ registerCleanup }) => {
  const envSnapshot = snapshotEnv(['DATABASE_URL', 'APPHUB_AUTH_DISABLED', 'NODE_ENV']);
  registerCleanup(async () => {
    restoreEnv(envSnapshot);
  });

  const dataDir = await mkdtemp(path.join(tmpdir(), 'metastore-migrate-pg-'));
  const port = await findAvailablePort();

  const postgres = new EmbeddedPostgres({
    databaseDir: dataDir,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false
  });

  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('apphub');

  registerCleanup(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  registerCleanup(async () => {
    await postgres.stop();
  });

  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.APPHUB_AUTH_DISABLED = '1';
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }

  const { withTransaction, withConnection, closePool, ensureSchemaReady } = await import('../../src/db/client');
  const { upsertRecord, fetchRecord } = await import('../../src/db/recordsRepository');

  registerCleanup(async () => {
    await closePool();
  });

  await ensureSchemaReady();

  const recordKey = '2025-09-26T15:12';
  const namespace = 'observatory.reports';

  await withTransaction(async (client) => {
    const result = await upsertRecord(client, {
      namespace,
      key: recordKey,
      metadata: {
        status: 'ok',
        generatedAt: '2025-09-26T15:12:00Z'
      },
      tags: ['demo'],
      owner: 'test@apphub.dev',
      schemaHash: 'sha256:test',
      actor: 'integration-test'
    });

    assert.equal(result.created, true);
    assert.equal(result.record.namespace, namespace);
  });

  const stored = await withConnection((client) => fetchRecord(client, namespace, recordKey));
  assert.ok(stored);
  assert.equal(stored?.metadata.status, 'ok');

  const migrationsApplied = await withConnection(async (client) => {
    const { rowCount } = await client.query<{ id: string }>(
      'SELECT id FROM metastore_schema_migrations'
    );
    return rowCount ?? 0;
  });

  assert.ok(migrationsApplied >= 1);

  const tableSchema = await withConnection(async (client) => {
    const { rows } = await client.query<{ schemaname: string }>(
      `SELECT schemaname FROM pg_tables WHERE tablename = 'metastore_records'`
    );
    return rows[0]?.schemaname;
  });

  assert.equal(tableSchema, 'metastore');
}, { name: 'metastore-auto-migrations' });

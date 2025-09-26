/// <reference path="../src/types/embeddedPostgres.d.ts" />

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';

let postgres: EmbeddedPostgres | null = null;
let dataDirectory: string | null = null;

let clientModule: typeof import('../src/db/client');
let schemaModule: typeof import('../src/db/schema');
let migrationsModule: typeof import('../src/db/migrations');

before(async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'filestore-pg-'));
  dataDirectory = dataRoot;
  const port = 55000 + Math.floor(Math.random() * 1000);
  const embedded = new EmbeddedPostgres({
    databaseDir: dataRoot,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    postgresFlags: ['-c', 'dynamic_shared_memory_type=posix'],
    onError(message) {
      console.error('[embedded-postgres:filestore]', message);
    }
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('apphub');
  postgres = embedded;

  const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.FILESTORE_DATABASE_URL = connectionString;
  process.env.FILESTORE_PG_SCHEMA = `filestore_test_${randomUUID().slice(0, 8)}`;
  process.env.FILESTORE_PGPOOL_MAX = '4';

  const configModule = await import('../src/config/serviceConfig');
  configModule.resetCachedServiceConfig();

  clientModule = await import('../src/db/client');
  schemaModule = await import('../src/db/schema');
  migrationsModule = await import('../src/db/migrations');

  await schemaModule.ensureSchemaExists(clientModule.POSTGRES_SCHEMA);
  await migrationsModule.runMigrationsWithConnection();
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
});

test('creates the core filestore tables', async () => {
  const schemaName = clientModule.POSTGRES_SCHEMA;
  await clientModule.withConnection(async (client) => {
    const { rows } = await client.query<{
      table_name: string;
    }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name = ANY($2)
        ORDER BY table_name`,
      [schemaName, ['backend_mounts', 'journal_entries', 'nodes', 'rollups', 'snapshots']]
    );

    assert.deepEqual(
      rows.map((row) => row.table_name),
      ['backend_mounts', 'journal_entries', 'nodes', 'rollups', 'snapshots']
    );

    const viewCheck = await client.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.views
        WHERE table_schema = $1
          AND table_name = 'view_filestore_active_nodes'`,
      [schemaName]
    );
    assert.equal(viewCheck.rowCount, 1);
  });
});

test('triggers bump node version and touch timestamps', async () => {
  await clientModule.withConnection(async (client) => {
    const mount = await client.query<{ id: number; updated_at: Date }>(
      `INSERT INTO backend_mounts (mount_key, backend_kind, root_path)
       VALUES ($1, 'local', $2)
       RETURNING id, updated_at`,
      ['local-default', '/tmp/apphub']
    );

    assert.equal(mount.rowCount, 1);
    const mountId = mount.rows[0].id;
    const initialMountUpdatedAt = mount.rows[0].updated_at;

    const node = await client.query<{ id: number; version: number }>(
      `INSERT INTO nodes (backend_mount_id, path, name, depth, kind)
       VALUES ($1, $2, $3, $4, 'file')
       RETURNING id, version`,
      [mountId, 'examples/hello.txt', 'hello.txt', 2]
    );

    assert.equal(node.rowCount, 1);
    const nodeId = node.rows[0].id;
    assert.equal(node.rows[0].version, 1);

    const updatedMount = await client.query<{ updated_at: Date }>(
      `UPDATE backend_mounts
          SET state = 'disabled'
        WHERE id = $1
      RETURNING updated_at`,
      [mountId]
    );
    assert.equal(updatedMount.rowCount, 1);
    assert.ok(updatedMount.rows[0].updated_at.getTime() >= initialMountUpdatedAt.getTime());

    const bumped = await client.query<{ version: number; deleted_at: Date | null }>(
      `UPDATE nodes
          SET size_bytes = size_bytes + 128
        WHERE id = $1
      RETURNING version, deleted_at`,
      [nodeId]
    );
    assert.equal(bumped.rowCount, 1);
    assert.equal(bumped.rows[0].version, 2);
    assert.equal(bumped.rows[0].deleted_at, null);

    const deleted = await client.query<{ version: number; deleted_at: Date | null }>(
      `UPDATE nodes
          SET state = 'deleted'
        WHERE id = $1
      RETURNING version, deleted_at`,
      [nodeId]
    );
    assert.equal(deleted.rowCount, 1);
    assert.equal(deleted.rows[0].version, 3);
    assert.ok(deleted.rows[0].deleted_at instanceof Date);
  });
});

test('enforces journal idempotency and rollup defaults', async () => {
  await clientModule.withConnection(async (client) => {
    const mount = await client.query<{ id: number }>(
      `INSERT INTO backend_mounts (mount_key, backend_kind, root_path)
       VALUES ($1, 'local', $2)
       ON CONFLICT (mount_key) DO UPDATE SET root_path = EXCLUDED.root_path
       RETURNING id`,
      ['local-reuse', '/tmp/reuse']
    );

    const node = await client.query<{ id: number }>(
      `INSERT INTO nodes (backend_mount_id, path, name, depth, kind)
       VALUES ($1, $2, $3, $4, 'directory')
       RETURNING id`,
      [mount.rows[0].id, 'archives', 'archives', 1]
    );

    const rollup = await client.query<{ size_bytes: number; state: string }>(
      `INSERT INTO rollups (node_id)
       VALUES ($1)
       RETURNING size_bytes, state`,
      [node.rows[0].id]
    );
    assert.equal(rollup.rows[0].size_bytes, 0);
    assert.equal(rollup.rows[0].state, 'up_to_date');

    await client.query(
      `INSERT INTO journal_entries
         (command, status, executor_kind, idempotency_key, parameters, affected_node_ids)
       VALUES
         ($1, $2, $3, $4, $5::jsonb, $6::bigint[])`,
      ['create', 'succeeded', 'local', 'idem-1', JSON.stringify({ path: 'archives' }), [node.rows[0].id]]
    );

    await assert.rejects(
      client.query(
        `INSERT INTO journal_entries
           (command, status, executor_kind, idempotency_key, parameters)
         VALUES
           ($1, $2, $3, $4, $5::jsonb)`,
        ['create', 'succeeded', 'local', 'idem-1', JSON.stringify({ path: 'archives' })]
      ),
      /duplicate key value violates unique constraint/i
    );
  });
});

test('migrations are idempotent', async () => {
  await migrationsModule.runMigrationsWithConnection();
});

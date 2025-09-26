/// <reference path="../src/types/embeddedPostgres.d.ts" />

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import EmbeddedPostgres from 'embedded-postgres';
import { runE2E } from '../../../tests/helpers';

async function createBackendMount(
  dbClientModule: typeof import('../src/db/client'),
  mountRoots: string[]
): Promise<number> {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'filestore-local-executor-'));
  mountRoots.push(rootDir);
  const result = await dbClientModule.withConnection(async (client) =>
    client.query<{ id: number }>(
      `INSERT INTO backend_mounts (mount_key, backend_kind, root_path)
       VALUES ($1, 'local', $2)
       RETURNING id`,
      [`local-${randomUUID().slice(0, 8)}`, rootDir]
    )
  );
  return result.rows[0].id;
}

async function getJournalCount(dbClientModule: typeof import('../src/db/client')): Promise<number> {
  const result = await dbClientModule.withConnection(async (client) =>
    client.query('SELECT COUNT(*)::int AS count FROM journal_entries')
  );
  return result.rows[0].count as number;
}

runE2E(async ({ registerCleanup }) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'filestore-routes-pg-'));
  registerCleanup(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const mountRoots: string[] = [];
  registerCleanup(async () => {
    await Promise.all(mountRoots.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  const port = 57000 + Math.floor(Math.random() * 1000);
  const postgres = new EmbeddedPostgres({
    databaseDir: dataDir,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    postgresFlags: ['-c', 'dynamic_shared_memory_type=posix']
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('apphub');
  registerCleanup(async () => {
    await postgres.stop();
  });

  process.env.FILESTORE_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.FILESTORE_PG_SCHEMA = `filestore_test_${randomUUID().slice(0, 8)}`;
  process.env.FILESTORE_PGPOOL_MAX = '4';
  process.env.FILESTORE_METRICS_ENABLED = 'false';

  const configModulePath = require.resolve('../src/config/serviceConfig');
  delete require.cache[configModulePath];

  for (const modulePath of ['../src/db/client', '../src/db/schema', '../src/db/migrations', '../src/app']) {
    const resolved = require.resolve(modulePath);
    delete require.cache[resolved];
  }

  const dbClientModule = await import('../src/db/client');
  const schemaModule = await import('../src/db/schema');
  const migrationsModule = await import('../src/db/migrations');
  const { buildApp } = await import('../src/app');

  await schemaModule.ensureSchemaExists(dbClientModule.POSTGRES_SCHEMA);
  await migrationsModule.runMigrationsWithConnection();

  const { app } = await buildApp();
  await app.ready();
  registerCleanup(async () => {
    await app.close();
  });

  const backendMountId = await createBackendMount(dbClientModule, mountRoots);

  const countBeforeParent = await getJournalCount(dbClientModule);
  const parentResponse = await app.inject({
    method: 'POST',
    url: '/v1/directories',
    payload: {
      backendMountId,
      path: 'datasets'
    },
    headers: {
      'x-filestore-principal': 'routes-test'
    }
  });
  assert.equal(parentResponse.statusCode, 201, parentResponse.body);
  const countAfterParent = await getJournalCount(dbClientModule);
  assert.equal(countAfterParent - countBeforeParent, 1);

  const createResponse = await app.inject({
    method: 'POST',
    url: '/v1/directories',
    payload: {
      backendMountId,
      path: 'datasets/observatory',
      metadata: { owner: 'astro' },
      idempotencyKey: 'routes-create-1'
    }
  });
  assert.equal(createResponse.statusCode, 201, createResponse.body);
  const createBody = createResponse.json() as {
    data: {
      node: { id: number; path: string; metadata: Record<string, unknown> } | null;
      journalEntryId: number;
      idempotent: boolean;
    };
  };
  assert.equal(createBody.data.idempotent, false);
  assert.ok(createBody.data.node);
  const nodeId = createBody.data.node!.id;
  assert.equal(createBody.data.node!.path, 'datasets/observatory');
  assert.equal((createBody.data.node!.metadata as { owner?: string }).owner, 'astro');
  const countAfterCreate = await getJournalCount(dbClientModule);
  assert.equal(countAfterCreate - countAfterParent, 1);

  const idempotentResponse = await app.inject({
    method: 'POST',
    url: '/v1/directories',
    payload: {
      backendMountId,
      path: 'datasets/observatory',
      idempotencyKey: 'routes-create-1'
    }
  });
  assert.equal(idempotentResponse.statusCode, 200, idempotentResponse.body);
  const idempotentBody = idempotentResponse.json() as { data: { idempotent: boolean; journalEntryId: number } };
  assert.equal(idempotentBody.data.idempotent, true);
  assert.equal(idempotentBody.data.journalEntryId, createBody.data.journalEntryId);
  const countAfterIdempotent = await getJournalCount(dbClientModule);
  assert.equal(countAfterIdempotent, countAfterCreate);

  const byIdResponse = await app.inject({ method: 'GET', url: `/v1/nodes/${nodeId}` });
  assert.equal(byIdResponse.statusCode, 200, byIdResponse.body);
  const byIdBody = byIdResponse.json() as { data: { id: number; path: string; state: string } };
  assert.equal(byIdBody.data.id, nodeId);
  assert.equal(byIdBody.data.path, 'datasets/observatory');
  assert.equal(byIdBody.data.state, 'active');

  const byPathResponse = await app.inject({
    method: 'GET',
    url: `/v1/nodes/by-path?backendMountId=${backendMountId}&path=datasets/observatory`
  });
  assert.equal(byPathResponse.statusCode, 200, byPathResponse.body);

  const deleteResponse = await app.inject({
    method: 'DELETE',
    url: '/v1/nodes',
    payload: {
      backendMountId,
      path: 'datasets/observatory'
    }
  });
  assert.equal(deleteResponse.statusCode, 200, deleteResponse.body);
  const deleteBody = deleteResponse.json() as { data: { node: { state: string } | null } };
  assert.equal(deleteBody.data.node?.state, 'deleted');

  const afterDeleteById = await app.inject({ method: 'GET', url: `/v1/nodes/${nodeId}` });
  assert.equal(afterDeleteById.statusCode, 200, afterDeleteById.body);
  const afterDeleteBody = afterDeleteById.json() as { data: { state: string } };
  assert.equal(afterDeleteBody.data.state, 'deleted');

  const afterDeleteByPath = await app.inject({
    method: 'GET',
    url: `/v1/nodes/by-path?backendMountId=${backendMountId}&path=datasets/observatory`
  });
  assert.equal(afterDeleteByPath.statusCode, 200, afterDeleteByPath.body);
  const afterDeleteByPathBody = afterDeleteByPath.json() as { data: { state: string } };
  assert.equal(afterDeleteByPathBody.data.state, 'deleted');
});

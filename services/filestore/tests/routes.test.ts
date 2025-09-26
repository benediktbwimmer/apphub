/// <reference path="../src/types/embeddedPostgres.d.ts" />

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
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
  process.env.FILESTORE_REDIS_URL = 'inline';
  process.env.FILESTORE_ROLLUP_CACHE_TTL_SECONDS = '60';
  process.env.FILESTORE_EVENTS_MODE = 'inline';

  const configModulePath = require.resolve('../src/config/serviceConfig');
  delete require.cache[configModulePath];

  for (const modulePath of [
    '../src/db/client',
    '../src/db/schema',
    '../src/db/migrations',
    '../src/app',
    '../src/rollup/manager',
    '../src/events/publisher'
  ]) {
    const resolved = require.resolve(modulePath);
    delete require.cache[resolved];
  }

  const dbClientModule = await import('../src/db/client');
  const schemaModule = await import('../src/db/schema');
  const migrationsModule = await import('../src/db/migrations');
  const { buildApp } = await import('../src/app');
  const eventsModule = await import('../src/events/publisher');

  await schemaModule.ensureSchemaExists(dbClientModule.POSTGRES_SCHEMA);
  await migrationsModule.runMigrationsWithConnection();

  const { app } = await buildApp();
  await app.ready();
  const baseAddress = await app.listen({ port: 0, host: '127.0.0.1' });
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
  const parentBody = parentResponse.json() as {
    data: {
      node: { rollup: { directoryCount: number; childCount: number } | null } | null;
    };
  };
  assert.ok(parentBody.data.node?.rollup);
  assert.equal(parentBody.data.node?.rollup?.directoryCount, 0);
  assert.equal(parentBody.data.node?.rollup?.childCount, 0);
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
      node: {
        id: number;
        path: string;
        metadata: Record<string, unknown>;
        rollup: { directoryCount: number; childCount: number; state: string } | null;
      } | null;
      journalEntryId: number;
      idempotent: boolean;
    };
  };
  assert.equal(createBody.data.idempotent, false);
  assert.ok(createBody.data.node);
  const nodeId = createBody.data.node!.id;
  assert.equal(createBody.data.node!.path, 'datasets/observatory');
  assert.equal((createBody.data.node!.metadata as { owner?: string }).owner, 'astro');
  assert.ok(createBody.data.node!.rollup);
  assert.equal(createBody.data.node!.rollup?.directoryCount, 0);
  assert.equal(createBody.data.node!.rollup?.childCount, 0);
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

  const catalogResponse = await app.inject({
    method: 'POST',
    url: '/v1/directories',
    payload: {
      backendMountId,
      path: 'datasets/catalog'
    }
  });
  assert.equal(catalogResponse.statusCode, 201, catalogResponse.body);
  const catalogBody = catalogResponse.json() as {
    data: { node: { id: number; path: string } | null; journalEntryId: number };
  };
  const catalogId = catalogBody.data.node?.id;
  assert.equal(catalogBody.data.node?.path, 'datasets/catalog');

  const rawResponse = await app.inject({
    method: 'POST',
    url: '/v1/directories',
    payload: {
      backendMountId,
      path: 'datasets/observatory/raw'
    }
  });
  assert.equal(rawResponse.statusCode, 201, rawResponse.body);
  const rawBody = rawResponse.json() as {
    data: { node: { id: number; path: string } | null };
  };
  const rawId = rawBody.data.node?.id;
  assert.equal(rawBody.data.node?.path, 'datasets/observatory/raw');
  assert.ok(rawId);

  const processedResponse = await app.inject({
    method: 'POST',
    url: '/v1/directories',
    payload: {
      backendMountId,
      path: 'datasets/observatory/processed'
    }
  });
  assert.equal(processedResponse.statusCode, 201, processedResponse.body);
  const processedBody = processedResponse.json() as {
    data: { node: { id: number; path: string } | null };
  };
  assert.equal(processedBody.data.node?.path, 'datasets/observatory/processed');

  const listResponse = await app.inject({
    method: 'GET',
    url: `/v1/nodes?backendMountId=${backendMountId}&limit=2`
  });
  assert.equal(listResponse.statusCode, 200, listResponse.body);
  const listBody = listResponse.json() as {
    data: {
      nodes: Array<{ path: string }>;
      pagination: { total: number; limit: number; offset: number; nextOffset: number | null };
      filters: { backendMountId: number; path: string | null; depth: number | null; states: string[]; kinds: string[]; search: string | null; driftOnly: boolean };
    };
  };
  assert.equal(listBody.data.nodes.length, 2);
  assert.equal(listBody.data.pagination.limit, 2);
  assert.equal(listBody.data.pagination.offset, 0);
  assert.equal(listBody.data.pagination.nextOffset, 2);
  assert.ok(listBody.data.pagination.total >= 4);
  assert.equal(listBody.data.filters.backendMountId, backendMountId);
  assert.equal(listBody.data.filters.path, null);
  assert.equal(listBody.data.filters.driftOnly, false);
  assert.deepEqual(listBody.data.filters.states, []);

  const scopedListResponse = await app.inject({
    method: 'GET',
    url: `/v1/nodes?backendMountId=${backendMountId}&path=datasets&depth=1`
  });
  assert.equal(scopedListResponse.statusCode, 200, scopedListResponse.body);
  const scopedListBody = scopedListResponse.json() as {
    data: {
      nodes: Array<{ path: string }>;
      filters: { path: string | null; depth: number | null };
    };
  };
  assert.equal(scopedListBody.data.filters.path, 'datasets');
  assert.equal(scopedListBody.data.filters.depth, 1);
  const scopedPaths = scopedListBody.data.nodes.map((node) => node.path);
  assert.ok(scopedPaths.includes('datasets'));
  assert.ok(scopedPaths.includes('datasets/catalog'));
  assert.ok(scopedPaths.includes('datasets/observatory'));

  const searchResponse = await app.inject({
    method: 'GET',
    url: `/v1/nodes?backendMountId=${backendMountId}&search=raw`
  });
  assert.equal(searchResponse.statusCode, 200, searchResponse.body);
  const searchBody = searchResponse.json() as {
    data: { nodes: Array<{ path: string }>; filters: { search: string | null } };
  };
  assert.equal(searchBody.data.filters.search, 'raw');
  assert.ok(searchBody.data.nodes.some((node) => node.path.endsWith('/raw')));

  const childrenResponse = await app.inject({
    method: 'GET',
    url: `/v1/nodes/${nodeId}/children?limit=10`
  });
  assert.equal(childrenResponse.statusCode, 200, childrenResponse.body);
  const childrenBody = childrenResponse.json() as {
    data: {
      parent: { id: number; path: string };
      children: Array<{ path: string }>;
      pagination: { total: number };
      filters: { driftOnly: boolean; search: string | null };
    };
  };
  assert.equal(childrenBody.data.parent.id, nodeId);
  assert.equal(childrenBody.data.pagination.total, 2);
  const childPaths = childrenBody.data.children.map((node) => node.path);
  assert.ok(childPaths.includes('datasets/observatory/raw'));
  assert.ok(childPaths.includes('datasets/observatory/processed'));
  assert.equal(childrenBody.data.filters.driftOnly, false);
  assert.equal(childrenBody.data.filters.search, null);

  assert.ok(catalogId);
  if (catalogId) {
    await dbClientModule.withConnection(async (client) => {
      await client.query(
        `UPDATE nodes
            SET consistency_state = 'inconsistent',
                last_drift_detected_at = NOW()
          WHERE id = $1`,
        [catalogId]
      );
    });
  }

  const driftResponse = await app.inject({
    method: 'GET',
    url: `/v1/nodes?backendMountId=${backendMountId}&driftOnly=true`
  });
  assert.equal(driftResponse.statusCode, 200, driftResponse.body);
  const driftBody = driftResponse.json() as {
    data: {
      nodes: Array<{ id: number; consistencyState: string; lastDriftDetectedAt: string | null }>;
      filters: { driftOnly: boolean };
    };
  };
  assert.equal(driftBody.data.filters.driftOnly, true);
  assert.ok(driftBody.data.nodes.length >= 1);
  if (catalogId) {
    assert.ok(driftBody.data.nodes.some((node) => node.id === catalogId));
  }

  const byIdResponse = await app.inject({ method: 'GET', url: `/v1/nodes/${nodeId}` });
  assert.equal(byIdResponse.statusCode, 200, byIdResponse.body);
  const byIdBody = byIdResponse.json() as {
    data: { id: number; path: string; state: string; rollup: { state: string; directoryCount: number } | null };
  };
  assert.equal(byIdBody.data.id, nodeId);
  assert.equal(byIdBody.data.path, 'datasets/observatory');
  assert.equal(byIdBody.data.state, 'active');
  assert.ok(byIdBody.data.rollup);
  assert.equal(byIdBody.data.rollup?.state, 'up_to_date');

  const byPathResponse = await app.inject({
    method: 'GET',
    url: `/v1/nodes/by-path?backendMountId=${backendMountId}&path=datasets/observatory`
  });
  assert.equal(byPathResponse.statusCode, 200, byPathResponse.body);
  const byPathBody = byPathResponse.json() as {
    data: { rollup: { directoryCount: number; childCount: number; state: string } | null };
  };
  assert.ok(byPathBody.data.rollup);
  assert.equal(byPathBody.data.rollup?.directoryCount, 2);

  const deleteResponse = await app.inject({
    method: 'DELETE',
    url: '/v1/nodes',
    payload: {
      backendMountId,
      path: 'datasets/observatory',
      recursive: true
    }
  });
  assert.equal(deleteResponse.statusCode, 200, deleteResponse.body);
  const deleteBody = deleteResponse.json() as {
    data: { node: { state: string; rollup: { state: string; directoryCount: number } | null } | null };
  };
  assert.equal(deleteBody.data.node?.state, 'deleted');
  assert.ok(deleteBody.data.node?.rollup);
  assert.equal(deleteBody.data.node?.rollup?.state, 'invalid');

  const deletedListResponse = await app.inject({
    method: 'GET',
    url: `/v1/nodes?backendMountId=${backendMountId}&states=deleted`
  });
  assert.equal(deletedListResponse.statusCode, 200, deletedListResponse.body);
  const deletedListBody = deletedListResponse.json() as {
    data: {
      nodes: Array<{ path: string; state: string }>;
      filters: { states: string[] };
    };
  };
  assert.ok(deletedListBody.data.nodes.some((node) => node.path === 'datasets/observatory'));
  assert.deepEqual(deletedListBody.data.filters.states, ['deleted']);

  const afterDeleteById = await app.inject({ method: 'GET', url: `/v1/nodes/${nodeId}` });
  assert.equal(afterDeleteById.statusCode, 200, afterDeleteById.body);
  const afterDeleteBody = afterDeleteById.json() as {
    data: { state: string; rollup: { state: string; directoryCount: number } | null };
  };
  assert.equal(afterDeleteBody.data.state, 'deleted');
  assert.ok(afterDeleteBody.data.rollup);
  assert.equal(afterDeleteBody.data.rollup?.state, 'invalid');

  const afterDeleteByPath = await app.inject({
    method: 'GET',
    url: `/v1/nodes/by-path?backendMountId=${backendMountId}&path=datasets/observatory`
  });
  assert.equal(afterDeleteByPath.statusCode, 200, afterDeleteByPath.body);
  const afterDeleteByPathBody = afterDeleteByPath.json() as {
    data: { state: string; rollup: { state: string } | null };
  };
  assert.equal(afterDeleteByPathBody.data.state, 'deleted');
  assert.ok(afterDeleteByPathBody.data.rollup);
  assert.equal(afterDeleteByPathBody.data.rollup?.state, 'invalid');

  const reconcileResponse = await app.inject({
    method: 'POST',
    url: '/v1/reconciliation',
    payload: {
      backendMountId,
      path: 'datasets/observatory'
    }
  });
  assert.equal(reconcileResponse.statusCode, 202, reconcileResponse.body);

  const eventUrl = new URL('/v1/events/stream', baseAddress).toString();
  const sseData = await new Promise<string>((resolve, reject) => {
    const req = http.get(eventUrl, (res) => {
      res.setEncoding('utf8');
      let buffer = '';
      let connected = false;

      res.on('data', (chunk: string) => {
        buffer += chunk;
        if (!connected && buffer.includes(':connected')) {
          connected = true;
          void eventsModule.emitFilestoreEvent({
            type: 'filestore.node.created',
            data: {
              backendMountId,
              nodeId,
              path: 'datasets/observatory',
              kind: 'directory',
              state: 'active',
              parentId: null,
              version: 2,
              sizeBytes: 0,
              checksum: null,
              contentHash: null,
              metadata: {},
              journalId: 999,
              command: 'createDirectory',
              idempotencyKey: null,
              principal: null,
              observedAt: new Date().toISOString()
            }
          }).catch(reject);
        }
        if (buffer.includes('filestore.node.created')) {
          resolve(buffer);
          req.destroy();
        }
      });

      res.on('end', () => {
        resolve(buffer);
      });

      res.on('error', reject);
    });

    req.on('error', reject);
  });

  assert.ok(sseData.includes('filestore.node.created'));
});

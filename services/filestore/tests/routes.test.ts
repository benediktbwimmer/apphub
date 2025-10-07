/// <reference path="../src/types/embeddedPostgres.d.ts" />

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import EmbeddedPostgres from 'embedded-postgres';
import { encodeFilestoreNodeFiltersParam } from '@apphub/shared/filestoreFilters';
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

function encodeMultipart(
  boundary: string,
  parts: Array<{ name: string; value: string | Buffer; filename?: string; contentType?: string }>
): Buffer {
  const buffers: Buffer[] = [];
  for (const part of parts) {
    buffers.push(Buffer.from(`--${boundary}\r\n`));
    let disposition = `Content-Disposition: form-data; name="${part.name}"`;
    if (part.filename) {
      disposition += `; filename="${part.filename}"`;
    }
    buffers.push(Buffer.from(`${disposition}\r\n`));
    if (part.contentType) {
      buffers.push(Buffer.from(`Content-Type: ${part.contentType}\r\n`));
    }
    buffers.push(Buffer.from('\r\n'));
    buffers.push(typeof part.value === 'string' ? Buffer.from(part.value) : part.value);
    buffers.push(Buffer.from('\r\n'));
  }
  buffers.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(buffers);
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
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';

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
  const backendRoot = mountRoots[mountRoots.length - 1];

  const mountsResponse = await app.inject({
    method: 'GET',
    url: '/v1/backend-mounts'
  });
  assert.equal(mountsResponse.statusCode, 200, mountsResponse.body);
  const mountsBody = mountsResponse.json() as {
    data: {
      mounts: Array<{
        id: number;
        mountKey: string;
        backendKind: string;
        accessMode: string;
        state: string;
        displayName: string | null;
        description: string | null;
        contact: string | null;
        labels: string[];
        rootPath: string | null;
        bucket: string | null;
        prefix: string | null;
        lastHealthCheckAt: string | null;
        lastHealthStatus: string | null;
        createdAt: string;
        updatedAt: string;
      }>;
      pagination: { total: number; limit: number; offset: number; nextOffset: number | null };
      filters: { search: string | null; kinds: string[]; states: string[]; accessModes: string[] };
    };
  };
  assert.ok(Array.isArray(mountsBody.data.mounts));
  assert.ok(mountsBody.data.pagination.total >= 1);
  assert.equal(mountsBody.data.pagination.offset, 0);
  const discoveredMount = mountsBody.data.mounts.find((entry) => entry.id === backendMountId);
  assert.ok(discoveredMount);
  assert.equal(discoveredMount?.backendKind, 'local');
  assert.equal(discoveredMount?.rootPath, backendRoot);
  assert.equal(discoveredMount?.state, 'active');
  assert.equal(Array.isArray(discoveredMount?.labels), true);
  assert.equal(Object.prototype.hasOwnProperty.call(discoveredMount as Record<string, unknown>, 'config'), false);

  const unauthorizedMountResponse = await app.inject({
    method: 'POST',
    url: '/v1/backend-mounts',
    payload: {
      mountKey: 'routes-unauthorized',
      backendKind: 'local',
      rootPath: backendRoot,
      accessMode: 'rw',
      state: 'inactive'
    }
  });
  assert.equal(unauthorizedMountResponse.statusCode, 403, unauthorizedMountResponse.body);

  const managedRoot = await mkdtemp(path.join(tmpdir(), 'filestore-managed-mount-'));
  mountRoots.push(managedRoot);

  const createMountResponse = await app.inject({
    method: 'POST',
    url: '/v1/backend-mounts',
    headers: {
      'x-iam-scopes': 'filestore:admin'
    },
    payload: {
      mountKey: 'routes-managed',
      backendKind: 'local',
      rootPath: managedRoot,
      accessMode: 'ro',
      state: 'inactive',
      displayName: 'Routes Managed Mount',
      description: 'Managed via integration test',
      contact: 'ops@apphub.dev',
      labels: ['ops', 'archive'],
      stateReason: 'paused for tests'
    }
  });
  assert.equal(createMountResponse.statusCode, 201, createMountResponse.body);
  const createdMount = createMountResponse.json() as {
    data: {
      id: number;
      mountKey: string;
      state: string;
      displayName: string | null;
      labels: string[];
      stateReason: string | null;
    };
  };
  assert.equal(createdMount.data.mountKey, 'routes-managed');
  assert.equal(createdMount.data.state, 'inactive');
  assert.ok(createdMount.data.labels.includes('ops'));

  const getManagedMount = await app.inject({
    method: 'GET',
    url: `/v1/backend-mounts/${createdMount.data.id}`
  });
  assert.equal(getManagedMount.statusCode, 200, getManagedMount.body);
  const getManagedBody = getManagedMount.json() as { data: { id: number; rootPath: string | null } };
  assert.equal(getManagedBody.data.id, createdMount.data.id);
  assert.equal(getManagedBody.data.rootPath, managedRoot);

  const unauthorizedPatch = await app.inject({
    method: 'PATCH',
    url: `/v1/backend-mounts/${createdMount.data.id}`,
    payload: {
      state: 'active'
    }
  });
  assert.equal(unauthorizedPatch.statusCode, 403, unauthorizedPatch.body);

  const updateMountResponse = await app.inject({
    method: 'PATCH',
    url: `/v1/backend-mounts/${createdMount.data.id}`,
    headers: {
      'x-iam-scopes': 'filestore:admin'
    },
    payload: {
      state: 'active',
      stateReason: null,
      labels: ['primary']
    }
  });
  assert.equal(updateMountResponse.statusCode, 200, updateMountResponse.body);
  const updatedMount = updateMountResponse.json() as {
    data: {
      state: string;
      labels: string[];
      stateReason: string | null;
    };
  };
  assert.equal(updatedMount.data.state, 'active');
  assert.equal(updatedMount.data.stateReason, null);
  assert.deepEqual(updatedMount.data.labels, ['primary']);

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

  let currentPath = 'datasets/observatory';

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

  const coreResponse = await app.inject({
    method: 'POST',
    url: '/v1/directories',
    payload: {
      backendMountId,
      path: 'datasets/core'
    }
  });
  assert.equal(coreResponse.statusCode, 201, coreResponse.body);
  const coreBody = coreResponse.json() as {
    data: { node: { id: number; path: string } | null; journalEntryId: number };
  };
  const coreId = coreBody.data.node?.id;
  assert.equal(coreBody.data.node?.path, 'datasets/core');

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
  assert.ok(scopedPaths.includes('datasets/core'));
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

  assert.ok(coreId);
  if (coreId) {
    await dbClientModule.withConnection(async (client) => {
      await client.query(
        `UPDATE nodes
            SET consistency_state = 'inconsistent',
                last_drift_detected_at = NOW()
          WHERE id = $1`,
        [coreId]
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
  if (coreId) {
    assert.ok(driftBody.data.nodes.some((node) => node.id === coreId));
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
    url: `/v1/nodes/by-path?backendMountId=${backendMountId}&path=${currentPath}`
  });
  assert.equal(byPathResponse.statusCode, 200, byPathResponse.body);
  const byPathBody = byPathResponse.json() as {
    data: { rollup: { directoryCount: number; childCount: number; state: string } | null };
  };
  assert.ok(byPathBody.data.rollup);
  assert.equal(byPathBody.data.rollup?.directoryCount, 2);

  const moveResponse = await app.inject({
    method: 'POST',
    url: '/v1/nodes/move',
    payload: {
      backendMountId,
      path: currentPath,
      targetPath: 'datasets/observatory-archive'
    },
    headers: {
      'x-filestore-principal': 'routes-test'
    }
  });
  assert.equal(moveResponse.statusCode, 200, moveResponse.body);
  const moveBody = moveResponse.json() as {
    data: {
      node: { path: string } | null;
      result: { movedFrom?: string };
    };
  };
  assert.equal(moveBody.data.node?.path, 'datasets/observatory-archive');
  assert.equal(moveBody.data.result.movedFrom, 'datasets/observatory');
  currentPath = 'datasets/observatory-archive';

  const movedByPathResponse = await app.inject({
    method: 'GET',
    url: `/v1/nodes/by-path?backendMountId=${backendMountId}&path=${currentPath}`
  });
  assert.equal(movedByPathResponse.statusCode, 200, movedByPathResponse.body);
  const movedByPathBody = movedByPathResponse.json() as {
    data: { path: string; rollup: { state: string } | null };
  };
  assert.equal(movedByPathBody.data.path, currentPath);
  assert.ok(movedByPathBody.data.rollup);

  const movedChildrenResponse = await app.inject({
    method: 'GET',
    url: `/v1/nodes/${nodeId}/children?limit=10`
  });
  assert.equal(movedChildrenResponse.statusCode, 200, movedChildrenResponse.body);
  const movedChildrenBody = movedChildrenResponse.json() as {
    data: { children: Array<{ path: string }> };
  };
  const movedChildPaths = movedChildrenBody.data.children.map((node) => node.path);
  assert.ok(movedChildPaths.includes(`${currentPath}/raw`));
  assert.ok(movedChildPaths.includes(`${currentPath}/processed`));

  const metadataResponse = await app.inject({
    method: 'PATCH',
    url: `/v1/nodes/${nodeId}/metadata`,
    payload: {
      backendMountId,
      set: {
        owner: 'astro-ops',
        classification: 'restricted'
      },
      unset: ['deprecatedField']
    },
    headers: {
      'x-filestore-principal': 'routes-test'
    }
  });
  assert.equal(metadataResponse.statusCode, 200, metadataResponse.body);
  const metadataBody = metadataResponse.json() as {
    data: {
      node: {
        metadata: Record<string, unknown>;
        rollup: { state: string } | null;
      } | null;
      idempotent: boolean;
      result: { nodeId: number };
    };
  };
  assert.equal(metadataBody.data.idempotent, false);
  assert.equal((metadataBody.data.node?.metadata as { owner?: string }).owner, 'astro-ops');
  assert.equal((metadataBody.data.node?.metadata as { classification?: string }).classification, 'restricted');

  const uploadPath = `${currentPath}/raw/data.csv`;
  const uploadBoundary = '----filestore-routes-upload';
  const fileContent = Buffer.from('epoch,telescope\n1,Hubble\n', 'utf8');
  const checksum = createHash('sha256').update(fileContent).digest('hex');
  const uploadPayload = encodeMultipart(uploadBoundary, [
    { name: 'backendMountId', value: String(backendMountId) },
    { name: 'path', value: uploadPath },
    { name: 'metadata', value: JSON.stringify({ source: 'routes-test' }) },
    { name: 'file', value: fileContent, filename: 'data.csv', contentType: 'text/csv' }
  ]);

  const uploadResponse = await app.inject({
    method: 'POST',
    url: '/v1/files',
    payload: uploadPayload,
    headers: {
      'content-type': `multipart/form-data; boundary=${uploadBoundary}`,
      'x-filestore-checksum': `sha256:${checksum}`,
      'x-filestore-content-hash': `sha256:${checksum}`,
      'x-filestore-principal': 'routes-test',
      'Idempotency-Key': 'upload-test-1'
    }
  });
  assert.equal(uploadResponse.statusCode, 201, uploadResponse.body);
  const uploadBody = uploadResponse.json() as {
    data: {
      node: {
        id: number;
        path: string;
        kind: string;
        sizeBytes: number;
        metadata: Record<string, unknown>;
      } | null;
      result: { sizeBytes?: number };
    };
  };
  assert.equal(uploadBody.data.node?.path, uploadPath);
  assert.equal(uploadBody.data.node?.kind, 'file');
  assert.equal(uploadBody.data.node?.sizeBytes, fileContent.length);
  assert.equal((uploadBody.data.node?.metadata as { source?: string }).source, 'routes-test');
  assert.equal(uploadBody.data.result.sizeBytes, fileContent.length);

  const storedFile = await readFile(path.join(backendRoot, uploadPath), 'utf8');
  assert.equal(storedFile, fileContent.toString('utf8'));

  const uploadedNodeResponse = await app.inject({
    method: 'GET',
    url: `/v1/nodes/by-path?backendMountId=${backendMountId}&path=${uploadPath}`
  });
  assert.equal(uploadedNodeResponse.statusCode, 200, uploadedNodeResponse.body);
  const uploadedNodeBody = uploadedNodeResponse.json() as {
    data: { state: string; sizeBytes: number; version: number };
  };
  assert.equal(uploadedNodeBody.data.state, 'active');
  assert.equal(uploadedNodeBody.data.sizeBytes, fileContent.length);
  assert.ok(uploadedNodeBody.data.version >= 1);

  const overwriteBoundary = '----filestore-routes-overwrite';
  const overwriteContent = Buffer.from('epoch,telescope\n2,James Webb\n', 'utf8');
  const overwriteChecksum = createHash('sha256').update(overwriteContent).digest('hex');
  const overwritePayload = encodeMultipart(overwriteBoundary, [
    { name: 'backendMountId', value: String(backendMountId) },
    { name: 'path', value: uploadPath },
    { name: 'overwrite', value: 'true' },
    { name: 'file', value: overwriteContent, filename: 'data.csv', contentType: 'text/csv' }
  ]);

  const overwriteResponse = await app.inject({
    method: 'POST',
    url: '/v1/files',
    payload: overwritePayload,
    headers: {
      'content-type': `multipart/form-data; boundary=${overwriteBoundary}`,
      'x-filestore-checksum': `sha256:${overwriteChecksum}`,
      'x-filestore-content-hash': `sha256:${overwriteChecksum}`,
      'x-filestore-principal': 'routes-test',
      'Idempotency-Key': 'upload-test-2'
    }
  });
  assert.equal(overwriteResponse.statusCode, 200, overwriteResponse.body);
  const overwriteBody = overwriteResponse.json() as {
    data: {
      node: { id: number; sizeBytes: number; version: number } | null;
      result: { previousSizeBytes?: number };
    };
  };
  assert.ok(overwriteBody.data.node);
  assert.ok((overwriteBody.data.node?.version ?? 0) > 1);
  assert.equal(overwriteBody.data.node?.sizeBytes, overwriteContent.length);
  assert.equal(overwriteBody.data.result.previousSizeBytes, fileContent.length);

  const storedOverwrite = await readFile(path.join(backendRoot, uploadPath), 'utf8');
  assert.equal(storedOverwrite, overwriteContent.toString('utf8'));

  const fileNodeId = overwriteBody.data.node?.id ?? uploadBody.data.node?.id;
  assert.ok(fileNodeId);

  const downloadResponse = await app.inject({
    method: 'GET',
    url: `/v1/files/${fileNodeId}/content`
  });
  assert.equal(downloadResponse.statusCode, 200, downloadResponse.body);
  assert.equal(downloadResponse.headers['content-type'], 'application/octet-stream');
  assert.equal(downloadResponse.headers['accept-ranges'], 'bytes');
  assert.ok(downloadResponse.headers['content-disposition']?.includes('attachment'));
  assert.equal(downloadResponse.body, overwriteContent.toString('utf8'));

  const rangeResponse = await app.inject({
    method: 'GET',
    url: `/v1/files/${fileNodeId}/content`,
    headers: {
      Range: 'bytes=0-4'
    }
  });
  assert.equal(rangeResponse.statusCode, 206, rangeResponse.body);
  assert.ok(rangeResponse.headers['content-range']);
  assert.ok(rangeResponse.headers['content-range']?.startsWith('bytes 0-4/'));
  assert.equal(rangeResponse.headers['content-length'], '5');
  assert.equal(rangeResponse.body, overwriteContent.slice(0, 5).toString('utf8'));

  const presignResponse = await app.inject({
    method: 'GET',
    url: `/v1/files/${fileNodeId}/presign`
  });
  assert.equal(presignResponse.statusCode, 400, presignResponse.body);
  const presignBody = presignResponse.json() as { error: { code: string } };
  assert.equal(presignBody.error.code, 'NOT_SUPPORTED');

  const metadataFilters = encodeFilestoreNodeFiltersParam({
    metadata: [{ key: 'owner', value: 'astro-ops' }]
  });
  const metadataQuery = new URLSearchParams({ backendMountId: String(backendMountId) });
  if (metadataFilters) {
    metadataQuery.set('filters', metadataFilters);
  }
  const metadataFilteredResponse = await app.inject({
    method: 'GET',
    url: `/v1/nodes?${metadataQuery.toString()}`
  });
  assert.equal(metadataFilteredResponse.statusCode, 200, metadataFilteredResponse.body);
  const metadataFilteredBody = metadataFilteredResponse.json() as {
    data: {
      nodes: Array<{ path: string; metadata: Record<string, unknown> }>;
      filters: { advanced: { metadata?: Array<{ key: string; value: unknown }> } | null };
    };
  };
  assert.ok(metadataFilteredBody.data.filters.advanced?.metadata);
  assert.ok(
    metadataFilteredBody.data.nodes.every(
      (node) => (node.metadata.owner ?? null) === 'astro-ops'
    )
  );
  assert.ok(
    metadataFilteredBody.data.nodes.some((node) => node.path.includes('observatory-archive'))
  );

  const sizeFilters = encodeFilestoreNodeFiltersParam({
    size: { min: overwriteContent.length, max: overwriteContent.length }
  });
  const sizeQuery = new URLSearchParams({ backendMountId: String(backendMountId) });
  if (sizeFilters) {
    sizeQuery.set('filters', sizeFilters);
  }
  const sizeFilteredResponse = await app.inject({
    method: 'GET',
    url: `/v1/nodes?${sizeQuery.toString()}`
  });
  assert.equal(sizeFilteredResponse.statusCode, 200, sizeFilteredResponse.body);
  const sizeFilteredBody = sizeFilteredResponse.json() as {
    data: {
      nodes: Array<{ path: string; sizeBytes: number }>;
      filters: { advanced: { size?: { min?: number; max?: number } } | null };
    };
  };
  assert.equal(sizeFilteredBody.data.nodes.length, 1);
  assert.equal(sizeFilteredBody.data.nodes[0].path, uploadPath);
  assert.equal(sizeFilteredBody.data.nodes[0].sizeBytes, overwriteContent.length);

  const recentIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const recentFilters = encodeFilestoreNodeFiltersParam({
    lastSeenAt: { after: recentIso }
  });
  const recentQuery = new URLSearchParams({ backendMountId: String(backendMountId) });
  if (recentFilters) {
    recentQuery.set('filters', recentFilters);
  }
  const recentResponse = await app.inject({
    method: 'GET',
    url: `/v1/nodes?${recentQuery.toString()}`
  });
  assert.equal(recentResponse.statusCode, 200, recentResponse.body);
  const recentBody = recentResponse.json() as { data: { nodes: Array<{ lastSeenAt: string }> } };
  assert.ok(recentBody.data.nodes.length > 0);
  assert.ok(
    recentBody.data.nodes.every((node) => new Date(node.lastSeenAt) >= new Date(recentIso))
  );

  const pastFilters = encodeFilestoreNodeFiltersParam({
    lastSeenAt: { before: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }
  });
  const pastQuery = new URLSearchParams({ backendMountId: String(backendMountId) });
  if (pastFilters) {
    pastQuery.set('filters', pastFilters);
  }
  const pastResponse = await app.inject({
    method: 'GET',
    url: `/v1/nodes?${pastQuery.toString()}`
  });
  assert.equal(pastResponse.statusCode, 200, pastResponse.body);
  const pastBody = pastResponse.json() as { data: { nodes: unknown[] } };
  assert.equal(pastBody.data.nodes.length, 0);

  const rollupFilters = encodeFilestoreNodeFiltersParam({
    rollup: { states: ['up_to_date'], minChildCount: 1 }
  });
  const rollupQuery = new URLSearchParams({ backendMountId: String(backendMountId) });
  if (rollupFilters) {
    rollupQuery.set('filters', rollupFilters);
  }
  const rollupResponse = await app.inject({
    method: 'GET',
    url: `/v1/nodes?${rollupQuery.toString()}`
  });
  assert.equal(rollupResponse.statusCode, 200, rollupResponse.body);
  const rollupBody = rollupResponse.json() as {
    data: {
      nodes: Array<{ path: string; rollup: { state: string; childCount: number } | null }>;
    };
  };
  assert.ok(rollupBody.data.nodes.length > 0);
  assert.ok(
    rollupBody.data.nodes.every(
      (node) => node.rollup !== null && node.rollup.state === 'up_to_date' && node.rollup.childCount >= 1
    )
  );

  const deleteResponse = await app.inject({
    method: 'DELETE',
    url: '/v1/nodes',
    payload: {
      backendMountId,
      path: currentPath,
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
  assert.ok(deletedListBody.data.nodes.some((node) => node.path === currentPath));
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
    url: `/v1/nodes/by-path?backendMountId=${backendMountId}&path=${currentPath}`
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
      path: currentPath
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
              path: currentPath,
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

  const scopedPrefix = `${currentPath}/scoped`;
  const scopedUrl = new URL(
    `/v1/events/stream?backendMountId=${backendMountId}&pathPrefix=${encodeURIComponent(scopedPrefix)}&events=filestore.node.updated`,
    baseAddress
  ).toString();

  const scopedData = await new Promise<string>((resolve, reject) => {
    const req = http.get(scopedUrl, (res) => {
      res.setEncoding('utf8');
      let buffer = '';
      let connected = false;

      res.on('data', (chunk: string) => {
        buffer += chunk;
        if (!connected && buffer.includes(':connected')) {
          connected = true;
          const emit = async () => {
            await eventsModule.emitFilestoreEvent({
              type: 'filestore.node.created',
              data: {
                backendMountId,
                nodeId,
                path: `${currentPath}/misc/file`,
                kind: 'directory',
                state: 'active',
                parentId: null,
                version: 1,
                sizeBytes: 0,
                checksum: null,
                contentHash: null,
                metadata: {},
                journalId: 1001,
                command: 'createDirectory',
                idempotencyKey: null,
                principal: null,
                observedAt: new Date().toISOString()
              }
            });
            await eventsModule.emitFilestoreEvent({
              type: 'filestore.node.updated',
              data: {
                backendMountId: backendMountId + 1,
                nodeId,
                path: `${scopedPrefix}/file`,
                kind: 'directory',
                state: 'active',
                parentId: null,
                version: 2,
                sizeBytes: 0,
                checksum: null,
                contentHash: null,
                metadata: {},
                journalId: 1002,
                command: 'updateNodeMetadata',
                idempotencyKey: null,
                principal: null,
                observedAt: new Date().toISOString()
              }
            });
            await eventsModule.emitFilestoreEvent({
              type: 'filestore.command.completed',
              data: {
                backendMountId,
                nodeId,
                path: `${scopedPrefix}/other`,
                command: 'writeFile',
                journalId: 1003,
                idempotencyKey: null,
                principal: null,
                result: {},
                observedAt: new Date().toISOString()
              }
            });
            await eventsModule.emitFilestoreEvent({
              type: 'filestore.node.updated',
              data: {
                backendMountId,
                nodeId,
                path: `${scopedPrefix}/final`,
                kind: 'directory',
                state: 'active',
                parentId: null,
                version: 3,
                sizeBytes: 0,
                checksum: null,
                contentHash: null,
                metadata: {},
                journalId: 1004,
                command: 'updateNodeMetadata',
                idempotencyKey: null,
                principal: null,
                observedAt: new Date().toISOString()
              }
            });
          };
          void emit().catch(reject);
        }
        if (buffer.includes('filestore.node.updated')) {
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

  assert.ok(scopedData.includes('filestore.node.updated'));
  assert.ok(!scopedData.includes('filestore.node.created'));
  assert.ok(!scopedData.includes('filestore.command.completed'));

  const unauthorizedJobsResponse = await app.inject({
    method: 'GET',
    url: '/v1/reconciliation/jobs'
  });
  assert.equal(unauthorizedJobsResponse.statusCode, 403, unauthorizedJobsResponse.body);

  const jobsResponse = await app.inject({
    method: 'GET',
    url: '/v1/reconciliation/jobs',
    headers: {
      'x-iam-scopes': 'filestore:write'
    }
  });
  assert.equal(jobsResponse.statusCode, 200, jobsResponse.body);
  const jobsBody = jobsResponse.json() as {
    data: {
      jobs: Array<{
        id: number;
        backendMountId: number;
        path: string;
        status: string;
        enqueuedAt: string;
      }>;
      filters: {
        status: string[];
      };
    };
  };
  assert.ok(Array.isArray(jobsBody.data.jobs));
  assert.ok(jobsBody.data.jobs.length >= 1);
  const discoveredJob = jobsBody.data.jobs[0];
  assert.equal(discoveredJob.backendMountId, backendMountId);
  assert.equal(discoveredJob.path, currentPath);
  assert.ok(discoveredJob.enqueuedAt);

  const filteredJobsResponse = await app.inject({
    method: 'GET',
    url: `/v1/reconciliation/jobs?status=${encodeURIComponent(discoveredJob.status)}`,
    headers: {
      'x-iam-scopes': 'filestore:write'
    }
  });
  assert.equal(filteredJobsResponse.statusCode, 200, filteredJobsResponse.body);
  const filteredJobsBody = filteredJobsResponse.json() as {
    data: {
      jobs: Array<{ id: number; status: string }>;
      filters: { status: string[] };
    };
  };
  assert.ok(filteredJobsBody.data.jobs.every((job) => job.status === discoveredJob.status));
  assert.ok(filteredJobsBody.data.filters.status.includes(discoveredJob.status));

  const jobDetailResponse = await app.inject({
    method: 'GET',
    url: `/v1/reconciliation/jobs/${discoveredJob.id}`,
    headers: {
      'x-iam-scopes': 'filestore:write'
    }
  });
  assert.equal(jobDetailResponse.statusCode, 200, jobDetailResponse.body);
  const jobDetailBody = jobDetailResponse.json() as {
    data: {
      id: number;
      status: string;
      result: Record<string, unknown> | null;
      error: Record<string, unknown> | null;
    };
  };
  assert.equal(jobDetailBody.data.id, discoveredJob.id);
  assert.equal(jobDetailBody.data.status, discoveredJob.status);
  assert.ok(jobDetailBody.data.result === null || typeof jobDetailBody.data.result === 'object');
  assert.ok(jobDetailBody.data.error === null || typeof jobDetailBody.data.error === 'object');

  const missingJobResponse = await app.inject({
    method: 'GET',
    url: '/v1/reconciliation/jobs/9999999',
    headers: {
      'x-iam-scopes': 'filestore:write'
    }
  });
  assert.equal(missingJobResponse.statusCode, 404, missingJobResponse.body);
});

import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { FastifyInstance } from 'fastify';
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

type TestContext = {
  app: FastifyInstance;
  dataDir: string;
  postgres: EmbeddedPostgres;
};

async function setupMetastore(): Promise<TestContext> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'metastore-pg-'));
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

  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.APPHUB_AUTH_DISABLED = '1';
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }

  const { buildApp } = await import('../../src/app');

  const { app } = await buildApp();
  await app.ready();

  return { app, dataDir, postgres } satisfies TestContext;
}

runE2E(async ({ registerCleanup }) => {
  const envSnapshot = snapshotEnv(['DATABASE_URL', 'APPHUB_AUTH_DISABLED', 'NODE_ENV', 'APPHUB_METASTORE_TOKENS']);
  registerCleanup(async () => {
    restoreEnv(envSnapshot);
  });

  const { app, dataDir, postgres } = await setupMetastore();

  registerCleanup(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  registerCleanup(async () => {
    await postgres.stop();
  });

  registerCleanup(async () => {
    await app.close();
  });

  // Create record
  const createResponse = await app.inject({
    method: 'POST',
    url: '/records',
    payload: {
      namespace: 'analytics',
      key: 'pipeline-1',
      metadata: {
        status: 'active',
        version: 1,
        thresholds: { latencyMs: 250 }
      },
      tags: ['beta', 'pipelines'],
      owner: 'data-team@apphub.dev',
      schemaHash: 'sha256:abc123'
    }
  });

  assert.equal(createResponse.statusCode, 201, createResponse.body);
  const createBody = createResponse.json() as {
    created: boolean;
    record: { namespace: string; key: string; metadata: Record<string, unknown>; version: number };
  };
  assert.equal(createBody.created, true);
  assert.equal(createBody.record.namespace, 'analytics');
  assert.equal(createBody.record.key, 'pipeline-1');
  assert.equal(createBody.record.metadata.status, 'active');

  // Fetch record
  const fetchResponse = await app.inject({
    method: 'GET',
    url: '/records/analytics/pipeline-1'
  });
  assert.equal(fetchResponse.statusCode, 200, fetchResponse.body);
  const fetchBody = fetchResponse.json() as { record: { version: number; tags: string[] } };
  assert.equal(fetchBody.record.version, 1);
  assert.deepEqual(fetchBody.record.tags.sort(), ['beta', 'pipelines']);

  // Update record via PUT
  const updateResponse = await app.inject({
    method: 'PUT',
    url: '/records/analytics/pipeline-1',
    payload: {
      metadata: {
        status: 'paused',
        version: 2,
        notes: ['maintenance']
      },
      tags: ['pipelines', 'maintenance'],
      owner: 'data-team@apphub.dev'
    }
  });
  assert.equal(updateResponse.statusCode, 200, updateResponse.body);
  const updateBody = updateResponse.json() as { record: { version: number; metadata: Record<string, unknown> } };
  assert.equal(updateBody.record.version, 2);
  assert.equal(updateBody.record.metadata.status, 'paused');

  // Patch record to merge metadata, adjust tags, and clear owner
  const patchResponse = await app.inject({
    method: 'PATCH',
    url: '/records/analytics/pipeline-1',
    payload: {
      metadata: {
        status: 'active',
        thresholds: { latencyMs: 180 }
      },
      metadataUnset: ['notes'],
      tags: {
        add: ['patched'],
        remove: ['maintenance']
      },
      owner: null
    }
  });
  assert.equal(patchResponse.statusCode, 200, patchResponse.body);
  const patchBody = patchResponse.json() as {
    record: { metadata: Record<string, unknown>; tags: string[]; owner: string | null; version: number };
  };
  assert.equal(patchBody.record.metadata.status, 'active');
  assert.equal(
    (patchBody.record.metadata.thresholds as Record<string, unknown>).latencyMs,
    180
  );
  assert.equal(patchBody.record.owner, null);
  assert.deepEqual(patchBody.record.tags.sort(), ['patched', 'pipelines']);

  // Numeric comparison search should treat metadata latency as a number
  const numericSearchResponse = await app.inject({
    method: 'POST',
    url: '/records/search',
    payload: {
      namespace: 'analytics',
      filter: {
        field: 'metadata.thresholds.latencyMs',
        operator: 'lt',
        value: 200
      }
    }
  });
  assert.equal(numericSearchResponse.statusCode, 200, numericSearchResponse.body);
  const numericSearchBody = numericSearchResponse.json() as {
    pagination: { total: number };
    records: Array<{ metadata: Record<string, unknown> }>;
  };
  assert.equal(numericSearchBody.pagination.total, 1);
  assert.equal(
    (numericSearchBody.records[0]?.metadata.thresholds as Record<string, unknown>).latencyMs,
    180
  );

  // Projection search should trim the payload to requested fields
  const projectionSearchResponse = await app.inject({
    method: 'POST',
    url: '/records/search',
    payload: {
      namespace: 'analytics',
      projection: ['namespace', 'key', 'metadata.status'],
      filter: {
        field: 'metadata.status',
        operator: 'eq',
        value: 'active'
      }
    }
  });
  assert.equal(projectionSearchResponse.statusCode, 200, projectionSearchResponse.body);
  const projectionBody = projectionSearchResponse.json() as {
    records: Array<{ metadata: Record<string, unknown>; namespace: string; key: string }>;
  };
  const projectedRecord = projectionBody.records[0];
  assert.deepEqual(Object.keys(projectedRecord).sort(), ['key', 'metadata', 'namespace']);
  assert.deepEqual(Object.keys(projectedRecord.metadata ?? {}).sort(), ['status']);
  assert.equal(projectedRecord.metadata.status, 'active');

  // Search records
  const searchResponse = await app.inject({
    method: 'POST',
    url: '/records/search',
    payload: {
      namespace: 'analytics',
      filter: {
        type: 'condition',
        condition: {
          field: 'metadata.status',
          operator: 'eq',
          value: 'active'
        }
      }
    }
  });
  assert.equal(searchResponse.statusCode, 200, searchResponse.body);
  const searchBody = searchResponse.json() as {
    pagination: { total: number };
    records: Array<{ key: string; metadata: Record<string, unknown> }>;
  };
  assert.equal(searchBody.pagination.total, 1);
  assert.equal(searchBody.records[0]?.metadata.status, 'active');

  // Bulk operations should honor continueOnError and report per-op status
  const bulkContinueResponse = await app.inject({
    method: 'POST',
    url: '/records/bulk',
    payload: {
      continueOnError: true,
      operations: [
        {
          namespace: 'analytics',
          key: 'pipeline-1',
          metadata: {
            status: 'active',
            thresholds: { latencyMs: 170 }
          },
          tags: ['pipelines', 'patched']
        },
        {
          type: 'delete',
          namespace: 'analytics',
          key: 'non-existent'
        }
      ]
    }
  });
  assert.equal(bulkContinueResponse.statusCode, 200, bulkContinueResponse.body);
  const bulkContinueBody = bulkContinueResponse.json() as {
    operations: Array<Record<string, unknown>>;
  };
  assert.equal(bulkContinueBody.operations.length, 2);
  const okOperation = bulkContinueBody.operations.find((op) => op.status === 'ok');
  assert.ok(okOperation);
  assert.equal(okOperation?.type, 'upsert');
  const errorOperation = bulkContinueBody.operations.find((op) => op.status === 'error');
  assert.ok(errorOperation);
  assert.equal((errorOperation?.error as Record<string, unknown>).code, 'not_found');

  // Bulk upsert + delete
  const bulkResponse = await app.inject({
    method: 'POST',
    url: '/records/bulk',
    payload: {
      operations: [
        {
          namespace: 'analytics',
          key: 'pipeline-1',
          metadata: {
            status: 'retired'
          },
          tags: ['pipelines']
        },
        {
          type: 'delete',
          namespace: 'analytics',
          key: 'pipeline-1'
        }
      ]
    }
  });
  assert.equal(bulkResponse.statusCode, 200, bulkResponse.body);
  const bulkBody = bulkResponse.json() as { operations: Array<{ type: string }> };
  assert.equal(bulkBody.operations.length, 2);
  assert.equal(bulkBody.operations[0]?.type, 'upsert');
  assert.equal(bulkBody.operations[1]?.type, 'delete');

  // Fetch record including deleted
  const fetchDeleted = await app.inject({
    method: 'GET',
    url: '/records/analytics/pipeline-1?includeDeleted=true'
  });
  assert.equal(fetchDeleted.statusCode, 200, fetchDeleted.body);
  const deletedBody = fetchDeleted.json() as { record: { deletedAt: string | null; version: number } };
  assert.ok(deletedBody.record.deletedAt);

  const auditResponse = await app.inject({
    method: 'GET',
    url: '/records/analytics/pipeline-1/audit'
  });
  assert.equal(auditResponse.statusCode, 200, auditResponse.body);
  const auditBody = auditResponse.json() as {
    pagination: { total: number };
    entries: Array<{ action: string }>;
  };
  assert.ok(auditBody.pagination.total >= 1);
  assert.ok(auditBody.entries.some((entry) => entry.action === 'delete'));

  const purgeResponse = await app.inject({
    method: 'DELETE',
    url: '/records/analytics/pipeline-1/purge',
    payload: {
      expectedVersion: deletedBody.record.version
    }
  });
  assert.equal(purgeResponse.statusCode, 200, purgeResponse.body);
  const purgeBody = purgeResponse.json() as { purged: boolean; record: { key: string } };
  assert.equal(purgeBody.purged, true);

  const fetchAfterPurge = await app.inject({
    method: 'GET',
    url: '/records/analytics/pipeline-1?includeDeleted=true'
  });
  assert.equal(fetchAfterPurge.statusCode, 404, fetchAfterPurge.body);

  const auditAfterPurge = await app.inject({
    method: 'GET',
    url: '/records/analytics/pipeline-1/audit'
  });
  assert.equal(auditAfterPurge.statusCode, 200, auditAfterPurge.body);
  const auditAfterBody = auditAfterPurge.json() as { pagination: { total: number } };
  assert.equal(auditAfterBody.pagination.total, 0);

  process.env.APPHUB_METASTORE_TOKENS = JSON.stringify([
    {
      token: 'abc123',
      subject: 'service-a',
      scopes: ['metastore:read'],
      namespaces: '*',
      kind: 'service'
    },
    {
      token: 'def456',
      subject: 'service-b',
      scopes: ['metastore:write', 'metastore:delete'],
      namespaces: '*',
      kind: 'service'
    }
  ]);

  const reloadTokensResponse = await app.inject({
    method: 'POST',
    url: '/admin/tokens/reload'
  });
  assert.equal(reloadTokensResponse.statusCode, 200, reloadTokensResponse.body);
  const reloadTokensBody = reloadTokensResponse.json() as { reloaded: boolean; tokenCount: number };
  assert.equal(reloadTokensBody.reloaded, true);
  assert.equal(reloadTokensBody.tokenCount, 2);
}, { name: 'metastore-record-lifecycle' });

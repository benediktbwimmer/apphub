import './testEnv';

import assert from 'node:assert/strict';
import { subscribeToRecordStream, type RecordStreamEvent } from '../../src/events/recordStream';
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
  process.env.APPHUB_METASTORE_SEARCH_PRESETS = JSON.stringify([
    {
      name: 'soft-deleted',
      filter: { field: 'deletedAt', operator: 'exists' },
      requiredScopes: ['metastore:read']
    },
    {
      name: 'active-records',
      filter: {
        type: 'condition',
        condition: { field: 'metadata.status', operator: 'eq', value: 'active' }
      },
      requiredScopes: ['metastore:read']
    }
  ]);
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }

  const { buildApp } = await import('../../src/app');

  const { app } = await buildApp();
  await app.ready();

  return { app, dataDir, postgres } satisfies TestContext;
}

runE2E(async ({ registerCleanup }) => {
  const envSnapshot = snapshotEnv([
    'DATABASE_URL',
    'APPHUB_AUTH_DISABLED',
    'NODE_ENV',
    'APPHUB_METASTORE_TOKENS',
    'APPHUB_METASTORE_SEARCH_PRESETS'
  ]);
  registerCleanup(async () => {
    restoreEnv(envSnapshot);
  });

  const { app, dataDir, postgres } = await setupMetastore();

  const streamEvents: RecordStreamEvent[] = [];
  const unsubscribeStream = subscribeToRecordStream((event) => {
    streamEvents.push(event);
  });

  registerCleanup(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  registerCleanup(async () => {
    await postgres.stop();
  });

  registerCleanup(async () => {
    unsubscribeStream();
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
    idempotent: boolean;
    record: { namespace: string; key: string; metadata: Record<string, unknown>; version: number };
  };
  assert.equal(createBody.created, true);
  assert.equal(createBody.idempotent, false);
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
      owner: 'data-team@apphub.dev',
      idempotencyKey: 'pipeline-1-update-v1'
    }
  });
  assert.equal(updateResponse.statusCode, 200, updateResponse.body);
  const updateBody = updateResponse.json() as {
    created: boolean;
    idempotent: boolean;
    record: { version: number; metadata: Record<string, unknown> };
  };
  assert.equal(updateBody.created, false);
  assert.equal(updateBody.idempotent, false);
  assert.equal(updateBody.record.version, 2);
  assert.equal(updateBody.record.metadata.status, 'paused');
  const updatedVersion = updateBody.record.version;
  const eventsAfterFirstUpdate = streamEvents.length;

  const duplicateUpdateResponse = await app.inject({
    method: 'PUT',
    url: '/records/analytics/pipeline-1',
    payload: {
      metadata: {
        status: 'paused',
        version: 2,
        notes: ['maintenance']
      },
      tags: ['pipelines', 'maintenance'],
      owner: 'data-team@apphub.dev',
      idempotencyKey: 'pipeline-1-update-v1'
    }
  });
  assert.equal(duplicateUpdateResponse.statusCode, 200, duplicateUpdateResponse.body);
  const duplicateUpdateBody = duplicateUpdateResponse.json() as {
    created: boolean;
    idempotent: boolean;
    record: { version: number };
  };
  assert.equal(duplicateUpdateBody.created, false);
  assert.equal(duplicateUpdateBody.idempotent, true);
  assert.equal(duplicateUpdateBody.record.version, updatedVersion);
  assert.equal(streamEvents.length, eventsAfterFirstUpdate);

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
      owner: null,
      idempotencyKey: 'pipeline-1-patch-v1'
    }
  });
  assert.equal(patchResponse.statusCode, 200, patchResponse.body);
  const patchBody = patchResponse.json() as {
    idempotent: boolean;
    record: { metadata: Record<string, unknown>; tags: string[]; owner: string | null; version: number };
  };
  assert.equal(patchBody.idempotent, false);
  assert.equal(patchBody.record.metadata.status, 'active');
  assert.equal(
    (patchBody.record.metadata.thresholds as Record<string, unknown>).latencyMs,
    180
  );
  assert.equal(patchBody.record.owner, null);
  assert.deepEqual(patchBody.record.tags.sort(), ['patched', 'pipelines']);
  const eventsAfterPatch = streamEvents.length;

  const duplicatePatchResponse = await app.inject({
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
      owner: null,
      idempotencyKey: 'pipeline-1-patch-v1'
    }
  });
  assert.equal(duplicatePatchResponse.statusCode, 200, duplicatePatchResponse.body);
  const duplicatePatchBody = duplicatePatchResponse.json() as { idempotent: boolean; record: { version: number } };
  assert.equal(duplicatePatchBody.idempotent, true);
  assert.equal(duplicatePatchBody.record.version, patchBody.record.version);
  assert.equal(streamEvents.length, eventsAfterPatch);

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

  const summarySearchResponse = await app.inject({
    method: 'POST',
    url: '/records/search',
    payload: {
      namespace: 'analytics',
      summary: true
    }
  });
  assert.equal(summarySearchResponse.statusCode, 200, summarySearchResponse.body);
  const summaryBody = summarySearchResponse.json() as {
    records: Array<Record<string, unknown>>;
  };
  const summaryRecord = summaryBody.records[0] ?? {};
  assert.ok(!('metadata' in summaryRecord));
  assert.deepEqual(
    Object.keys(summaryRecord).sort(),
    ['deletedAt', 'key', 'namespace', 'owner', 'schemaHash', 'tags', 'updatedAt', 'version']
  );
  assert.equal(summaryRecord.owner, null);
  assert.equal(Array.isArray(summaryRecord.tags), true);
  if (Array.isArray(summaryRecord.tags)) {
    assert.deepEqual([...summaryRecord.tags].sort(), ['patched', 'pipelines']);
  }
  assert.equal(typeof summaryRecord.updatedAt, 'string');

  const querySearchResponse = await app.inject({
    method: 'POST',
    url: '/records/search',
    payload: {
      namespace: 'analytics',
      q: 'key:pipeline-1 status:"active"'
    }
  });
  assert.equal(querySearchResponse.statusCode, 200, querySearchResponse.body);
  const querySearchBody = querySearchResponse.json() as {
    records: Array<{ key: string }>;
  };
  assert.equal(querySearchBody.records.length, 1);
  assert.equal(querySearchBody.records[0]?.key, 'pipeline-1');

  const missingPresetResponse = await app.inject({
    method: 'POST',
    url: '/records/search',
    payload: {
      namespace: 'analytics',
      preset: 'does-not-exist'
    }
  });
  assert.equal(missingPresetResponse.statusCode, 400, missingPresetResponse.body);

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
  assert.equal((okOperation as { idempotent?: boolean }).idempotent, false);
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
  assert.equal((bulkBody.operations[0] as { idempotent?: boolean }).idempotent, false);
  assert.equal(bulkBody.operations[1]?.type, 'delete');
  assert.equal((bulkBody.operations[1] as { idempotent?: boolean }).idempotent, false);

  // Fetch record including deleted
  const fetchDeleted = await app.inject({
    method: 'GET',
    url: '/records/analytics/pipeline-1?includeDeleted=true'
  });
  assert.equal(fetchDeleted.statusCode, 200, fetchDeleted.body);
  const deletedBody = fetchDeleted.json() as { record: { deletedAt: string | null; version: number } };
  assert.ok(deletedBody.record.deletedAt);
  let deletedVersion = deletedBody.record.version;

  const presetSearchResponse = await app.inject({
    method: 'POST',
    url: '/records/search',
    payload: {
      namespace: 'analytics',
      includeDeleted: true,
      preset: 'soft-deleted'
    }
  });
  assert.equal(presetSearchResponse.statusCode, 200, presetSearchResponse.body);
  const presetSearchBody = presetSearchResponse.json() as {
    records: Array<{ key: string; deletedAt: string | null }>;
  };
  assert.equal(presetSearchBody.records.length, 1);
  assert.equal(presetSearchBody.records[0]?.key, 'pipeline-1');
  assert.ok(presetSearchBody.records[0]?.deletedAt);

  const auditResponse = await app.inject({
    method: 'GET',
    url: '/records/analytics/pipeline-1/audit'
  });
  assert.equal(auditResponse.statusCode, 200, auditResponse.body);
  const auditBody = auditResponse.json() as {
    pagination: { total: number };
    entries: Array<{
      id: number;
      action: string;
      metadata: Record<string, unknown> | null;
      previousMetadata: Record<string, unknown> | null;
      tags: string[] | null;
      previousTags: string[] | null;
      version: number | null;
    }>;
  };
  assert.ok(auditBody.pagination.total >= 1);
  assert.ok(auditBody.entries.some((entry) => entry.action === 'delete'));

  const restoreSource = auditBody.entries.find(
    (entry) => entry.action === 'update' && (entry.metadata?.status as string | undefined) === 'retired'
  );
  assert.ok(restoreSource, 'expected update audit entry for bulk upsert');

  const diffResponse = await app.inject({
    method: 'GET',
    url: `/records/analytics/pipeline-1/audit/${restoreSource!.id}/diff`
  });
  assert.equal(diffResponse.statusCode, 200, diffResponse.body);
  const diffBody = diffResponse.json() as {
    audit: { id: number; action: string };
    metadata: {
      added: Array<{ path: string }>;
      removed: Array<{ path: string; value: Record<string, unknown> | null }>;
      changed: Array<{ path: string; before: unknown; after: unknown }>;
    };
    tags: { added: string[]; removed: string[] };
    owner: { changed: boolean; before: string | null; after: string | null };
    schemaHash: { changed: boolean };
    snapshots: {
      current: { metadata: Record<string, unknown> | null; tags: string[] };
      previous: { metadata: Record<string, unknown> | null; tags: string[] };
    };
  };
  assert.equal(diffBody.audit.id, restoreSource!.id);
  const statusChange = diffBody.metadata.changed.find((change) => change.path === 'status');
  assert.ok(statusChange, 'expected metadata status diff');
  assert.equal(statusChange?.before, 'active');
  assert.equal(statusChange?.after, 'retired');
  assert.ok(diffBody.metadata.removed.some((entry) => entry.path === 'thresholds'));
  assert.deepEqual(diffBody.tags.added, []);
  assert.deepEqual(diffBody.tags.removed, ['patched']);
  assert.equal(diffBody.owner.changed, false);
  assert.equal(diffBody.schemaHash.changed, false);
  assert.equal(diffBody.snapshots.current.metadata?.status, 'retired');
  assert.ok(diffBody.snapshots.previous.metadata);

  const restoreResponse = await app.inject({
    method: 'POST',
    url: '/records/analytics/pipeline-1/restore',
    payload: {
      auditId: restoreSource!.id,
      expectedVersion: deletedVersion
    }
  });
  assert.equal(restoreResponse.statusCode, 200, restoreResponse.body);
  const restoreBody = restoreResponse.json() as {
    restored: boolean;
    idempotent: boolean;
    record: {
      metadata: Record<string, unknown>;
      tags: string[];
      deletedAt: string | null;
      version: number;
    };
    restoredFrom: { auditId: number };
  };
  assert.equal(restoreBody.restored, true);
  assert.equal(restoreBody.idempotent, false);
  assert.equal(restoreBody.restoredFrom.auditId, restoreSource!.id);
  assert.equal(restoreBody.record.metadata.status, 'retired');
  assert.equal(Array.isArray(restoreBody.record.tags), true);
  assert.deepEqual(restoreBody.record.tags.sort(), ['pipelines']);
  assert.equal(restoreBody.record.deletedAt, null);

  const postRestoreFetch = await app.inject({
    method: 'GET',
    url: '/records/analytics/pipeline-1'
  });
  assert.equal(postRestoreFetch.statusCode, 200, postRestoreFetch.body);
  const postRestoreBody = postRestoreFetch.json() as {
    record: { metadata: Record<string, unknown>; deletedAt: string | null; version: number };
  };
  assert.equal(postRestoreBody.record.metadata.status, 'retired');
  assert.equal(postRestoreBody.record.deletedAt, null);

  const deleteAfterRestore = await app.inject({
    method: 'DELETE',
    url: '/records/analytics/pipeline-1',
    payload: {
      expectedVersion: restoreBody.record.version,
      idempotencyKey: 'pipeline-1-delete-v1'
    }
  });
  assert.equal(deleteAfterRestore.statusCode, 200, deleteAfterRestore.body);
  const deleteAfterBody = deleteAfterRestore.json() as {
    deleted: boolean;
    idempotent: boolean;
    record: { version: number; deletedAt: string | null };
  };
  assert.equal(deleteAfterBody.deleted, true);
  assert.equal(deleteAfterBody.idempotent, false);
  assert.ok(deleteAfterBody.record.deletedAt);
  deletedVersion = deleteAfterBody.record.version;

  const duplicateDelete = await app.inject({
    method: 'DELETE',
    url: '/records/analytics/pipeline-1',
    payload: {
      expectedVersion: deletedVersion,
      idempotencyKey: 'pipeline-1-delete-v1'
    }
  });
  assert.equal(duplicateDelete.statusCode, 200, duplicateDelete.body);
  const duplicateDeleteBody = duplicateDelete.json() as { deleted: boolean; idempotent: boolean; record: { version: number } };
  assert.equal(duplicateDeleteBody.deleted, false);
  assert.equal(duplicateDeleteBody.idempotent, true);
  assert.equal(duplicateDeleteBody.record.version, deletedVersion);

  const fetchAfterRestoreDelete = await app.inject({
    method: 'GET',
    url: '/records/analytics/pipeline-1?includeDeleted=true'
  });
  assert.equal(fetchAfterRestoreDelete.statusCode, 200, fetchAfterRestoreDelete.body);
  const afterRestoreDeletedBody = fetchAfterRestoreDelete.json() as {
    record: { deletedAt: string | null; version: number };
  };
  assert.ok(afterRestoreDeletedBody.record.deletedAt);
  assert.equal(afterRestoreDeletedBody.record.version, deletedVersion);

  const purgeResponse = await app.inject({
    method: 'DELETE',
    url: '/records/analytics/pipeline-1/purge',
    payload: {
      expectedVersion: deletedVersion
    }
  });
  assert.equal(purgeResponse.statusCode, 200, purgeResponse.body);
  const purgeBody = purgeResponse.json() as { purged: boolean; idempotent: boolean; record: { key: string } };
  assert.equal(purgeBody.purged, true);
  assert.equal(purgeBody.idempotent, false);

  const fetchAfterPurge = await app.inject({
    method: 'GET',
    url: '/records/analytics/pipeline-1?includeDeleted=true'
  });
  assert.equal(fetchAfterPurge.statusCode, 404, fetchAfterPurge.body);

  const createdEvent = streamEvents.find((event) => event.action === 'created' && event.key === 'pipeline-1');
  assert.ok(createdEvent, 'expected created stream event for pipeline-1');
  const updatedEvents = streamEvents.filter((event) => event.action === 'updated' && event.key === 'pipeline-1');
  assert.ok(updatedEvents.length >= 1, 'expected at least one updated stream event');
  const softDeleted = streamEvents.find((event) => event.action === 'deleted' && event.mode === 'soft');
  assert.ok(softDeleted, 'expected soft delete stream event');
  const hardDeleted = streamEvents.find((event) => event.action === 'deleted' && event.mode === 'hard');
  assert.ok(hardDeleted, 'expected hard delete stream event');

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

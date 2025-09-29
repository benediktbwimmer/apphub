/// <reference path="../src/types/embeddedPostgres.d.ts" />

import './testEnv';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import fastify from 'fastify';
import EmbeddedPostgres from 'embedded-postgres';
import { resetCachedServiceConfig } from '../src/config/serviceConfig';

let postgres: EmbeddedPostgres | null = null;
let dataDirectory: string | null = null;
let storageRoot: string | null = null;
let app: ReturnType<typeof fastify> | null = null;

let clientModule: typeof import('../src/db/client');
let schemaModule: typeof import('../src/db/schema');
let migrationsModule: typeof import('../src/db/migrations');
let bootstrapModule: typeof import('../src/service/bootstrap');
let metadataModule: typeof import('../src/db/metadata');
let adminRoutesModule: typeof import('../src/routes/admin');

let defaultStorageTargetId: string;
let datasetA: Awaited<ReturnType<typeof import('../src/db/metadata')['createDataset']>>;
let datasetB: Awaited<ReturnType<typeof import('../src/db/metadata')['createDataset']>>;
let storageTargetAlt: Awaited<ReturnType<typeof import('../src/db/metadata')['upsertStorageTarget']>>;

before(async () => {
  process.env.TIMESTORE_ADMIN_SCOPE = 'admin-scope';
  process.env.TIMESTORE_REQUIRE_SCOPE = 'query-scope';
  process.env.REDIS_URL = 'inline';
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';

  dataDirectory = await mkdtemp(path.join(tmpdir(), 'timestore-admin-pg-'));
  storageRoot = await mkdtemp(path.join(tmpdir(), 'timestore-admin-storage-'));

  const port = 58000 + Math.floor(Math.random() * 1000);
  const embedded = new EmbeddedPostgres({
    databaseDir: dataDirectory,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    postgresFlags: ['-c', 'dynamic_shared_memory_type=posix'],
    onError(message) {
      console.error('[embedded-postgres:admin]', message);
    }
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('apphub');
  postgres = embedded;

  process.env.TIMESTORE_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.TIMESTORE_PG_SCHEMA = `timestore_admin_${randomUUID().slice(0, 8)}`;
  process.env.TIMESTORE_STORAGE_ROOT = storageRoot;
  process.env.TIMESTORE_PGPOOL_MAX = '4';

  resetCachedServiceConfig();

  clientModule = await import('../src/db/client');
  schemaModule = await import('../src/db/schema');
  migrationsModule = await import('../src/db/migrations');
  bootstrapModule = await import('../src/service/bootstrap');
  metadataModule = await import('../src/db/metadata');
  adminRoutesModule = await import('../src/routes/admin');

  await schemaModule.ensureSchemaExists(clientModule.POSTGRES_SCHEMA);
  await migrationsModule.runMigrations();

  const defaultTarget = await bootstrapModule.ensureDefaultStorageTarget();
  defaultStorageTargetId = defaultTarget.id;

  storageTargetAlt = await metadataModule.upsertStorageTarget({
    id: `st-${randomUUID()}`,
    name: `alt-target-${randomUUID().slice(0, 6)}`,
    kind: 'local',
    description: 'Alternate storage',
    config: {
      root: storageRoot
    }
  });

  datasetA = await seedDataset('observatory-admin-a');
  datasetB = await seedDataset('observatory-admin-b');

  app = fastify();
  await adminRoutesModule.registerAdminRoutes(app);
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

async function seedDataset(slug: string) {
  const dataset = await metadataModule.createDataset({
    id: `ds-${randomUUID()}`,
    slug,
    name: `Dataset ${slug}`,
    description: null,
    defaultStorageTargetId: defaultStorageTargetId,
    metadata: {}
  });

  const schemaVersion = await metadataModule.createDatasetSchemaVersion({
    id: `dsv-${randomUUID()}`,
    datasetId: dataset.id,
    version: 1,
    schema: {
      fields: [
        { name: 'timestamp', type: 'timestamp' },
        { name: 'value', type: 'double' }
      ]
    }
  });

  const now = new Date();
  await metadataModule.createDatasetManifest({
    id: `dm-${randomUUID()}`,
    datasetId: dataset.id,
    version: 1,
    status: 'published',
    manifestShard: now.toISOString().slice(0, 10),
    schemaVersionId: schemaVersion.id,
    summary: { note: 'seed manifest' },
    statistics: { startTime: now.toISOString(), endTime: now.toISOString() },
    metadata: {},
    createdBy: 'tests',
    partitions: [
      {
        id: `part-${randomUUID()}`,
        storageTargetId: defaultStorageTargetId,
        fileFormat: 'duckdb',
        filePath: `${slug}/2024-01-01.duckdb`,
        partitionKey: { window: '2024-01-01' },
        startTime: new Date(now.getTime() - 3_600_000),
        endTime: now,
        fileSizeBytes: 1024,
        rowCount: 10,
        checksum: 'seed-checksum'
      }
    ]
  });

  return dataset;
}

function adminHeaders() {
  return {
    'x-iam-scopes': 'admin-scope'
  };
}

test('creates dataset via admin API with metadata and idempotency', async () => {
  assert.ok(app);
  const slug = `admin-created-${randomUUID().slice(0, 8)}`;
  const requestBody = {
    slug,
    name: 'New Observability Dataset',
    description: 'Created via admin API test',
    defaultStorageTargetId: defaultStorageTargetId,
    metadata: {
      iam: {
        readScopes: ['admin-scope', 'query-scope'],
        writeScopes: ['admin-scope']
      }
    },
    idempotencyKey: `ticket-044-${randomUUID().slice(0, 6)}`
  };

  const response = await app!.inject({
    method: 'POST',
    url: '/admin/datasets',
    headers: {
      ...adminHeaders(),
      'content-type': 'application/json'
    },
    body: requestBody
  });

  assert.equal(response.statusCode, 201);
  const createdPayload = response.json() as {
    dataset: { id: string; slug: string; metadata: { iam?: { readScopes?: string[] } } };
    etag: string;
  };
  assert.equal(createdPayload.dataset.slug, slug);
  assert.equal(Array.isArray(createdPayload.dataset.metadata.iam?.readScopes), true);
  assert.ok(response.headers['etag']);
  assert.equal(createdPayload.etag.length > 0, true);
  assert.equal(Number.isNaN(Date.parse(String(response.headers['etag']))), false);

  const replay = await app!.inject({
    method: 'POST',
    url: '/admin/datasets',
    headers: {
      ...adminHeaders(),
      'content-type': 'application/json'
    },
    body: requestBody
  });

  assert.equal(replay.statusCode, 200);
  const replayPayload = replay.json() as { dataset: { id: string } };
  assert.equal(replayPayload.dataset.id, createdPayload.dataset.id);

  const stored = await metadataModule.getDatasetBySlug(slug);
  assert.ok(stored);
  const auditLog = await metadataModule.listDatasetAccessEvents(stored!.id, { limit: 10 });
  assert.ok(auditLog.events.some((event) => event.action === 'admin.dataset.created'));
});

test('rejects dataset creation when slug conflicts with different config', async () => {
  assert.ok(app);
  const response = await app!.inject({
    method: 'POST',
    url: '/admin/datasets',
    headers: {
      ...adminHeaders(),
      'content-type': 'application/json'
    },
    body: {
      slug: datasetA.slug,
      name: 'Conflicting Dataset',
      idempotencyKey: `conflict-${randomUUID().slice(0, 6)}`
    }
  });

  assert.equal(response.statusCode, 409);
});

test('updates dataset metadata with optimistic concurrency', async () => {
  assert.ok(app);
  const before = await metadataModule.getDatasetById(datasetA.id);
  assert.ok(before);

  const response = await app!.inject({
    method: 'PATCH',
    url: `/admin/datasets/${datasetA.id}`,
    headers: {
      ...adminHeaders(),
      'content-type': 'application/json'
    },
    body: {
      name: `${before!.name} Updated`,
      description: 'Updated by admin API test',
      metadata: {
        iam: {
          readScopes: ['admin-scope', 'query-scope', 'admin-scope'],
          writeScopes: ['admin-scope']
        }
      },
      ifMatch: before!.updatedAt
    }
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as { dataset: { name: string; metadata: { iam?: { readScopes?: string[] } } }; etag: string };
  assert.equal(payload.dataset.name, `${before!.name} Updated`);
  assert.ok(response.headers['etag']);
  assert.equal(Number.isNaN(Date.parse(String(response.headers['etag']))), false);
  assert.deepEqual(payload.dataset.metadata.iam?.readScopes, ['admin-scope', 'query-scope']);

  datasetA = await metadataModule.getDatasetById(datasetA.id);
  assert.ok(datasetA);
  assert.equal(datasetA!.name.endsWith('Updated'), true);

  const updateAudit = await metadataModule.listDatasetAccessEvents(datasetA!.id, { limit: 5 });
  assert.ok(updateAudit.events.some((event) => event.action === 'admin.dataset.updated'));
});

test('returns 412 when dataset update conflicts', async () => {
  assert.ok(app);
  const response = await app!.inject({
    method: 'PATCH',
    url: `/admin/datasets/${datasetB.id}`,
    headers: {
      ...adminHeaders(),
      'content-type': 'application/json'
    },
    body: {
      name: 'Stale Update',
      ifMatch: '2000-01-01T00:00:00.000Z'
    }
  });

  assert.equal(response.statusCode, 412);
});

test('archives dataset and is idempotent', async () => {
  assert.ok(app);
  const before = await metadataModule.getDatasetById(datasetB.id);
  assert.ok(before);

  const response = await app!.inject({
    method: 'POST',
    url: `/admin/datasets/${datasetB.id}/archive`,
    headers: {
      ...adminHeaders(),
      'content-type': 'application/json'
    },
    body: {
      reason: 'cleanup',
      ifMatch: before!.updatedAt
    }
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as { dataset: { status: string }; etag: string };
  assert.equal(payload.dataset.status, 'inactive');
  assert.ok(response.headers['etag']);
  assert.equal(Number.isNaN(Date.parse(String(response.headers['etag']))), false);

  const second = await app!.inject({
    method: 'POST',
    url: `/admin/datasets/${datasetB.id}/archive`,
    headers: {
      ...adminHeaders(),
      'content-type': 'application/json'
    },
    body: {
      reason: 'cleanup repeat'
    }
  });

  assert.equal(second.statusCode, 200);
  const archiveAudit = await metadataModule.listDatasetAccessEvents(datasetB.id, { limit: 5 });
  assert.ok(archiveAudit.events.some((event) => event.action === 'admin.dataset.archived'));
});

test('lists datasets with pagination', async () => {
  assert.ok(app);
  const response = await app!.inject({
    method: 'GET',
    url: '/admin/datasets?limit=1',
    headers: adminHeaders()
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as { datasets: Array<{ id: string }>; nextCursor: string | null };
  assert.equal(payload.datasets.length, 1);
  assert.ok(payload.nextCursor);

  const nextResponse = await app!.inject({
    method: 'GET',
    url: `/admin/datasets?cursor=${encodeURIComponent(payload.nextCursor ?? '')}`,
    headers: adminHeaders()
  });

  assert.equal(nextResponse.statusCode, 200);
  const nextPayload = nextResponse.json() as { datasets: Array<{ id: string }>; nextCursor: string | null };
  assert.equal(nextPayload.datasets.length >= 0, true);
});

test('returns dataset details', async () => {
  assert.ok(app);
  const response = await app!.inject({
    method: 'GET',
    url: `/admin/datasets/${datasetA.id}`,
    headers: adminHeaders()
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as { dataset: { id: string; slug: string } };
  assert.equal(payload.dataset.id, datasetA.id);
  assert.equal(payload.dataset.slug, datasetA.slug);
});

test('lists dataset access audit events with filters and pagination', async () => {
  assert.ok(app);
  const auditDataset = await seedDataset(`audit-${randomUUID().slice(0, 6)}`);
  const baseScopes = ['admin-scope', 'query-scope'];

  await metadataModule.recordDatasetAccessEvent({
    id: `da-${randomUUID()}`,
    datasetId: auditDataset.id,
    datasetSlug: auditDataset.slug,
    actorId: 'robot-one',
    actorScopes: baseScopes,
    action: 'ingest.requested',
    success: false,
    metadata: {
      stage: 'ingest',
      error: 'missing_scope',
      jobId: 'job-001'
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 5));

  await metadataModule.recordDatasetAccessEvent({
    id: `da-${randomUUID()}`,
    datasetId: auditDataset.id,
    datasetSlug: auditDataset.slug,
    actorId: 'robot-one',
    actorScopes: baseScopes,
    action: 'ingest.completed',
    success: true,
    metadata: {
      stage: 'ingest',
      jobId: 'job-001'
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 5));

  await metadataModule.recordDatasetAccessEvent({
    id: `da-${randomUUID()}`,
    datasetId: auditDataset.id,
    datasetSlug: auditDataset.slug,
    actorId: 'robot-two',
    actorScopes: baseScopes,
    action: 'query.executed',
    success: true,
    metadata: {
      stage: 'query',
      manifestId: 'dm-test',
      rowCount: 42
    }
  });

  const pageOneResponse = await app!.inject({
    method: 'GET',
    url: `/admin/datasets/${auditDataset.id}/audit?limit=2`,
    headers: adminHeaders()
  });

  assert.equal(pageOneResponse.statusCode, 200);
  const pageOneBody = pageOneResponse.json() as {
    events: Array<{ action: string; actorScopes: string[]; metadata: Record<string, unknown>; createdAt: string; success: boolean }>;
    nextCursor: string | null;
  };
  assert.equal(pageOneBody.events.length, 2);
  assert.ok(pageOneBody.nextCursor);
  assert.deepEqual(pageOneBody.events.map((event) => event.action), ['query.executed', 'ingest.completed']);
  assert.equal(Array.isArray(pageOneBody.events[0].actorScopes), true);
  assert.equal(typeof pageOneBody.events[0].metadata, 'object');

  const pageTwoResponse = await app!.inject({
    method: 'GET',
    url: `/admin/datasets/${auditDataset.id}/audit?cursor=${encodeURIComponent(pageOneBody.nextCursor ?? '')}`,
    headers: adminHeaders()
  });

  assert.equal(pageTwoResponse.statusCode, 200);
  const pageTwoBody = pageTwoResponse.json() as {
    events: Array<{ action: string; createdAt: string }>;
    nextCursor: string | null;
  };
  assert.equal(pageTwoBody.events.length, 1);
  assert.equal(pageTwoBody.events[0].action, 'ingest.requested');
  assert.equal(pageTwoBody.nextCursor, null);

  const actionFilterResponse = await app!.inject({
    method: 'GET',
    url: `/admin/datasets/${auditDataset.id}/audit?action=${encodeURIComponent('ingest.requested')}`,
    headers: adminHeaders()
  });

  assert.equal(actionFilterResponse.statusCode, 200);
  const actionFilterBody = actionFilterResponse.json() as { events: Array<{ action: string }>; nextCursor: string | null };
  assert.equal(actionFilterBody.events.length, 1);
  assert.equal(actionFilterBody.events[0].action, 'ingest.requested');

  const multiActionResponse = await app!.inject({
    method: 'GET',
    url: `/admin/datasets/${auditDataset.id}/audit?actions=${encodeURIComponent('ingest.requested')}&actions=${encodeURIComponent('ingest.completed')}`,
    headers: adminHeaders()
  });

  assert.equal(multiActionResponse.statusCode, 200);
  const multiActionBody = multiActionResponse.json() as { events: Array<{ action: string }>; nextCursor: string | null };
  const multiActions = multiActionBody.events.map((event) => event.action);
  assert.equal(multiActions.includes('query.executed'), false);
  assert.equal(multiActions.includes('ingest.completed'), true);

  const successFilterResponse = await app!.inject({
    method: 'GET',
    url: `/admin/datasets/${auditDataset.id}/audit?success=false`,
    headers: adminHeaders()
  });

  assert.equal(successFilterResponse.statusCode, 200);
  const successFilterBody = successFilterResponse.json() as { events: Array<{ success: boolean }>; nextCursor: string | null };
  assert.equal(successFilterBody.events.length, 1);
  assert.equal(successFilterBody.events[0].success, false);

  const mostRecentCreatedAt = pageOneBody.events[0].createdAt;
  const oldestCreatedAt = pageTwoBody.events[0].createdAt;

  const startTimeResponse = await app!.inject({
    method: 'GET',
    url: `/admin/datasets/${auditDataset.id}/audit?startTime=${encodeURIComponent(mostRecentCreatedAt)}`,
    headers: adminHeaders()
  });

  assert.equal(startTimeResponse.statusCode, 200);
  const startTimeBody = startTimeResponse.json() as { events: Array<{ createdAt: string }>; nextCursor: string | null };
  assert.equal(startTimeBody.events.every((event) => event.createdAt >= mostRecentCreatedAt), true);

  const endTimeResponse = await app!.inject({
    method: 'GET',
    url: `/admin/datasets/${auditDataset.id}/audit?endTime=${encodeURIComponent(oldestCreatedAt)}`,
    headers: adminHeaders()
  });

  assert.equal(endTimeResponse.statusCode, 200);
  const endTimeBody = endTimeResponse.json() as { events: Array<{ createdAt: string }>; nextCursor: string | null };
  assert.equal(endTimeBody.events.every((event) => event.createdAt <= oldestCreatedAt), true);

  const invalidSuccessResponse = await app!.inject({
    method: 'GET',
    url: `/admin/datasets/${auditDataset.id}/audit?success=maybe`,
    headers: adminHeaders()
  });

  assert.equal(invalidSuccessResponse.statusCode, 400);

  const invalidCursorResponse = await app!.inject({
    method: 'GET',
    url: `/admin/datasets/${auditDataset.id}/audit?cursor=invalid`,
    headers: adminHeaders()
  });

  assert.equal(invalidCursorResponse.statusCode, 400);
});

test('requires admin scope to fetch dataset audit history', async () => {
  assert.ok(app);
  const response = await app!.inject({
    method: 'GET',
    url: `/admin/datasets/${datasetA.id}/audit`,
    headers: {}
  });

  assert.equal(response.statusCode, 403);
});

test('updates retention policy via admin API', async () => {
  assert.ok(app);
  const response = await app!.inject({
    method: 'PUT',
    url: `/admin/datasets/${datasetA.slug}/retention`,
    headers: {
      ...adminHeaders(),
      'content-type': 'application/json'
    },
    body: {
      mode: 'time',
      rules: {
        maxAgeHours: 24
      },
      deleteGraceMinutes: 15
    }
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as { policy: unknown; effectivePolicy: Record<string, unknown> };
  const policy = payload.policy as { rules?: Record<string, unknown> };
  const rules = policy.rules ?? {};
  assert.equal(rules['maxAgeHours'], 24);

  const stored = await metadataModule.getRetentionPolicy(datasetA.id);
  assert.ok(stored);
  const storedRules = (stored?.policy?.rules ?? {}) as { maxAgeHours?: number };
  assert.equal(storedRules.maxAgeHours, 24);
});

test('updates dataset default storage target', async () => {
  assert.ok(app);
  const response = await app!.inject({
    method: 'PUT',
    url: `/admin/datasets/${datasetA.id}/storage-target`,
    headers: {
      ...adminHeaders(),
      'content-type': 'application/json'
    },
    body: {
      storageTargetId: storageTargetAlt.id
    }
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as { dataset: { defaultStorageTargetId: string | null } };
  assert.equal(payload.dataset.defaultStorageTargetId, storageTargetAlt.id);
});

test('fetches manifest inventory and shard lookup', async () => {
  assert.ok(app);
  const response = await app!.inject({
    method: 'GET',
    url: `/admin/datasets/${datasetA.slug}/manifest`,
    headers: adminHeaders()
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as {
    datasetId: string;
    manifests: Array<{
      id: string;
      manifestShard: string;
      partitions: unknown[];
      schemaVersion: { id: string; version: number; fields: Array<{ name: string; type: string }> } | null;
    }>;
  };
  assert.equal(payload.datasetId, datasetA.id);
  assert.ok(Array.isArray(payload.manifests));
  assert.ok(payload.manifests.length >= 1);
  const first = payload.manifests[0];
  assert.ok(first);
  assert.ok(first.schemaVersion);
  assert.ok(first.schemaVersion?.fields.some((field) => field.name === 'timestamp'));

  const shardResponse = await app!.inject({
    method: 'GET',
    url: `/admin/datasets/${datasetA.slug}/manifest?shard=${encodeURIComponent(first.manifestShard)}`,
    headers: adminHeaders()
  });
  assert.equal(shardResponse.statusCode, 200);
  const shardPayload = shardResponse.json() as {
    datasetId: string;
    manifest: {
      manifestShard: string;
      partitions: unknown[];
    };
  };
  assert.equal(shardPayload.datasetId, datasetA.id);
  assert.equal(shardPayload.manifest.manifestShard, first.manifestShard);
  assert.ok(Array.isArray(shardPayload.manifest.partitions));
});

test('lists storage targets', async () => {
  assert.ok(app);
  const response = await app!.inject({
    method: 'GET',
    url: '/admin/storage-targets',
    headers: adminHeaders()
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as { storageTargets: Array<{ id: string }> };
  const ids = payload.storageTargets.map((target) => target.id);
  assert.ok(ids.includes(storageTargetAlt.id));
});

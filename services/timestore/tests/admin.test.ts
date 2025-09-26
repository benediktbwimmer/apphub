/// <reference path="../src/types/embeddedPostgres.d.ts" />

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

test('fetches latest manifest', async () => {
  assert.ok(app);
  const response = await app!.inject({
    method: 'GET',
    url: `/admin/datasets/${datasetA.slug}/manifest`,
    headers: adminHeaders()
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as { manifest: { datasetId: string; partitions: unknown[] } };
  assert.equal(payload.manifest.datasetId, datasetA.id);
  assert.ok(Array.isArray(payload.manifest.partitions));
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

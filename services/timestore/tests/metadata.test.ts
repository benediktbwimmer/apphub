import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';

let postgres: EmbeddedPostgres | null = null;
let dataDirectory: string | null = null;

let metadata: typeof import('../src/db/metadata');
let clientModule: typeof import('../src/db/client');
let schemaModule: typeof import('../src/db/schema');
let migrationsModule: typeof import('../src/db/migrations');

before(async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'timestore-pg-'));
  dataDirectory = dataRoot;
  const port = await findAvailablePort();
  const embedded = new EmbeddedPostgres({
    databaseDir: dataRoot,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('apphub');
  postgres = embedded;

  const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.TIMESTORE_DATABASE_URL = connectionString;
  process.env.TIMESTORE_PG_SCHEMA = `timestore_test_${randomUUID().slice(0, 8)}`;
  process.env.TIMESTORE_PGPOOL_MAX = '4';

  const configModule = await import('../src/config/serviceConfig');
  configModule.resetCachedServiceConfig();

  clientModule = await import('../src/db/client');
  schemaModule = await import('../src/db/schema');
  migrationsModule = await import('../src/db/migrations');
  metadata = await import('../src/db/metadata');

  await schemaModule.ensureSchemaExists(clientModule.POSTGRES_SCHEMA);
  await migrationsModule.runMigrations();
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

test('timestore metadata lifecycle', async () => {
  const storageTarget = await metadata.upsertStorageTarget({
    id: `st-${randomUUID()}`,
    name: 'local-default',
    kind: 'local',
    description: 'Local filesystem root',
    config: { root: '/tmp/timestore' }
  });

  assert.equal(storageTarget.kind, 'local');
  assert.equal(storageTarget.name, 'local-default');

  const datasetId = `ds-${randomUUID()}`;
  const dataset = await metadata.createDataset({
    id: datasetId,
    slug: 'observatory-timeseries',
    name: 'Observatory Time Series',
    description: 'Minute-level weather telemetry',
    defaultStorageTargetId: storageTarget.id,
    metadata: { source: 'observatory' }
  });

  assert.equal(dataset.defaultStorageTargetId, storageTarget.id);
  assert.equal(dataset.status, 'active');

  const schemaVersion = await metadata.createDatasetSchemaVersion({
    id: `dsv-${randomUUID()}`,
    datasetId,
    version: 1,
    schema: {
      fields: [
        { name: 'timestamp', type: 'timestamp' },
        { name: 'temperature_c', type: 'float' },
        { name: 'humidity_percent', type: 'float' }
      ]
    }
  });

  assert.equal(schemaVersion.version, 1);

  const now = new Date();
  const manifest = await metadata.createDatasetManifest({
    id: `dm-${randomUUID()}`,
    datasetId,
    version: 1,
    status: 'published',
    schemaVersionId: schemaVersion.id,
    summary: { rowsIngested: 240 },
    statistics: { minTimestamp: now.toISOString() },
    metadata: { note: 'Initial load' },
    createdBy: 'ingest-worker',
    partitions: [
      {
        id: `part-${randomUUID()}`,
        storageTargetId: storageTarget.id,
        fileFormat: 'duckdb',
        filePath: 'datasets/observatory/2024-01-01.duckdb',
        partitionKey: { dataset: 'observatory', window: '2024-01-01' },
        startTime: new Date(now.getTime() - 3_600_000),
        endTime: now,
        fileSizeBytes: 1024,
        rowCount: 120,
        checksum: 'abc123',
        metadata: { columns: 4 }
      },
      {
        id: `part-${randomUUID()}`,
        storageTargetId: storageTarget.id,
        fileFormat: 'duckdb',
        filePath: 'datasets/observatory/2024-01-02.duckdb',
        partitionKey: { dataset: 'observatory', window: '2024-01-02' },
        startTime: now,
        endTime: new Date(now.getTime() + 3_600_000),
        fileSizeBytes: 2048,
        rowCount: 120,
        checksum: 'def456',
        metadata: { columns: 4 }
      }
    ]
  });

  assert.equal(manifest.partitionCount, 2);
  assert.equal(manifest.totalRows, 240);
  assert.equal(manifest.totalBytes, 3072);
  assert.equal(manifest.partitions.length, 2);

  const latest = await metadata.getLatestPublishedManifest(datasetId);
  assert.ok(latest);
  assert.equal(latest?.id, manifest.id);
  assert.equal(latest?.partitions.length, 2);

  await assert.rejects(
    metadata.createDatasetManifest({
      id: `dm-${randomUUID()}`,
      datasetId,
      version: 1,
      status: 'draft',
      partitions: []
    }),
    /Manifest version 1 is not greater/
  );

  const retentionPolicy = await metadata.upsertRetentionPolicy(datasetId, {
    type: 'timeWindow',
    ttlHours: 720,
    coldStorageAfterHours: 168
  });

  assert.equal(retentionPolicy.policy.ttlHours, 720);

  const fetchedPolicy = await metadata.getRetentionPolicy(datasetId);
  assert.ok(fetchedPolicy);
  assert.equal(fetchedPolicy?.policy.coldStorageAfterHours, 168);

  const fetchedDataset = await metadata.getDatasetBySlug('observatory-timeseries');
  assert.ok(fetchedDataset);
  assert.equal(fetchedDataset?.id, datasetId);
});

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

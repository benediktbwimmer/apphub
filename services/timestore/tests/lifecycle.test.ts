/// <reference path="../src/types/embeddedPostgres.d.ts" />

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
import type { PartitionInput } from '../src/db/metadata';

let postgres: EmbeddedPostgres | null = null;
let dataDirectory: string | null = null;
let storageRoot: string | null = null;

let configModule: typeof import('../src/config/serviceConfig');
let clientModule: typeof import('../src/db/client');
let schemaModule: typeof import('../src/db/schema');
let migrationsModule: typeof import('../src/db/migrations');
let bootstrapModule: typeof import('../src/service/bootstrap');
let metadataModule: typeof import('../src/db/metadata');
let lifecycleModule: typeof import('../src/lifecycle/maintenance');
let metricsModule: typeof import('../src/lifecycle/metrics');
let storageModule: typeof import('../src/storage');

before(async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'timestore-lifecycle-pg-'));
  const storageDir = await mkdtemp(path.join(tmpdir(), 'timestore-lifecycle-storage-'));
  dataDirectory = dataRoot;
  storageRoot = storageDir;

  const port = 54000 + Math.floor(Math.random() * 1000);
  const embedded = new EmbeddedPostgres({
    databaseDir: dataRoot,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    postgresFlags: ['-c', 'dynamic_shared_memory_type=posix'],
    onError(message) {
      console.error('[embedded-postgres:lifecycle]', message);
    }
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('apphub');
  postgres = embedded;

  process.env.TIMESTORE_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.TIMESTORE_PG_SCHEMA = `timestore_test_${randomUUID().slice(0, 8)}`;
  process.env.TIMESTORE_PGPOOL_MAX = '4';
  process.env.TIMESTORE_STORAGE_ROOT = storageDir;
  process.env.REDIS_URL = 'inline';

  configModule = await import('../src/config/serviceConfig');
  configModule.resetCachedServiceConfig();

  clientModule = await import('../src/db/client');
  schemaModule = await import('../src/db/schema');
  migrationsModule = await import('../src/db/migrations');
  bootstrapModule = await import('../src/service/bootstrap');
  metadataModule = await import('../src/db/metadata');
  lifecycleModule = await import('../src/lifecycle/maintenance');
  metricsModule = await import('../src/lifecycle/metrics');
  storageModule = await import('../src/storage');

  await schemaModule.ensureSchemaExists(clientModule.POSTGRES_SCHEMA);
  await migrationsModule.runMigrations();
  await bootstrapModule.ensureDefaultStorageTarget();
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
  if (storageRoot) {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test('compaction merges adjacent small partitions and removes old files', async () => {
  metricsModule.resetLifecycleMetrics();
  const datasetSlug = `compaction-${randomUUID().slice(0, 6)}`;
  const seed = await seedDatasetWithPartitions(datasetSlug, [
    {
      key: { window: '2024-01-01T00:00:00.000Z' },
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-01-01T00:10:00.000Z',
      rows: [
        { timestamp: '2024-01-01T00:01:00.000Z', value: 1 },
        { timestamp: '2024-01-01T00:02:00.000Z', value: 2 }
      ]
    },
    {
      key: { window: '2024-01-01T00:10:00.000Z' },
      start: '2024-01-01T00:10:00.000Z',
      end: '2024-01-01T00:20:00.000Z',
      rows: [
        { timestamp: '2024-01-01T00:11:00.000Z', value: 3 }
      ]
    }
  ]);

  const manifestBefore = await metadataModule.getLatestPublishedManifest(seed.datasetId, {
    shard: seed.manifestShard
  });
  assert.ok(manifestBefore);
  assert.equal(manifestBefore.partitionCount, 2);
  const oldPaths = manifestBefore.partitions.map((partition) => resolveLocalPath(partition.filePath));
  for (const filePath of oldPaths) {
    const stats = await stat(filePath);
    assert.ok(stats.isFile());
  }

  const report = await lifecycleModule.runLifecycleJob(configModule.loadServiceConfig(), {
    datasetId: seed.datasetId,
    datasetSlug,
    operations: ['compaction'],
    trigger: 'manual',
    requestId: randomUUID(),
    requestedAt: new Date().toISOString(),
    scheduledFor: null
  });

  assert.equal(report.operations[0]?.status, 'completed');
  const compactionShards = (report.operations[0]?.details as { shards?: Array<Record<string, unknown>> } | null)?.shards;
  assert.ok(Array.isArray(compactionShards));
  assert.ok(
    compactionShards?.some((entry) => entry?.shard === seed.manifestShard && entry?.status === 'completed')
  );

  const manifestAfter = await metadataModule.getLatestPublishedManifest(seed.datasetId, {
    shard: seed.manifestShard
  });
  assert.ok(manifestAfter);
  assert.equal(manifestAfter.partitionCount, 1);
  const newPartition = manifestAfter.partitions[0];
  assert.ok(newPartition);
  const newPath = resolveLocalPath(newPartition.filePath);
  const newStats = await stat(newPath);
  assert.ok(newStats.isFile());

  for (const filePath of oldPaths) {
    await assert.rejects(stat(filePath));
  }

  const audits = await metadataModule.listLifecycleAuditEvents(seed.datasetId, 5);
  assert.ok(audits.some((event) => event.eventType === 'compaction.group.compacted'));

  const lifecycleMetrics = metricsModule.captureLifecycleMetrics();
  assert.ok(lifecycleMetrics.compactionChunks.length >= 1);
  const latestChunk = lifecycleMetrics.compactionChunks[lifecycleMetrics.compactionChunks.length - 1];
  assert.ok(latestChunk);
  assert.equal(latestChunk.partitions, 2);

  const checkpoint = await metadataModule.getCompactionCheckpointByManifest(manifestAfter.id);
  assert.ok(checkpoint);
  assert.equal(checkpoint.status, 'completed');
  const checkpointMetadata = checkpoint.metadata as {
    version?: number;
    groups?: Array<Record<string, unknown>>;
    completedGroupIds?: string[];
  };
  assert.equal(checkpointMetadata.version, 1);
  assert.ok(Array.isArray(checkpointMetadata.completedGroupIds));
  const checkpointStats = checkpoint.stats as { chunksCompleted?: number };
  assert.ok((checkpointStats.chunksCompleted ?? 0) >= 1);
});

test('retention policy removes expired partitions', async () => {
  metricsModule.resetLifecycleMetrics();
  const datasetSlug = `retention-${randomUUID().slice(0, 6)}`;
  const now = new Date();
  const oldStart = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString();
  const oldEnd = new Date(now.getTime() - 71 * 60 * 60 * 1000).toISOString();
  const recentStart = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const recentEnd = new Date(now.getTime() - 11 * 60 * 60 * 1000).toISOString();
  const seed = await seedDatasetWithPartitions(datasetSlug, [
    {
      key: { window: oldStart },
      start: oldStart,
      end: oldEnd,
      rows: [
        { timestamp: oldStart, value: 1 }
      ]
    },
    {
      key: { window: recentStart },
      start: recentStart,
      end: recentEnd,
      rows: [
        { timestamp: recentStart, value: 2 }
      ]
    }
  ]);

  await metadataModule.upsertRetentionPolicy(seed.datasetId, {
    mode: 'time',
    rules: {
      maxAgeHours: 48
    }
  });

  const manifestBefore = await metadataModule.getLatestPublishedManifest(seed.datasetId, {
    shard: seed.manifestShard
  });
  assert.ok(manifestBefore);
  assert.equal(manifestBefore.partitionCount, 2);

  const expiredPath = resolveLocalPath(manifestBefore.partitions[0]?.filePath ?? '');
  const activePath = resolveLocalPath(manifestBefore.partitions[1]?.filePath ?? '');

  const report = await lifecycleModule.runLifecycleJob(configModule.loadServiceConfig(), {
    datasetId: seed.datasetId,
    datasetSlug,
    operations: ['retention'],
    trigger: 'manual',
    requestId: randomUUID(),
    requestedAt: new Date().toISOString(),
    scheduledFor: null
  });

  assert.equal(report.operations[0]?.status, 'completed');
  const retentionShards = (report.operations[0]?.details as { shards?: Array<Record<string, unknown>> } | null)?.shards;
  assert.ok(Array.isArray(retentionShards));
  assert.ok(
    retentionShards?.some((entry) => entry?.shard === seed.manifestShard && entry?.status === 'completed')
  );

  const manifestAfter = await metadataModule.getLatestPublishedManifest(seed.datasetId, {
    shard: seed.manifestShard
  });
  assert.ok(manifestAfter);
  assert.equal(manifestAfter.partitionCount, 1);
  assert.equal(manifestAfter.partitions[0]?.filePath, manifestBefore.partitions[1]?.filePath);

  await assert.rejects(stat(expiredPath));
  const remainingStats = await stat(activePath);
  assert.ok(remainingStats.isFile());

  const audits = await metadataModule.listLifecycleAuditEvents(seed.datasetId, 5);
  assert.ok(audits.some((event) => event.eventType === 'retention.partition.deleted'));
});

test('parquet export produces snapshot artifact', async () => {
  metricsModule.resetLifecycleMetrics();
  const datasetSlug = `export-${randomUUID().slice(0, 6)}`;
  const seed = await seedDatasetWithPartitions(datasetSlug, [
    {
      key: { window: '2024-02-01T00:00:00.000Z' },
      start: '2024-02-01T00:00:00.000Z',
      end: '2024-02-01T00:05:00.000Z',
      rows: [
        { timestamp: '2024-02-01T00:01:00.000Z', value: 42 }
      ]
    }
  ]);

  const report = await lifecycleModule.runLifecycleJob(configModule.loadServiceConfig(), {
    datasetId: seed.datasetId,
    datasetSlug,
    operations: ['parquetExport'],
    trigger: 'manual',
    requestId: randomUUID(),
    requestedAt: new Date().toISOString(),
    scheduledFor: null
  });

  assert.equal(report.operations[0]?.status, 'completed');
  const exportShards = (report.operations[0]?.details as { shards?: Array<Record<string, unknown>> } | null)?.shards;
  assert.ok(Array.isArray(exportShards));
  assert.ok(
    exportShards?.some((entry) => entry?.shard === seed.manifestShard && entry?.status === 'completed')
  );

  const manifestAfter = await metadataModule.getLatestPublishedManifest(seed.datasetId, {
    shard: seed.manifestShard
  });
  assert.ok(manifestAfter);
  const exportsMetadata = (manifestAfter.metadata.lifecycle as Record<string, unknown> | undefined)?.exports as
    | Record<string, unknown>
    | undefined;
  assert.ok(exportsMetadata);
  const history = exportsMetadata.history as Array<Record<string, unknown>> | undefined;
  assert.ok(Array.isArray(history));
  const latestExport = history![history!.length - 1];
  assert.ok(latestExport);

  const filePath = latestExport.filePath;
  assert.equal(typeof filePath, 'string');
  const exportStat = await stat(resolveLocalPath(String(filePath)));
  assert.ok(exportStat.isFile());

  const metrics = metricsModule.captureLifecycleMetrics();
  assert.equal(metrics.jobsCompleted, 1);
});

interface SeedPartition {
  key: Record<string, string>;
  start: string;
  end: string;
  rows: Array<Record<string, unknown>>;
}

async function seedDatasetWithPartitions(
  datasetSlug: string,
  partitions: SeedPartition[]
): Promise<{ datasetId: string }> {
  const config = configModule.loadServiceConfig();
  const storageTarget = await bootstrapModule.ensureDefaultStorageTarget();
  const dataset = await metadataModule.createDataset({
    id: `ds-${randomUUID()}`,
    slug: datasetSlug,
    name: datasetSlug,
    defaultStorageTargetId: storageTarget.id,
    metadata: {
      createdBy: 'lifecycle-test'
    }
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

  const driver = storageModule.createStorageDriver(config, storageTarget);
  const partitionInputs: PartitionInput[] = [];

  for (const definition of partitions) {
    const partitionId = `part-${randomUUID()}`;
    const writeResult = await driver.writePartition({
      datasetSlug,
      partitionId,
      partitionKey: definition.key,
      tableName: 'records',
      schema: [
        { name: 'timestamp', type: 'timestamp' },
        { name: 'value', type: 'double' }
      ],
      rows: definition.rows
    });

    partitionInputs.push({
      id: partitionId,
      storageTargetId: storageTarget.id,
      fileFormat: 'duckdb',
      filePath: writeResult.relativePath,
      partitionKey: definition.key,
      startTime: new Date(definition.start),
      endTime: new Date(definition.end),
      fileSizeBytes: writeResult.fileSizeBytes,
      rowCount: writeResult.rowCount,
      checksum: writeResult.checksum,
      metadata: {
        tableName: 'records'
      }
    });
  }

  partitionInputs.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const totalRows = partitionInputs.reduce((acc, partition) => acc + (partition.rowCount ?? 0), 0);
  const totalBytes = partitionInputs.reduce((acc, partition) => acc + (partition.fileSizeBytes ?? 0), 0);
  const manifestShard = partitionInputs[0]
    ? partitionInputs[0].startTime.toISOString().slice(0, 10)
    : 'root';

  await metadataModule.createDatasetManifest({
    id: `dm-${randomUUID()}`,
    datasetId: dataset.id,
    version: 1,
    status: 'published',
    manifestShard,
    schemaVersionId: schemaVersion.id,
    summary: {
      totalPartitions: partitionInputs.length
    },
    statistics: {
      rowCount: totalRows,
      fileSizeBytes: totalBytes,
      startTime: partitionInputs[0]?.startTime.toISOString(),
      endTime: partitionInputs[partitionInputs.length - 1]?.endTime.toISOString()
    },
    metadata: {
      tableName: 'records',
      storageTargetId: storageTarget.id
    },
    createdBy: 'lifecycle-test',
    partitions: partitionInputs
  });

  return { datasetId: dataset.id, manifestShard };
}

function resolveLocalPath(relativePath: string): string {
  if (!storageRoot) {
    throw new Error('storage root not initialised');
  }
  const platformPath = relativePath.split('/').join(path.sep);
  return path.join(storageRoot, platformPath);
}

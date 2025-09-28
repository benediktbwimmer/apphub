/// <reference path="../src/types/embeddedPostgres.d.ts" />

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
import { extractFieldDefinitions } from '../src/schema/compatibility';
import { resetCachedServiceConfig } from '../src/config/serviceConfig';
import { executeSchemaMigration } from '../src/schema/migration/executor';
import type { SchemaMigrationManifest } from '../src/schema/migration/manifest';

let schemaModule: typeof import('../src/db/schema');
let clientModule: typeof import('../src/db/client');
let migrationsModule: typeof import('../src/db/migrations');
let bootstrapModule: typeof import('../src/service/bootstrap');
let ingestionModule: typeof import('../src/ingestion/processor');
let ingestionTypesModule: typeof import('../src/ingestion/types');
let metadataModule: typeof import('../src/db/metadata');

let postgres: EmbeddedPostgres | null = null;
let dataDirectory: string | null = null;
let storageRoot: string | null = null;
let archiveRoot: string | null = null;
let datasetId: string | null = null;
let baselineManifestIds: string[] = [];
let baselinePartitionIds: string[] = [];

before(async () => {
  dataDirectory = await mkdtemp(path.join(tmpdir(), 'timestore-migration-pg-'));
  const port = 56000 + Math.floor(Math.random() * 1000);
  const embedded = new EmbeddedPostgres({
    databaseDir: dataDirectory,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    postgresFlags: ['-c', 'dynamic_shared_memory_type=posix'],
    onError(message) {
      console.error('[embedded-postgres:schema-migration]', message);
    }
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('apphub');
  postgres = embedded;

  storageRoot = await mkdtemp(path.join(tmpdir(), 'timestore-migration-storage-'));
  archiveRoot = await mkdtemp(path.join(tmpdir(), 'timestore-migration-archive-'));

  process.env.TIMESTORE_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.TIMESTORE_PG_SCHEMA = `timestore_schema_migration_${randomUUID().slice(0, 8)}`;
  process.env.TIMESTORE_PGPOOL_MAX = '4';
  process.env.TIMESTORE_STORAGE_ROOT = storageRoot;
  process.env.REDIS_URL = 'inline';
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';
  process.env.TIMESTORE_PARTITION_INDEX_COLUMNS = 'temperature_c,humidity_percent';
  process.env.TIMESTORE_PARTITION_BLOOM_COLUMNS = 'temperature_c';
  process.env.TIMESTORE_PARTITION_HISTOGRAM_COLUMNS = 'temperature_c';
  process.env.TIMESTORE_PARTITION_INDEX_HISTOGRAM_BINS = '4';

  resetCachedServiceConfig();

  schemaModule = await import('../src/db/schema');
  clientModule = await import('../src/db/client');
  migrationsModule = await import('../src/db/migrations');
  bootstrapModule = await import('../src/service/bootstrap');
  ingestionModule = await import('../src/ingestion/processor');
  ingestionTypesModule = await import('../src/ingestion/types');
  metadataModule = await import('../src/db/metadata');

  await clientModule.resetPool();

  await schemaModule.ensureSchemaExists(clientModule.POSTGRES_SCHEMA);
  await migrationsModule.runMigrations();
  await bootstrapModule.ensureDefaultStorageTarget();

  await seedDataset();
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
  if (archiveRoot) {
    await rm(archiveRoot, { recursive: true, force: true });
  }
});

async function seedDataset(): Promise<void> {
  const payload = ingestionTypesModule.ingestionJobPayloadSchema.parse({
    datasetSlug: 'migration-dataset',
    datasetName: 'Migration Dataset',
    tableName: 'observations',
    schema: {
      fields: [
        { name: 'timestamp', type: 'timestamp' },
        { name: 'temperature_c', type: 'double' },
        { name: 'humidity_percent', type: 'double' },
        { name: 'deprecated_metric', type: 'string' }
      ]
    },
    partition: {
      key: { day: '2024-04-01' },
      timeRange: {
        start: '2024-04-01T00:00:00.000Z',
        end: '2024-04-01T00:30:00.000Z'
      }
    },
    rows: [
      {
        timestamp: '2024-04-01T00:00:00.000Z',
        temperature_c: 20,
        humidity_percent: 60,
        deprecated_metric: 'alpha'
      },
      {
        timestamp: '2024-04-01T00:10:00.000Z',
        temperature_c: 21,
        humidity_percent: 58,
        deprecated_metric: 'beta'
      }
    ],
    idempotencyKey: 'migration-day-one',
    receivedAt: new Date().toISOString()
  });

  const secondPayload = {
    ...payload,
    partition: {
      key: { day: '2024-04-02' },
      timeRange: {
        start: '2024-04-02T00:00:00.000Z',
        end: '2024-04-02T00:30:00.000Z'
      }
    },
    rows: [
      {
        timestamp: '2024-04-02T00:05:00.000Z',
        temperature_c: 19,
        humidity_percent: 65,
        deprecated_metric: 'gamma'
      }
    ],
    idempotencyKey: 'migration-day-two'
  } satisfies typeof payload;

  const firstResult = await ingestionModule.processIngestionJob(payload);
  const secondResult = await ingestionModule.processIngestionJob(secondPayload);

  datasetId = firstResult.dataset.id;
  baselineManifestIds = [firstResult.manifest.id, secondResult.manifest.id];
  const manifests = await metadataModule.listPublishedManifestsWithPartitions(datasetId);
  baselinePartitionIds = manifests.flatMap((manifest) => manifest.partitions.map((partition) => partition.id));
  assert.equal(baselinePartitionIds.length, 2);
}

test('executeSchemaMigration supports dry-run validation', async () => {
  assert.ok(datasetId);
  const manifest = buildMigrationManifest({ dryRun: true });
  const result = await executeSchemaMigration(manifest, { dryRun: true, archiveDirectory: archiveRoot ?? undefined });

  assert.equal(result.dryRun, true);
  assert.equal(result.partitionsMigrated, 0);
  assert.equal(result.manifestsProcessed, baselineManifestIds.length);

  const latestManifest = await metadataModule.getLatestPublishedManifest(datasetId!);
  assert.ok(latestManifest);
  assert.ok(latestManifest?.schemaVersionId);
  assert.ok(baselineManifestIds.includes(latestManifest!.id));
});

test('executeSchemaMigration rewrites partitions with operations and archives drops', async () => {
  assert.ok(datasetId);
  assert.ok(storageRoot);
  assert.ok(archiveRoot);

  const manifest = buildMigrationManifest({ dryRun: false, archiveDirectory: archiveRoot! });
  const result = await executeSchemaMigration(manifest, { archiveDirectory: archiveRoot ?? undefined });

  assert.equal(result.dryRun, false);
  assert.equal(result.partitionsMigrated, result.partitionsEvaluated);
  assert.ok(result.targetSchemaVersionId);
  assert.equal(result.archivedColumns, result.partitionsMigrated);

  const manifestsAfter = await metadataModule.listPublishedManifestsWithPartitions(datasetId!);
  assert.equal(manifestsAfter.length, baselineManifestIds.length);
  const totalPartitions = manifestsAfter.reduce((sum, manifestRecord) => sum + manifestRecord.partitions.length, 0);
  assert.equal(totalPartitions, result.partitionsMigrated);
  for (const manifestRecord of manifestsAfter) {
    assert.equal(manifestRecord.schemaVersionId, result.targetSchemaVersionId);
  }

  const supersededManifests = await Promise.all(
    baselineManifestIds.map((id) => metadataModule.getManifestById(id))
  );
  for (const manifestRecord of supersededManifests) {
    assert.equal(manifestRecord?.status, 'superseded');
  }

  const partitions = manifestsAfter.flatMap((manifestRecord) => manifestRecord.partitions);

  const schemaVersion = await metadataModule.getSchemaVersionById(result.targetSchemaVersionId!);
  assert.ok(schemaVersion);
  const schemaFields = extractFieldDefinitions(schemaVersion!.schema);
  const expectedFields = [
    { name: 'timestamp', type: 'timestamp' as const },
    { name: 'temperature_f', type: 'double' as const },
    { name: 'humidity_ratio', type: 'double' as const }
  ];
  assert.deepEqual(schemaFields, expectedFields);

  for (const partition of partitions) {
    const migrationMetadata = (partition.metadata as Record<string, unknown>)?.schemaMigration as
      | Record<string, unknown>
      | undefined;
    assert.ok(migrationMetadata);
    assert.equal(migrationMetadata?.ticketId, 'TS-126');
    assert.equal(migrationMetadata?.approvedBy, 'ops@apphub.dev');
  }

  const archiveFiles = await readdir(archiveRoot!);
  const archivedMetricFiles = archiveFiles
    .filter((name) => name.includes('deprecated_metric'))
    .sort();
  const expectedArchiveFiles = baselinePartitionIds
    .map((id) => `migration-dataset-${id}-deprecated_metric.jsonl`)
    .sort();
  if (archivedMetricFiles.length !== expectedArchiveFiles.length) {
    throw new Error(
      `archive file count mismatch actual=${archivedMetricFiles.join(',')} expected=${expectedArchiveFiles.join(',')}`
    );
  }
  if (JSON.stringify(archivedMetricFiles) !== JSON.stringify(expectedArchiveFiles)) {
    throw new Error(
      `archive files mismatch actual=${JSON.stringify(archivedMetricFiles)} expected=${JSON.stringify(expectedArchiveFiles)}`
    );
  }

  for (const fileName of archivedMetricFiles) {
    if (!fileName.includes('deprecated_metric')) {
      continue;
    }
    const content = await readFile(path.join(archiveRoot!, fileName), 'utf8');
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { value: unknown });
    assert.ok(lines.length > 0);
    for (const entry of lines) {
      assert.equal(typeof entry.value, 'string');
    }
  }
});

function buildMigrationManifest(params: { dryRun: boolean; archiveDirectory?: string }): SchemaMigrationManifest {
  return {
    version: 1,
    dataset: 'migration-dataset',
    targetSchema: {
      fields: [
        { name: 'timestamp', type: 'timestamp' },
        { name: 'temperature_f', type: 'double' },
        { name: 'humidity_ratio', type: 'double' }
      ]
    },
    operations: [
      {
        kind: 'rename',
        from: 'temperature_c',
        to: 'temperature_f',
        transform: '(temperature_c * 9.0 / 5.0) + 32',
        description: 'Convert Celsius to Fahrenheit'
      },
      {
        kind: 'transform',
        column: 'humidity_ratio',
        expression: 'humidity_percent / 100.0',
        description: 'Convert percentage to ratio'
      },
      {
        kind: 'drop',
        column: 'deprecated_metric',
        archive: params.archiveDirectory ? { enabled: true } : null,
        description: 'Archive legacy metric values'
      }
    ],
    governance: {
      approvedBy: 'ops@apphub.dev',
      ticketId: 'TS-126',
      changeReason: 'Rename and adjust climate dataset columns'
    },
    execution: {
      dryRun: params.dryRun,
      partitionBatchSize: 1,
      archiveDirectory: params.archiveDirectory ?? null,
      continueOnPartitionFailure: false
    },
    validation: {
      requireConsistentSchema: true,
      allowManifestsWithoutSchemaVersion: false,
      maxPartitions: 20
    }
  } satisfies SchemaMigrationManifest;
}

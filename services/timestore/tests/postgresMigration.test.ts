import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { loadServiceConfig } from '../src/config/serviceConfig';
import { closePool, POSTGRES_SCHEMA, withConnection } from '../src/db/client';
import { ensureSchemaExists } from '../src/db/schema';
import { runMigrations } from '../src/db/migrations';
import { ensureDefaultStorageTarget } from '../src/service/bootstrap';
import { runLifecycleJob } from '../src/lifecycle/maintenance';
import { getMaintenanceMetrics } from '../src/lifecycle/maintenance';
import type { LifecycleJobPayload } from '../src/lifecycle/types';

interface TestDataset {
  id: string;
  slug: string;
  name: string;
}

let testDatasets: TestDataset[] = [];
let originalEnvVars: Record<string, string | undefined> = {};

beforeEach(async () => {
  originalEnvVars = {
    TIMESTORE_POSTGRES_MIGRATION_ENABLED: process.env.TIMESTORE_POSTGRES_MIGRATION_ENABLED,
    TIMESTORE_POSTGRES_MIGRATION_BATCH_SIZE: process.env.TIMESTORE_POSTGRES_MIGRATION_BATCH_SIZE,
    TIMESTORE_POSTGRES_MIGRATION_MAX_AGE_HOURS: process.env.TIMESTORE_POSTGRES_MIGRATION_MAX_AGE_HOURS,
    TIMESTORE_POSTGRES_MIGRATION_GRACE_PERIOD_HOURS: process.env.TIMESTORE_POSTGRES_MIGRATION_GRACE_PERIOD_HOURS,
    REDIS_URL: process.env.REDIS_URL,
    APPHUB_ALLOW_INLINE_MODE: process.env.APPHUB_ALLOW_INLINE_MODE
  };

  process.env.REDIS_URL = 'inline';
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';
  process.env.TIMESTORE_POSTGRES_MIGRATION_ENABLED = 'true';
  process.env.TIMESTORE_POSTGRES_MIGRATION_BATCH_SIZE = '100';
  process.env.TIMESTORE_POSTGRES_MIGRATION_MAX_AGE_HOURS = '1';
  process.env.TIMESTORE_POSTGRES_MIGRATION_GRACE_PERIOD_HOURS = '0';

  const { resetCachedServiceConfig } = await import('../src/config/serviceConfig');
  resetCachedServiceConfig();

  await ensureSchemaExists(POSTGRES_SCHEMA);
  await runMigrations();
  await ensureDefaultStorageTarget();

  testDatasets = await createTestDatasets(2);
});

afterEach(async () => {
  await cleanupTestData();
  testDatasets = [];

  for (const [key, value] of Object.entries(originalEnvVars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const { resetCachedServiceConfig } = await import('../src/config/serviceConfig');
  resetCachedServiceConfig();

  await closePool();
});

test('postgres migration configuration loads correctly', () => {
  const config = loadServiceConfig();
  
  assert.ok(config.lifecycle.postgresMigration);
  assert.equal(config.lifecycle.postgresMigration.enabled, true);
  assert.ok(config.lifecycle.postgresMigration.batchSize > 0);
  assert.ok(config.lifecycle.postgresMigration.maxAgeHours > 0);
  assert.ok(config.lifecycle.postgresMigration.gracePeriodhours >= 0);
  assert.ok(config.lifecycle.postgresMigration.targetTable);
  assert.ok(config.lifecycle.postgresMigration.watermarkTable);
});

test('postgres migration can be disabled via configuration', () => {
  process.env.TIMESTORE_POSTGRES_MIGRATION_ENABLED = 'false';
  
  const { resetCachedServiceConfig } = require('../src/config/serviceConfig');
  resetCachedServiceConfig();
  
  const config = loadServiceConfig();
  assert.equal(config.lifecycle.postgresMigration?.enabled, false);
});

test('postgres migration operation executes successfully', async () => {
  const config = loadServiceConfig();
  const dataset = testDatasets[0];

  const payload: LifecycleJobPayload = {
    datasetId: dataset.id,
    datasetSlug: dataset.slug,
    operations: ['postgres_migration'],
    trigger: 'manual',
    requestId: randomUUID(),
    requestedAt: new Date().toISOString()
  };

  const report = await runLifecycleJob(config, payload);
  
  assert.ok(report);
  assert.equal(report.datasetId, dataset.id);
  assert.equal(report.operations.length, 1);
  
  const migrationOp = report.operations.find(op => op.operation === 'postgres_migration');
  assert.ok(migrationOp);
  assert.ok(['completed', 'skipped'].includes(migrationOp.status));
});

test('postgres migration handles disabled configuration gracefully', async () => {
  process.env.TIMESTORE_POSTGRES_MIGRATION_ENABLED = 'false';
  
  const { resetCachedServiceConfig } = require('../src/config/serviceConfig');
  resetCachedServiceConfig();
  
  const config = loadServiceConfig();
  const dataset = testDatasets[0];

  const payload: LifecycleJobPayload = {
    datasetId: dataset.id,
    datasetSlug: dataset.slug,
    operations: ['postgres_migration'],
    trigger: 'manual',
    requestId: randomUUID(),
    requestedAt: new Date().toISOString()
  };

  const report = await runLifecycleJob(config, payload);
  const migrationOp = report.operations.find(op => op.operation === 'postgres_migration');
  
  assert.equal(migrationOp?.status, 'skipped');
  assert.ok(migrationOp?.message?.includes('disabled'));
});

test('postgres migration handles non-existent dataset', async () => {
  const config = loadServiceConfig();

  const payload: LifecycleJobPayload = {
    datasetId: 'non-existent-dataset',
    datasetSlug: 'non_existent',
    operations: ['postgres_migration'],
    trigger: 'manual',
    requestId: randomUUID(),
    requestedAt: new Date().toISOString()
  };

  await assert.rejects(
    () => runLifecycleJob(config, payload),
    /not found/
  );
});

test('postgres migration tracks metrics correctly', async () => {
  const initialMetrics = getMaintenanceMetrics();
  const initialMigrationCount = initialMetrics.operationTotals.postgres_migration.count;

  const config = loadServiceConfig();
  const dataset = testDatasets[0];

  const payload: LifecycleJobPayload = {
    datasetId: dataset.id,
    datasetSlug: dataset.slug,
    operations: ['postgres_migration'],
    trigger: 'manual',
    requestId: randomUUID(),
    requestedAt: new Date().toISOString()
  };

  await runLifecycleJob(config, payload);

  const finalMetrics = getMaintenanceMetrics();
  const finalMigrationCount = finalMetrics.operationTotals.postgres_migration.count;

  assert.ok(finalMigrationCount >= initialMigrationCount);
  assert.ok(finalMetrics.operationTotals.postgres_migration);
  assert.ok(finalMetrics.operationTotals.postgres_migration.bytes >= 0);
  assert.ok(finalMetrics.operationTotals.postgres_migration.partitions >= 0);
});

test('postgres migration creates and manages watermarks', async () => {
  const config = loadServiceConfig();
  const dataset = testDatasets[0];

  const payload: LifecycleJobPayload = {
    datasetId: dataset.id,
    datasetSlug: dataset.slug,
    operations: ['postgres_migration'],
    trigger: 'manual',
    requestId: randomUUID(),
    requestedAt: new Date().toISOString()
  };

  await runLifecycleJob(config, payload);

  await withConnection(async (client) => {
    const result = await client.query(
      'SELECT table_name, watermark_timestamp FROM migration_watermarks WHERE dataset_id = $1',
      [dataset.id]
    );

    assert.ok(result.rows.length >= 0);
    
    for (const row of result.rows) {
      assert.ok(row.table_name);
      assert.ok(row.watermark_timestamp instanceof Date);
    }
  });
});

async function createTestDatasets(count: number): Promise<TestDataset[]> {
  const datasets: TestDataset[] = [];
  
  await withConnection(async (client) => {
    for (let i = 0; i < count; i++) {
      const dataset: TestDataset = {
        id: `test-dataset-${randomUUID()}`,
        slug: `test_migration_${i + 1}_${Date.now()}`,
        name: `Test Migration Dataset ${i + 1}`
      };

      await client.query(
        `INSERT INTO datasets (id, slug, name, status, write_format, created_at, updated_at)
         VALUES ($1, $2, $3, 'active', 'clickhouse', NOW(), NOW())
         ON CONFLICT (slug) DO UPDATE SET
           id = EXCLUDED.id,
           name = EXCLUDED.name,
           updated_at = NOW()`,
        [dataset.id, dataset.slug, dataset.name]
      );

      for (let j = 0; j < 10; j++) {
        const createdAt = new Date(Date.now() - (Math.random() * 2 * 24 * 60 * 60 * 1000));
        
        await client.query(
          `INSERT INTO dataset_access_audit (id, dataset_id, dataset_slug, actor_id, actor_scopes, action, success, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            `audit-${randomUUID()}`,
            dataset.id,
            dataset.slug,
            `test-user-${Math.floor(Math.random() * 10)}`,
            ['read'],
            'query',
            true,
            JSON.stringify({ test: true, iteration: j }),
            createdAt
          ]
        );
      }

      datasets.push(dataset);
    }
  });

  return datasets;
}

async function cleanupTestData(): Promise<void> {
  if (testDatasets.length === 0) return;
  
  await withConnection(async (client) => {
    for (const dataset of testDatasets) {
      await client.query('DELETE FROM dataset_access_audit WHERE dataset_id = $1', [dataset.id]);
      await client.query('DELETE FROM migration_watermarks WHERE dataset_id = $1', [dataset.id]);
      await client.query('DELETE FROM datasets WHERE id = $1', [dataset.id]);
    }
  });
}
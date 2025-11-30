#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { loadServiceConfig } from '../config/serviceConfig';
import { closePool, POSTGRES_SCHEMA, withConnection } from '../db/client';
import { ensureSchemaExists } from '../db/schema';
import { runMigrations } from '../db/migrations';
import { ensureDefaultStorageTarget } from '../service/bootstrap';
import { runLifecycleJob } from '../lifecycle/maintenance';
import type { LifecycleJobPayload } from '../lifecycle/types';

interface CliOptions {
  datasetId?: string;
  dryRun: boolean;
  createTestData: boolean;
  verbose: boolean;
}

async function main(): Promise<void> {
  const cli = parseCliOptions(process.argv.slice(2));
  
  console.log('[test-postgres-migration] Starting postgres migration test');
  console.log('[test-postgres-migration] Options:', cli);

  const config = loadServiceConfig();
  await ensureSchemaExists(POSTGRES_SCHEMA);
  await runMigrations();
  await ensureDefaultStorageTarget();

  if (cli.createTestData) {
    await createTestData(cli.datasetId);
  }

  if (cli.dryRun) {
    await performDryRun(cli.datasetId);
  } else {
    await performActualMigration(config, cli.datasetId);
  }

  await closePool();
  console.log('[test-postgres-migration] Test completed');
}

async function createTestData(datasetId?: string): Promise<void> {
  console.log('[test-postgres-migration] Creating test data...');
  
  const testDatasetId = datasetId || `test-migration-${randomUUID()}`;
  const testDatasetSlug = `test_migration_${Date.now()}`;
  
  await withConnection(async (client) => {
    // Create test dataset
    await client.query(
      `INSERT INTO datasets (id, slug, name, status, write_format, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', 'clickhouse', NOW(), NOW())
       ON CONFLICT (slug) DO UPDATE SET
         id = EXCLUDED.id,
         name = EXCLUDED.name,
         updated_at = NOW()`,
      [testDatasetId, testDatasetSlug, 'Test Migration Dataset']
    );

    // Create a published manifest for the test dataset
    const manifestId = `manifest-${randomUUID()}`;
    await client.query(
      `INSERT INTO dataset_manifests (id, dataset_id, version, status, manifest_shard, created_at, updated_at, published_at)
       VALUES ($1, $2, 1, 'published', 'root', NOW(), NOW(), NOW())`,
      [manifestId, testDatasetId]
    );

    // Create test data in tables that will be migrated
    const tables = [
      { name: 'dataset_access_audit', columns: 'id, dataset_id, dataset_slug, actor_id, actor_scopes, action, success, metadata, created_at' },
      { name: 'lifecycle_audit_log', columns: 'id, dataset_id, manifest_id, event_type, payload, created_at' },
      { name: 'lifecycle_job_runs', columns: 'id, job_kind, dataset_id, operations, trigger_source, status, started_at, created_at, updated_at' }
    ];

    for (const table of tables) {
      console.log(`[test-postgres-migration] Creating test data in ${table.name}...`);
      
      for (let i = 0; i < 50; i++) {
        const createdAt = new Date(Date.now() - (Math.random() * 10 * 24 * 60 * 60 * 1000)); // Random time in last 10 days
        
        if (table.name === 'dataset_access_audit') {
          await client.query(
            `INSERT INTO dataset_access_audit (id, dataset_id, dataset_slug, actor_id, actor_scopes, action, success, metadata, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              `audit-${randomUUID()}`,
              testDatasetId,
              testDatasetSlug,
              `test-user-${Math.floor(Math.random() * 10)}`,
              ['read', 'write'],
              ['query', 'insert', 'update'][Math.floor(Math.random() * 3)],
              Math.random() > 0.1, // 90% success rate
              JSON.stringify({ test: true, iteration: i, timestamp: createdAt.toISOString() }),
              createdAt
            ]
          );
        } else if (table.name === 'lifecycle_audit_log') {
          await client.query(
            `INSERT INTO lifecycle_audit_log (id, dataset_id, manifest_id, event_type, payload, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              `audit-log-${randomUUID()}`,
              testDatasetId,
              manifestId,
              ['compaction', 'retention', 'export'][Math.floor(Math.random() * 3)],
              JSON.stringify({ test: true, iteration: i, records: Math.floor(Math.random() * 1000) }),
              createdAt
            ]
          );
        } else if (table.name === 'lifecycle_job_runs') {
          await client.query(
            `INSERT INTO lifecycle_job_runs (id, job_kind, dataset_id, operations, trigger_source, status, started_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              `job-run-${randomUUID()}`,
              'dataset-maintenance',
              testDatasetId,
              ['compaction', 'retention'],
              'schedule',
              ['completed', 'failed', 'skipped'][Math.floor(Math.random() * 3)],
              createdAt,
              createdAt,
              createdAt
            ]
          );
        }
      }
    }
  });

  console.log(`[test-postgres-migration] Created test dataset: ${testDatasetId} (${testDatasetSlug})`);
  console.log('[test-postgres-migration] Test data creation completed');
}

async function performDryRun(datasetId?: string): Promise<void> {
  console.log('[test-postgres-migration] Performing dry run...');
  
  await withConnection(async (client) => {
    const datasets = datasetId 
      ? [{ id: datasetId }]
      : (await client.query('SELECT id FROM datasets WHERE status = $1 LIMIT 5', ['active'])).rows;

    for (const dataset of datasets) {
      console.log(`[test-postgres-migration] Checking dataset ${dataset.id}:`);
      
      // Query all tables that would be discovered by the dynamic migration
      const discoveryResult = await client.query(`
        SELECT DISTINCT
          t.table_name,
          CASE
            WHEN EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name = t.table_name
                        AND column_name = 'created_at'
                        AND data_type IN ('timestamp with time zone', 'timestamp without time zone'))
            THEN 'created_at'
            WHEN EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name = t.table_name
                        AND column_name = 'updated_at'
                        AND data_type IN ('timestamp with time zone', 'timestamp without time zone'))
            THEN 'updated_at'
            WHEN EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name = t.table_name
                        AND column_name = 'started_at'
                        AND data_type IN ('timestamp with time zone', 'timestamp without time zone'))
            THEN 'started_at'
            ELSE NULL
          END as time_column
        FROM information_schema.tables t
        WHERE t.table_schema = CURRENT_SCHEMA()
          AND t.table_type = 'BASE TABLE'
          AND EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_name = t.table_name
              AND c.column_name = 'dataset_id'
              AND c.table_schema = t.table_schema
          )
          AND EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_name = t.table_name
              AND c.column_name IN ('created_at', 'updated_at', 'started_at')
              AND c.data_type IN ('timestamp with time zone', 'timestamp without time zone')
              AND c.table_schema = t.table_schema
          )
          AND t.table_name NOT IN ('migration_watermarks', 'schema_migrations')
        ORDER BY t.table_name
      `);
      
      console.log(`  Discovered ${discoveryResult.rows.length} tables for migration:`);
      
      for (const discoveredTable of discoveryResult.rows) {
        if (!discoveredTable.time_column) continue;
        
        const tableName = discoveredTable.table_name;
        const timeColumn = discoveredTable.time_column;
        
        const result = await client.query(
          `SELECT COUNT(*) as count,
                  MIN(${timeColumn}) as oldest,
                  MAX(${timeColumn}) as newest
           FROM ${tableName}
           WHERE dataset_id = $1`,
          [dataset.id]
        );
        
        const row = result.rows[0];
        console.log(`    ${tableName} (${timeColumn}): ${row.count} records (${row.oldest} to ${row.newest})`);
        
        if (parseInt(row.count) > 0) {
          // Check what would be migrated (older than 7 days)
          const cutoffTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          const migrateResult = await client.query(
            `SELECT COUNT(*) as migrate_count
             FROM ${tableName}
             WHERE dataset_id = $1 AND ${timeColumn} <= $2`,
            [dataset.id, cutoffTime]
          );
          
          console.log(`      Would migrate: ${migrateResult.rows[0].migrate_count} records (older than ${cutoffTime.toISOString()})`);
        }
      }
    }
  });
}

async function performActualMigration(config: any, datasetId?: string): Promise<void> {
  console.log('[test-postgres-migration] Performing actual migration...');
  
  await withConnection(async (client) => {
    const datasets = datasetId 
      ? (await client.query('SELECT id, slug FROM datasets WHERE id = $1', [datasetId])).rows
      : (await client.query('SELECT id, slug FROM datasets WHERE status = $1 LIMIT 3', ['active'])).rows;

    if (datasets.length === 0) {
      console.log('[test-postgres-migration] No datasets found for migration');
      return;
    }

    for (const dataset of datasets) {
      console.log(`[test-postgres-migration] Migrating dataset ${dataset.id} (${dataset.slug})...`);
      
      const payload: LifecycleJobPayload = {
        datasetId: dataset.id,
        datasetSlug: dataset.slug,
        operations: ['postgres_migration'],
        trigger: 'manual',
        requestId: randomUUID(),
        requestedAt: new Date().toISOString()
      };

      try {
        const report = await runLifecycleJob(config, payload);
        
        console.log(`[test-postgres-migration] Migration result for ${dataset.id}:`);
        for (const operation of report.operations) {
          console.log(`  ${operation.operation}: ${operation.status} - ${operation.message || 'no message'}`);
        }
        
        if (report.auditLogEntries.length > 0) {
          console.log(`  Created ${report.auditLogEntries.length} audit log entries`);
        }
      } catch (error) {
        console.error(`[test-postgres-migration] Migration failed for dataset ${dataset.id}:`, error);
      }
    }
  });
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    createTestData: false,
    verbose: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--create-test-data') {
      options.createTestData = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--dataset-id') {
      options.datasetId = args[i + 1];
      i++;
    } else if (arg.startsWith('--dataset-id=')) {
      options.datasetId = arg.split('=')[1];
    }
  }

  return options;
}

main().catch((err) => {
  console.error('[test-postgres-migration] Fatal error:', err);
  process.exit(1);
});

import { randomUUID } from 'node:crypto';
import type { ServiceConfig } from '../config/serviceConfig';
import { withConnection, withTransaction } from '../db/client';
import { writeBatchToClickHouse } from '../clickhouse/writer';
import {
  createLifecycleJobRun,
  getDatasetById,
  getDatasetBySlug,
  getManifestById,
  getPartitionsWithTargetsForManifest,
  getRetentionPolicy,
  listPublishedManifests,
  recordLifecycleAuditEvent,
  updateLifecycleJobRun,
  type LifecycleAuditLogRecord,
  type LifecycleAuditLogInput,
  type PartitionWithTarget
} from '../db/metadata';
import {
  captureLifecycleMetrics,
  recordJobCompleted,
  recordJobFailed,
  recordJobSkipped,
  recordJobStarted,
  recordOperationTotals
} from './metrics';
import { observeLifecycleJob, observeLifecycleOperation } from '../observability/metrics';
import {
  createDefaultRetentionPolicy,
  normalizeOperations,
  parseRetentionPolicy,
  type LifecycleJobContext,
  type LifecycleJobPayload,
  type LifecycleMaintenanceReport,
  type LifecycleOperationExecutionResult,
  type LifecycleOperationResult,
  type LifecycleOperation
} from './types';

export async function runLifecycleJob(
  config: ServiceConfig,
  payload: LifecycleJobPayload
): Promise<LifecycleMaintenanceReport> {
  const operations = normalizeOperations(payload.operations);
  const dataset = await resolveDataset(payload);
  const jobRunId = `ljr-${payload.requestId ?? randomUUID()}`;
  const startedAt = new Date();
  const jobRun = await createLifecycleJobRun({
    id: jobRunId,
    jobKind: 'dataset-maintenance',
    datasetId: dataset?.id ?? null,
    operations,
    triggerSource: payload.trigger,
    scheduledFor: payload.scheduledFor ? new Date(payload.scheduledFor) : null,
    startedAt,
    metadata: {
      requestId: payload.requestId,
      datasetSlug: payload.datasetSlug
    }
  });

  recordJobStarted();
  observeLifecycleJob({
    datasetId: dataset?.id ?? null,
    status: 'started'
  });

  if (!dataset) {
    const errorMessage = `dataset ${payload.datasetId ?? payload.datasetSlug ?? '<unknown>'} not found`;
    await updateLifecycleJobRun({
      id: jobRun.id,
      status: 'failed',
      error: errorMessage,
      completedAt: new Date(),
      metadataPatch: {
        error: errorMessage
      }
    });
    recordJobFailed();
    throw new Error(errorMessage);
  }

  const manifestRecords = await listPublishedManifests(dataset.id);
  if (manifestRecords.length === 0) {
    await updateLifecycleJobRun({
      id: jobRun.id,
      status: 'skipped',
      completedAt: new Date(),
      metadataPatch: {
        reason: 'no published manifests'
      }
    });
    recordJobSkipped();
    observeLifecycleJob({
      datasetId: dataset.id,
      status: 'skipped'
    });
    return {
      jobId: jobRun.id,
      datasetId: dataset.id,
      datasetSlug: dataset.slug,
      operations: operations.map((operation) => ({
        operation,
        status: 'skipped',
        message: 'no published manifests available'
      })),
      auditLogEntries: []
    };
  }

  const manifestMap = new Map<string, import('../db/metadata').DatasetManifestWithPartitions>();
  for (const record of manifestRecords) {
    const manifestWithPartitions = await getManifestById(record.id);
    if (manifestWithPartitions) {
      manifestMap.set(record.manifestShard, manifestWithPartitions);
    }
  }

  if (manifestMap.size === 0) {
    await updateLifecycleJobRun({
      id: jobRun.id,
      status: 'skipped',
      completedAt: new Date(),
      metadataPatch: {
        reason: 'no published manifests'
      }
    });
    recordJobSkipped();
    observeLifecycleJob({
      datasetId: dataset.id,
      status: 'skipped'
    });
    return {
      jobId: jobRun.id,
      datasetId: dataset.id,
      datasetSlug: dataset.slug,
      operations: operations.map((operation) => ({
        operation,
        status: 'skipped',
        message: 'no published manifests available'
      })),
      auditLogEntries: []
    };
  }

  const retentionRecord = await getRetentionPolicy(dataset.id);
  const defaultPolicy = createDefaultRetentionPolicy(config);
  const retentionPolicy = parseRetentionPolicy(retentionRecord, defaultPolicy);

  const firstManifestEntry = manifestMap.values().next().value;
  if (!firstManifestEntry) {
    throw new Error('no manifest records available for lifecycle job');
  }

  const context: LifecycleJobContext = {
    config,
    dataset,
    manifest: firstManifestEntry,
    retentionPolicy,
    jobRun
  };

  const auditRecords: LifecycleAuditLogRecord[] = [];
  const operationSummaries: LifecycleOperationResult[] = [];

  try {
    for (const operation of operations) {
      const shardSummaries: Array<Record<string, unknown>> = [];
      let aggregatedStatus: LifecycleOperationResult['status'] = 'skipped';
      let aggregatedMessage: string | undefined;
      let summaryRecorded = false;

      for (const [shardKey, shardManifest] of manifestMap.entries()) {
        context.manifest = shardManifest;
        const partitions = await getPartitionsWithTargetsForManifest(shardManifest.id);
        const opStart = Date.now();
        const result = await executeOperation(operation, context, partitions);
        const durationMs = Date.now() - opStart;

        shardSummaries.push({
          shard: shardKey,
          status: result.status,
          message: result.message,
          totals: result.totals ?? null,
          details: result.details ?? null
        });

        observeLifecycleOperation({
          operation,
          status: result.status,
          partitions: result.totals?.partitions,
          bytes: result.totals?.bytes
        });

        if (result.auditEvents) {
          for (const event of result.auditEvents) {
            const record = await recordLifecycleAuditEvent(event);
            auditRecords.push(record);
          }
        }

        if (result.status === 'failed') {
          aggregatedStatus = 'failed';
          aggregatedMessage = result.message
            ? `[${shardKey}] ${result.message}`
            : `${operation} lifecycle step failed for shard ${shardKey}`;
          operationSummaries.push({
            operation,
            status: aggregatedStatus,
            message: aggregatedMessage,
            details: { shards: shardSummaries }
          });
          summaryRecorded = true;
          throw new Error(aggregatedMessage);
        }

        if (result.status === 'completed') {
          aggregatedStatus = 'completed';
          if (result.totals) {
            recordOperationTotals(operation, {
              partitions: result.totals.partitions,
              bytes: result.totals.bytes
            });
          }
        }

        if (result.manifest) {
          manifestMap.set(shardKey, result.manifest);
        }
      }

      if (!summaryRecorded) {
        operationSummaries.push({
          operation,
          status: aggregatedStatus,
          message: aggregatedMessage,
          details: { shards: shardSummaries }
        });
      }
    }

    await updateLifecycleJobRun({
      id: jobRun.id,
      status: 'completed',
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
      metadataPatch: {
        operations: operationSummaries
      }
    });
    recordJobCompleted();
    observeLifecycleJob({
      datasetId: dataset.id,
      status: 'completed',
      durationSeconds: (Date.now() - startedAt.getTime()) / 1000
    });

    return {
      jobId: jobRun.id,
      datasetId: dataset.id,
      datasetSlug: dataset.slug,
      operations: operationSummaries,
      auditLogEntries: auditRecords
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    await updateLifecycleJobRun({
      id: jobRun.id,
      status: 'failed',
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
      error: err.message,
      metadataPatch: {
        operations: operationSummaries,
        error: err.message
      }
    });
    recordJobFailed();
    observeLifecycleJob({
      datasetId: dataset?.id ?? null,
      status: 'failed',
      durationSeconds: (Date.now() - startedAt.getTime()) / 1000
    });
    throw err;
  }
}

async function resolveDataset(payload: LifecycleJobPayload) {
  if (payload.datasetId) {
    const dataset = await getDatasetById(payload.datasetId);
    if (dataset) {
      return dataset;
    }
  }
  if (payload.datasetSlug) {
    return getDatasetBySlug(payload.datasetSlug);
  }
  return null;
}

async function executeOperation(
  operation: LifecycleOperation,
  context: LifecycleJobContext,
  partitions: PartitionWithTarget[]
): Promise<LifecycleOperationExecutionResult> {
  switch (operation) {
    case 'compaction':
      return {
        operation,
        status: 'skipped',
        message: 'compaction is unavailable for ClickHouse-backed datasets'
      } satisfies LifecycleOperationExecutionResult;
    case 'retention':
      return {
        operation,
        status: 'skipped',
        message: 'retention is managed directly by ClickHouse TTL policies'
      } satisfies LifecycleOperationExecutionResult;
    case 'postgres_migration':
      return await executePostgresMigration(context, partitions);
    default:
      return {
        operation,
        status: 'skipped',
        message: `operation ${operation} not implemented`
      };
  }
}

async function executePostgresMigration(
  context: LifecycleJobContext,
  partitions: PartitionWithTarget[]
): Promise<LifecycleOperationExecutionResult> {
  const { config, dataset, jobRun } = context;
  const migrationConfig = config.lifecycle?.postgresMigration || {
    enabled: true,
    batchSize: 10000,
    maxAgeHours: 24 * 7,
    gracePeriodhours: 24,
    targetTable: 'migrated_data',
    watermarkTable: 'migration_watermarks'
  };

  if (!migrationConfig.enabled) {
    return {
      operation: 'postgres_migration',
      status: 'skipped',
      message: 'postgres migration is disabled in configuration'
    };
  }

  try {
    const cutoffTime = new Date(Date.now() - migrationConfig.maxAgeHours * 60 * 60 * 1000);
    const graceTime = new Date(Date.now() - migrationConfig.gracePeriodhours * 60 * 60 * 1000);
    
    console.log(`[postgres_migration] Starting migration for dataset ${dataset.id}, cutoff: ${cutoffTime.toISOString()}`);
    
    const watermark = await getMigrationWatermark(dataset.id);
    console.log(`[postgres_migration] Current watermarks:`, watermark);
    
    const migrationTasks = [
      { table: 'dataset_access_audit', timeColumn: 'created_at' },
      { table: 'lifecycle_audit_log', timeColumn: 'created_at' },
      { table: 'lifecycle_job_runs', timeColumn: 'created_at' }
    ];

    let totalMigrated = 0;
    let totalBytes = 0;
    const auditEvents: LifecycleAuditLogInput[] = [];

    for (const task of migrationTasks) {
      console.log(`[postgres_migration] Processing table ${task.table}...`);
      
      try {
        const result = await migrateTableData(
          dataset.id,
          task.table,
          task.timeColumn,
          cutoffTime,
          watermark[task.table] || new Date(0),
          migrationConfig,
          config
        );
        
        console.log(`[postgres_migration] Table ${task.table}: migrated ${result.recordCount} records, ${result.bytes} bytes`);
        
        totalMigrated += result.recordCount;
        totalBytes += result.bytes;
        
        if (result.recordCount > 0) {
          auditEvents.push({
            id: randomUUID(),
            datasetId: dataset.id,
            manifestId: context.manifest.id,
            eventType: 'postgres_migration',
            payload: {
              table: task.table,
              recordsMigrated: result.recordCount,
              bytes: result.bytes,
              watermark: result.newWatermark.toISOString()
            }
          });
        }

        await updateMigrationWatermark(dataset.id, task.table, result.newWatermark);
      } catch (tableError) {
        console.error(`[postgres_migration] Failed to migrate table ${task.table}:`, tableError);
        // Continue with other tables even if one fails
      }
    }

    console.log(`[postgres_migration] Starting cleanup of old data (grace time: ${graceTime.toISOString()})`);
    await cleanupOldData(dataset.id, graceTime, migrationConfig);

    const message = totalMigrated > 0
      ? `migrated ${totalMigrated} records (${Math.round(totalBytes / 1024)} KB) to ClickHouse`
      : 'no records found for migration';
      
    console.log(`[postgres_migration] Completed: ${message}`);

    return {
      operation: 'postgres_migration',
      status: totalMigrated > 0 ? 'completed' : 'skipped',
      message,
      totals: {
        partitions: migrationTasks.length,
        bytes: totalBytes
      },
      auditEvents
    };

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[postgres_migration] Migration failed for dataset ${dataset.id}:`, err);
    return {
      operation: 'postgres_migration',
      status: 'failed',
      message: `postgres migration failed: ${err.message}`
    };
  }
}

export function getMaintenanceMetrics() {
  return captureLifecycleMetrics();
}

interface MigrationWatermark {
  [tableName: string]: Date;
}

interface MigrationResult {
  recordCount: number;
  bytes: number;
  newWatermark: Date;
}

async function getMigrationWatermark(datasetId: string): Promise<MigrationWatermark> {
  return await withConnection(async (client) => {
    const result = await client.query(
      `SELECT table_name, watermark_timestamp
       FROM migration_watermarks
       WHERE dataset_id = $1`,
      [datasetId]
    );
    
    const watermarks: MigrationWatermark = {};
    for (const row of result.rows) {
      watermarks[row.table_name] = new Date(row.watermark_timestamp);
    }
    return watermarks;
  });
}

async function updateMigrationWatermark(
  datasetId: string,
  tableName: string,
  watermark: Date
): Promise<void> {
  await withConnection(async (client) => {
    await client.query(
      `INSERT INTO migration_watermarks (dataset_id, table_name, watermark_timestamp, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (dataset_id, table_name)
       DO UPDATE SET watermark_timestamp = $3, updated_at = NOW()`,
      [datasetId, tableName, watermark]
    );
  });
}

async function migrateTableData(
  datasetId: string,
  tableName: string,
  timeColumn: string,
  cutoffTime: Date,
  watermark: Date,
  migrationConfig: any,
  config: ServiceConfig
): Promise<MigrationResult> {
  return await withTransaction(async (client) => {
    const query = `
      SELECT * FROM ${tableName}
      WHERE dataset_id = $1
        AND ${timeColumn} > $2
        AND ${timeColumn} <= $3
      ORDER BY ${timeColumn}
      LIMIT $4
    `;
    
    const result = await client.query(query, [
      datasetId,
      watermark,
      cutoffTime,
      migrationConfig.batchSize
    ]);

    if (result.rows.length === 0) {
      return {
        recordCount: 0,
        bytes: 0,
        newWatermark: watermark
      };
    }

    const rows = result.rows.map(row => ({
      ...row,
      __migrated_at: new Date().toISOString(),
      __source_table: tableName
    }));

    const bytes = JSON.stringify(rows).length;

    // Create a proper schema based on the actual row structure
    const sampleRow = rows[0];
    const dynamicSchema: Array<{ name: string; type: 'string' | 'timestamp' | 'integer' | 'boolean' | 'double' }> = [];
    
    // Add all columns from the source table (excluding our migration metadata columns)
    for (const [key, value] of Object.entries(sampleRow)) {
      // Skip migration metadata columns as they'll be handled by ClickHouse writer's metadata system
      if (key === '__migrated_at' || key === '__source_table') {
        continue;
      }
      
      if (key === timeColumn) {
        dynamicSchema.push({ name: key, type: 'timestamp' });
      } else if (typeof value === 'number') {
        dynamicSchema.push({ name: key, type: Number.isInteger(value) ? 'integer' : 'double' });
      } else if (typeof value === 'boolean') {
        dynamicSchema.push({ name: key, type: 'boolean' });
      } else {
        dynamicSchema.push({ name: key, type: 'string' });
      }
    }
    
    // Add migration-specific columns that don't conflict with ClickHouse metadata
    dynamicSchema.push({ name: 'migrated_at', type: 'timestamp' });
    dynamicSchema.push({ name: 'source_table', type: 'string' });

    console.log(`[postgres_migration] Writing ${rows.length} records from ${tableName} to ClickHouse`);
    
    // Prepare rows without the conflicting metadata column names
    const preparedRows = rows.map(row => {
      const cleanRow = { ...row };
      // Remove the conflicting column names and use non-conflicting names
      delete cleanRow.__migrated_at;
      delete cleanRow.__source_table;
      
      // Add migration metadata with non-conflicting names
      cleanRow.migrated_at = row.__migrated_at;
      cleanRow.source_table = row.__source_table;
      
      return cleanRow;
    });
    
    await writeBatchToClickHouse({
      config,
      datasetSlug: `migrated_${tableName}`,
      tableName: migrationConfig.targetTable,
      schema: dynamicSchema,
      rows: preparedRows,
      partitionKey: { dataset_id: datasetId, source_table: tableName },
      partitionAttributes: { migration_batch: new Date().toISOString() },
      timeRange: {
        start: rows[0][timeColumn],
        end: rows[rows.length - 1][timeColumn]
      },
      ingestionSignature: `migration_${tableName}_${Date.now()}`,
      receivedAt: new Date().toISOString()
    });
    
    console.log(`[postgres_migration] Successfully wrote ${rows.length} records from ${tableName} to ClickHouse`);

    // Check if the table has a metadata column before updating
    const columnCheck = await client.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = $1 AND column_name = 'metadata'`,
      [tableName]
    );
    
    if (columnCheck.rows.length > 0) {
      // Table has metadata column, mark records as migrated
      const ids = result.rows.map(row => row.id);
      await client.query(
        `UPDATE ${tableName}
         SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"migrated_to_clickhouse": true, "migrated_at": "${new Date().toISOString()}"}'::jsonb
         WHERE id = ANY($1)`,
        [ids]
      );
    } else {
      console.log(`[postgres_migration] Table ${tableName} has no metadata column - skipping migration marking`);
    }

    const newWatermark = new Date(Math.max(...result.rows.map(row => new Date(row[timeColumn]).getTime())));

    return {
      recordCount: result.rows.length,
      bytes,
      newWatermark
    };
  });
}

async function cleanupOldData(
  datasetId: string,
  graceTime: Date,
  migrationConfig: any
): Promise<void> {
  const tables = ['dataset_access_audit', 'lifecycle_audit_log', 'lifecycle_job_runs'];
  
  await withTransaction(async (client) => {
    for (const tableName of tables) {
      // Check if the table has a metadata column
      const columnCheck = await client.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_name = $1 AND column_name = 'metadata'`,
        [tableName]
      );
      
      let query: string;
      if (columnCheck.rows.length > 0) {
        // Table has metadata column, use it to check for migrated records
        query = `DELETE FROM ${tableName}
                 WHERE dataset_id = $1
                   AND created_at <= $2
                   AND metadata->>'migrated_to_clickhouse' = 'true'`;
      } else {
        // Table doesn't have metadata column, skip cleanup for safety
        console.log(`[postgres_migration] Skipping cleanup for ${tableName} - no metadata column`);
        continue;
      }
      
      const result = await client.query(query, [datasetId, graceTime]);
      console.log(`[postgres_migration] cleaned up ${result.rowCount} records from ${tableName}`);
    }
  });
}

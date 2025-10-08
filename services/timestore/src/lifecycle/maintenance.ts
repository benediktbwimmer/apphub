import { randomUUID } from 'node:crypto';
import type { ServiceConfig } from '../config/serviceConfig';
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
  type PartitionWithTarget
} from '../db/metadata';
import { deletePartitionFile } from '../storage';
import { enforceRetention } from './retention';
import {
  captureLifecycleMetrics,
  recordExportLatency,
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
          if (operation === 'parquetExport') {
            recordExportLatency(durationMs);
          }
        }

        if (result.partitionsToDelete) {
          for (const partition of result.partitionsToDelete) {
            try {
              await deletePartitionFile(partition, partition.storageTarget, context.config);
            } catch (err) {
              console.warn('[timestore:lifecycle] failed to delete partition file', {
                partitionId: partition.id,
                shard: shardKey,
                error: err instanceof Error ? err.message : err
              });
            }
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
      return enforceRetention(context, partitions);
    case 'parquetExport':
      return {
        operation,
        status: 'skipped',
        message: 'parquet exports are disabled for ClickHouse-backed datasets'
      } satisfies LifecycleOperationExecutionResult;
    default:
      return {
        operation,
        status: 'skipped',
        message: `operation ${operation} not implemented`
      };
  }
}

export function getMaintenanceMetrics() {
  return captureLifecycleMetrics();
}

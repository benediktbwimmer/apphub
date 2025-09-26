import { randomUUID } from 'node:crypto';
import type { ServiceConfig } from '../config/serviceConfig';
import {
  createLifecycleJobRun,
  getDatasetById,
  getDatasetBySlug,
  getLatestPublishedManifest,
  getPartitionsWithTargetsForManifest,
  getRetentionPolicy,
  recordLifecycleAuditEvent,
  updateLifecycleJobRun,
  type LifecycleAuditLogRecord,
  type PartitionWithTarget
} from '../db/metadata';
import { deletePartitionFile } from '../storage';
import { performCompaction } from './compaction';
import { enforceRetention } from './retention';
import { performParquetExport } from './parquetExport';
import {
  captureLifecycleMetrics,
  recordExportLatency,
  recordJobCompleted,
  recordJobFailed,
  recordJobSkipped,
  recordJobStarted,
  recordOperationTotals
} from './metrics';
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

  const manifest = await getLatestPublishedManifest(dataset.id);
  if (!manifest) {
    await updateLifecycleJobRun({
      id: jobRun.id,
      status: 'skipped',
      completedAt: new Date(),
      metadataPatch: {
        reason: 'no published manifest'
      }
    });
    recordJobSkipped();
    return {
      jobId: jobRun.id,
      datasetId: dataset.id,
      datasetSlug: dataset.slug,
      operations: operations.map((operation) => ({
        operation,
        status: 'skipped',
        message: 'no published manifest available'
      })),
      auditLogEntries: []
    };
  }

  const retentionRecord = await getRetentionPolicy(dataset.id);
  const defaultPolicy = createDefaultRetentionPolicy(config);
  const retentionPolicy = parseRetentionPolicy(retentionRecord, defaultPolicy);

  const context: LifecycleJobContext = {
    config,
    dataset,
    manifest,
    retentionPolicy,
    jobRun
  };

  const auditRecords: LifecycleAuditLogRecord[] = [];
  const operationSummaries: LifecycleOperationResult[] = [];
  let currentManifest = manifest;

  try {
    for (const operation of operations) {
      context.manifest = currentManifest;
      const partitions = await getPartitionsWithTargetsForManifest(currentManifest.id);
      const opStart = Date.now();
      const result = await executeOperation(operation, context, partitions);
      const durationMs = Date.now() - opStart;
      operationSummaries.push({
        operation,
        status: result.status,
        message: result.message,
        details: result.details
      });

      if (result.auditEvents) {
        for (const event of result.auditEvents) {
          const record = await recordLifecycleAuditEvent(event);
          auditRecords.push(record);
        }
      }

      if (result.status === 'failed') {
        throw new Error(result.message ?? `${operation} lifecycle step failed`);
      }

      if (result.status === 'completed') {
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
              error: err instanceof Error ? err.message : err
            });
          }
        }
      }

      if (result.manifest) {
        currentManifest = result.manifest;
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
      return performCompaction(context, partitions);
    case 'retention':
      return enforceRetention(context, partitions);
    case 'parquetExport':
      return performParquetExport(context, partitions);
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

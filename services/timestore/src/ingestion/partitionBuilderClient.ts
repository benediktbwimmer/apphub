import type { ServiceConfig } from '../config/serviceConfig';
import type { StorageTargetRecord } from '../db/metadata';
import { writePartitionFile, type PartitionBuildRequest } from './partitionWriter';
import {
  partitionBuildJobPayloadSchema,
  partitionBuildJobResultSchema,
  type PartitionBuildJobResult
} from './types';
import {
  ensurePartitionBuildQueue,
  ensurePartitionBuildQueueEvents,
  isPartitionBuildInlineMode
} from './partitionBuildQueue';
import {
  metricsEnabled,
  observePartitionBuildJob,
  updatePartitionBuildQueueDepth
} from '../observability/metrics';
import type { Job } from 'bullmq';

const DEFAULT_ATTEMPTS = Number(process.env.TIMESTORE_PARTITION_BUILD_ATTEMPTS ?? 5);
const DEFAULT_BACKOFF_MS = Number(process.env.TIMESTORE_PARTITION_BUILD_BACKOFF_MS ?? 15_000);
const DEFAULT_TIMEOUT_MS = Number(process.env.TIMESTORE_PARTITION_BUILD_TIMEOUT_MS ?? 5 * 60_000);

interface BuildOptions {
  attempts?: number;
  backoffMs?: number;
  timeoutMs?: number;
}

export interface PartitionBuildInvocation extends PartitionBuildRequest {
  storageTarget: StorageTargetRecord;
}

export async function executePartitionBuild(
  config: ServiceConfig,
  request: PartitionBuildInvocation,
  options: BuildOptions = {}
): Promise<PartitionBuildJobResult> {
  const attempts = normalizePositiveInteger(options.attempts, DEFAULT_ATTEMPTS);
  const backoffMs = normalizePositiveInteger(options.backoffMs, DEFAULT_BACKOFF_MS);
  const timeoutMs = normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);

  const payload = partitionBuildJobPayloadSchema.parse({
    datasetSlug: request.datasetSlug,
    storageTargetId: request.storageTarget.id,
    partitionId: request.partitionId,
    partitionKey: request.partitionKey,
    tableName: request.tableName,
    schema: request.schema,
    rows: request.rows,
    sourceFilePath: request.sourceFilePath,
    rowCountHint: request.rowCountHint
  });

  if (isPartitionBuildInlineMode()) {
    const start = process.hrtime.bigint();
    try {
      const result = await writePartitionFile(config, request.storageTarget, request);
      observePartitionBuildJob({
        datasetSlug: request.datasetSlug,
        result: 'success',
        durationSeconds: durationSince(start)
      });
      return partitionBuildJobResultSchema.parse({
        storageTargetId: request.storageTarget.id,
        relativePath: result.relativePath,
        fileSizeBytes: result.fileSizeBytes,
        rowCount: result.rowCount,
        checksum: result.checksum
      });
    } catch (error) {
      observePartitionBuildJob({
        datasetSlug: request.datasetSlug,
        result: 'failure',
        durationSeconds: durationSince(start),
        failureReason: classifyError(error)
      });
      throw error;
    }
  }

  const queue = ensurePartitionBuildQueue();
  const job = await queue.add(
    payload.datasetSlug,
    payload,
    {
      attempts,
      backoff: backoffMs > 0
        ? {
            type: 'exponential',
            delay: backoffMs
          }
        : undefined,
      removeOnComplete: 100,
      removeOnFail: 100
    }
  );

  void refreshQueueMetrics(queue).catch(() => undefined);

  return waitForPartitionBuildResult(job, timeoutMs);
}

async function waitForPartitionBuildResult(
  job: Job,
  timeoutMs: number
): Promise<PartitionBuildJobResult> {
  const queueEvents = ensurePartitionBuildQueueEvents();
  const result = await job.waitUntilFinished(queueEvents, timeoutMs);
  return partitionBuildJobResultSchema.parse(result);
}

async function refreshQueueMetrics(queue: ReturnType<typeof ensurePartitionBuildQueue>): Promise<void> {
  if (!metricsEnabled()) {
    return;
  }
  try {
    const counts = await queue.getJobCounts();
    updatePartitionBuildQueueDepth({
      waiting: counts.waiting,
      active: counts.active,
      completed: counts.completed,
      failed: counts.failed,
      delayed: counts.delayed,
      paused: counts.paused
    });
  } catch (error) {
    console.warn('[timestore:partition-build] failed to collect queue metrics', {
      error: error instanceof Error ? error.message : error
    });
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.isFinite(value) ? Math.floor(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function durationSince(start: bigint): number {
  const elapsed = Number(process.hrtime.bigint() - start);
  return elapsed / 1_000_000_000;
}

function classifyError(error: unknown): string {
  if (!error) {
    return 'unknown';
  }
  if (error instanceof Error) {
    return error.name || 'error';
  }
  return typeof error === 'string' ? error.slice(0, 120) : 'error';
}

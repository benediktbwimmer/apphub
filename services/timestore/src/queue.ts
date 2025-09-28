import type { Job, Queue } from 'bullmq';
import { Queue as BullQueue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { ingestionJobPayloadSchema, type IngestionJobPayload, type IngestionProcessingResult } from './ingestion/types';
import { processIngestionJob } from './ingestion/processor';
import { metricsEnabled, updateIngestionQueueDepth } from './observability/metrics';

export const TIMESTORE_INGEST_QUEUE_NAME = process.env.TIMESTORE_INGEST_QUEUE_NAME ?? 'timestore_ingest_queue';

let queueInstance: Queue<IngestionJobPayload> | null = null;
let connection: Redis | null = null;

function resolveRedisUrl(): string {
  const raw = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  return raw.trim();
}

function isInlineRedis(): boolean {
  return resolveRedisUrl() === 'inline';
}

export function isInlineQueueMode(): boolean {
  return isInlineRedis();
}

export async function enqueueIngestionJob(
  payload: IngestionJobPayload
): Promise<{ jobId: string; mode: 'inline' | 'queued'; result?: IngestionProcessingResult }> {
  const jobPayload = ingestionJobPayloadSchema.parse({
    ...payload,
    receivedAt: payload.receivedAt ?? new Date().toISOString()
  });

  if (isInlineRedis()) {
    const result = await processIngestionJob(jobPayload);
    return {
      jobId: `inline:${Date.now()}`,
      mode: 'inline',
      result
    };
  }

  const queue = ensureQueue();
  const jobOptions = jobPayload.idempotencyKey
    ? {
        jobId: `${jobPayload.datasetSlug}-${jobPayload.idempotencyKey.replace(/[:]/g, '-')}`
      }
    : undefined;
  const job: Job<IngestionJobPayload> = await queue.add(
    jobPayload.datasetSlug,
    jobPayload,
    jobOptions
  );

  if (metricsEnabled()) {
    try {
      const counts = await queue.getJobCounts();
      updateIngestionQueueDepth({
        waiting: counts.waiting,
        active: counts.active,
        completed: counts.completed,
        failed: counts.failed,
        delayed: counts.delayed,
        paused: counts.paused
      });
    } catch (error) {
      console.warn('[timestore:queue] failed to collect ingestion queue metrics', {
        error: error instanceof Error ? error.message : error
      });
    }
  }

  return {
    jobId: String(job.id),
    mode: 'queued'
  };
}

export function getQueueConnection(): Redis {
  if (!connection) {
    ensureQueue();
  }
  if (!connection) {
    throw new Error('Redis connection not initialised');
  }
  return connection;
}

export async function closeQueueConnection(): Promise<void> {
  if (queueInstance) {
    await queueInstance.close();
    queueInstance = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
}

export async function getIngestionQueueDepth(): Promise<number> {
  if (isInlineQueueMode()) {
    return 0;
  }
  try {
    const queue = ensureQueue();
    const counts = await queue.getJobCounts();
    return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
  } catch (error) {
    console.warn('[timestore:queue] failed to determine ingestion queue depth', {
      error: error instanceof Error ? error.message : error
    });
    return 0;
  }
}

function ensureQueue(): Queue<IngestionJobPayload> {
  if (isInlineRedis()) {
    throw new Error('Queue not available in inline mode');
  }

  if (queueInstance) {
    return queueInstance;
  }

  if (!connection) {
    const redisUrl = resolveRedisUrl();
    connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null
    });
    connection.on('error', (err) => {
      console.error('[timestore:queue] Redis connection error', err);
    });
  }

  queueInstance = new BullQueue(TIMESTORE_INGEST_QUEUE_NAME, {
    connection
  });

  return queueInstance;
}

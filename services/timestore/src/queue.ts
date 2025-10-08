import type { Job, Queue } from 'bullmq';
import { Queue as BullQueue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import {
  ingestionJobPayloadSchema,
  type IngestionJobPayload,
  type IngestionProcessingResult
} from './ingestion/types';
import { processIngestionJob } from './ingestion/processor';
import { metricsEnabled, updateIngestionQueueDepth } from './observability/metrics';

export const TIMESTORE_INGEST_QUEUE_NAME = process.env.TIMESTORE_INGEST_QUEUE_NAME ?? 'timestore_ingest_queue';

type IngestionQueuePayload = IngestionJobPayload & { __operation?: 'ingest' };

export type QueueJobPayload = IngestionQueuePayload;

let queueInstance: Queue<QueueJobPayload> | null = null;
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

  const jobOptions = jobPayload.idempotencyKey
    ? {
        jobId: `${jobPayload.datasetSlug}-${jobPayload.idempotencyKey.replace(/[:]/g, '-')}`
      }
    : undefined;
  const ingestPayload: QueueJobPayload = { ...jobPayload, __operation: 'ingest' };
  const job: Job<QueueJobPayload> = await addJobWithRetries(jobPayload.datasetSlug, ingestPayload, jobOptions);

  if (metricsEnabled()) {
    try {
      const counts = await ensureQueue().getJobCounts();
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

function ensureQueue(): Queue<QueueJobPayload> {
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

function isJobExistsError(error: unknown, jobId: string): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message ?? '';
  return message.includes('already exists') && message.includes(jobId);
}

function isRedisConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message ?? '';
  return message.includes('Connection is closed') || message.includes('Connection was never established');
}

async function resetQueueInstance(): Promise<void> {
  if (queueInstance) {
    try {
      await queueInstance.close();
    } catch {
      // ignore close errors
    }
    queueInstance = null;
  }
  if (connection) {
    try {
      await connection.quit();
    } catch {
      connection.disconnect();
    }
    connection = null;
  }
}

async function addJobWithRetries(
  jobName: string,
  payload: QueueJobPayload,
  options: Parameters<Queue<QueueJobPayload>['add']>[2],
  attempts = 3,
  baseDelayMs = 200
): Promise<Job<QueueJobPayload>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const queue = ensureQueue();
      await queue.waitUntilReady();
      return await queue.add(jobName, payload, options);
    } catch (error) {
      if (!isRedisConnectionError(error)) {
        throw error;
      }
      lastError = error;
      await resetQueueInstance();
      if (attempt < attempts - 1) {
        await delay(baseDelayMs * Math.pow(2, attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Failed to enqueue job'));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import { Queue, Worker } from 'bullmq';
import type { JobsOptions, WorkerOptions, Processor } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import type { ServiceConfig } from '../config/serviceConfig';
import type { LifecycleJobPayload } from './types';
import { metricsEnabled, updateLifecycleQueueDepth } from '../observability/metrics';

let queueInstance: Queue<LifecycleJobPayload> | null = null;
type QueueSchedulerLike = {
  waitUntilReady(): Promise<void>;
  close(): Promise<void>;
};

type QueueSchedulerConstructor = new (queueName: string, options: { connection: Redis }) => QueueSchedulerLike;

let schedulerInstance: QueueSchedulerLike | null = null;
let connectionInstance: Redis | null = null;
let connectionReadyPromise: Promise<void> | null = null;
let lifecycleReady = false;
let lifecycleLastError: string | null = null;

function allowInlineMode(): boolean {
  const value = process.env.APPHUB_ALLOW_INLINE_MODE;
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function resolveRedisUrl(): string {
  const raw = process.env.REDIS_URL;
  if (!raw || !raw.trim()) {
    throw new Error('REDIS_URL must be set to a redis:// connection string for lifecycle queues');
  }
  const url = raw.trim();
  if (url === 'inline' && !allowInlineMode()) {
    throw new Error('REDIS_URL=inline requires APPHUB_ALLOW_INLINE_MODE=true to enable inline lifecycle mode');
  }
  return url;
}

function isInlineRedis(): boolean {
  return resolveRedisUrl() === 'inline';
}

export const LIFECYCLE_QUEUE_NAME_DEFAULT = 'timestore_lifecycle_queue';

export function isLifecycleInlineMode(): boolean {
  return isInlineRedis();
}

export function ensureLifecycleQueue(config: ServiceConfig): Queue<LifecycleJobPayload> {
  if (isInlineRedis()) {
    throw new Error('Lifecycle queue unavailable in inline mode');
  }
  if (queueInstance) {
    return queueInstance;
  }
  const connection = ensureConnection();
  void ensureConnectionReady();
  queueInstance = new Queue<LifecycleJobPayload>(config.lifecycle.queueName, {
    connection
  });
  return queueInstance;
}

export function ensureLifecycleScheduler(config: ServiceConfig): QueueSchedulerLike {
  if (isInlineRedis()) {
    throw new Error('Lifecycle scheduler unavailable in inline mode');
  }
  if (schedulerInstance) {
    return schedulerInstance;
  }
  const connection = ensureConnection();
  void ensureConnectionReady();
  const ctor = loadQueueSchedulerConstructor();
  if (!ctor) {
    throw new Error('QueueScheduler not available in this BullMQ version');
  }
  schedulerInstance = new ctor(config.lifecycle.queueName, {
    connection
  });
  return schedulerInstance;
}

export function createLifecycleWorker(
  config: ServiceConfig,
  processor: Processor<LifecycleJobPayload>,
  options: Omit<WorkerOptions, 'connection'> = {}
): Worker<LifecycleJobPayload> {
  if (isInlineRedis()) {
    throw new Error('Lifecycle worker unavailable in inline mode');
  }
  const connection = ensureConnection();
  return new Worker<LifecycleJobPayload>(config.lifecycle.queueName, processor, {
    connection,
    ...options
  });
}

export async function enqueueLifecycleJob(
  config: ServiceConfig,
  payload: LifecycleJobPayload,
  options?: JobsOptions
): Promise<void> {
  if (isInlineRedis()) {
    throw new Error('Cannot enqueue lifecycle job when REDIS_URL=inline');
  }
  await ensureConnectionReady();
  const queue = ensureLifecycleQueue(config);
  await queue.add(payload.datasetSlug, payload, options);
  if (metricsEnabled()) {
    try {
      const counts = await queue.getJobCounts();
      updateLifecycleQueueDepth({
        waiting: counts.waiting,
        active: counts.active,
        completed: counts.completed,
        failed: counts.failed,
        delayed: counts.delayed,
        paused: counts.paused
      });
    } catch (error) {
      console.warn('[timestore:lifecycle] failed to collect queue metrics', {
        error: error instanceof Error ? error.message : error
      });
    }
  }
}

export async function closeLifecycleQueue(): Promise<void> {
  if (queueInstance) {
    await queueInstance.close();
    queueInstance = null;
  }
  if (schedulerInstance) {
    await schedulerInstance.close();
    schedulerInstance = null;
  }
  if (connectionInstance) {
    await connectionInstance.quit();
    connectionInstance = null;
  }
  connectionReadyPromise = null;
  lifecycleReady = false;
  lifecycleLastError = null;
}

function ensureConnection(): Redis {
  if (connectionInstance) {
    return connectionInstance;
  }
  const redisUrl = resolveRedisUrl();
  connectionInstance = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true
  });
  connectionInstance.on('error', (err) => {
    lifecycleReady = false;
    lifecycleLastError = err instanceof Error ? err.message : String(err);
    console.error('[timestore:lifecycle] Redis connection error', err);
  });
  connectionInstance.on('end', () => {
    lifecycleReady = false;
    lifecycleLastError = 'connection closed';
  });
  connectionInstance.on('close', () => {
    lifecycleReady = false;
    lifecycleLastError = 'connection closed';
  });
  connectionInstance.on('ready', () => {
    lifecycleReady = true;
    lifecycleLastError = null;
  });
  return connectionInstance;
}

async function ensureConnectionReady(): Promise<void> {
  if (isInlineRedis()) {
    lifecycleReady = true;
    lifecycleLastError = null;
    return;
  }

  const connection = ensureConnection();
  if (!connectionReadyPromise) {
    connectionReadyPromise = (async () => {
      if (connection.status === 'wait') {
        await connection.connect();
      }
      await connection.ping();
      lifecycleReady = true;
      lifecycleLastError = null;
    })();
  }

  try {
    await connectionReadyPromise;
  } catch (err) {
    connectionReadyPromise = null;
    lifecycleReady = false;
    lifecycleLastError = err instanceof Error ? err.message : String(err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function verifyLifecycleQueueConnection(): Promise<void> {
  await ensureConnectionReady();
}

export function getLifecycleQueueHealth(): {
  inline: boolean;
  ready: boolean;
  lastError: string | null;
} {
  try {
    const inline = isInlineRedis();
    return {
      inline,
      ready: inline ? true : lifecycleReady,
      lastError: inline ? null : lifecycleLastError
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      inline: false,
      ready: false,
      lastError: message
    };
  }
}

let cachedQueueSchedulerCtor: QueueSchedulerConstructor | null | undefined;

function loadQueueSchedulerConstructor(): QueueSchedulerConstructor | null {
  if (cachedQueueSchedulerCtor !== undefined) {
    return cachedQueueSchedulerCtor;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bullmq = require('bullmq') as Record<string, unknown>;
    if (typeof bullmq.QueueScheduler === 'function') {
      cachedQueueSchedulerCtor = bullmq.QueueScheduler as QueueSchedulerConstructor;
      return cachedQueueSchedulerCtor;
    }
    if (typeof bullmq.JobScheduler === 'function') {
      cachedQueueSchedulerCtor = bullmq.JobScheduler as QueueSchedulerConstructor;
      return cachedQueueSchedulerCtor;
    }
  } catch (error) {
    // ignore and fall through
  }

  cachedQueueSchedulerCtor = null;
  return null;
}

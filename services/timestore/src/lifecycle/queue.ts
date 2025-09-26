import { Queue, Worker } from 'bullmq';
import type { JobsOptions, WorkerOptions, Processor } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import type { ServiceConfig } from '../config/serviceConfig';
import type { LifecycleJobPayload } from './types';

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const inlineMode = redisUrl === 'inline';

let queueInstance: Queue<LifecycleJobPayload> | null = null;
type QueueSchedulerLike = {
  waitUntilReady(): Promise<void>;
  close(): Promise<void>;
};

type QueueSchedulerConstructor = new (queueName: string, options: { connection: Redis }) => QueueSchedulerLike;

let schedulerInstance: QueueSchedulerLike | null = null;
let connectionInstance: Redis | null = null;

export const LIFECYCLE_QUEUE_NAME_DEFAULT = 'timestore_lifecycle_queue';

export function isLifecycleInlineMode(): boolean {
  return inlineMode;
}

export function ensureLifecycleQueue(config: ServiceConfig): Queue<LifecycleJobPayload> {
  if (inlineMode) {
    throw new Error('Lifecycle queue unavailable in inline mode');
  }
  if (queueInstance) {
    return queueInstance;
  }
  const connection = ensureConnection();
  queueInstance = new Queue<LifecycleJobPayload>(config.lifecycle.queueName, {
    connection
  });
  return queueInstance;
}

export function ensureLifecycleScheduler(config: ServiceConfig): QueueSchedulerLike {
  if (inlineMode) {
    throw new Error('Lifecycle scheduler unavailable in inline mode');
  }
  if (schedulerInstance) {
    return schedulerInstance;
  }
  const connection = ensureConnection();
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
  if (inlineMode) {
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
  if (inlineMode) {
    throw new Error('Cannot enqueue lifecycle job when REDIS_URL=inline');
  }
  const queue = ensureLifecycleQueue(config);
  await queue.add(payload.datasetSlug, payload, options);
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
}

function ensureConnection(): Redis {
  if (connectionInstance) {
    return connectionInstance;
  }
  connectionInstance = new IORedis(redisUrl, {
    maxRetriesPerRequest: null
  });
  connectionInstance.on('error', (err) => {
    console.error('[timestore:lifecycle] Redis connection error', err);
  });
  return connectionInstance;
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

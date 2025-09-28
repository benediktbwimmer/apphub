import { Queue, QueueEvents } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import type { PartitionBuildJobPayload } from './types';

export const TIMESTORE_PARTITION_BUILD_QUEUE_NAME =
  process.env.TIMESTORE_PARTITION_BUILD_QUEUE_NAME ?? 'timestore_partition_build_queue';

let queueInstance: Queue<PartitionBuildJobPayload> | null = null;
let queueEventsInstance: QueueEvents | null = null;
let connectionInstance: Redis | null = null;

function resolveRedisUrl(): string {
  const raw = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  return raw.trim();
}

function isInlineRedis(): boolean {
  return resolveRedisUrl() === 'inline';
}

export function isPartitionBuildInlineMode(): boolean {
  return isInlineRedis();
}

export function ensurePartitionBuildQueue(): Queue<PartitionBuildJobPayload> {
  if (isInlineRedis()) {
    throw new Error('Partition build queue unavailable in inline mode');
  }
  if (queueInstance) {
    return queueInstance;
  }
  const connection = ensureConnection();
  queueInstance = new Queue<PartitionBuildJobPayload>(TIMESTORE_PARTITION_BUILD_QUEUE_NAME, {
    connection
  });
  return queueInstance;
}

export function ensurePartitionBuildQueueEvents(): QueueEvents {
  if (isInlineRedis()) {
    throw new Error('Partition build queue events unavailable in inline mode');
  }
  if (queueEventsInstance) {
    return queueEventsInstance;
  }
  const connection = ensureConnection();
  queueEventsInstance = new QueueEvents(TIMESTORE_PARTITION_BUILD_QUEUE_NAME, {
    connection
  });
  return queueEventsInstance;
}

export function getPartitionBuildQueueConnection(): Redis {
  return ensureConnection();
}

export async function closePartitionBuildQueue(): Promise<void> {
  if (queueInstance) {
    await queueInstance.close();
    queueInstance = null;
  }
  if (queueEventsInstance) {
    await queueEventsInstance.close();
    queueEventsInstance = null;
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
  const redisUrl = resolveRedisUrl();
  connectionInstance = new IORedis(redisUrl, {
    maxRetriesPerRequest: null
  });
  connectionInstance.on('error', (err) => {
    console.error('[timestore:partition-build] Redis connection error', err);
  });
  return connectionInstance;
}

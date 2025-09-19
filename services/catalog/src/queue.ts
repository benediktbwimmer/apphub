import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const inlineMode = redisUrl === 'inline';

function createConnection() {
  if (inlineMode) {
    return null;
  }
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null
  });
  connection.on('error', (err) => {
    console.error('[queue] Redis connection error', err);
  });
  return connection;
}

const connection = createConnection();

export const INGEST_QUEUE_NAME = process.env.INGEST_QUEUE_NAME ?? 'apphub_queue';
export const BUILD_QUEUE_NAME = process.env.BUILD_QUEUE_NAME ?? 'apphub_build_queue';

const queue = !inlineMode && connection
  ? new Queue(INGEST_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 100
      }
    })
  : null;

const buildQueue = !inlineMode && connection
  ? new Queue(BUILD_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 50,
        attempts: 1
      }
    })
  : null;

export async function enqueueRepositoryIngestion(repositoryId: string) {
  if (inlineMode) {
    return;
  }

  if (!queue) {
    throw new Error('Queue not initialised');
  }

  await queue.add(
    'repository-ingest',
    { repositoryId },
    {
      attempts: Number(process.env.INGEST_JOB_ATTEMPTS ?? 3),
      backoff: {
        type: 'exponential',
        delay: Number(process.env.INGEST_JOB_BACKOFF_MS ?? 10_000)
      }
    }
  );
}

export function getQueueConnection() {
  if (inlineMode || !connection) {
    throw new Error('Redis connection not initialised');
  }
  return connection;
}

export function isInlineQueueMode() {
  return inlineMode;
}

export async function enqueueBuildJob(buildId: string, repositoryId: string) {
  if (inlineMode) {
    return;
  }

  if (!buildQueue) {
    throw new Error('Build queue not initialised');
  }

  await buildQueue.add('repository-build', { buildId, repositoryId });
}

import { Worker } from 'bullmq';
import type { EventEnvelope } from '@apphub/event-bus';
import {
  EVENT_TRIGGER_JOB_NAME,
  EVENT_TRIGGER_QUEUE_NAME,
  closeQueueConnection,
  getQueueConnection,
  isInlineQueueMode,
  type EventTriggerJobData
} from './queue';
import { processEventTriggersForEnvelope } from './eventTriggerProcessor';
import { logger } from './observability/logger';
import { normalizeMeta } from './observability/meta';

const inlineMode = isInlineQueueMode();
const EVENT_TRIGGER_WORKER_CONCURRENCY = Number(process.env.EVENT_TRIGGER_CONCURRENCY ?? 5);

async function processJob(data: EventTriggerJobData): Promise<void> {
  await processEventTriggersForEnvelope(data.envelope as EventEnvelope);
}

async function runInlineMode(): Promise<void> {
  logger.info('Event trigger worker running in inline mode; jobs execute synchronously');
}

async function runQueuedWorker(): Promise<void> {
  const connection = getQueueConnection();
  const worker = new Worker<EventTriggerJobData>(
    EVENT_TRIGGER_QUEUE_NAME,
    async (job) => {
      try {
        await processJob(job.data);
      } catch (err) {
        logger.error(
          'Workflow event trigger job failed',
          normalizeMeta({ jobId: job.id, error: err instanceof Error ? err.message : String(err) })
        );
        throw err;
      }
    },
    {
      connection,
      concurrency: EVENT_TRIGGER_WORKER_CONCURRENCY
    }
  );

  worker.on('failed', (job, err) => {
    logger.error(
      'Workflow event trigger job failed after retries',
      normalizeMeta({ jobId: job?.id ?? null, error: err instanceof Error ? err.message : String(err) })
    );
  });

  worker.on('completed', (job) => {
    logger.info('Workflow event trigger job completed', normalizeMeta({ jobId: job.id }));
  });

  await worker.waitUntilReady();
  logger.info(
    'Event trigger worker ready',
    normalizeMeta({ queue: EVENT_TRIGGER_QUEUE_NAME, concurrency: EVENT_TRIGGER_WORKER_CONCURRENCY })
  );

  const shutdown = async () => {
    logger.info('Event trigger worker shutting down');
    await worker.close();
    try {
      await closeQueueConnection(connection);
    } catch (err) {
      logger.error('Failed to close Redis connection for event trigger worker', normalizeMeta({ error: err instanceof Error ? err.message : String(err) }));
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main(): Promise<void> {
  if (inlineMode) {
    await runInlineMode();
    return;
  }
  await runQueuedWorker();
}

if (require.main === module) {
  main().catch((err) => {
    logger.error('Event trigger worker crashed', normalizeMeta({ error: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  });
}

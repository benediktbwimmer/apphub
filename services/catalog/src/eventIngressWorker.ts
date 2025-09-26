import { Worker } from 'bullmq';
import { DEFAULT_EVENT_JOB_NAME, validateEventEnvelope, type EventIngressJobData } from '@apphub/event-bus';
import { EVENT_QUEUE_NAME, closeQueueConnection, getQueueConnection, isInlineQueueMode } from './queue';
import { ingestWorkflowEvent } from './workflowEvents';
import { logger } from './observability/logger';
import { normalizeMeta } from './observability/meta';

const EVENT_WORKER_CONCURRENCY = Number(process.env.EVENT_INGRESS_CONCURRENCY ?? 5);
const inlineMode = isInlineQueueMode();

async function runInlineMode(): Promise<void> {
  logger.info('Event ingress worker running in inline mode; events process synchronously via queue helpers');
}

async function runQueuedWorker(): Promise<void> {
  const connection = getQueueConnection();
  const worker = new Worker<EventIngressJobData>(
    EVENT_QUEUE_NAME,
    async (job) => {
      const validated = validateEventEnvelope(job.data.envelope);
      await ingestWorkflowEvent(validated);
    },
    {
      connection,
      concurrency: EVENT_WORKER_CONCURRENCY
    }
  );

  worker.on('failed', (job, err) => {
    logger.error(
      'Workflow event ingestion failed',
      normalizeMeta({ jobId: job?.id ?? null, error: err?.message ?? 'unknown error' })
    );
  });

  worker.on('completed', (job) => {
    logger.info('Workflow event processed', normalizeMeta({ jobId: job.id }));
  });

  await worker.waitUntilReady();
  logger.info(
    'Event ingress worker ready',
    normalizeMeta({ queue: EVENT_QUEUE_NAME, concurrency: EVENT_WORKER_CONCURRENCY })
  );

  const shutdown = async () => {
    logger.info('Event ingress worker shutting down');
    await worker.close();
    try {
      await closeQueueConnection(connection);
    } catch (err) {
      logger.error('Failed to close Redis connection for event worker', normalizeMeta({ error: (err as Error).message }));
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
    logger.error('Event ingress worker crashed', normalizeMeta({ error: err?.message ?? 'unknown error' }));
    process.exit(1);
  });
}

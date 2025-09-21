import { Worker } from 'bullmq';
import { runWorkflowOrchestration } from './workflowOrchestrator';
import {
  WORKFLOW_QUEUE_NAME,
  getQueueConnection,
  closeQueueConnection,
  isInlineQueueMode
} from './queue';
import { logger } from './observability/logger';
import { normalizeMeta } from './observability/meta';

const WORKFLOW_CONCURRENCY = Number(process.env.WORKFLOW_CONCURRENCY ?? 1);
const useInlineQueue = isInlineQueueMode();

function log(message: string, meta?: Record<string, unknown>) {
  const payload = normalizeMeta(meta);
  logger.info(message, payload);
}

async function runInlineMode() {
  log('Inline workflow mode detected; worker process will exit. Workflow runs execute synchronously.');
}

async function runQueueWorker() {
  const connection = getQueueConnection();
  const worker = new Worker(
    WORKFLOW_QUEUE_NAME,
    async (job) => {
      const { workflowRunId } = job.data as { workflowRunId?: string };
      if (!workflowRunId || typeof workflowRunId !== 'string') {
        throw new Error('workflowRunId is required');
      }
      log('Processing workflow run', { jobId: job.id ?? 'unknown', workflowRunId });
      await runWorkflowOrchestration(workflowRunId);
    },
    {
      connection,
      concurrency: WORKFLOW_CONCURRENCY
    }
  );

  worker.on('completed', (job) => {
    logger.info('Workflow run completed', { jobId: job.id ?? 'unknown' });
  });

  worker.on('failed', (job, err) => {
    logger.error('Workflow run failed', {
      jobId: job?.id ?? 'unknown',
      error: err?.message ?? 'unknown error'
    });
  });

  await worker.waitUntilReady();
  log('Workflow worker ready', {
    queue: WORKFLOW_QUEUE_NAME,
    concurrency: WORKFLOW_CONCURRENCY
  });

  const shutdown = async () => {
    log('Shutdown signal received');
    await worker.close();
    try {
      await closeQueueConnection(connection);
    } catch (err) {
      log('Failed to close queue connection', { error: (err as Error).message });
    }
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

async function main() {
  if (useInlineQueue) {
    await runInlineMode();
    return;
  }
  await runQueueWorker();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[workflow-worker] Worker crashed', err);
    process.exit(1);
  });
}

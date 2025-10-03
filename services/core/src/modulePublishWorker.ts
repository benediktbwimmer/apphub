import { Worker } from 'bullmq';
import { publishModule, type PublishModuleOptions } from './modulePublishing/manager';
import { closeQueueConnection, getQueueConnection, isInlineQueueMode } from './queue';

const MODULE_PUBLISH_QUEUE_NAME = process.env.MODULE_PUBLISH_QUEUE_NAME ?? 'apphub_module_publish_queue';

export type ModulePublishJobData = PublishModuleOptions;

const MODULE_PUBLISH_CONCURRENCY = Number(process.env.MODULE_PUBLISH_CONCURRENCY ?? 1);

const useInlineQueue = isInlineQueueMode();

export async function processModulePublishJob(
  data: ModulePublishJobData,
  jobId?: string
) {
  if (!data || typeof data.moduleId !== 'string' || data.moduleId.trim().length === 0) {
    throw new Error('Module publish job requires a moduleId');
  }
  return publishModule({
    ...data,
    jobId: jobId ?? data.jobId ?? null
  });
}

async function runWorker(): Promise<void> {
  if (useInlineQueue) {
    console.warn('[module-publish] Inline queue mode active; worker not started');
    return;
  }

  const connection = getQueueConnection();
  const worker = new Worker(
    MODULE_PUBLISH_QUEUE_NAME,
    async (job) => {
      const data = job.data as ModulePublishJobData;
      return processModulePublishJob(data, job.id ? String(job.id) : undefined);
    },
    {
      connection,
      concurrency:
        Number.isFinite(MODULE_PUBLISH_CONCURRENCY) && MODULE_PUBLISH_CONCURRENCY > 0
          ? MODULE_PUBLISH_CONCURRENCY
          : 1
    }
  );

  worker.on('failed', (job, err) => {
    const moduleId = (job?.data as ModulePublishJobData | undefined)?.moduleId;
    console.error('[module-publish] Job failed', {
      jobId: job?.id,
      moduleId,
      error: err instanceof Error ? err.message : String(err)
    });
  });

  worker.on('completed', (job) => {
    const moduleId = (job.data as ModulePublishJobData | undefined)?.moduleId;
    console.log('[module-publish] Job completed', { jobId: job.id, moduleId });
  });

  await worker.waitUntilReady();
  console.log('[module-publish] Worker ready');

  const shutdown = async () => {
    console.log('[module-publish] Shutdown signal received');
    await worker.close();
    try {
      await closeQueueConnection(connection);
    } catch (err) {
      console.error('[module-publish] Failed to close Redis connection', err);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  runWorker().catch((err) => {
    console.error('[module-publish] Worker crashed', err);
    process.exit(1);
  });
}

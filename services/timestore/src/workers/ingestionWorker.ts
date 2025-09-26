import { Worker } from 'bullmq';
import { closeQueueConnection, getQueueConnection, isInlineQueueMode, TIMESTORE_INGEST_QUEUE_NAME } from '../queue';
import type { IngestionJobPayload } from '../ingestion/types';
import { processIngestionJob } from '../ingestion/processor';
import { ensureSchemaExists } from '../db/schema';
import { POSTGRES_SCHEMA } from '../db/client';
import { runMigrations } from '../db/migrations';
import { ensureDefaultStorageTarget } from '../service/bootstrap';

const concurrency = Number(process.env.TIMESTORE_INGEST_CONCURRENCY ?? 2);

async function main(): Promise<void> {
  if (isInlineQueueMode()) {
    console.log('[timestore:ingest] inline queue mode active; worker not started.');
    return;
  }

  await ensureSchemaExists(POSTGRES_SCHEMA);
  await runMigrations();
  await ensureDefaultStorageTarget();

  const worker = new Worker<IngestionJobPayload>(
    TIMESTORE_INGEST_QUEUE_NAME,
    async (job) => {
      const result = await processIngestionJob(job.data);
      return {
        manifestId: result.manifest.id,
        datasetId: result.dataset.id,
        storageTargetId: result.storageTarget.id
      };
    },
    {
      connection: getQueueConnection(),
      concurrency
    }
  );

  worker.on('completed', (job) => {
    console.log('[timestore:ingest] completed job', {
      jobId: job.id,
      manifestId: job.returnvalue?.manifestId,
      datasetId: job.returnvalue?.datasetId
    });
  });

  worker.on('failed', (job, err) => {
    console.error('[timestore:ingest] job failed', {
      jobId: job?.id,
      error: err?.message
    });
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    console.log('[timestore:ingest] shutting down', { signal });
    await worker.close();
    await closeQueueConnection();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(async (err) => {
  console.error('[timestore:ingest] fatal error', err);
  try {
    await closeQueueConnection();
  } catch (closeErr) {
    console.error('[timestore:ingest] failed to close queue connection', closeErr);
  }
  process.exit(1);
});

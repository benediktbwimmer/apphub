import { Worker } from 'bullmq';
import {
  closeQueueConnection,
  getQueueConnection,
  isInlineQueueMode,
  TIMESTORE_INGEST_QUEUE_NAME,
  type QueueJobPayload
} from '../queue';
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

  type WorkerResult = {
    operation: 'ingest';
    manifestId: string | null;
    datasetId: string;
    datasetSlug: string;
    storageTargetId: string;
    flushPending: boolean;
  };

  const worker = new Worker<QueueJobPayload, WorkerResult>(
    TIMESTORE_INGEST_QUEUE_NAME,
    async (job) => {
      const result = await processIngestionJob(job.data as IngestionJobPayload);
      return {
        operation: 'ingest',
        manifestId: result.manifest?.id ?? null,
        datasetId: result.dataset.id,
        datasetSlug: job.data.datasetSlug,
        storageTargetId: result.storageTarget.id,
        flushPending: result.flushPending ?? false
      } satisfies WorkerResult;
    },
    {
      connection: getQueueConnection(),
      concurrency
    }
  );

  worker.on('completed', (job) => {
    const result = job.returnvalue;
    if (!result) {
      console.log('[timestore:ingest] completed job without result', {
        jobId: job.id
      });
      return;
    }

    console.log('[timestore:ingest] ingestion job completed', {
      jobId: job.id,
      datasetId: result.datasetId,
      datasetSlug: result.datasetSlug,
      manifestId: result.manifestId ?? null,
      storageTargetId: result.storageTargetId,
      flushPending: result.flushPending
    });
  });

  worker.on('failed', (job, err) => {
    console.error('[timestore:ingest] job failed', {
      jobId: job?.id,
      datasetSlug: job?.data?.datasetSlug ?? (job?.name ?? null),
      operation: (job?.data as QueueJobPayload | undefined)?.__operation ?? 'ingest',
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

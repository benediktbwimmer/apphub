import { Worker } from 'bullmq';
import { loadServiceConfig } from '../config/serviceConfig';
import { ensureSchemaExists } from '../db/schema';
import { POSTGRES_SCHEMA } from '../db/client';
import { runMigrations } from '../db/migrations';
import { getStorageTargetById } from '../db/metadata';
import { writePartitionFile } from '../ingestion/partitionWriter';
import {
  closePartitionBuildQueue,
  getPartitionBuildQueueConnection,
  isPartitionBuildInlineMode,
  TIMESTORE_PARTITION_BUILD_QUEUE_NAME
} from '../ingestion/partitionBuildQueue';
import {
  observePartitionBuildJob,
  recordPartitionBuildRetries
} from '../observability/metrics';
import { partitionBuildJobPayloadSchema } from '../ingestion/types';

const concurrency = Number(process.env.TIMESTORE_PARTITION_BUILD_CONCURRENCY ?? 2);

async function main(): Promise<void> {
  if (isPartitionBuildInlineMode()) {
    console.log('[timestore:partition-build] inline queue mode active; worker not started.');
    return;
  }

  await ensureSchemaExists(POSTGRES_SCHEMA);
  await runMigrations();

  const config = loadServiceConfig();

  const worker = new Worker(
    TIMESTORE_PARTITION_BUILD_QUEUE_NAME,
    async (job) => {
      const payload = partitionBuildJobPayloadSchema.parse(job.data);
      const start = process.hrtime.bigint();
      try {
        const storageTarget = await getStorageTargetById(payload.storageTargetId);
        if (!storageTarget) {
          throw new Error(`Storage target ${payload.storageTargetId} not found`);
        }

        const result = await writePartitionFile(config, storageTarget, payload);
        const duration = durationSince(start);

        observePartitionBuildJob({
          datasetSlug: payload.datasetSlug,
          result: 'success',
          durationSeconds: duration
        });

        const retries = job.attemptsMade && job.attemptsMade > 0 ? job.attemptsMade : 0;
        if (retries > 0) {
          recordPartitionBuildRetries({ datasetSlug: payload.datasetSlug, retries });
        }

        return {
          storageTargetId: storageTarget.id,
          relativePath: result.relativePath,
          fileSizeBytes: result.fileSizeBytes,
          rowCount: result.rowCount,
          checksum: result.checksum
        };
      } catch (error) {
        const duration = durationSince(start);
        observePartitionBuildJob({
          datasetSlug: payload.datasetSlug,
          result: 'failure',
          durationSeconds: duration,
          failureReason: classifyError(error)
        });
        throw error;
      }
    },
    {
      connection: getPartitionBuildQueueConnection(),
      concurrency: Math.max(1, concurrency)
    }
  );

  worker.on('completed', (job) => {
    console.log('[timestore:partition-build] completed job', {
      jobId: job.id,
      datasetSlug: job.data?.datasetSlug,
      storageTargetId: job.returnvalue?.storageTargetId,
      relativePath: job.returnvalue?.relativePath
    });
  });

  worker.on('failed', (job, err) => {
    console.error('[timestore:partition-build] job failed', {
      jobId: job?.id,
      datasetSlug: job?.data?.datasetSlug,
      error: err?.message
    });
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    console.log('[timestore:partition-build] shutting down', { signal });
    await worker.close();
    await closePartitionBuildQueue();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(async (err) => {
  console.error('[timestore:partition-build] fatal error', err);
  try {
    await closePartitionBuildQueue();
  } catch (closeErr) {
    console.error('[timestore:partition-build] failed to close queue connection', closeErr);
  }
  process.exit(1);
});

function durationSince(start: bigint): number {
  const elapsed = Number(process.hrtime.bigint() - start);
  return elapsed / 1_000_000_000;
}

function classifyError(error: unknown): string {
  if (!error) {
    return 'unknown';
  }
  if (error instanceof Error) {
    return error.name || 'error';
  }
  return typeof error === 'string' ? error.slice(0, 120) : 'error';
}

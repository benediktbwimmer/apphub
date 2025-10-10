import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { loadServiceConfig } from '../config/serviceConfig';
import { closePool, POSTGRES_SCHEMA } from '../db/client';
import { ensureSchemaExists } from '../db/schema';
import { runMigrations } from '../db/migrations';
import { ensureDefaultStorageTarget } from '../service/bootstrap';
import { listActiveDatasets } from '../db/metadata';
import { runLifecycleJob } from '../lifecycle/maintenance';
import {
  closeLifecycleQueue,
  createLifecycleWorker,
  ensureLifecycleQueue,
  ensureLifecycleScheduler,
  isLifecycleInlineMode,
  verifyLifecycleQueueConnection
} from '../lifecycle/queue';
import type { LifecycleJobPayload, LifecycleOperation } from '../lifecycle/types';

interface CliOptions {
  datasetId?: string;
  datasetSlug?: string;
  operations?: LifecycleOperation[];
  once: boolean;
}

async function main(): Promise<void> {
  const config = loadServiceConfig();
  await ensureSchemaExists(POSTGRES_SCHEMA);
  await runMigrations();
  await ensureDefaultStorageTarget();

  const cli = parseCliOptions(process.argv.slice(2));

  if (cli.once) {
    await runSingleExecution(config, cli);
    await closePool();
    return;
  }

  if (isLifecycleInlineMode()) {
    console.log('[timestore:lifecycle] REDIS_URL=inline - lifecycle queue disabled');
    process.stdin.resume();
    return;
  }

  await verifyLifecycleQueueConnection();
  const queue = ensureLifecycleQueue(config);
  const scheduler = ensureLifecycleScheduler(config);
  await scheduler.waitUntilReady();

  const worker = createLifecycleWorker(
    config,
    async (job) => {
      const report = await runLifecycleJob(config, job.data);
      return {
        datasetId: report.datasetId,
        operations: report.operations.map((operation) => operation.status)
      };
    },
    {
      concurrency: config.lifecycle.jobConcurrency
    }
  );

  worker.on('completed', (job, result) => {
    console.log('[timestore:lifecycle] job completed', {
      jobId: job.id,
      datasetId: result?.datasetId,
      operations: result?.operations
    });
  });

  worker.on('failed', (job, err) => {
    console.error('[timestore:lifecycle] job failed', {
      jobId: job?.id,
      error: err?.message
    });
  });

  worker.on('error', (err) => {
    console.error('[timestore:lifecycle] worker error', err);
  });

  await scheduleDatasets(config, queue, cli.datasetId, cli.datasetSlug);

  const shutdown = async (signal: string) => {
    console.log('[timestore:lifecycle] shutting down', { signal });
    await worker.close();
    await closeLifecycleQueue();
    await closePool();
    process.exit(0);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }

  console.log('[timestore:lifecycle] worker online');
  process.stdin.resume();
}

async function scheduleDatasets(
  config: ReturnType<typeof loadServiceConfig>,
  queue: Queue<LifecycleJobPayload>,
  datasetId?: string,
  datasetSlug?: string
): Promise<void> {
  const datasets = datasetId || datasetSlug
    ? (await listActiveDatasets()).filter((dataset) => {
        if (datasetId && dataset.id !== datasetId) {
          return false;
        }
        if (datasetSlug && dataset.slug !== datasetSlug) {
          return false;
        }
        return true;
      })
    : await listActiveDatasets();

  const intervalMs = config.lifecycle.intervalSeconds * 1000;
  const jitterMs = config.lifecycle.jitterSeconds * 1000;

  for (const dataset of datasets) {
    const payload: LifecycleJobPayload = {
      datasetId: dataset.id,
      datasetSlug: dataset.slug,
      operations: ['compaction', 'retention'],
      trigger: 'schedule',
      requestId: randomUUID(),
      requestedAt: new Date().toISOString()
    };
    try {
      await queue.add(dataset.slug, payload, {
        jobId: `dataset-${dataset.id}`,
        repeat: {
          every: intervalMs
        },
        delay: jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : undefined,
        removeOnComplete: true,
        removeOnFail: false
      });
    } catch (err) {
      console.warn('[timestore:lifecycle] failed to schedule dataset job', {
        datasetId: dataset.id,
        error: err instanceof Error ? err.message : err
      });
    }
  }
}

async function runSingleExecution(
  config: ReturnType<typeof loadServiceConfig>,
  cli: CliOptions
): Promise<void> {
  if (!cli.datasetId && !cli.datasetSlug) {
    throw new Error('When using --once you must specify --dataset-id or --dataset');
  }
  const payload: LifecycleJobPayload = {
    datasetId: cli.datasetId ?? '',
    datasetSlug: cli.datasetSlug ?? '',
    operations: cli.operations ?? ['compaction', 'retention'],
    trigger: 'manual',
    requestId: randomUUID(),
    requestedAt: new Date().toISOString()
  };
  const report = await runLifecycleJob(config, payload);
  console.log('[timestore:lifecycle] manual maintenance complete', {
    datasetId: report.datasetId,
    operations: report.operations.map((operation) => ({
      operation: operation.operation,
      status: operation.status,
      message: operation.message
    }))
  });
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    once: false
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--once') {
      options.once = true;
      continue;
    }
    if (arg === '--dataset' || arg === '--dataset-slug') {
      options.datasetSlug = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--dataset=')) {
      options.datasetSlug = arg.split('=')[1];
      continue;
    }
    if (arg === '--dataset-id') {
      options.datasetId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--dataset-id=')) {
      options.datasetId = arg.split('=')[1];
      continue;
    }
    if (arg === '--operations') {
      options.operations = parseOperations(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--operations=')) {
      options.operations = parseOperations(arg.split('=')[1]);
      continue;
    }
  }

  return options;
}

function parseOperations(input?: string): LifecycleOperation[] | undefined {
  if (!input) {
    return undefined;
  }
  return input
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is LifecycleOperation =>
      value === 'compaction' || value === 'retention'
    );
}

main().catch(async (err) => {
  console.error('[timestore:lifecycle] fatal error', err);
  try {
    await closeLifecycleQueue();
  } catch (queueErr) {
    console.error('[timestore:lifecycle] failed to close lifecycle queue', queueErr);
  }
  try {
    await closePool();
  } catch (poolErr) {
    console.error('[timestore:lifecycle] failed to close pool', poolErr);
  }
  process.exit(1);
});

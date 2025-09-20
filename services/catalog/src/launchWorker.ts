import { Worker } from 'bullmq';
import {
  takeNextLaunchToStart,
  takeNextLaunchToStop,
  type LaunchRecord
} from './db';
import { runLaunchStart, runLaunchStop } from './launchRunner';
import {
  LAUNCH_QUEUE_NAME,
  closeQueueConnection,
  getQueueConnection,
  isInlineQueueMode
} from './queue';

const LAUNCH_CONCURRENCY = Number(process.env.LAUNCH_CONCURRENCY ?? 1);
const useInlineQueue = isInlineQueueMode();

type LaunchJob = { type: 'start' | 'stop'; launchId: string };

function log(message: string, meta?: Record<string, unknown>) {
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[launch-worker] ${message}${payload}`);
}

async function runInlineLaunchLoop() {
  log('Starting inline launch loop');
  let running = true;

  const poll = async () => {
    if (!running) {
      return;
    }
    try {
      while (running) {
        const launchToStop: LaunchRecord | null = await takeNextLaunchToStop();
        if (!launchToStop) {
          break;
        }
        await runLaunchStop(launchToStop.id);
      }
      while (running) {
        const launchToStart: LaunchRecord | null = await takeNextLaunchToStart();
        if (!launchToStart) {
          break;
        }
        await runLaunchStart(launchToStart.id);
      }
    } catch (err) {
      log('Inline launch error', { error: (err as Error).message });
    }
  };

  const interval = setInterval(() => {
    void poll();
  }, 500);

  void poll();

  const shutdown = async () => {
    running = false;
    clearInterval(interval);
    log('Shutdown signal received');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function runQueuedLaunchWorker() {
  log('Starting queued launch worker', {
    queue: LAUNCH_QUEUE_NAME,
    concurrency: LAUNCH_CONCURRENCY
  });

  const connection = getQueueConnection();
  const worker = new Worker(
    LAUNCH_QUEUE_NAME,
    async (job) => {
      const data = job.data as LaunchJob;
      if (data.type === 'stop') {
        await runLaunchStop(data.launchId);
        return;
      }
      await runLaunchStart(data.launchId);
    },
    {
      connection,
      concurrency: LAUNCH_CONCURRENCY
    }
  );

  worker.on('failed', (job, err) => {
    log('Launch job failed', {
      jobId: job?.id ?? 'unknown',
      error: err?.message ?? 'unknown'
    });
  });

  worker.on('completed', (job) => {
    log('Launch job completed', { jobId: job.id });
  });

  await worker.waitUntilReady();
  log('Launch worker ready');

  const shutdown = async () => {
    log('Shutdown signal received');
    await worker.close();
    try {
      await closeQueueConnection(connection);
    } catch (err) {
      log('Error closing Redis connection', { error: (err as Error).message });
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main() {
  if (useInlineQueue) {
    await runInlineLaunchLoop();
    return;
  }
  await runQueuedLaunchWorker();
}

main().catch((err) => {
  console.error('[launch-worker] Worker crashed', err);
  process.exit(1);
});

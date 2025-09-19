import { Worker } from 'bullmq';
import { runBuildJob } from './buildRunner';
import { takeNextPendingBuild, type BuildRecord } from './db';
import { BUILD_QUEUE_NAME, getQueueConnection, isInlineQueueMode } from './queue';

const BUILD_CONCURRENCY = Number(process.env.BUILD_CONCURRENCY ?? 1);
const useInlineQueue = isInlineQueueMode();

function log(message: string, meta?: Record<string, unknown>) {
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[build-worker] ${message}${payload}`);
}

async function runInlineBuildLoop() {
  log('Starting inline build loop');
  let running = true;

  const poll = async () => {
    try {
      let build: BuildRecord | null;
      while (running && (build = takeNextPendingBuild())) {
        await runBuildJob(build.id);
      }
    } catch (err) {
      log('Inline build error', { error: (err as Error).message });
    }
  };

  const interval = setInterval(() => {
    if (!running) {
      return;
    }
    void poll();
  }, 250);

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

async function runQueuedBuildWorker() {
  log('Starting queued build worker', {
    queue: BUILD_QUEUE_NAME,
    concurrency: BUILD_CONCURRENCY
  });

  const connection = getQueueConnection();
  const worker = new Worker(
    BUILD_QUEUE_NAME,
    async (job) => {
      const { buildId } = job.data as { buildId: string };
      log('Build job received', { jobId: job.id, buildId });
      await runBuildJob(buildId);
    },
    {
      connection,
      concurrency: BUILD_CONCURRENCY
    }
  );

  worker.on('failed', (job, err) => {
    log('Build job failed', {
      jobId: job?.id ?? 'unknown',
      error: err?.message ?? 'unknown'
    });
  });

  worker.on('completed', (job) => {
    log('Build job completed', { jobId: job.id });
  });

  await worker.waitUntilReady();
  log('Build worker ready');

  const shutdown = async () => {
    log('Shutdown signal received');
    await worker.close();
    try {
      await connection.quit();
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
    await runInlineBuildLoop();
    return;
  }
  await runQueuedBuildWorker();
}

main().catch((err) => {
  console.error('[build-worker] Worker crashed', err);
  process.exit(1);
});

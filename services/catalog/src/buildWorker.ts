import { Worker } from 'bullmq';
import './buildRunner';
import { takeNextPendingBuild, type BuildRecord, type JsonValue } from './db/index';
import {
  BUILD_QUEUE_NAME,
  closeQueueConnection,
  getQueueConnection,
  isInlineQueueMode
} from './queue';
import { createJobRunForSlug, executeJobRun } from './jobs/runtime';
import { checkKubectlDiagnostics } from './kubernetes/toolingDiagnostics';

const BUILD_CONCURRENCY = Number(process.env.BUILD_CONCURRENCY ?? 1);
const useInlineQueue = isInlineQueueMode();

function log(message: string, meta?: Record<string, unknown>) {
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[build-worker] ${message}${payload}`);
}

async function reportKubectlStatus() {
  try {
    const diagnostics = await checkKubectlDiagnostics();
    if (diagnostics.status === 'ok') {
      log('kubectl client detected', {
        version: diagnostics.version ?? 'unknown'
      });
    } else {
      log('kubectl unavailable', {
        error: diagnostics.error ?? 'unknown',
        exitCode: diagnostics.result.exitCode
      });
      if (process.env.APPHUB_K8S_REQUIRE_TOOLING === '1') {
        throw new Error(diagnostics.error ?? 'kubectl required but unavailable');
      }
    }
    for (const warning of diagnostics.warnings) {
      log('kubectl warning', { warning });
    }
  } catch (err) {
    log('kubectl diagnostics failed', { error: (err as Error).message });
    if (process.env.APPHUB_K8S_REQUIRE_TOOLING === '1') {
      throw err;
    }
  }
}

async function runInlineBuildLoop() {
  log('Starting inline build loop');
  let running = true;

  const poll = async () => {
    try {
      while (running) {
        const build: BuildRecord | null = await takeNextPendingBuild();
        if (!build) {
          break;
        }
        const run = await createJobRunForSlug('repository-build', {
          parameters: { buildId: build.id, repositoryId: build.repositoryId }
        });
        log('Executing inline build run', { buildId: build.id, jobRunId: run.id });
        await executeJobRun(run.id);
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
      const { buildId, repositoryId, jobRunId } = job.data as {
        buildId: string;
        repositoryId?: string;
        jobRunId?: string;
      };
      let targetRunId = jobRunId;
      if (!targetRunId) {
        const parameters: Record<string, JsonValue> = { buildId };
        if (repositoryId) {
          parameters.repositoryId = repositoryId;
        }
        const run = await createJobRunForSlug('repository-build', { parameters });
        targetRunId = run.id;
      }
      log('Build job received', { jobId: job.id, buildId, jobRunId: targetRunId });
      await executeJobRun(targetRunId);
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
  await reportKubectlStatus();
  if (useInlineQueue) {
    await runInlineBuildLoop();
    return;
  }
  await runQueuedBuildWorker();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[build-worker] Worker crashed', err);
    process.exit(1);
  });
}

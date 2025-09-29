import { getRepositoryById, setRepositoryStatus, takeNextPendingRepository, type JsonValue } from './db/index';
import {
  INGEST_QUEUE_NAME,
  closeQueueConnection,
  getQueueConnection,
  isInlineQueueMode
} from './queue';
import {
  createJobRunForSlug,
  executeJobRun,
  registerJobHandler,
  type JobRunContext,
  type JobResult
} from './jobs/runtime';
import { IngestionPipelineError, processRepository } from './ingestion';
import { log } from './ingestion/logger';
import { createRuntimeScalingWorkerAgent } from './runtimeScaling/workerAgent';
import { getRuntimeScalingTarget, type RuntimeScalingTargetKey } from './runtimeScaling/targets';
import type { RuntimeScalingSnapshot } from './runtimeScaling/policies';
import { setRuntimeScalingSnapshot } from './runtimeScaling/state';

const useInlineQueue = isInlineQueueMode();
const INGEST_SCALING_TARGET: RuntimeScalingTargetKey = 'catalog:ingest';
const INGEST_SCALING_CONFIG = getRuntimeScalingTarget(INGEST_SCALING_TARGET);

async function runIngestionJobTask(
  repositoryId: string,
  jobContext?: JobRunContext
): Promise<JobResult> {
  const trimmedId = repositoryId.trim();
  if (!trimmedId) {
    throw new Error('repositoryId parameter is required');
  }

  const repository = await getRepositoryById(trimmedId);
  if (!repository) {
    log('Repository missing for job', { repositoryId: trimmedId });
    const metrics: Record<string, JsonValue> = {
      repositoryId: trimmedId,
      status: 'skipped'
    };
    const contextPayload: Record<string, JsonValue> = {
      repositoryId: trimmedId,
      skipped: true
    };
    if (jobContext) {
      await jobContext.update({ metrics, context: contextPayload });
    }
    return {
      status: 'succeeded',
      result: {
        repositoryId: trimmedId,
        skipped: true
      },
      metrics
    };
  }

  const startedAt = Date.now();
  const nowIso = new Date().toISOString();

  await setRepositoryStatus(trimmedId, 'processing', {
    updatedAt: nowIso,
    ingestError: null,
    incrementAttempts: true,
    eventMessage: 'Ingestion started'
  });

  const refreshed = await getRepositoryById(trimmedId);

  try {
    const result = await processRepository(
      refreshed ?? {
        ...repository,
        ingestStatus: 'processing',
        ingestError: null,
        updatedAt: nowIso
      },
      { jobContext, inlineQueueMode: useInlineQueue }
    );

    const durationMs = Date.now() - startedAt;
    const stageMetrics = result.metrics.map((metric) => ({
      stage: metric.stage,
      durationMs: metric.durationMs
    }));

    const metrics: Record<string, JsonValue> = {
      repositoryId: trimmedId,
      status: 'succeeded',
      durationMs,
      stages: stageMetrics
    };
    if (result.commitSha) {
      metrics.commitSha = result.commitSha;
    }

    if (jobContext) {
      const contextPayload: Record<string, JsonValue> = {
        repositoryId: trimmedId,
        stages: stageMetrics
      };
      if (result.commitSha) {
        contextPayload.commitSha = result.commitSha;
      }
      await jobContext.update({ metrics, context: contextPayload });
    }

    return {
      status: 'succeeded',
      result: { repositoryId: trimmedId, commitSha: result.commitSha ?? null },
      metrics
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const isPipelineError = err instanceof IngestionPipelineError;
    const stageMetrics = isPipelineError
      ? err.stageMetrics.map((metric) => ({ stage: metric.stage, durationMs: metric.durationMs }))
      : [];

    if (jobContext) {
      const metrics: Record<string, JsonValue> = {
        repositoryId: trimmedId,
        status: 'failed',
        durationMs,
        stages: stageMetrics
      };
      if (isPipelineError && err.commitSha) {
        metrics.commitSha = err.commitSha;
      }
      const contextPayload: Record<string, JsonValue> = {
        repositoryId: trimmedId,
        error: (err as Error).message,
        stages: stageMetrics
      };
      if (isPipelineError && err.commitSha) {
        contextPayload.commitSha = err.commitSha;
      }
      await jobContext.update({ metrics, context: contextPayload });
    }

    throw err;
  }
}

function resolveRepositoryId(parameters: JsonValue): string {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new Error('repositoryId parameter is required');
  }
  const value = (parameters as Record<string, JsonValue>).repositoryId;
  if (typeof value !== 'string') {
    throw new Error('repositoryId parameter is required');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('repositoryId parameter is required');
  }
  return trimmed;
}

async function ingestionJobHandler(context: JobRunContext): Promise<JobResult> {
  const repositoryId = resolveRepositoryId(context.parameters);
  return runIngestionJobTask(repositoryId, context);
}

registerJobHandler('repository-ingest', ingestionJobHandler);

async function runWorker() {
  log('Starting ingestion worker', {
    queue: INGEST_QUEUE_NAME,
    concurrency: INGEST_SCALING_CONFIG.defaultConcurrency,
    mode: useInlineQueue ? 'inline' : 'redis'
  });

  const handleJob = async ({
    repositoryId,
    jobRunId
  }: {
    repositoryId: string;
    jobRunId?: string;
  }) => {
    const trimmedId = repositoryId.trim();
    if (!trimmedId) {
      log('Skipping ingestion job with empty repository id');
      return;
    }

    let targetRunId = jobRunId;
    if (!targetRunId) {
      const run = await createJobRunForSlug('repository-ingest', {
        parameters: { repositoryId: trimmedId }
      });
      targetRunId = run.id;
    }

    log('Executing ingestion job run', { repositoryId: trimmedId, jobRunId: targetRunId });

    try {
      await executeJobRun(targetRunId);
    } catch (err) {
      log('Ingestion job execution failed', {
        repositoryId: trimmedId,
        jobRunId: targetRunId,
        error: (err as Error).message ?? 'unknown error'
      });
      throw err;
    }
  };

  if (useInlineQueue) {
    let running = true;

    const poll = async () => {
      try {
        while (true) {
          const pending = await takeNextPendingRepository();
          if (!pending) {
            break;
          }
          await handleJob({ repositoryId: pending.id });
        }
      } catch (err) {
        log('Inline worker poll error', { error: (err as Error).message });
      }
    };

    const interval = setInterval(() => {
      if (!running) {
        return;
      }
      void poll();
    }, 200);

    void poll();

    log('Inline ingestion worker ready');

    const shutdown = async () => {
      running = false;
      clearInterval(interval);
      log('Shutdown signal received');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  const connection = getQueueConnection();
  const { Worker } = await import('bullmq');

  const initialConcurrency = Math.max(INGEST_SCALING_CONFIG.defaultConcurrency, 1);

  const worker = new Worker(
    INGEST_QUEUE_NAME,
    async (job) => {
      const { repositoryId, jobRunId } = job.data as {
        repositoryId: string;
        jobRunId?: string;
      };
      log('Job received', { repositoryId, jobRunId, jobId: job.id });
      await handleJob({ repositoryId, jobRunId });
    },
    {
      connection,
      concurrency: initialConcurrency
    }
  );

  worker.on('failed', (job, err) => {
    log('Worker job failed', {
      jobId: job?.id ?? 'unknown',
      error: err?.message ?? 'unknown'
    });
  });

  worker.on('completed', (job) => {
    log('Worker job completed', { jobId: job.id });
  });

  await worker.waitUntilReady();

  const scalingAgent = createRuntimeScalingWorkerAgent({
    target: INGEST_SCALING_TARGET,
    applyConcurrency: async (concurrency: number, snapshot: RuntimeScalingSnapshot) => {
      if (concurrency <= 0) {
        await worker.pause(true).catch((err) => {
          log('Failed to pause ingestion worker during scaling', { error: (err as Error).message });
        });
        worker.concurrency = 1;
        log('Applied runtime scaling update', {
          target: snapshot.target,
          concurrency: 0,
          reason: snapshot.reason ?? undefined
        });
        return;
      }
      const next = Math.max(1, concurrency);
      worker.concurrency = next;
      if (worker.isPaused()) {
        worker.resume();
      }
      log('Applied runtime scaling update', {
        target: snapshot.target,
        concurrency: next,
        reason: snapshot.reason ?? undefined
      });
    },
    getCurrentConcurrency: () => worker.concurrency,
    onSnapshotApplied: (snapshot: RuntimeScalingSnapshot) => {
      setRuntimeScalingSnapshot(snapshot);
      log('Runtime scaling snapshot applied', {
        target: snapshot.target,
        effectiveConcurrency: snapshot.effectiveConcurrency,
        desiredConcurrency: snapshot.desiredConcurrency,
        source: snapshot.source
      });
    }
  });

  await scalingAgent.start();
  log('Ingestion worker ready');

  const shutdown = async () => {
    log('Shutdown signal received');
    await scalingAgent.stop().catch((err) => {
      log('Error stopping runtime scaling agent', { error: (err as Error).message });
    });
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

if (require.main === module) {
  runWorker().catch((err) => {
    console.error('[ingest] Worker crashed', err);
    process.exit(1);
  });
}

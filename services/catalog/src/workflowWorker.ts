import { Worker } from 'bullmq';
import { runWorkflowOrchestration } from './workflowOrchestrator';
import {
  WORKFLOW_QUEUE_NAME,
  WORKFLOW_RETRY_JOB_NAME,
  getQueueConnection,
  closeQueueConnection,
  isInlineQueueMode,
  enqueueWorkflowRun,
  scheduleWorkflowRetryJob,
  type WorkflowRetryJobData
} from './queue';
import { logger } from './observability/logger';
import { normalizeMeta } from './observability/meta';
import { startWorkflowScheduler } from './workflowScheduler';
import {
  findStaleWorkflowRunSteps,
  getWorkflowRunStepById,
  getWorkflowRunById,
  getWorkflowDefinitionById,
  appendWorkflowExecutionHistory,
  updateWorkflowRunStep,
  listScheduledWorkflowRunSteps,
  type WorkflowStaleStepRef
} from './db/workflows';
import {
  type WorkflowRunStepRecord,
  type WorkflowDefinitionRecord,
  type WorkflowRunRecord,
  type WorkflowStepDefinition,
  type JsonValue
} from './db/types';
import { createRuntimeScalingWorkerAgent } from './runtimeScaling/workerAgent';
import { getRuntimeScalingTarget, type RuntimeScalingTargetKey } from './runtimeScaling/targets';
import type { RuntimeScalingSnapshot } from './runtimeScaling/policies';
import { setRuntimeScalingSnapshot } from './runtimeScaling/state';

const useInlineQueue = isInlineQueueMode();
const WORKFLOW_SCALING_TARGET: RuntimeScalingTargetKey = 'catalog:workflow';
const WORKFLOW_SCALING_CONFIG = getRuntimeScalingTarget(WORKFLOW_SCALING_TARGET);

const HEARTBEAT_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.WORKFLOW_HEARTBEAT_TIMEOUT_MS ?? 60_000)
);

const HEARTBEAT_CHECK_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.WORKFLOW_HEARTBEAT_CHECK_INTERVAL_MS ?? 15_000)
);

const HEARTBEAT_BATCH_LIMIT = Math.max(
  1,
  Number(process.env.WORKFLOW_HEARTBEAT_CHECK_BATCH ?? 20)
);

const WORKFLOW_RETRY_RECONCILIATION_INTERVAL_MS = Math.max(
  10_000,
  Number(process.env.WORKFLOW_RETRY_RECONCILIATION_INTERVAL_MS ?? 30_000)
);

const WORKFLOW_RETRY_RECONCILIATION_BATCH = Math.max(
  10,
  Number(process.env.WORKFLOW_RETRY_RECONCILIATION_BATCH ?? 200)
);

type HeartbeatMonitor = {
  stop: () => Promise<void>;
};

type RetryReconciler = {
  stop: () => Promise<void>;
};

function log(message: string, meta?: Record<string, unknown>) {
  const payload = normalizeMeta(meta);
  logger.info(message, payload);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function reconcileScheduledWorkflowRetries(batchSize = WORKFLOW_RETRY_RECONCILIATION_BATCH) {
  if (useInlineQueue) {
    return;
  }

  const scheduledSteps = await listScheduledWorkflowRunSteps(batchSize);
  if (scheduledSteps.length === 0) {
    return;
  }

  let reconciled = 0;

  const runKeyCache = new Map<string, string | null>();

  for (const step of scheduledSteps) {
    if (step.retryState !== 'scheduled') {
      continue;
    }
    const stepId = step.stepId ?? null;
    const runAt = step.nextAttemptAt ?? new Date().toISOString();
    const attempt = Math.max(step.retryAttempts ?? 1, 1);
    try {
      let runKey: string | null | undefined = runKeyCache.get(step.workflowRunId);
      if (runKey === undefined) {
        const runRecord = await getWorkflowRunById(step.workflowRunId);
        runKey = runRecord?.runKey ?? null;
        runKeyCache.set(step.workflowRunId, runKey);
      }
      await scheduleWorkflowRetryJob(step.workflowRunId, stepId, runAt, attempt, {
        runKey: runKey ?? null
      });
      reconciled += 1;
    } catch (err) {
      logger.error('Failed to reconcile workflow retry scheduling', {
        workflowRunId: step.workflowRunId,
        stepId: stepId ?? 'run',
        error: err instanceof Error ? err.message : 'unknown'
      });
    }
  }

  if (reconciled > 0) {
    log('Reconciled scheduled workflow retries', { count: reconciled });
  }
}

function startRetryReconciler(): RetryReconciler {
  if (useInlineQueue) {
    return {
      stop: async () => {
        // inline mode has no queue to reconcile
      }
    } satisfies RetryReconciler;
  }

  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      try {
        await reconcileScheduledWorkflowRetries();
      } catch (err) {
        logger.error('Workflow retry reconciliation failed', {
          error: err instanceof Error ? err.message : 'unknown'
        });
      }
      await sleep(WORKFLOW_RETRY_RECONCILIATION_INTERVAL_MS);
    }
  })();

  return {
    stop: async () => {
      stopped = true;
      await loop;
    }
  } satisfies RetryReconciler;
}

function resolveStepDefinition(
  definition: WorkflowDefinitionRecord,
  stepRecord: WorkflowRunStepRecord
): WorkflowStepDefinition | null {
  const steps = definition.steps ?? [];
  let resolved = steps.find((entry) => entry.id === stepRecord.stepId);
  if (resolved) {
    if (resolved.type === 'fanout' && stepRecord.templateStepId && resolved.template) {
      const template = resolved.template;
      if (template.id === stepRecord.templateStepId) {
        return template;
      }
    }
    return resolved;
  }

  if (stepRecord.parentStepId) {
    const parent = steps.find((entry) => entry.id === stepRecord.parentStepId);
    if (parent && parent.type === 'fanout') {
      const template = parent.template;
      if (template && template.id === stepRecord.templateStepId) {
        return template;
      }
    }
  }

  if (stepRecord.templateStepId) {
    const template = steps.find((entry) => entry.id === stepRecord.templateStepId);
    if (template) {
      return template;
    }
  }

  return null;
}

function extractMaxAttempts(policy: { maxAttempts?: unknown } | null | undefined): number | null {
  if (!policy || policy.maxAttempts === undefined || policy.maxAttempts === null) {
    return null;
  }
  const parsed = Number(policy.maxAttempts);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return Math.floor(parsed);
}

function getMaxAttempts(stepDefinition: WorkflowStepDefinition | null): number {
  if (!stepDefinition) {
    return Number.POSITIVE_INFINITY;
  }
  if (stepDefinition.type === 'fanout') {
    const template = stepDefinition.template;
    const templateAttempts = extractMaxAttempts(template?.retryPolicy ?? null);
    if (templateAttempts !== null) {
      return templateAttempts;
    }
  } else {
    const stepAttempts = extractMaxAttempts(stepDefinition.retryPolicy ?? null);
    if (stepAttempts !== null) {
      return stepAttempts;
    }
  }
  return Number.POSITIVE_INFINITY;
}

async function handleStaleStep(
  ref: WorkflowStaleStepRef,
  cutoffIso: string
): Promise<void> {
  const stepRecord = await getWorkflowRunStepById(ref.workflowRunStepId);
  if (!stepRecord || stepRecord.status !== 'running') {
    return;
  }

  const run = await getWorkflowRunById(ref.workflowRunId);
  if (!run || run.status !== 'running') {
    return;
  }

  const cutoffTime = Date.parse(cutoffIso);
  const lastHeartbeatTime = stepRecord.lastHeartbeatAt
    ? Date.parse(stepRecord.lastHeartbeatAt)
    : null;
  const startedTime = stepRecord.startedAt ? Date.parse(stepRecord.startedAt) : null;

  if (!Number.isNaN(lastHeartbeatTime ?? NaN) && lastHeartbeatTime !== null && lastHeartbeatTime >= cutoffTime) {
    return;
  }
  if (
    lastHeartbeatTime === null &&
    startedTime !== null &&
    !Number.isNaN(startedTime) &&
    startedTime >= cutoffTime
  ) {
    return;
  }

  const definition = await getWorkflowDefinitionById(run.workflowDefinitionId);
  const definitionStep = definition ? resolveStepDefinition(definition, stepRecord) : null;
  const maxAttempts = Math.max(1, getMaxAttempts(definitionStep));
  const nextRetryCount = stepRecord.retryCount + 1;
  const nowIso = new Date().toISOString();

  let updatedStep = stepRecord;
  let action: 'retry' | 'failed' = 'failed';
  let nextAttempt = stepRecord.attempt;

  try {
    if (nextRetryCount < maxAttempts) {
      const pendingUpdate = {
        status: 'pending' as const,
        attempt: stepRecord.attempt + 1,
        retryCount: nextRetryCount,
        errorMessage: 'Step heartbeat timeout - retry scheduled',
        failureReason: 'heartbeat-timeout',
        jobRunId: null,
        startedAt: null,
        completedAt: null,
        lastHeartbeatAt: null
      };
      updatedStep = (await updateWorkflowRunStep(stepRecord.id, pendingUpdate)) ?? stepRecord;
      action = 'retry';
      nextAttempt = pendingUpdate.attempt;
    } else {
      const failedUpdate = {
        status: 'failed' as const,
        retryCount: nextRetryCount,
        errorMessage: 'Step heartbeat timeout',
        failureReason: 'heartbeat-timeout',
        completedAt: nowIso,
        jobRunId: null,
        lastHeartbeatAt: nowIso
      };
      updatedStep = (await updateWorkflowRunStep(stepRecord.id, failedUpdate)) ?? stepRecord;
      action = 'failed';
    }
  } catch (err) {
    logger.error('Failed to update stale workflow step', {
      workflowRunId: ref.workflowRunId,
      workflowRunStepId: ref.workflowRunStepId,
      error: err instanceof Error ? err.message : 'unknown'
    });
    return;
  }

  try {
    await appendWorkflowExecutionHistory({
      workflowRunId: run.id,
      workflowRunStepId: updatedStep.id,
      stepId: updatedStep.stepId,
      eventType: 'step.timeout',
      eventPayload: {
        heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
        previousAttempt: stepRecord.attempt,
        attempt: nextAttempt,
        retryCount: updatedStep.retryCount,
        maxAttempts,
        action,
        lastHeartbeatAt: stepRecord.lastHeartbeatAt ?? null,
        failureReason: 'heartbeat-timeout'
      } satisfies Record<string, JsonValue>
    });

    await appendWorkflowExecutionHistory({
      workflowRunId: run.id,
      eventType: 'run.reschedule',
      eventPayload: {
        reason: 'step-timeout',
        stepId: updatedStep.stepId,
        action
      } satisfies Record<string, JsonValue>
    });
  } catch (err) {
    logger.error('Failed to append heartbeat timeout history', {
      workflowRunId: run.id,
      workflowRunStepId: updatedStep.id,
      error: err instanceof Error ? err.message : 'unknown'
    });
  }

  try {
    await enqueueWorkflowRun(run.id, { runKey: run.runKey ?? null });
    logger.warn('Requeued workflow run after heartbeat timeout', {
      workflowRunId: run.id,
      workflowRunStepId: updatedStep.id,
      stepId: updatedStep.stepId,
      action
    });
  } catch (err) {
    logger.error('Failed to enqueue workflow run for recovery', {
      workflowRunId: run.id,
      workflowRunStepId: updatedStep.id,
      error: err instanceof Error ? err.message : 'unknown'
    });
  }
}

async function checkStaleWorkflowSteps(): Promise<void> {
  const cutoffIso = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS).toISOString();
  const staleRefs = await findStaleWorkflowRunSteps(cutoffIso, HEARTBEAT_BATCH_LIMIT);
  if (staleRefs.length === 0) {
    return;
  }
  const processed = new Set<string>();
  for (const ref of staleRefs) {
    if (processed.has(ref.workflowRunStepId)) {
      continue;
    }
    await handleStaleStep(ref, cutoffIso);
    processed.add(ref.workflowRunStepId);
  }
}

function startHeartbeatMonitor(): HeartbeatMonitor {
  if (HEARTBEAT_TIMEOUT_MS <= 0) {
    return {
      stop: async () => {
        // no-op
      }
    } satisfies HeartbeatMonitor;
  }

  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      try {
        await checkStaleWorkflowSteps();
      } catch (err) {
        logger.error('Heartbeat monitor failed', {
          error: err instanceof Error ? err.message : 'unknown'
        });
      }
      await sleep(HEARTBEAT_CHECK_INTERVAL_MS);
    }
  })();

  return {
    stop: async () => {
      stopped = true;
      await loop;
    }
  } satisfies HeartbeatMonitor;
}

async function runInlineMode() {
  log('Inline workflow mode detected; scheduler will run without queue worker. Workflow runs execute synchronously.');
  const scheduler = startWorkflowScheduler();

  const shutdown = async () => {
    log('Shutdown signal received');
    await scheduler.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });

  await new Promise(() => {
    // Keep process alive until terminated.
  });
}

async function runQueueWorker() {
  const scheduler = startWorkflowScheduler();
  const connection = getQueueConnection();
  const heartbeatMonitor = startHeartbeatMonitor();
  let retryReconciler: RetryReconciler | null = null;
  const initialConcurrency = Math.max(WORKFLOW_SCALING_CONFIG.defaultConcurrency, 1);
  const worker = new Worker(
    WORKFLOW_QUEUE_NAME,
    async (job) => {
      if (job.name === WORKFLOW_RETRY_JOB_NAME || (job.data as WorkflowRetryJobData)?.retryKind === 'workflow') {
        const data = job.data as WorkflowRetryJobData;
        if (!data.workflowRunId || typeof data.workflowRunId !== 'string') {
          throw new Error('workflowRunId is required');
        }
        log('Processing workflow retry', {
          jobId: job.id ?? 'unknown',
          workflowRunId: data.workflowRunId,
          stepId: data.stepId ?? null,
          runKey: data.runKey ?? null
        });
        await runWorkflowOrchestration(data.workflowRunId);
        return;
      }

      const { workflowRunId, runKey } = job.data as { workflowRunId?: string; runKey?: string | null };
      if (!workflowRunId || typeof workflowRunId !== 'string') {
        throw new Error('workflowRunId is required');
      }
      log('Processing workflow run', {
        jobId: job.id ?? 'unknown',
        workflowRunId,
        runKey: runKey ?? null
      });
      await runWorkflowOrchestration(workflowRunId);
    },
    {
      connection,
      concurrency: initialConcurrency
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

  let scalingAgent: ReturnType<typeof createRuntimeScalingWorkerAgent> | null = null;

  try {
    await worker.waitUntilReady();
    scalingAgent = createRuntimeScalingWorkerAgent({
      target: WORKFLOW_SCALING_TARGET,
      applyConcurrency: async (concurrency: number, snapshot: RuntimeScalingSnapshot) => {
        if (concurrency <= 0) {
          if (!worker.isPaused()) {
            await worker.pause(true).catch((error) => {
              log('Failed to pause workflow worker during scaling', {
                error: (error as Error).message
              });
            });
          }
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

    log('Workflow worker ready', {
      queue: WORKFLOW_QUEUE_NAME,
      concurrency: WORKFLOW_SCALING_CONFIG.defaultConcurrency
    });
    await reconcileScheduledWorkflowRetries();
    retryReconciler = startRetryReconciler();
  } catch (err) {
    if (scalingAgent) {
      await scalingAgent.stop().catch(() => undefined);
    }
    await heartbeatMonitor.stop();
    await scheduler.stop();
    throw err;
  }

  const shutdown = async () => {
    log('Shutdown signal received');
    if (scalingAgent) {
      await scalingAgent.stop().catch((error) => {
        log('Error stopping runtime scaling agent', { error: (error as Error).message });
      });
      scalingAgent = null;
    }
    await worker.close();
    if (retryReconciler) {
      await retryReconciler.stop();
    }
    await heartbeatMonitor.stop();
    await scheduler.stop();
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

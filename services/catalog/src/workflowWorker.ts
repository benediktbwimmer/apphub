import { Worker } from 'bullmq';
import { runWorkflowOrchestration } from './workflowOrchestrator';
import {
  WORKFLOW_QUEUE_NAME,
  getQueueConnection,
  closeQueueConnection,
  isInlineQueueMode,
  enqueueWorkflowRun
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
  type WorkflowStaleStepRef
} from './db/workflows';
import {
  type WorkflowRunStepRecord,
  type WorkflowDefinitionRecord,
  type WorkflowRunRecord,
  type WorkflowStepDefinition,
  type JsonValue
} from './db/types';

const WORKFLOW_CONCURRENCY = Number(process.env.WORKFLOW_CONCURRENCY ?? 1);
const useInlineQueue = isInlineQueueMode();

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

type HeartbeatMonitor = {
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

function getMaxAttempts(stepDefinition: WorkflowStepDefinition | null): number {
  if (!stepDefinition) {
    return 1;
  }
  if (stepDefinition.type === 'fanout') {
    const template = stepDefinition.template;
    if (template && template.retryPolicy && typeof template.retryPolicy.maxAttempts === 'number') {
      return template.retryPolicy.maxAttempts;
    }
    return 1;
  }
  if (stepDefinition.retryPolicy && typeof stepDefinition.retryPolicy.maxAttempts === 'number') {
    return stepDefinition.retryPolicy.maxAttempts;
  }
  return 1;
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
    await enqueueWorkflowRun(run.id);
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
  const worker = new Worker(
    WORKFLOW_QUEUE_NAME,
    async (job) => {
      const { workflowRunId } = job.data as { workflowRunId?: string };
      if (!workflowRunId || typeof workflowRunId !== 'string') {
        throw new Error('workflowRunId is required');
      }
      log('Processing workflow run', { jobId: job.id ?? 'unknown', workflowRunId });
      await runWorkflowOrchestration(workflowRunId);
    },
    {
      connection,
      concurrency: WORKFLOW_CONCURRENCY
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

  try {
    await worker.waitUntilReady();
    log('Workflow worker ready', {
      queue: WORKFLOW_QUEUE_NAME,
      concurrency: WORKFLOW_CONCURRENCY
    });
  } catch (err) {
    await heartbeatMonitor.stop();
    await scheduler.stop();
    throw err;
  }

  const shutdown = async () => {
    log('Shutdown signal received');
    await worker.close();
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

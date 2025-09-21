import {
  createWorkflowRunStep,
  getWorkflowDefinitionById,
  getWorkflowRunById,
  getWorkflowRunStep,
  updateWorkflowRun,
  updateWorkflowRunStep
} from './db/workflows';
import {
  type JsonValue,
  type JobRunStatus,
  type WorkflowDefinitionRecord,
  type WorkflowRunRecord,
  type WorkflowRunStepRecord,
  type WorkflowRunStepStatus,
  type WorkflowStepDefinition
} from './db/types';
import { createJobRunForSlug, executeJobRun } from './jobs/runtime';

function log(message: string, meta?: Record<string, unknown>) {
  const suffix = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[workflow] ${message}${suffix}`);
}

type WorkflowStepRuntimeContext = {
  status: WorkflowRunStepStatus;
  jobRunId: string | null;
  result?: JsonValue | null;
  errorMessage?: string | null;
  logsUrl?: string | null;
  metrics?: JsonValue | null;
  startedAt?: string | null;
  completedAt?: string | null;
  attempt?: number;
};

type WorkflowRuntimeContext = {
  steps: Record<string, WorkflowStepRuntimeContext>;
  lastUpdatedAt: string;
};

const loadedHandlers = new Set<string>();

async function ensureJobHandler(slug: string): Promise<void> {
  if (loadedHandlers.has(slug)) {
    return;
  }
  switch (slug) {
    case 'repository-ingest':
      await import('./ingestionWorker');
      loadedHandlers.add(slug);
      break;
    case 'repository-build':
      await import('./buildRunner');
      loadedHandlers.add(slug);
      break;
    default:
      loadedHandlers.add(slug);
  }
}

function isJsonObject(value: JsonValue | null | undefined): value is Record<string, JsonValue> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toWorkflowContext(raw: JsonValue | null | undefined): WorkflowRuntimeContext {
  if (isJsonObject(raw)) {
    const stepsValue = raw.steps;
    const steps: Record<string, WorkflowStepRuntimeContext> = {};
    if (isJsonObject(stepsValue)) {
      for (const [key, entry] of Object.entries(stepsValue)) {
        if (!isJsonObject(entry)) {
          continue;
        }
        const normalized: WorkflowStepRuntimeContext = {
          status: (typeof entry.status === 'string' ? (entry.status as WorkflowRunStepStatus) : 'pending') ?? 'pending',
          jobRunId: typeof entry.jobRunId === 'string' ? entry.jobRunId : null,
          result: (entry.result as JsonValue | null | undefined) ?? null,
          errorMessage: typeof entry.errorMessage === 'string' ? entry.errorMessage : null,
          logsUrl: typeof entry.logsUrl === 'string' ? entry.logsUrl : null,
          metrics: (entry.metrics as JsonValue | null | undefined) ?? null,
          startedAt: typeof entry.startedAt === 'string' ? entry.startedAt : null,
          completedAt: typeof entry.completedAt === 'string' ? entry.completedAt : null,
          attempt: typeof entry.attempt === 'number' ? entry.attempt : undefined
        };
        steps[key] = normalized;
      }
    }
    return {
      steps,
      lastUpdatedAt: typeof raw.lastUpdatedAt === 'string' ? raw.lastUpdatedAt : new Date().toISOString()
    };
  }
  return {
    steps: {},
    lastUpdatedAt: new Date().toISOString()
  };
}

function serializeContext(context: WorkflowRuntimeContext): JsonValue {
  return {
    steps: context.steps,
    lastUpdatedAt: context.lastUpdatedAt
  } as unknown as JsonValue;
}

function updateStepContext(
  context: WorkflowRuntimeContext,
  stepId: string,
  patch: Partial<WorkflowStepRuntimeContext>
): WorkflowRuntimeContext {
  const next: WorkflowRuntimeContext = {
    steps: { ...context.steps },
    lastUpdatedAt: new Date().toISOString()
  };
  const previous = next.steps[stepId] ?? { status: 'pending', jobRunId: null };
  next.steps[stepId] = {
    ...previous,
    ...patch
  };
  return next;
}

function mergeParameters(
  runParameters: JsonValue,
  stepParameters: JsonValue | null | undefined
): JsonValue {
  const runIsObject = isJsonObject(runParameters);
  const stepIsObject = isJsonObject(stepParameters);

  if (runIsObject || stepIsObject) {
    const base: Record<string, JsonValue> = runIsObject ? { ...runParameters } : {};
    if (stepIsObject) {
      for (const [key, value] of Object.entries(stepParameters as Record<string, JsonValue>)) {
        base[key] = value;
      }
    }
    return base as JsonValue;
  }

  if (stepParameters !== undefined && stepParameters !== null) {
    return stepParameters;
  }

  return runParameters;
}

function jobStatusToStepStatus(status: JobRunStatus): WorkflowRunStepStatus {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'skipped';
    case 'expired':
      return 'failed';
    case 'running':
    case 'pending':
    default:
      return 'running';
  }
}

async function ensureRunIsStartable(run: WorkflowRunRecord, steps: WorkflowStepDefinition[]) {
  if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'canceled') {
    return run;
  }
  if (run.status === 'running' && run.startedAt) {
    return run;
  }
  const startedAt = run.startedAt ?? new Date().toISOString();
  const metrics = { totalSteps: steps.length, completedSteps: 0 } as JsonValue;
  const updated = await updateWorkflowRun(run.id, {
    status: 'running',
    startedAt,
    metrics
  });
  if (updated) {
    return updated;
  }
  return (await getWorkflowRunById(run.id)) ?? run;
}

async function recordRunFailure(
  runId: string,
  errorMessage: string,
  context: WorkflowRuntimeContext,
  totals: { totalSteps: number; completedSteps: number },
  startedAt: number
) {
  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startedAt;
  await updateWorkflowRun(runId, {
    status: 'failed',
    errorMessage,
    context: serializeContext(context),
    completedAt,
    durationMs,
    metrics: { totalSteps: totals.totalSteps, completedSteps: totals.completedSteps }
  });
}

async function recordRunSuccess(
  runId: string,
  context: WorkflowRuntimeContext,
  totals: { totalSteps: number; completedSteps: number },
  startedAt: number
) {
  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startedAt;
  await updateWorkflowRun(runId, {
    status: 'succeeded',
    context: serializeContext(context),
    completedAt,
    durationMs,
    metrics: { totalSteps: totals.totalSteps, completedSteps: totals.completedSteps }
  });
}

async function loadOrCreateStepRecord(
  runId: string,
  step: WorkflowStepDefinition,
  inputParameters: JsonValue
): Promise<WorkflowRunStepRecord> {
  const existing = await getWorkflowRunStep(runId, step.id);
  if (existing) {
    if (existing.status === 'pending' || existing.status === 'running') {
      return existing;
    }
    if (existing.status === 'succeeded') {
      return existing;
    }
    if (existing.status === 'failed' || existing.status === 'skipped') {
      return existing;
    }
  }
  return createWorkflowRunStep(runId, {
    stepId: step.id,
    status: 'running',
    input: inputParameters,
    startedAt: new Date().toISOString()
  });
}

async function executeStep(
  run: WorkflowRunRecord,
  step: WorkflowStepDefinition,
  context: WorkflowRuntimeContext,
  stepIndex: number,
  totals: { totalSteps: number; completedSteps: number }
): Promise<{ context: WorkflowRuntimeContext; stepStatus: WorkflowRunStepStatus; completed: boolean }> {
  const dependencies = step.dependsOn ?? [];
  const blocked = dependencies.filter((dependencyId) => {
    const summary = context.steps[dependencyId];
    return !summary || summary.status !== 'succeeded';
  });
  if (blocked.length > 0) {
    throw new Error(
      `Step ${step.id} is blocked by incomplete dependencies: ${blocked.join(', ')}`
    );
  }

  const parameters = mergeParameters(run.parameters, step.parameters ?? null);
  let stepRecord = await loadOrCreateStepRecord(run.id, step, parameters);

  if (stepRecord.status === 'succeeded') {
    totals.completedSteps += 1;
    const nextContext = updateStepContext(context, step.id, {
      status: stepRecord.status,
      jobRunId: stepRecord.jobRunId,
      result: stepRecord.output,
      errorMessage: stepRecord.errorMessage,
      logsUrl: stepRecord.logsUrl,
      metrics: stepRecord.metrics,
      startedAt: stepRecord.startedAt,
      completedAt: stepRecord.completedAt,
      attempt: stepRecord.attempt
    });
    return { context: nextContext, stepStatus: 'succeeded', completed: true };
  }

  const startedAt = stepRecord.startedAt ?? new Date().toISOString();
  if (stepRecord.status !== 'running') {
    stepRecord =
      (await updateWorkflowRunStep(stepRecord.id, {
        status: 'running',
        startedAt,
        input: parameters
      })) ?? stepRecord;
  }

  let nextContext = updateStepContext(context, step.id, {
    status: 'running',
    jobRunId: stepRecord.jobRunId,
    startedAt,
    attempt: stepRecord.attempt,
    result: stepRecord.output ?? null,
    errorMessage: stepRecord.errorMessage ?? null,
    logsUrl: stepRecord.logsUrl ?? null,
    metrics: stepRecord.metrics ?? null,
    completedAt: stepRecord.completedAt ?? null
  });

  await updateWorkflowRun(run.id, {
    currentStepId: step.id,
    currentStepIndex: stepIndex,
    context: serializeContext(nextContext),
    metrics: { totalSteps: totals.totalSteps, completedSteps: totals.completedSteps }
  });

  await ensureJobHandler(step.jobSlug);

  const jobRun = await createJobRunForSlug(step.jobSlug, {
    parameters,
    timeoutMs: step.timeoutMs ?? null,
    maxAttempts: step.retryPolicy?.maxAttempts ?? null
  });

  await updateWorkflowRunStep(stepRecord.id, {
    jobRunId: jobRun.id
  });

  const executed = await executeJobRun(jobRun.id);
  if (!executed) {
    throw new Error(`Job run ${jobRun.id} not found after execution`);
  }

  const stepStatus = jobStatusToStepStatus(executed.status);
  const completedAt = executed.completedAt ?? new Date().toISOString();

  stepRecord =
    (await updateWorkflowRunStep(stepRecord.id, {
      status: stepStatus,
      output: executed.result ?? null,
      errorMessage: executed.errorMessage ?? null,
      logsUrl: executed.logsUrl ?? null,
      metrics: executed.metrics ?? null,
      context: executed.context ?? null,
      completedAt,
      startedAt: executed.startedAt ?? startedAt,
      jobRunId: executed.id
    })) ?? stepRecord;

  nextContext = updateStepContext(nextContext, step.id, {
    status: stepRecord.status,
    jobRunId: executed.id,
    result: executed.result ?? null,
    errorMessage: executed.errorMessage ?? null,
    logsUrl: executed.logsUrl ?? null,
    metrics: executed.metrics ?? null,
    startedAt: executed.startedAt ?? startedAt,
    completedAt
  });

  if (stepRecord.status === 'succeeded') {
    totals.completedSteps += 1;
    await updateWorkflowRun(run.id, {
      context: serializeContext(nextContext),
      metrics: { totalSteps: totals.totalSteps, completedSteps: totals.completedSteps }
    });
  }

  return { context: nextContext, stepStatus: stepRecord.status, completed: stepRecord.status === 'succeeded' };
}

export async function runWorkflowOrchestration(workflowRunId: string): Promise<WorkflowRunRecord | null> {
  const startTime = Date.now();
  let run = await getWorkflowRunById(workflowRunId);
  if (!run) {
    log('Workflow run missing', { workflowRunId });
    return null;
  }

  const definition: WorkflowDefinitionRecord | null = await getWorkflowDefinitionById(run.workflowDefinitionId);
  if (!definition) {
    log('Workflow definition missing for run', {
      workflowRunId,
      workflowDefinitionId: run.workflowDefinitionId
    });
    await recordRunFailure(run.id, 'Workflow definition missing', {
      steps: {},
      lastUpdatedAt: new Date().toISOString()
    }, { totalSteps: 0, completedSteps: 0 }, startTime);
    return await getWorkflowRunById(run.id);
  }

  const steps = definition.steps ?? [];
  if (steps.length === 0) {
    await recordRunSuccess(run.id, { steps: {}, lastUpdatedAt: new Date().toISOString() }, { totalSteps: 0, completedSteps: 0 }, startTime);
    return await getWorkflowRunById(run.id);
  }

  run = await ensureRunIsStartable(run, steps);
  let context = toWorkflowContext(run.context);
  const totals = { totalSteps: steps.length, completedSteps: Object.values(context.steps).filter((entry) => entry.status === 'succeeded').length };

  try {
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      const result = await executeStep(run, step, context, index, totals);
      context = result.context;
      if (result.stepStatus !== 'succeeded') {
        const errorMessage =
          result.stepStatus === 'skipped'
            ? `Step ${step.id} was skipped`
            : `Step ${step.id} failed`;
        await recordRunFailure(run.id, errorMessage, context, totals, startTime);
        return await getWorkflowRunById(run.id);
      }
    }

    await recordRunSuccess(run.id, context, totals, startTime);
    return await getWorkflowRunById(run.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Workflow orchestration failed';
    log('Workflow orchestration error', { workflowRunId, error: message });
    await recordRunFailure(run.id, message, context, totals, startTime);
    return await getWorkflowRunById(run.id);
  }
}

import type {
  JobRetryPolicy,
  JobRunRecord,
  JobRunStatus,
  JsonValue,
  SecretReference,
  ServiceRecord,
  WorkflowDefinitionRecord,
  WorkflowFanOutStepDefinition,
  WorkflowFanOutTemplateDefinition,
  WorkflowJobStepDefinition,
  WorkflowRunRecord,
  WorkflowRunStepAssetInput,
  WorkflowRunStepAssetRecord,
  WorkflowRunStepRecord,
  WorkflowRunStepStatus,
  WorkflowRunStepUpdateInput,
  WorkflowServiceStepDefinition,
  WorkflowStepDefinition,
  WorkflowAssetRecoveryRequestRecord
} from '../db/types';
import { WORKFLOW_BUNDLE_CONTEXT_KEY } from '../jobs/runtime';
import {
  calculateRetryDelay,
  computeWorkflowRetryTimestamp,
  resolveRetryAttemptLimit
} from './config';
import {
  extractProducedAssetsFromResult,
  parseRuntimeAssets,
  toRuntimeAssetSummaries
} from './assets';
import { getRecoveryPollDelayMs, type AssetRecoveryDescriptor, type RecoveryRequestOutcome } from './recovery/manager';
import { logger } from '../observability/logger';
import { recordAssetRecoveryCompleted, recordAssetRecoveryFailed } from '../observability/recoveryMetrics';
import {
  mergeParameters,
  resolveJsonTemplates,
  resolveTemplateString,
  setSharedValue,
  templateValueToString,
  updateStepContext,
  withStepScope,
  buildTemplateScope,
  type FanOutRuntimeMetadata,
  type TemplateScope,
  type WorkflowRuntimeContext,
  type WorkflowStepRuntimeContext,
  type WorkflowStepServiceContext,
  type TemplateResolutionIssue,
  type TemplateResolutionTracker
} from './context';

export type ScheduledRetryInfo = {
  stepId: string;
  runAt: string;
  attempts: number;
  reason: string;
};

export type FanOutChildStep = {
  definition: WorkflowStepDefinition;
  fanOut: FanOutRuntimeMetadata;
};

export type FanOutExpansion = {
  parentStepId: string;
  parentRunStepId: string;
  storeKey?: string;
  maxConcurrency: number;
  templateStepId: string;
  childSteps: FanOutChildStep[];
};

export type RuntimeStep = {
  definition: WorkflowStepDefinition;
  index: number;
  fanOut?: FanOutRuntimeMetadata;
};

export type StepExecutionResult = {
  context: WorkflowRuntimeContext;
  stepStatus: WorkflowRunStepStatus;
  completed: boolean;
  stepPatch: WorkflowStepRuntimeContext;
  sharedPatch?: Record<string, JsonValue | null>;
  errorMessage?: string | null;
  fanOut?: FanOutExpansion;
  scheduledRetry?: ScheduledRetryInfo;
};

export type StepExecutorDependencies = {
  loadOrCreateStepRecord: (
    runId: string,
    step: WorkflowStepDefinition,
    inputParameters: JsonValue,
    options?: {
      parentStepId?: string | null;
      fanoutIndex?: number | null;
      templateStepId?: string | null;
    }
  ) => Promise<WorkflowRunStepRecord>;
  applyStepUpdateWithHistory: (
    step: WorkflowRunStepRecord,
    updates: WorkflowRunStepUpdateInput,
    options?: {
      eventType?: string;
      eventPayload?: Record<string, JsonValue | null>;
      heartbeat?: boolean;
    }
  ) => Promise<WorkflowRunStepRecord>;
  recordStepHeartbeat: (step: WorkflowRunStepRecord) => Promise<WorkflowRunStepRecord>;
  applyRunContextPatch: (
    runId: string,
    stepId: string,
    patch: Partial<WorkflowStepRuntimeContext> | null,
    options?: {
      shared?: Record<string, JsonValue | null>;
      metrics?: { totalSteps: number; completedSteps: number };
      status?: WorkflowRunStepStatus;
      errorMessage?: string | null;
      currentStepId?: string | null;
      currentStepIndex?: number | null;
      startedAt?: string | null;
      completedAt?: string | null;
      durationMs?: number | null;
    }
  ) => Promise<void>;
  scheduleWorkflowRetryJob: (
    runId: string,
    stepId: string,
    runAt: string,
    attempts: number,
    options: { runKey: string | null }
  ) => Promise<void>;
  clearStepAssets: (options: { run: WorkflowRunRecord; stepId: string; stepRecordId: string }) => Promise<void>;
  persistStepAssets: (options: {
    definition: WorkflowDefinitionRecord;
    run: WorkflowRunRecord;
    stepId: string;
    stepRecordId: string;
    assets: WorkflowRunStepAssetInput[];
  }) => Promise<WorkflowRunStepAssetRecord[]>;
  resolveSecret: (
    ref: SecretReference,
    options: {
      actor: string;
      actorType: string;
      metadata?: Record<string, JsonValue | string | number | boolean | null>;
    }
  ) => { value: string | null };
  maskSecret: (value: string) => string;
  describeSecret: (ref: SecretReference) => string;
  createJobRunForSlug: (
    slug: string,
    input: {
      parameters?: JsonValue;
      timeoutMs?: number | null;
      maxAttempts?: number | null;
      context?: Record<string, JsonValue> | undefined;
    }
  ) => Promise<JobRunRecord>;
  executeJobRun: (runId: string) => Promise<JobRunRecord | null>;
  ensureJobHandler: (slug: string) => Promise<void>;
  getServiceBySlug: (slug: string) => Promise<ServiceRecord | null>;
  fetchFromService: (
    service: ServiceRecord,
    request: {
      method: string;
      path: string;
      headers: Headers;
      body?: string;
      signal?: AbortSignal;
    }
  ) => Promise<Response>;
  ensureWorkflowAssetRecovery: (options: {
    descriptor: AssetRecoveryDescriptor;
    failingDefinition: WorkflowDefinitionRecord;
    failingRun: WorkflowRunRecord;
    step: WorkflowStepDefinition;
    stepRecord: WorkflowRunStepRecord;
  }) => Promise<RecoveryRequestOutcome | null>;
  getAssetRecoveryRequestById: (id: string) => Promise<WorkflowAssetRecoveryRequestRecord | null>;
};

export function createStepExecutor(deps: StepExecutorDependencies) {
  return async function executeStep(
    run: WorkflowRunRecord,
    definition: WorkflowDefinitionRecord,
    step: WorkflowStepDefinition,
    context: WorkflowRuntimeContext,
    stepIndex: number,
    runtimeStep?: RuntimeStep
  ): Promise<StepExecutionResult> {
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

    const baseScope = buildTemplateScope(run, context);

    if (step.type === 'fanout') {
      const fanOutScope = runtimeStep?.fanOut
        ? withStepScope(baseScope, step.id, null, runtimeStep.fanOut)
        : withStepScope(baseScope, step.id, null);
      return executeFanOutStep(
        run,
        definition,
        step,
        context,
        stepIndex,
        fanOutScope,
        deps
      );
    }

    const mergedParameters = mergeParameters(run.parameters, step.parameters ?? null);
    const resolutionScope = runtimeStep?.fanOut
      ? withStepScope(baseScope, step.id, mergedParameters as JsonValue, runtimeStep.fanOut)
      : withStepScope(baseScope, step.id, mergedParameters as JsonValue);
    const parameterResolutionIssues: TemplateResolutionIssue[] = [];
    const parameterTracker: TemplateResolutionTracker = {
      record(issue) {
        parameterResolutionIssues.push(issue);
      }
    } satisfies TemplateResolutionTracker;
    const resolvedParameters = resolveJsonTemplates(
      mergedParameters as JsonValue,
      resolutionScope,
      parameterTracker,
      '$.parameters'
    );
    const stepScope = runtimeStep?.fanOut
      ? withStepScope(baseScope, step.id, resolvedParameters, runtimeStep.fanOut)
      : withStepScope(baseScope, step.id, resolvedParameters);

    if (parameterResolutionIssues.length > 0) {
      return handleParameterResolutionFailure(
        run,
        step,
        context,
        stepIndex,
        resolvedParameters,
        parameterResolutionIssues,
        runtimeStep?.fanOut ?? null,
        deps
      );
    }

    if (step.type === 'service') {
      return executeServiceStep(
        run,
        definition,
        step,
        context,
        stepIndex,
        resolvedParameters,
        stepScope,
        runtimeStep?.fanOut ?? null,
        deps
      );
    }

    return executeJobStep(
      run,
      definition,
      step,
      context,
      stepIndex,
      resolvedParameters,
      runtimeStep?.fanOut ?? null,
      deps
    );
  };
}

function generateFanOutChildId(parentStepId: string, templateStepId: string, index: number): string {
  const normalize = (value: string) => value.replace(/[^a-z0-9-_:.]/gi, '-');
  const safeParent = normalize(parentStepId);
  const safeTemplate = normalize(templateStepId);
  return `${safeParent}:${safeTemplate}:${index + 1}`;
}

function dedupeResolutionIssues(issues: TemplateResolutionIssue[]): TemplateResolutionIssue[] {
  const seen = new Map<string, TemplateResolutionIssue>();
  for (const issue of issues) {
    const expression = issue.expression.trim();
    const path = issue.path.trim();
    const key = `${path}|${expression}`;
    if (!seen.has(key)) {
      seen.set(key, { path, expression });
    }
  }
  return Array.from(seen.values());
}

function describeResolutionIssues(issues: TemplateResolutionIssue[]): string {
  const deduped = dedupeResolutionIssues(issues);
  if (deduped.length === 0) {
    return '';
  }
  return deduped
    .map((issue) => {
      const normalizedPath = issue.path
        .replace(/^\$\.(?:parameters\.)?/, '')
        .replace(/^\$\.?/, '');
      const renderedPath = normalizedPath.length > 0 ? normalizedPath : 'parameters';
      return `${renderedPath}: {{ ${issue.expression} }}`;
    })
    .join('; ');
}

async function handleParameterResolutionFailure(
  run: WorkflowRunRecord,
  step: WorkflowStepDefinition,
  context: WorkflowRuntimeContext,
  stepIndex: number,
  parameters: JsonValue,
  issues: TemplateResolutionIssue[],
  fanOutMeta: FanOutRuntimeMetadata | null,
  deps: StepExecutorDependencies
): Promise<StepExecutionResult> {
  const summary = describeResolutionIssues(issues);
  const errorMessage = summary
    ? `Parameter resolution failed: ${summary}`
    : 'Parameter resolution failed: required inputs are missing';

  const recordOptions = fanOutMeta
    ? {
        parentStepId: fanOutMeta.parentStepId,
        fanoutIndex: fanOutMeta.index,
        templateStepId: fanOutMeta.templateStepId
      }
    : undefined;

  let stepRecord = await deps.loadOrCreateStepRecord(run.id, step, parameters, recordOptions);

  const startedAt = stepRecord.startedAt ?? new Date().toISOString();
  const completedAt = new Date().toISOString();
  const previousStatus = stepRecord.status;

  stepRecord = await deps.applyStepUpdateWithHistory(
    stepRecord,
    {
      status: 'failed',
      errorMessage,
      startedAt,
      completedAt,
      input: parameters,
      retryState: 'completed',
      nextAttemptAt: null,
      retryMetadata: null,
      failureReason: 'parameter_resolution_failed',
      resolutionError: true
    },
    {
      eventType: 'status',
      eventPayload: {
        previousStatus,
        status: 'failed',
        errorMessage,
        completedAt,
        startedAt
      }
    }
  );

  const failureContext = updateStepContext(context, step.id, {
    status: 'failed',
    jobRunId: stepRecord.jobRunId ?? null,
    result: null,
    errorMessage,
    logsUrl: stepRecord.logsUrl ?? null,
    metrics: stepRecord.metrics ?? null,
    startedAt,
    completedAt,
    attempt: stepRecord.attempt,
    assets: toRuntimeAssetSummaries(stepRecord.producedAssets),
    resolutionError: true
  });

  await deps.applyRunContextPatch(run.id, step.id, failureContext.steps[step.id], {
    currentStepId: step.id,
    currentStepIndex: stepIndex,
    status: 'failed',
    errorMessage,
    completedAt,
    startedAt
  });

  return {
    context: failureContext,
    stepStatus: 'failed',
    completed: true,
    stepPatch: failureContext.steps[step.id],
    errorMessage
  } satisfies StepExecutionResult;
}

async function executeFanOutStep(
  run: WorkflowRunRecord,
  definition: WorkflowDefinitionRecord,
  step: WorkflowFanOutStepDefinition,
  context: WorkflowRuntimeContext,
  stepIndex: number,
  scope: TemplateScope,
  deps: StepExecutorDependencies
): Promise<StepExecutionResult> {
  const evaluatedCollection = resolveJsonTemplates(step.collection as JsonValue, scope);
  const collectionInput = (evaluatedCollection ?? null) as JsonValue;

  let stepRecord = await deps.loadOrCreateStepRecord(run.id, step, collectionInput);
  const startedAt = stepRecord.startedAt ?? new Date().toISOString();

  const fail = async (message: string): Promise<StepExecutionResult> => {
    const completedAt = new Date().toISOString();
    const previousStatus = stepRecord.status;
    stepRecord = await deps.applyStepUpdateWithHistory(
      stepRecord,
      {
        status: 'failed',
        errorMessage: message,
        completedAt,
        startedAt
      },
      {
        eventType: 'status',
        eventPayload: {
          previousStatus,
          status: 'failed',
          errorMessage: message,
          completedAt,
          startedAt
        }
      }
    );
    const nextContext = updateStepContext(context, step.id, {
      status: 'failed',
      result: null,
      errorMessage: message,
      startedAt,
      completedAt
    });
    await deps.applyRunContextPatch(run.id, step.id, nextContext.steps[step.id], {
      currentStepId: step.id,
      currentStepIndex: stepIndex
    });
    return {
      context: nextContext,
      stepStatus: 'failed',
      completed: true,
      stepPatch: nextContext.steps[step.id],
      errorMessage: message
    } satisfies StepExecutionResult;
  };

  if (!Array.isArray(evaluatedCollection)) {
    return fail('Fan-out step collection must resolve to an array');
  }

  const globalMaxItems = Math.max(
    1,
    Math.min(10_000, Number.parseInt(process.env.WORKFLOW_FANOUT_MAX_ITEMS ?? '100', 10) || 100)
  );
  const configuredMaxItems = Number.isFinite(step.maxItems) ? Math.floor(step.maxItems ?? 0) : globalMaxItems;
  const maxItems = Math.max(0, Math.min(globalMaxItems, configuredMaxItems));
  const items = evaluatedCollection.slice(0, maxItems);

  const globalMaxConcurrency = Math.max(
    1,
    Math.min(1_000, Number.parseInt(process.env.WORKFLOW_FANOUT_MAX_CONCURRENCY ?? '10', 10) || 10)
  );
  const requestedConcurrency =
    Number.isFinite(step.maxConcurrency) && step.maxConcurrency
      ? Math.max(1, Math.floor(step.maxConcurrency))
      : globalMaxConcurrency;
  const maxConcurrency = Math.max(
    1,
    Math.min(items.length === 0 ? 1 : items.length, requestedConcurrency, globalMaxConcurrency)
  );

  let nextContext = updateStepContext(context, step.id, {
    status: 'running',
    result: null,
    errorMessage: null,
    startedAt,
    completedAt: null,
    attempt: stepRecord.attempt ?? 1,
    resolutionError: false
  });

  let sharedPatch: Record<string, JsonValue | null> | undefined;
  if (step.storeResultsAs) {
    const placeholder = [] as JsonValue[];
    nextContext = setSharedValue(nextContext, step.storeResultsAs, placeholder as unknown as JsonValue);
    sharedPatch = { [step.storeResultsAs]: placeholder as unknown as JsonValue };
  }

  await deps.applyRunContextPatch(run.id, step.id, nextContext.steps[step.id], {
    shared: sharedPatch,
    currentStepId: step.id,
    currentStepIndex: stepIndex
  });

  const parentDependencies = Array.isArray(step.dependsOn) ? step.dependsOn.filter(Boolean) : [];
  const templateDependencies = Array.isArray(step.template.dependsOn)
    ? step.template.dependsOn.filter(Boolean)
    : [];
  const baseDependencies = Array.from(
    new Set([...parentDependencies, ...templateDependencies].filter((dep) => dep !== step.id))
  );

  const childSteps: FanOutChildStep[] = items.map((item, index) => {
    const childId = generateFanOutChildId(step.id, step.template.id, index);
    const childNameBase = step.template.name ?? step.template.id;
    const childName = `${childNameBase} [${index + 1}]`;
    const metadata: FanOutRuntimeMetadata = {
      parentStepId: step.id,
      templateStepId: step.template.id,
      index,
      item
    };

    if (step.template.type === 'service') {
      const { dependents: _ignored, ...rest } = step.template;
      const definition: WorkflowServiceStepDefinition = {
        ...rest,
        id: childId,
        name: childName,
        dependsOn: baseDependencies.length > 0 ? baseDependencies : undefined
      };
      return {
        definition,
        fanOut: metadata
      } satisfies FanOutChildStep;
    }

    const { dependents: _ignoredJob, ...restJob } = step.template;
    const definition: WorkflowJobStepDefinition = {
      ...restJob,
      id: childId,
      name: childName,
      dependsOn: baseDependencies.length > 0 ? baseDependencies : undefined
    };
    return {
      definition,
      fanOut: metadata
    } satisfies FanOutChildStep;
  });

  return {
    context: nextContext,
    stepStatus: 'running',
    completed: false,
    stepPatch: nextContext.steps[step.id],
    sharedPatch,
    fanOut: {
      parentStepId: step.id,
      parentRunStepId: stepRecord.id,
      storeKey: step.storeResultsAs ?? undefined,
      maxConcurrency,
      templateStepId: step.template.id,
      childSteps
    }
  } satisfies StepExecutionResult;
}

async function executeJobStep(
  run: WorkflowRunRecord,
  definition: WorkflowDefinitionRecord,
  step: WorkflowJobStepDefinition,
  context: WorkflowRuntimeContext,
  stepIndex: number,
  parameters: JsonValue,
  fanOutMeta: FanOutRuntimeMetadata | null,
  deps: StepExecutorDependencies
): Promise<StepExecutionResult> {
  let stepRecord = await deps.loadOrCreateStepRecord(run.id, step, parameters, {
    parentStepId: fanOutMeta?.parentStepId ?? null,
    fanoutIndex: fanOutMeta?.index ?? null,
    templateStepId: fanOutMeta?.templateStepId ?? null
  });

  if (stepRecord.status === 'succeeded') {
    let nextContext = updateStepContext(context, step.id, {
      status: stepRecord.status,
      jobRunId: stepRecord.jobRunId,
      result: stepRecord.output,
      errorMessage: stepRecord.errorMessage,
      logsUrl: stepRecord.logsUrl,
      metrics: stepRecord.metrics,
      startedAt: stepRecord.startedAt,
      completedAt: stepRecord.completedAt,
      attempt: stepRecord.attempt,
      assets: toRuntimeAssetSummaries(stepRecord.producedAssets)
    });
    let sharedPatch: Record<string, JsonValue | null> | undefined;
    if (step.storeResultAs) {
      const storedValue = (stepRecord.output ?? null) as JsonValue | null;
      nextContext = setSharedValue(nextContext, step.storeResultAs, storedValue);
      sharedPatch = { [step.storeResultAs]: storedValue };
    }
    return {
      context: nextContext,
      stepStatus: 'succeeded',
      completed: true,
      stepPatch: nextContext.steps[step.id],
      sharedPatch,
      errorMessage: stepRecord.errorMessage ?? null
    } satisfies StepExecutionResult;
  }

  const recoveryGate = await maybeDeferForAssetRecovery(run, step, stepRecord, context, stepIndex, deps);
  if (recoveryGate) {
    return recoveryGate;
  }

  const startedAt = stepRecord.startedAt ?? new Date().toISOString();
  if (stepRecord.status !== 'running') {
    const previousStatus = stepRecord.status;
    stepRecord = await deps.applyStepUpdateWithHistory(
      stepRecord,
      {
        status: 'running',
        startedAt,
        input: parameters,
        retryState: 'pending',
        nextAttemptAt: null,
        retryMetadata: null,
        resolutionError: false
      },
      {
        eventType: 'status',
        eventPayload: {
          previousStatus,
          status: 'running',
          startedAt
        }
      }
    );
    await deps.clearStepAssets({ run, stepId: step.id, stepRecordId: stepRecord.id });
    stepRecord = { ...stepRecord, producedAssets: [] };
  } else {
    stepRecord = await deps.recordStepHeartbeat(stepRecord);
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
    completedAt: stepRecord.completedAt ?? null,
    assets: toRuntimeAssetSummaries(stepRecord.producedAssets),
    resolutionError: false
  });

  await deps.applyRunContextPatch(run.id, step.id, nextContext.steps[step.id], {
    currentStepId: step.id,
    currentStepIndex: stepIndex
  });

  await deps.ensureJobHandler(step.jobSlug);

  let bundleOverrideContext: Record<string, JsonValue> | undefined;
  if (step.bundle && step.bundle.strategy !== 'latest') {
    const version = typeof step.bundle.version === 'string' ? step.bundle.version.trim() : '';
    const slug = step.bundle.slug?.trim().toLowerCase() ?? '';
    if (slug && version) {
      const exportNameValue =
        typeof step.bundle.exportName === 'string' && step.bundle.exportName.trim().length > 0
          ? step.bundle.exportName.trim()
          : null;
      bundleOverrideContext = {
        [WORKFLOW_BUNDLE_CONTEXT_KEY]: {
          slug,
          version,
          exportName: exportNameValue
        }
      } satisfies Record<string, JsonValue>;
    }
  }

  const jobRun = await deps.createJobRunForSlug(step.jobSlug, {
    parameters,
    timeoutMs: step.timeoutMs ?? null,
    maxAttempts: step.retryPolicy?.maxAttempts ?? null,
    context: bundleOverrideContext
  });

  stepRecord = await deps.applyStepUpdateWithHistory(
    stepRecord,
    {
      jobRunId: jobRun.id,
      startedAt,
      status: 'running'
    },
    {
      eventType: 'status',
      eventPayload: {
        status: 'running',
        startedAt,
        jobRunId: jobRun.id
      }
    }
  );

  nextContext = updateStepContext(nextContext, step.id, {
    jobRunId: jobRun.id
  });
  await deps.applyRunContextPatch(run.id, step.id, nextContext.steps[step.id], {
    currentStepId: step.id,
    currentStepIndex: stepIndex
  });

  try {
    const executed = await deps.executeJobRun(jobRun.id);
    if (!executed) {
      return finalizeStepFailure(
        run,
        step,
        stepRecord,
        nextContext,
        stepIndex,
        'Job run not found',
        'job_run_missing',
        deps
      );
    }

    const assetsPersisted = await deps.persistStepAssets({
      definition,
      run,
      stepId: step.id,
      stepRecordId: stepRecord.id,
      assets: extractProducedAssetsFromResult(step, executed.result ?? null)
    });

    stepRecord = { ...stepRecord, producedAssets: assetsPersisted };

    let successContext = updateStepContext(nextContext, step.id, {
      status: jobStatusToStepStatus(executed.status),
      jobRunId: jobRun.id,
      result: executed.result ?? null,
      errorMessage: executed.errorMessage ?? null,
      logsUrl: executed.logsUrl ?? null,
      metrics: executed.metrics ?? null,
      completedAt: executed.completedAt ?? null,
      attempt: executed.attempt,
      assets: toRuntimeAssetSummaries(assetsPersisted)
    });

    await deps.applyRunContextPatch(run.id, step.id, successContext.steps[step.id], {
      currentStepId: step.id,
      currentStepIndex: stepIndex
    });

    if (executed.status === 'succeeded') {
      const completedAt = executed.completedAt ?? new Date().toISOString();
      const previousStatus = stepRecord.status;
      stepRecord = await deps.applyStepUpdateWithHistory(
        stepRecord,
        {
          status: 'succeeded',
          output: executed.result ?? null,
          errorMessage: executed.errorMessage ?? null,
          logsUrl: executed.logsUrl ?? null,
          metrics: executed.metrics ?? null,
          context: executed.context ?? null,
          completedAt,
          startedAt: executed.startedAt ?? startedAt,
          jobRunId: executed.id,
          retryState: 'completed',
          nextAttemptAt: null,
          retryMetadata: null
        },
        {
          eventType: 'status',
          eventPayload: {
            previousStatus,
            status: 'succeeded',
            completedAt,
            jobRunStatus: executed.status,
            failure: executed.errorMessage ?? null
          }
        }
      );

      successContext = updateStepContext(successContext, step.id, {
        completedAt: stepRecord.completedAt ?? completedAt
      });

      let sharedPatch: Record<string, JsonValue | null> | undefined;
      if (step.storeResultAs) {
        const storedValue = (executed.result ?? null) as JsonValue | null;
        successContext = setSharedValue(successContext, step.storeResultAs, storedValue);
        sharedPatch = { [step.storeResultAs]: storedValue };
      }
      return {
        context: successContext,
        stepStatus: 'succeeded',
        completed: true,
        stepPatch: successContext.steps[step.id],
        sharedPatch,
        errorMessage: executed.errorMessage ?? null
      } satisfies StepExecutionResult;
    }

    if (executed.failureReason === 'asset_missing') {
      const descriptor = extractAssetRecoveryDescriptorFromContext(executed.context ?? null);
      if (descriptor) {
        const recoveryOutcome = await deps.ensureWorkflowAssetRecovery({
          descriptor,
          failingDefinition: definition,
          failingRun: run,
          step,
          stepRecord
        });
        if (recoveryOutcome && recoveryOutcome.request.status !== 'failed') {
          const metadata = buildRecoveryRetryMetadata(recoveryOutcome.request, descriptor);
          return scheduleRecoveryPoll(
            run,
            step,
            stepRecord,
            successContext,
            stepIndex,
            'asset_recovery_pending',
            metadata,
            deps
          );
        }
      }
    }

    return finalizeStepFailure(
      run,
      step,
      stepRecord,
      successContext,
      stepIndex,
      executed.errorMessage ?? null,
      executed.status === 'canceled' ? 'job_canceled' : 'job_failed',
      deps
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Job execution failed';
    const failureContext = updateStepContext(nextContext, step.id, {
      status: 'failed',
      jobRunId: jobRun.id,
      result: null,
      errorMessage,
      completedAt: new Date().toISOString(),
      assets: toRuntimeAssetSummaries(stepRecord.producedAssets)
    });
    await deps.applyRunContextPatch(run.id, step.id, failureContext.steps[step.id], {
      currentStepId: step.id,
      currentStepIndex: stepIndex
    });
    return finalizeStepFailure(
      run,
      step,
      stepRecord,
      failureContext,
      stepIndex,
      errorMessage,
      'job_execute_failed',
      deps
    );
  }
}

function cloneServiceQuery(query?: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  if (!query) {
    return {};
  }
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(query)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[normalizedKey] = value;
    }
  }
  return result;
}

function appendQuery(path: string, query: Record<string, string | number | boolean>): string {
  const entries = Object.entries(query);
  if (entries.length === 0) {
    return path;
  }
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    params.append(key, String(value));
  }
  const hasQuery = path.includes('?');
  const separator = hasQuery ? (path.endsWith('?') || path.endsWith('&') ? '' : '&') : '?';
  const queryString = params.toString();
  return queryString.length > 0 ? `${path}${separator}${queryString}` : path;
}

function normalizeQueryValue(value: JsonValue): string | number | boolean {
  if (value === null) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return templateValueToString(value);
}

function createMinimalServiceContext(
  step: WorkflowServiceStepDefinition,
  prepared: PreparedServiceRequest | null,
  service: ServiceRecord | null
): WorkflowStepServiceContext {
  return {
    slug: service?.slug ?? step.serviceSlug,
    status: service?.status ?? 'unknown',
    method: prepared?.method ?? (step.request.method ?? 'GET'),
    path: prepared?.fullPath ?? step.request.path,
    baseUrl: service?.baseUrl ?? null,
    statusCode: undefined,
    latencyMs: undefined
  };
}

function buildServiceContextFromPrepared(
  step: WorkflowServiceStepDefinition,
  prepared: PreparedServiceRequest,
  service: ServiceRecord | null,
  extras?: { statusCode?: number | null; latencyMs?: number | null; baseUrl?: string | null }
): WorkflowStepServiceContext {
  const context = createMinimalServiceContext(step, prepared, service);
  if (extras?.baseUrl !== undefined) {
    context.baseUrl = extras.baseUrl ?? null;
  }
  if (extras?.statusCode !== undefined) {
    context.statusCode = extras.statusCode ?? null;
  }
  if (extras?.latencyMs !== undefined) {
    context.latencyMs = extras.latencyMs ?? null;
  }
  return context;
}

function serviceContextToJson(context: WorkflowStepServiceContext): JsonValue {
  const payload: Record<string, JsonValue> = {
    slug: context.slug,
    status: context.status,
    method: context.method,
    path: context.path
  };
  if (context.baseUrl !== undefined && context.baseUrl !== null) {
    payload.baseUrl = context.baseUrl;
  }
  if (context.statusCode !== undefined && context.statusCode !== null) {
    payload.statusCode = context.statusCode;
  }
  if (context.latencyMs !== undefined && context.latencyMs !== null) {
    payload.latencyMs = context.latencyMs;
  }
  return { service: payload } as JsonValue;
}

function parseServiceRuntimeContext(value: JsonValue | null | undefined): WorkflowStepServiceContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, JsonValue>;
  const slug = typeof record.slug === 'string' ? record.slug : null;
  const status = typeof record.status === 'string' ? (record.status as WorkflowStepServiceContext['status']) : null;
  if (!slug || !status) {
    return undefined;
  }
  const context: WorkflowStepServiceContext = {
    slug,
    status,
    method: typeof record.method === 'string' ? record.method : 'GET',
    path: typeof record.path === 'string' ? record.path : '/'
  };
  if (typeof record.baseUrl === 'string') {
    context.baseUrl = record.baseUrl;
  }
  if (typeof record.statusCode === 'number' && Number.isFinite(record.statusCode)) {
    context.statusCode = record.statusCode;
  }
  if (typeof record.latencyMs === 'number' && Number.isFinite(record.latencyMs)) {
    context.latencyMs = record.latencyMs;
  }
  return context;
}

function extractServiceContextFromRecord(
  stepRecord: WorkflowRunStepRecord,
  fallback: WorkflowStepServiceContext
): WorkflowStepServiceContext {
  const contextValue = stepRecord.context as JsonValue | null;
  if (contextValue && typeof contextValue === 'object' && !Array.isArray(contextValue)) {
    const serviceValue = (contextValue as Record<string, JsonValue>).service as JsonValue | null | undefined;
    const parsed = parseServiceRuntimeContext(serviceValue);
    if (parsed) {
      return parsed;
    }
  }
  return fallback;
}

const MAX_RESPONSE_CHARS = 8_192;

async function extractResponseBody(response: Response): Promise<{ body: JsonValue | string | null; truncated: boolean; size: number }> {
  try {
    const rawText = await response.text();
    const size = rawText.length;
    const truncated = rawText.length > MAX_RESPONSE_CHARS;
    const snippet = truncated ? rawText.slice(0, MAX_RESPONSE_CHARS) : rawText;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        return { body: JSON.parse(snippet) as JsonValue, truncated, size };
      } catch {
        return { body: snippet, truncated, size };
      }
    }
    return { body: snippet, truncated, size };
  } catch {
    return { body: null, truncated: false, size: 0 };
  }
}

type PreparedServiceRequest = {
  method: string;
  path: string;
  fullPath: string;
  query: Record<string, string | number | boolean>;
  headers: Headers;
  sanitizedHeaders: Record<string, string>;
  requestInput: JsonValue;
  hasBody: boolean;
  bodyText?: string;
  bodyForRecord?: JsonValue | null;
  captureResponse: boolean;
  storeResponseAs?: string;
  timeoutMs?: number | null;
};

async function prepareServiceRequest(
  run: WorkflowRunRecord,
  step: WorkflowServiceStepDefinition,
  parameters: JsonValue,
  scope: TemplateScope,
  deps: StepExecutorDependencies
): Promise<PreparedServiceRequest> {
  const scoped = withStepScope(scope, step.id, parameters);
  const request = step.request;
  const query = cloneServiceQuery(request.query);
  const hasExplicitBody = Object.prototype.hasOwnProperty.call(request, 'body');
  const runHasBody = isObjectLike(parameters) ? Object.keys(parameters as Record<string, JsonValue>).length > 0 : parameters !== null;
  const defaultMethod = hasExplicitBody || runHasBody ? 'POST' : 'GET';
  const methodCandidate = request.method ? request.method.toUpperCase() : undefined;
  const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
  const method = allowedMethods.includes(methodCandidate ?? '')
    ? (methodCandidate as PreparedServiceRequest['method'])
    : (defaultMethod as PreparedServiceRequest['method']);

  const headers = new Headers();
  const sanitizedHeaders: Record<string, string> = {};

  if (request.headers) {
    for (const [headerName, headerValue] of Object.entries(request.headers)) {
      const name = headerName.trim();
      if (!name) {
        continue;
      }
      if (typeof headerValue === 'string') {
        const resolvedHeader = resolveTemplateString(headerValue, scoped);
        const headerText = templateValueToString(resolvedHeader);
        headers.set(name, headerText);
        sanitizedHeaders[name] = headerText;
        continue;
      }
      const secretRef = headerValue?.secret;
      if (!secretRef) {
        continue;
      }
      const resolved = deps.resolveSecret(secretRef as SecretReference, {
        actor: `workflow-run:${run.id}`,
        actorType: 'workflow',
        metadata: {
          workflowDefinitionId: run.workflowDefinitionId,
          workflowRunId: run.id,
          stepId: step.id,
          serviceSlug: step.serviceSlug,
          headerName: name
        }
      });
      if (!resolved.value) {
        throw new Error(`Secret ${deps.describeSecret(secretRef as SecretReference)} not found for header ${name}`);
      }
      const prefix = typeof headerValue.prefix === 'string' ? headerValue.prefix : '';
      const finalValue = `${prefix}${resolved.value}`;
      headers.set(name, finalValue);
      sanitizedHeaders[name] = deps.maskSecret(finalValue);
    }
  }

  if (!headers.has('accept')) {
    headers.set('accept', 'application/json');
    sanitizedHeaders['accept'] = 'application/json';
  }

  let hasBody = false;
  let bodyForRecord: JsonValue | null = null;
  if (hasExplicitBody) {
    bodyForRecord = resolveJsonTemplates(((request.body ?? null) as JsonValue) ?? null, scoped);
    hasBody = method !== 'GET' && method !== 'HEAD';
  } else if (method !== 'GET' && method !== 'HEAD') {
    bodyForRecord = parameters ?? null;
    hasBody = true;
  }

  let bodyText: string | undefined;
  if (hasBody) {
    bodyText = JSON.stringify(bodyForRecord ?? null);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
      sanitizedHeaders['content-type'] = 'application/json';
    }
  }

  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') {
      const resolved = resolveTemplateString(value, scoped);
      query[key] = normalizeQueryValue(resolved as JsonValue);
    }
  }

  const resolvedPathValue = resolveTemplateString(request.path, scoped);
  const requestPath = templateValueToString(resolvedPathValue) || request.path;
  const fullPath = appendQuery(requestPath, query);

  const requestInput: Record<string, JsonValue> = {
    method,
    path: requestPath
  };
  if (Object.keys(query).length > 0) {
    requestInput.query = { ...query } as unknown as JsonValue;
  }
  if (Object.keys(sanitizedHeaders).length > 0) {
    requestInput.headers = { ...sanitizedHeaders } as unknown as JsonValue;
  }
  if (hasBody) {
    requestInput.body = (bodyForRecord ?? null) as JsonValue;
  }

  return {
    method,
    path: requestPath,
    fullPath,
    query,
    headers,
    sanitizedHeaders,
    requestInput: requestInput as JsonValue,
    hasBody,
    bodyText,
    bodyForRecord: bodyForRecord ?? null,
    captureResponse: step.captureResponse ?? true,
    storeResponseAs: step.storeResponseAs,
    timeoutMs: step.timeoutMs ?? null
  };
}

function isObjectLike(value: JsonValue): value is Record<string, JsonValue> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

 type ServiceInvocationResult = {
  success: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  responseBody: JsonValue | string | null;
  truncated: boolean;
  responseSize: number | null;
  baseUrl: string | null;
  errorMessage?: string;
};

async function invokePreparedService(
  service: ServiceRecord,
  prepared: PreparedServiceRequest,
  deps: StepExecutorDependencies
): Promise<ServiceInvocationResult> {
  const abortSignal = createStepAbortSignal(prepared.timeoutMs ?? null);
  const start = Date.now();
  try {
    const response = await deps.fetchFromService(service, {
      method: prepared.method,
      path: prepared.fullPath,
      headers: prepared.headers,
      body: prepared.bodyText,
      signal: abortSignal
    });
    const latencyMs = Date.now() - start;
    const statusCode = response.status;

    if (!prepared.captureResponse) {
      response.body?.cancel?.();
      return {
        success: statusCode >= 200 && statusCode < 300,
        statusCode,
        latencyMs,
        responseBody: null,
        truncated: false,
        responseSize: null,
        baseUrl: service.baseUrl ?? null
      };
    }

    const extracted = await extractResponseBody(response);
    const success = statusCode >= 200 && statusCode < 300;
    return {
      success,
      statusCode,
      latencyMs,
      responseBody: extracted.body,
      truncated: extracted.truncated,
      responseSize: extracted.size,
      baseUrl: service.baseUrl ?? null
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const errorMessage = err instanceof Error ? err.message : 'Service invocation failed';
    return {
      success: false,
      statusCode: null,
      latencyMs,
      responseBody: null,
      truncated: false,
      responseSize: null,
      baseUrl: null,
      errorMessage
    };
  }
}

function buildServiceMetrics(options: {
  step: WorkflowServiceStepDefinition;
  service: ServiceRecord | null;
  statusCode: number | null;
  latencyMs: number | null;
  responseSize?: number | null;
  truncated?: boolean;
  attempt: number;
}): JsonValue {
  const serviceInfo: Record<string, JsonValue> = {
    slug: options.service?.slug ?? options.step.serviceSlug,
    status: options.service?.status ?? 'unknown',
    attempt: options.attempt
  };
  if (options.statusCode !== null && options.statusCode !== undefined) {
    serviceInfo.statusCode = options.statusCode;
  }
  if (options.latencyMs !== null && options.latencyMs !== undefined) {
    serviceInfo.latencyMs = options.latencyMs;
  }
  if (options.responseSize !== null && options.responseSize !== undefined) {
    serviceInfo.responseSizeBytes = options.responseSize;
  }
  if (options.truncated !== undefined) {
    serviceInfo.truncated = options.truncated;
  }
  if (options.service?.baseUrl) {
    serviceInfo.baseUrl = options.service.baseUrl;
  }
  return { service: serviceInfo } as JsonValue;
}

async function executeServiceStep(
  run: WorkflowRunRecord,
  definition: WorkflowDefinitionRecord,
  step: WorkflowServiceStepDefinition,
  context: WorkflowRuntimeContext,
  stepIndex: number,
  parameters: JsonValue,
  scope: TemplateScope,
  fanOutMeta: FanOutRuntimeMetadata | null,
  deps: StepExecutorDependencies
): Promise<StepExecutionResult> {
  let prepared: PreparedServiceRequest;
  try {
    prepared = await prepareServiceRequest(run, step, parameters, scope, deps);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to prepare service request';
    let stepRecord = await deps.loadOrCreateStepRecord(run.id, step, parameters);
    const startedAt = stepRecord.startedAt ?? new Date().toISOString();
    const completedAt = new Date().toISOString();
    const attempt = stepRecord.attempt ?? 1;
    const metrics = buildServiceMetrics({ step, service: null, statusCode: null, latencyMs: null, attempt });
    const previousStatus = stepRecord.status;
    stepRecord = await deps.applyStepUpdateWithHistory(
      stepRecord,
      {
        status: 'failed',
        startedAt,
        completedAt,
        errorMessage,
        metrics
      },
      {
        eventType: 'status',
        eventPayload: {
          previousStatus,
          status: 'failed',
          errorMessage,
          completedAt
        }
      }
    );

    await deps.clearStepAssets({ run, stepId: step.id, stepRecordId: stepRecord.id });
    stepRecord = { ...stepRecord, producedAssets: [] };

    const failureContext = updateStepContext(context, step.id, {
      status: 'failed',
      jobRunId: null,
      startedAt,
      completedAt,
      attempt,
      errorMessage,
      metrics,
      service: createMinimalServiceContext(step, null, null),
      assets: toRuntimeAssetSummaries(stepRecord.producedAssets)
    });

    await deps.applyRunContextPatch(run.id, step.id, failureContext.steps[step.id], {
      currentStepId: step.id,
      currentStepIndex: stepIndex
    });

    return finalizeStepFailure(
      run,
      step,
      stepRecord,
      failureContext,
      stepIndex,
      errorMessage,
      'service_prepare_failed',
      deps
    );
  }

  let stepRecord = await deps.loadOrCreateStepRecord(run.id, step, prepared.requestInput, {
    parentStepId: fanOutMeta?.parentStepId ?? null,
    fanoutIndex: fanOutMeta?.index ?? null,
    templateStepId: fanOutMeta?.templateStepId ?? null
  });

  if (stepRecord.status === 'succeeded') {
    const fallbackContext = buildServiceContextFromPrepared(step, prepared, null);
    const serviceContext = extractServiceContextFromRecord(stepRecord, fallbackContext);
    let nextContext = updateStepContext(context, step.id, {
      status: 'succeeded',
      jobRunId: null,
      result: stepRecord.output ?? null,
      errorMessage: stepRecord.errorMessage ?? null,
      logsUrl: stepRecord.logsUrl ?? null,
      metrics: stepRecord.metrics ?? null,
      startedAt: stepRecord.startedAt ?? null,
      completedAt: stepRecord.completedAt ?? null,
      attempt: stepRecord.attempt,
      service: serviceContext,
      assets: toRuntimeAssetSummaries(stepRecord.producedAssets)
    });
    let sharedPatch: Record<string, JsonValue | null> | undefined;
    if (step.storeResponseAs) {
      const storedResponse = (stepRecord.output ?? null) as JsonValue | null;
      nextContext = setSharedValue(nextContext, step.storeResponseAs, storedResponse);
      sharedPatch = { [step.storeResponseAs]: storedResponse };
    }
    return {
      context: nextContext,
      stepStatus: 'succeeded',
      completed: true,
      stepPatch: nextContext.steps[step.id],
      sharedPatch,
      errorMessage: stepRecord.errorMessage ?? null
    } satisfies StepExecutionResult;
  }

  const startedAt = stepRecord.startedAt ?? new Date().toISOString();
  if (stepRecord.status !== 'running') {
    const previousStatus = stepRecord.status;
    stepRecord = await deps.applyStepUpdateWithHistory(
      stepRecord,
      {
        status: 'running',
        startedAt,
        input: prepared.requestInput,
        retryState: 'pending',
        nextAttemptAt: null,
        retryMetadata: null,
        resolutionError: false
      },
      {
        eventType: 'status',
        eventPayload: {
          previousStatus,
          status: 'running',
          startedAt
        }
      }
    );
    await deps.clearStepAssets({ run, stepId: step.id, stepRecordId: stepRecord.id });
    stepRecord = { ...stepRecord, producedAssets: [] };
  } else {
    stepRecord = await deps.recordStepHeartbeat(stepRecord);
  }

  let nextContext = updateStepContext(context, step.id, {
    status: 'running',
    jobRunId: null,
    startedAt,
    attempt: stepRecord.attempt,
    result: stepRecord.output ?? null,
    errorMessage: stepRecord.errorMessage ?? null,
    logsUrl: stepRecord.logsUrl ?? null,
    metrics: stepRecord.metrics ?? null,
    completedAt: stepRecord.completedAt ?? null,
    service: createMinimalServiceContext(step, prepared, null),
    assets: toRuntimeAssetSummaries(stepRecord.producedAssets),
    resolutionError: false
  });

  await deps.applyRunContextPatch(run.id, step.id, nextContext.steps[step.id], {
    currentStepId: step.id,
    currentStepIndex: stepIndex
  });

  const service = await deps.getServiceBySlug(step.serviceSlug);
  if (!service) {
    return finalizeStepFailure(
      run,
      step,
      stepRecord,
      nextContext,
      stepIndex,
      `Service ${step.serviceSlug} not found`,
      'service_not_found',
      deps
    );
  }

  if (!isServiceAvailable(service, step)) {
    return finalizeStepFailure(
      run,
      step,
      stepRecord,
      nextContext,
      stepIndex,
      `Service ${step.serviceSlug} is not available`,
      'service_unavailable',
      deps
    );
  }

  const retryAttemptLimit = resolveRetryAttemptLimit(step.retryPolicy ?? null);
  const maxAttempts = retryAttemptLimit ?? Number.POSITIVE_INFINITY;
  const initialAttempt = Math.max(stepRecord.attempt ?? 1, 1);
  let finalContext = nextContext;
  let lastErrorMessage: string | null = null;
  let lastMetrics: JsonValue | null = stepRecord.metrics ?? null;
  let lastServiceContext = createMinimalServiceContext(step, prepared, null);

  for (let attempt = initialAttempt; attempt <= maxAttempts; attempt++) {
    if (attempt > initialAttempt) {
      const delayMs = calculateRetryDelay(attempt, step.retryPolicy ?? null);
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }

    const isRetry = attempt > initialAttempt;
    stepRecord = await deps.applyStepUpdateWithHistory(
      stepRecord,
      {
        attempt,
        input: prepared.requestInput
      },
      {
        eventType: isRetry ? 'retry' : 'heartbeat',
        eventPayload: {
          attempt,
          reason: isRetry ? 'retry-attempt' : 'attempt-initial'
        }
      }
    );

    const invocation = await invokePreparedService(service, prepared, deps);
    const serviceContext = buildServiceContextFromPrepared(step, prepared, service, {
      statusCode: invocation.statusCode,
      latencyMs: invocation.latencyMs,
      baseUrl: invocation.baseUrl
    });
    const metrics = buildServiceMetrics({
      step,
      service,
      statusCode: invocation.statusCode,
      latencyMs: invocation.latencyMs,
      responseSize: invocation.responseSize,
      truncated: invocation.truncated,
      attempt
    });

    lastServiceContext = serviceContext;
    lastMetrics = metrics;

    if (invocation.success) {
      const output = prepared.captureResponse ? (invocation.responseBody as JsonValue | null) : null;
      const completedAt = new Date().toISOString();
      stepRecord = await deps.applyStepUpdateWithHistory(
        stepRecord,
        {
          status: 'succeeded',
          completedAt,
          errorMessage: null,
          output,
          metrics,
          context: serviceContextToJson(serviceContext),
          retryState: 'completed',
          nextAttemptAt: null,
          retryMetadata: null
        },
        {
          eventType: 'status',
          eventPayload: {
            previousStatus: 'running',
            status: 'succeeded',
            completedAt,
            serviceStatus: invocation.statusCode,
            latencyMs: invocation.latencyMs
          }
        }
      );

      const assetInputs = extractProducedAssetsFromResult(step, output, {
        defaultPartitionKey: run.partitionKey
      });
      const storedAssets = await deps.persistStepAssets({
        definition,
        run,
        stepId: step.id,
        stepRecordId: stepRecord.id,
        assets: assetInputs
      });
      stepRecord = { ...stepRecord, producedAssets: storedAssets };

      let successContext = updateStepContext(finalContext, step.id, {
        status: 'succeeded',
        jobRunId: null,
        result: output,
        errorMessage: null,
        metrics,
        completedAt,
        service: serviceContext,
        assets: toRuntimeAssetSummaries(stepRecord.producedAssets)
      });

      let sharedPatch: Record<string, JsonValue | null> | undefined;
      if (prepared.storeResponseAs && prepared.captureResponse) {
        const storedResponse = (output ?? null) as JsonValue | null;
        successContext = setSharedValue(successContext, prepared.storeResponseAs, storedResponse);
        sharedPatch = { [prepared.storeResponseAs]: storedResponse };
      }

      await deps.applyRunContextPatch(run.id, step.id, successContext.steps[step.id], {
        shared: sharedPatch
      });

      return {
        context: successContext,
        stepStatus: 'succeeded',
        completed: true,
        stepPatch: successContext.steps[step.id],
        sharedPatch,
        errorMessage: null
      } satisfies StepExecutionResult;
    }

    lastErrorMessage =
      invocation.errorMessage ??
      (invocation.statusCode !== null
        ? `Service responded with status ${invocation.statusCode}`
        : 'Service invocation failed');

    stepRecord = await deps.applyStepUpdateWithHistory(
      stepRecord,
      {
        errorMessage: lastErrorMessage,
        metrics,
        context: serviceContextToJson(serviceContext)
      },
      {
        eventType: 'heartbeat',
        eventPayload: {
          reason: 'service-error',
          errorMessage: lastErrorMessage,
          metrics,
          statusCode: invocation.statusCode
        }
      }
    );

    finalContext = updateStepContext(finalContext, step.id, {
      errorMessage: lastErrorMessage,
      metrics,
      service: serviceContext
    });

    if (retryAttemptLimit === null || attempt < retryAttemptLimit) {
      const scheduled = await scheduleWorkflowStepRetry(
        run,
        step,
        stepRecord,
        finalContext,
        stepIndex,
        lastErrorMessage,
        'service_error',
        deps
      );
      if (scheduled) {
        return scheduled;
      }
      continue;
    }

    break;
  }

  const failureCompletedAt = new Date().toISOString();
  const failureMessage = lastErrorMessage ?? 'Service invocation failed';
  const failureMetrics = lastMetrics ?? buildServiceMetrics({
    step,
    service: null,
    statusCode: null,
    latencyMs: null,
    attempt: stepRecord.attempt ?? 1
  });

  const finalPreviousStatus = stepRecord.status;
  stepRecord = await deps.applyStepUpdateWithHistory(
    stepRecord,
    {
      status: 'failed',
      completedAt: failureCompletedAt,
      errorMessage: failureMessage,
      metrics: failureMetrics,
      context: serviceContextToJson(lastServiceContext)
    },
    {
      eventType: 'status',
      eventPayload: {
        previousStatus: finalPreviousStatus,
        status: 'failed',
        completedAt: failureCompletedAt,
        errorMessage: failureMessage
      }
    }
  );

  await deps.clearStepAssets({ run, stepId: step.id, stepRecordId: stepRecord.id });
  stepRecord = { ...stepRecord, producedAssets: [] };

  const failureContext = updateStepContext(finalContext, step.id, {
    status: 'failed',
    jobRunId: null,
    completedAt: failureCompletedAt,
    errorMessage: failureMessage,
    metrics: failureMetrics,
    service: lastServiceContext,
    assets: toRuntimeAssetSummaries(stepRecord.producedAssets)
  });

  await deps.applyRunContextPatch(run.id, step.id, failureContext.steps[step.id], {
    currentStepId: step.id,
    currentStepIndex: stepIndex
  });

  return finalizeStepFailure(
    run,
    step,
    stepRecord,
    failureContext,
    stepIndex,
    failureMessage,
    'service_failed',
    deps
  );
}

async function scheduleWorkflowStepRetry(
  run: WorkflowRunRecord,
  step: WorkflowStepDefinition,
  stepRecord: WorkflowRunStepRecord,
  context: WorkflowRuntimeContext,
  stepIndex: number,
  message: string | null,
  reason: string,
  deps: StepExecutorDependencies
): Promise<StepExecutionResult | null> {
  const policy = (step as WorkflowJobStepDefinition | WorkflowServiceStepDefinition | WorkflowFanOutTemplateDefinition)?.retryPolicy;
  const nextAttemptLimit = resolveRetryAttemptLimit(policy ?? null);
  const attempts = Math.max(stepRecord.retryCount ?? 0, 0) + 1;
  const nextAttemptNumber = (stepRecord.attempt ?? 1) + 1;

  if (nextAttemptLimit !== null && attempts >= nextAttemptLimit) {
    return null;
  }

  const nextAttemptAt = computeWorkflowRetryTimestamp(nextAttemptNumber, policy ?? null, attempts);

  const updatePayload: WorkflowRunStepUpdateInput = {
    status: 'pending',
    retryState: 'scheduled',
    retryCount: attempts,
    retryAttempts: attempts,
    nextAttemptAt,
    errorMessage: message ?? stepRecord.errorMessage ?? null,
    completedAt: null,
    lastHeartbeatAt: new Date().toISOString(),
    resolutionError: false
  };

  const updatedRecord =
    (await deps.applyStepUpdateWithHistory(stepRecord, updatePayload, {
      eventType: 'retry-scheduled',
      eventPayload: {
        reason,
        nextAttemptAt,
        attempt: nextAttemptNumber,
        retryAttempts: attempts
      }
    })) ?? {
      ...stepRecord,
      ...updatePayload
    } satisfies WorkflowRunStepRecord;

  await deps.scheduleWorkflowRetryJob(run.id, step.id, nextAttemptAt, attempts, {
    runKey: run.runKey ?? null
  });

  const retryContext = updateStepContext(context, step.id, {
    status: 'pending',
    jobRunId: updatedRecord.jobRunId ?? null,
    result: null,
    errorMessage: updatedRecord.errorMessage ?? null,
    logsUrl: updatedRecord.logsUrl ?? null,
    metrics: updatedRecord.metrics ?? null,
    attempt: updatedRecord.attempt,
    startedAt: updatedRecord.startedAt,
    completedAt: null,
    assets: toRuntimeAssetSummaries(updatedRecord.producedAssets ?? []),
    resolutionError: false
  });

  await deps.applyRunContextPatch(run.id, step.id, retryContext.steps[step.id], {
    currentStepId: step.id,
    currentStepIndex: stepIndex
  });

  return {
    context: retryContext,
    stepStatus: 'pending',
    completed: false,
    stepPatch: retryContext.steps[step.id],
    errorMessage: updatedRecord.errorMessage ?? null,
    scheduledRetry: {
      stepId: step.id,
      runAt: nextAttemptAt,
      attempts,
      reason
    }
  } satisfies StepExecutionResult;
}

type RecoveryRetryMetadata = {
  requestId: string;
  assetId: string;
  partitionKey: string | null;
  status: string;
  capability?: string | null;
  resource?: string | null;
  lastCheckedAt?: string;
  scheduledAt?: string;
};

function isPlainObject(value: JsonValue | null | undefined): value is Record<string, JsonValue> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function extractAssetRecoveryDescriptorFromContext(
  context: JsonValue | null | undefined
): AssetRecoveryDescriptor | null {
  if (!isPlainObject(context)) {
    return null;
  }
  const node = context.assetRecovery as JsonValue | undefined;
  if (!isPlainObject(node)) {
    return null;
  }
  const assetIdValue = node.assetId;
  const assetId = typeof assetIdValue === 'string' ? assetIdValue.trim() : '';
  if (!assetId) {
    return null;
  }
  const partitionKeyValue = node.partitionKey;
  const partitionKey =
    typeof partitionKeyValue === 'string' && partitionKeyValue.trim().length > 0
      ? partitionKeyValue.trim()
      : null;
  const capability = typeof node.capability === 'string' ? node.capability : null;
  const resource = typeof node.resource === 'string' ? node.resource : null;

  return {
    assetId,
    partitionKey,
    capability: capability ?? undefined,
    resource: resource ?? undefined
  } satisfies AssetRecoveryDescriptor;
}

function extractRecoveryRetryMetadata(value: JsonValue | null | undefined): RecoveryRetryMetadata | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const recoveryNode = value.recovery as JsonValue | undefined;
  if (!isPlainObject(recoveryNode)) {
    return null;
  }
  const requestIdValue = recoveryNode.requestId;
  const requestId = typeof requestIdValue === 'string' ? requestIdValue.trim() : '';
  if (!requestId) {
    return null;
  }
  const assetIdValue = recoveryNode.assetId;
  const assetId = typeof assetIdValue === 'string' ? assetIdValue.trim() : '';
  if (!assetId) {
    return null;
  }
  const partitionKeyValue = recoveryNode.partitionKey;
  const partitionKey =
    typeof partitionKeyValue === 'string' && partitionKeyValue.trim().length > 0
      ? partitionKeyValue.trim()
      : null;
  const statusValue = recoveryNode.status;
  const status = typeof statusValue === 'string' ? statusValue : 'pending';
  const capability = typeof recoveryNode.capability === 'string' ? recoveryNode.capability : null;
  const resource = typeof recoveryNode.resource === 'string' ? recoveryNode.resource : null;
  const lastCheckedAt = typeof recoveryNode.lastCheckedAt === 'string' ? recoveryNode.lastCheckedAt : undefined;
  const scheduledAt = typeof recoveryNode.scheduledAt === 'string' ? recoveryNode.scheduledAt : undefined;

  return {
    requestId,
    assetId,
    partitionKey,
    status,
    capability,
    resource,
    lastCheckedAt,
    scheduledAt
  } satisfies RecoveryRetryMetadata;
}

function buildRecoveryRetryMetadata(
  request: WorkflowAssetRecoveryRequestRecord,
  descriptor: AssetRecoveryDescriptor
): JsonValue {
  return {
    recovery: {
      requestId: request.id,
      assetId: descriptor.assetId,
      partitionKey: descriptor.partitionKey,
      status: request.status,
      capability: descriptor.capability ?? null,
      resource: descriptor.resource ?? null,
      scheduledAt: new Date().toISOString()
    }
  } satisfies JsonValue;
}

async function clearRecoveryMetadata(
  stepRecord: WorkflowRunStepRecord,
  deps: StepExecutorDependencies,
  reason: string
): Promise<void> {
  try {
    await deps.applyStepUpdateWithHistory(
      stepRecord,
      {
        retryMetadata: null,
        context: null
      },
      {
        eventType: 'recovery-metadata-cleared',
        eventPayload: {
          reason
        }
      }
    );
  } catch (err) {
    logger.warn('workflow.recovery.clear_metadata_failed', {
      stepId: stepRecord.stepId,
      workflowRunStepId: stepRecord.id,
      error: err instanceof Error ? err.message : 'unknown'
    });
  }
}

async function scheduleRecoveryPoll(
  run: WorkflowRunRecord,
  step: WorkflowStepDefinition,
  stepRecord: WorkflowRunStepRecord,
  context: WorkflowRuntimeContext,
  stepIndex: number,
  reason: string,
  metadata: JsonValue,
  deps: StepExecutorDependencies
): Promise<StepExecutionResult> {
  const delayMs = getRecoveryPollDelayMs();
  const runAt = new Date(Date.now() + delayMs).toISOString();
  const metadataValue = metadata ?? null;

  const updatedRecord =
    (await deps.applyStepUpdateWithHistory(
      stepRecord,
      {
        status: 'pending',
        retryState: 'scheduled',
        nextAttemptAt: runAt,
        retryMetadata: metadataValue,
        lastHeartbeatAt: new Date().toISOString(),
        errorMessage: stepRecord.errorMessage ?? null,
        completedAt: null,
        resolutionError: false,
        context: metadataValue
      },
      {
        eventType: 'retry-scheduled',
        eventPayload: {
          reason,
          nextAttemptAt: runAt,
          attempt: stepRecord.attempt ?? 1,
          retryAttempts: stepRecord.retryCount ?? 0
        }
      }
    )) ?? stepRecord;

  await deps.scheduleWorkflowRetryJob(run.id, step.id, runAt, stepRecord.retryCount ?? 0, {
    runKey: run.runKey ?? null
  });

  const retryContext = updateStepContext(context, step.id, {
    status: 'pending',
    jobRunId: updatedRecord.jobRunId ?? null,
    result: null,
    errorMessage: updatedRecord.errorMessage ?? null,
    logsUrl: updatedRecord.logsUrl ?? null,
    metrics: updatedRecord.metrics ?? null,
    attempt: updatedRecord.attempt,
    startedAt: updatedRecord.startedAt,
    completedAt: null,
    assets: toRuntimeAssetSummaries(updatedRecord.producedAssets ?? []),
    resolutionError: false,
    context: metadataValue as JsonValue | null
  });

  await deps.applyRunContextPatch(run.id, step.id, retryContext.steps[step.id], {
    currentStepId: step.id,
    currentStepIndex: stepIndex
  });

  return {
    context: retryContext,
    stepStatus: 'pending',
    completed: false,
    stepPatch: retryContext.steps[step.id],
    errorMessage: updatedRecord.errorMessage ?? null,
    scheduledRetry: {
      stepId: step.id,
      runAt,
      attempts: stepRecord.retryCount ?? 0,
      reason
    }
  } satisfies StepExecutionResult;
}

async function maybeDeferForAssetRecovery(
  run: WorkflowRunRecord,
  step: WorkflowStepDefinition,
  stepRecord: WorkflowRunStepRecord,
  context: WorkflowRuntimeContext,
  stepIndex: number,
  deps: StepExecutorDependencies
): Promise<StepExecutionResult | null> {
  const metadata = extractRecoveryRetryMetadata(stepRecord.retryMetadata ?? null);
  if (!metadata) {
    return null;
  }

  const request = await deps.getAssetRecoveryRequestById(metadata.requestId);
  if (!request) {
    recordAssetRecoveryFailed('request_missing');
    await clearRecoveryMetadata(stepRecord, deps, 'request-missing');
    return null;
  }

  if (request.status === 'succeeded') {
    recordAssetRecoveryCompleted();
    await clearRecoveryMetadata(stepRecord, deps, 'request-succeeded');
    return null;
  }

  if (request.status === 'failed') {
    recordAssetRecoveryFailed('request_failed');
    await clearRecoveryMetadata(stepRecord, deps, 'request-failed');
    return null;
  }

  const updatedMetadata: JsonValue = {
    recovery: {
      requestId: request.id,
      assetId: metadata.assetId,
      partitionKey: metadata.partitionKey,
      status: request.status,
      capability: metadata.capability ?? null,
      resource: metadata.resource ?? null,
      lastCheckedAt: new Date().toISOString()
    }
  } satisfies JsonValue;

  return scheduleRecoveryPoll(
    run,
    step,
    stepRecord,
    context,
    stepIndex,
    request.status === 'running' ? 'asset_recovery_running' : 'asset_recovery_pending',
    updatedMetadata,
    deps
  );
}

async function finalizeStepFailure(
  run: WorkflowRunRecord,
  step: WorkflowStepDefinition,
  stepRecord: WorkflowRunStepRecord,
  context: WorkflowRuntimeContext,
  stepIndex: number,
  message: string | null,
  reason: string,
  deps: StepExecutorDependencies
): Promise<StepExecutionResult> {
  const scheduled = await scheduleWorkflowStepRetry(run, step, stepRecord, context, stepIndex, message, reason, deps);
  if (scheduled) {
    return scheduled;
  }

  await deps.applyStepUpdateWithHistory(
    stepRecord,
    {
      retryState: 'completed',
      nextAttemptAt: null,
      retryMetadata: null
    },
    {
      eventType: 'retry-settled',
      eventPayload: {
        status: 'failed',
        reason
      }
    }
  );

  return {
    context,
    stepStatus: 'failed',
    completed: false,
    stepPatch: context.steps[step.id],
    errorMessage: message ?? stepRecord.errorMessage ?? null
  } satisfies StepExecutionResult;
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

function isServiceAvailable(service: ServiceRecord, step: WorkflowServiceStepDefinition): boolean {
  if (service.status === 'healthy') {
    return true;
  }
  const requireHealthy = step.requireHealthy ?? true;
  if (!requireHealthy && (service.status === 'degraded' || service.status === 'unknown')) {
    return step.allowDegraded ?? false;
  }
  return false;
}

function createStepAbortSignal(timeoutMs?: number | null): AbortSignal | undefined {
  if (!timeoutMs || timeoutMs <= 0) {
    return undefined;
  }
  if (typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer === 'object' && typeof (timer as NodeJS.Timeout).unref === 'function') {
    (timer as NodeJS.Timeout).unref();
  }
  controller.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
    },
    { once: true }
  );
  return controller.signal;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer === 'object' && typeof (timer as NodeJS.Timeout).unref === 'function') {
      (timer as NodeJS.Timeout).unref();
    }
  });
}

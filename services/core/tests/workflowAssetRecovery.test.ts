import './setupTestEnv';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { mock } from 'node:test';

import type {
  JobRunRecord,
  WorkflowAssetRecoveryRequestRecord,
  WorkflowDefinitionRecord,
  WorkflowJobStepDefinition,
  WorkflowRunRecord,
  WorkflowRunStepRecord
} from '../src/db/types';
import type { WorkflowRuntimeContext } from '../src/workflow/context';
import type { StepExecutorDependencies } from '../src/workflow/executors';

const ISO = '2025-01-01T00:00:00.000Z';

function createJobStepDefinition(): WorkflowJobStepDefinition {
  return {
    id: 'step-one',
    name: 'Recoverable job',
    type: 'job',
    jobSlug: 'recoverable-job'
  } satisfies WorkflowJobStepDefinition;
}

function createWorkflowDefinition(step: WorkflowJobStepDefinition): WorkflowDefinitionRecord {
  return {
    id: 'wf-' + randomUUID(),
    slug: 'asset-recovery-test',
    name: 'Asset Recovery Test',
    version: 1,
    description: null,
    steps: [step],
    triggers: [],
    eventTriggers: [],
    parametersSchema: {},
    defaultParameters: {},
    outputSchema: {},
    metadata: null,
    dag: {
      adjacency: { [step.id]: [] },
      roots: [step.id],
      topologicalOrder: [step.id],
      edges: 0
    },
    schedules: [],
    createdAt: ISO,
    updatedAt: ISO
  } satisfies WorkflowDefinitionRecord;
}

function createWorkflowRun(definition: WorkflowDefinitionRecord): WorkflowRunRecord {
  return {
    id: 'run-' + randomUUID(),
    workflowDefinitionId: definition.id,
    status: 'running',
    runKey: null,
    runKeyNormalized: null,
    parameters: {},
    context: {},
    output: null,
    errorMessage: null,
    currentStepId: null,
    currentStepIndex: null,
    metrics: null,
    triggeredBy: null,
    trigger: null,
    partitionKey: null,
    startedAt: ISO,
    completedAt: null,
    durationMs: null,
    createdAt: ISO,
    updatedAt: ISO,
    retrySummary: {
      pendingSteps: 0,
      nextAttemptAt: null,
      overdueSteps: 0
    }
  } satisfies WorkflowRunRecord;
}

function createRuntimeContext(stepId: string): WorkflowRuntimeContext {
  return {
    steps: {
      [stepId]: {
        status: 'pending',
        jobRunId: null,
        attempt: 1,
        result: null,
        errorMessage: null,
        logsUrl: null,
        metrics: null,
        startedAt: null,
        completedAt: null,
        resolutionError: false
      }
    },
    lastUpdatedAt: ISO
  } satisfies WorkflowRuntimeContext;
}

function createStepRecord(run: WorkflowRunRecord, stepId: string): WorkflowRunStepRecord {
  return {
    id: 'run-step-' + randomUUID(),
    workflowRunId: run.id,
    stepId,
    status: 'pending',
    attempt: 1,
    jobRunId: null,
    input: {},
    output: null,
    errorMessage: null,
    logsUrl: null,
    metrics: null,
    context: null,
    startedAt: null,
    completedAt: null,
    parentStepId: null,
    fanoutIndex: null,
    templateStepId: null,
    producedAssets: [],
    lastHeartbeatAt: null,
    retryCount: 0,
    failureReason: null,
    nextAttemptAt: null,
    retryState: 'pending',
    retryAttempts: 0,
    retryMetadata: null,
    resolutionError: false,
    createdAt: ISO,
    updatedAt: ISO
  } satisfies WorkflowRunStepRecord;
}

function createJobRunRecord(overrides: Partial<JobRunRecord>): JobRunRecord {
  const base: JobRunRecord = {
    id: overrides.id ?? 'job-run-' + randomUUID(),
    jobDefinitionId: overrides.jobDefinitionId ?? 'job-def-' + randomUUID(),
    status: overrides.status ?? 'pending',
    parameters: overrides.parameters ?? {},
    result: overrides.result ?? null,
    errorMessage: overrides.errorMessage ?? null,
    logsUrl: overrides.logsUrl ?? null,
    metrics: overrides.metrics ?? null,
    context: overrides.context ?? null,
    timeoutMs: overrides.timeoutMs ?? null,
    attempt: overrides.attempt ?? 1,
    maxAttempts: overrides.maxAttempts ?? null,
    durationMs: overrides.durationMs ?? null,
    scheduledAt: overrides.scheduledAt ?? ISO,
    startedAt: overrides.startedAt ?? ISO,
    completedAt: overrides.completedAt ?? null,
    lastHeartbeatAt: overrides.lastHeartbeatAt ?? ISO,
    retryCount: overrides.retryCount ?? 0,
    failureReason: overrides.failureReason ?? null,
    moduleBinding: overrides.moduleBinding ?? null,
    createdAt: overrides.createdAt ?? ISO,
    updatedAt: overrides.updatedAt ?? ISO
  } satisfies JobRunRecord;
  return base;
}

function createRecoveryRequest(
  overrides: Partial<WorkflowAssetRecoveryRequestRecord>
): WorkflowAssetRecoveryRequestRecord {
  return {
    id: overrides.id ?? 'recovery-request-' + randomUUID(),
    assetId: overrides.assetId ?? 'inventory.dataset',
    assetKey: overrides.assetKey ?? 'inventory.dataset',
    workflowDefinitionId: overrides.workflowDefinitionId ?? 'wf-producer',
    partitionKey: overrides.partitionKey ?? null,
    partitionKeyNormalized: overrides.partitionKeyNormalized ?? '',
    status: overrides.status ?? 'pending',
    requestedByWorkflowRunId: overrides.requestedByWorkflowRunId ?? 'run',
    requestedByWorkflowRunStepId: overrides.requestedByWorkflowRunStepId ?? 'run-step',
    requestedByStepId: overrides.requestedByStepId ?? 'step-one',
    recoveryWorkflowDefinitionId: overrides.recoveryWorkflowDefinitionId ?? null,
    recoveryWorkflowRunId: overrides.recoveryWorkflowRunId ?? null,
    recoveryJobRunId: overrides.recoveryJobRunId ?? null,
    attempts: overrides.attempts ?? 1,
    lastAttemptAt: overrides.lastAttemptAt ?? ISO,
    lastError: overrides.lastError ?? null,
    metadata: overrides.metadata ?? {},
    createdAt: overrides.createdAt ?? ISO,
    updatedAt: overrides.updatedAt ?? ISO,
    completedAt: overrides.completedAt ?? null
  } satisfies WorkflowAssetRecoveryRequestRecord;
}

test('workflow orchestrator schedules asset recovery and defers retry', async () => {
  const step = createJobStepDefinition();
  const definition = createWorkflowDefinition(step);
  const run = createWorkflowRun(definition);
  const context = createRuntimeContext(step.id);

  let stepState = createStepRecord(run, step.id);
  const createdJobRun = createJobRunRecord({ status: 'running' });
  const failedJobRun = createJobRunRecord({
    id: createdJobRun.id,
    jobDefinitionId: createdJobRun.jobDefinitionId,
    status: 'failed',
    errorMessage: 'Asset missing',
    failureReason: 'asset_missing',
    context: {
      assetRecovery: {
        assetId: 'inventory.dataset',
        partitionKey: null,
        capability: 'filestore.fetch',
        resource: 'filestore://inventory.dataset'
      }
    }
  });

  const scheduleCalls: Array<{ runId: string; stepId: string; runAt: string; attempts: number }> = [];

  const ensureStub = mock.fn(async () => ({
    request,
    producerWorkflowDefinitionId: definition.id
  }));
  const getRequestStub = mock.fn(async () => null);

  const deps: StepExecutorDependencies = {
    loadOrCreateStepRecord: async () => stepState,
    applyStepUpdateWithHistory: async (_record, updates) => {
      stepState = { ...stepState, ...updates } satisfies WorkflowRunStepRecord;
      return stepState;
    },
    recordStepHeartbeat: async () => {
      stepState = { ...stepState, lastHeartbeatAt: new Date().toISOString() } satisfies WorkflowRunStepRecord;
      return stepState;
    },
    applyRunContextPatch: async () => {
      // no-op for unit test
    },
    scheduleWorkflowRetryJob: async (runId, stepId, runAt, attempts) => {
      scheduleCalls.push({ runId, stepId, runAt, attempts });
    },
    clearStepAssets: async () => {
      stepState = { ...stepState, producedAssets: [] } satisfies WorkflowRunStepRecord;
    },
    persistStepAssets: async () => [],
    resolveSecret: () => ({ value: null }),
    maskSecret: (value) => value,
    describeSecret: () => 'secret',
    createJobRunForSlug: async () => createdJobRun,
    executeJobRun: async () => failedJobRun,
    ensureJobHandler: async () => {
      // no-op
    },
    getServiceBySlug: async () => null,
    fetchFromService: async () => new Response(null, { status: 200 }),
    ensureWorkflowAssetRecovery: ensureStub,
    getAssetRecoveryRequestById: getRequestStub
  } satisfies StepExecutorDependencies;

  const request = createRecoveryRequest({
    status: 'running',
    recoveryWorkflowDefinitionId: definition.id,
    recoveryWorkflowRunId: 'wf-recovery-' + randomUUID(),
    requestedByWorkflowRunId: run.id,
    requestedByWorkflowRunStepId: stepState.id,
    requestedByStepId: step.id
  });

  const { createStepExecutor } = await import('../src/workflow/executors');
  const executeStep = createStepExecutor(deps);

  const result = await executeStep(run, definition, step, context, 0);
  assert.equal(ensureStub.mock.calls.length, 1);
  assert.equal(getRequestStub.mock.calls.length, 0);
  assert.equal(result.completed, false);
  assert.equal(result.stepStatus, 'pending');
  assert.ok(result.scheduledRetry, 'expected scheduled retry metadata');
  assert.equal(result.scheduledRetry?.reason, 'asset_recovery_pending');
  assert.equal(result.scheduledRetry?.stepId, step.id);
  assert.equal(scheduleCalls.length, 1);

  assert.ok(stepState.retryMetadata && typeof stepState.retryMetadata === 'object');
  const metadataNode = (stepState.retryMetadata as { recovery?: Record<string, unknown> }).recovery;
  assert.ok(metadataNode, 'expected recovery metadata to be stored');
  assert.equal(metadataNode?.requestId, request.id);
  assert.equal(metadataNode?.status, 'running');
  assert.equal(metadataNode?.assetId, 'inventory.dataset');
  assert.equal(stepState.context && typeof stepState.context === 'object', true);
});

test('workflow orchestrator defers execution while recovery request is running', async () => {
  const step = createJobStepDefinition();
  const definition = createWorkflowDefinition(step);
  const run = createWorkflowRun(definition);
  const context = createRuntimeContext(step.id);

  let stepState = {
    ...createStepRecord(run, step.id),
    retryState: 'scheduled',
    retryMetadata: {
      recovery: {
        requestId: 'existing-request',
        assetId: 'inventory.dataset',
        partitionKey: null,
        status: 'pending'
      }
    }
  } satisfies WorkflowRunStepRecord;

  const scheduleCalls: Array<{ runId: string; stepId: string; runAt: string; attempts: number }> = [];

  let ensureCalled = false;

  const ensureStub = mock.fn(async () => {
    ensureCalled = true;
    return null;
  });
  const getRequestStub = mock.fn(async () => requestRecord);

  const deps: StepExecutorDependencies = {
    loadOrCreateStepRecord: async () => stepState,
    applyStepUpdateWithHistory: async (_record, updates) => {
      stepState = { ...stepState, ...updates } satisfies WorkflowRunStepRecord;
      return stepState;
    },
    recordStepHeartbeat: async () => stepState,
    applyRunContextPatch: async () => {
      // no-op
    },
    scheduleWorkflowRetryJob: async (runId, stepId, runAt, attempts) => {
      scheduleCalls.push({ runId, stepId, runAt, attempts });
    },
    clearStepAssets: async () => {
      stepState = { ...stepState, producedAssets: [] } satisfies WorkflowRunStepRecord;
    },
    persistStepAssets: async () => [],
    resolveSecret: () => ({ value: null }),
    maskSecret: (value) => value,
    describeSecret: () => 'secret',
    createJobRunForSlug: async () => {
      throw new Error('job should not be created while recovery is pending');
    },
    executeJobRun: async () => {
      throw new Error('job should not execute while recovery is pending');
    },
    ensureJobHandler: async () => {
      // no-op
    },
    getServiceBySlug: async () => null,
    fetchFromService: async () => new Response(null, { status: 200 }),
    ensureWorkflowAssetRecovery: ensureStub,
    getAssetRecoveryRequestById: getRequestStub
  } satisfies StepExecutorDependencies;

  const requestRecord = createRecoveryRequest({
    id: 'existing-request',
    status: 'running',
    recoveryWorkflowDefinitionId: definition.id,
    recoveryWorkflowRunId: 'wf-recovery-' + randomUUID(),
    requestedByWorkflowRunId: run.id,
    requestedByWorkflowRunStepId: stepState.id,
    requestedByStepId: step.id
  });

  const { createStepExecutor } = await import('../src/workflow/executors');
  const executeStep = createStepExecutor(deps);

  const result = await executeStep(run, definition, step, context, 0);

  assert.equal(ensureCalled, false, 'no new recovery request should be scheduled');
  assert.equal(ensureStub.mock.calls.length, 0);
  assert.equal(getRequestStub.mock.calls.length, 1);
  assert.equal(result.completed, false);
  assert.equal(result.stepStatus, 'pending');
  assert.equal(result.scheduledRetry?.reason, 'asset_recovery_running');
  assert.equal(scheduleCalls.length, 1);
  const metadataNode = (stepState.retryMetadata as { recovery: Record<string, unknown> }).recovery;
  assert.equal(metadataNode.status, 'running');
  assert.ok(metadataNode.lastCheckedAt, 'expected lastCheckedAt timestamp');
});

test('workflow orchestrator resumes execution after recovery succeeds', async () => {
  const step = createJobStepDefinition();
  const definition = createWorkflowDefinition(step);
  const run = createWorkflowRun(definition);
  const context = createRuntimeContext(step.id);

  let stepState = {
    ...createStepRecord(run, step.id),
    retryState: 'scheduled',
    retryMetadata: {
      recovery: {
        requestId: 'existing-request',
        assetId: 'inventory.dataset',
        partitionKey: null,
        status: 'running'
      }
    }
  } satisfies WorkflowRunStepRecord;

  const scheduleCalls: Array<{ runId: string; stepId: string; runAt: string; attempts: number }> = [];

  const createdJobRun = createJobRunRecord({ status: 'running' });
  const succeededJobRun = createJobRunRecord({
    id: createdJobRun.id,
    jobDefinitionId: createdJobRun.jobDefinitionId,
    status: 'succeeded',
    result: { ok: true },
    failureReason: null,
    completedAt: ISO
  });

  const succeededRequest = createRecoveryRequest({
    id: 'existing-request',
    status: 'succeeded',
    recoveryWorkflowDefinitionId: definition.id,
    recoveryWorkflowRunId: 'wf-recovery-' + randomUUID(),
    requestedByWorkflowRunId: run.id,
    requestedByWorkflowRunStepId: stepState.id,
    requestedByStepId: step.id
  });

  let ensureCalled = false;
  const ensureStub = mock.fn(async () => {
    ensureCalled = true;
    return {
      request: createRecoveryRequest({ id: 'should-not-be-created' }),
      producerWorkflowDefinitionId: definition.id
    };
  });
  const getRequestStub = mock.fn(async () => succeededRequest);

  const deps: StepExecutorDependencies = {
    loadOrCreateStepRecord: async () => stepState,
    applyStepUpdateWithHistory: async (_record, updates) => {
      stepState = { ...stepState, ...updates } satisfies WorkflowRunStepRecord;
      return stepState;
    },
    recordStepHeartbeat: async () => stepState,
    applyRunContextPatch: async () => {
      // no-op for unit test
    },
    scheduleWorkflowRetryJob: async (runId, stepId, runAt, attempts) => {
      scheduleCalls.push({ runId, stepId, runAt, attempts });
    },
    clearStepAssets: async () => {
      stepState = { ...stepState, producedAssets: [] } satisfies WorkflowRunStepRecord;
    },
    persistStepAssets: async () => [],
    resolveSecret: () => ({ value: null }),
    maskSecret: (value) => value,
    describeSecret: () => 'secret',
    createJobRunForSlug: async () => createdJobRun,
    executeJobRun: async () => succeededJobRun,
    ensureJobHandler: async () => {
      // no-op
    },
    getServiceBySlug: async () => null,
    fetchFromService: async () => new Response(null, { status: 200 }),
    ensureWorkflowAssetRecovery: ensureStub,
    getAssetRecoveryRequestById: getRequestStub
  } satisfies StepExecutorDependencies;

  const { createStepExecutor } = await import('../src/workflow/executors');
  const executeStep = createStepExecutor(deps);

  const result = await executeStep(run, definition, step, context, 0);
  assert.equal(ensureCalled, false, 'existing recovery request should be reused');
  assert.equal(ensureStub.mock.calls.length, 0);
  assert.equal(getRequestStub.mock.calls.length, 1);
  assert.equal(scheduleCalls.length, 0, 'no additional retry should be scheduled once recovery completes');
  assert.equal(result.completed, true);
  assert.equal(result.stepStatus, 'succeeded');
  assert.equal(stepState.retryMetadata, null);
  assert.equal(stepState.context, null);
});

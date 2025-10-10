import './setupTestEnv';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runE2E } from '@apphub/test-helpers';
import { ensureEmbeddedPostgres } from './setupTestEnv';

const OPERATOR_TOKEN = 'workflow-cancel-operator-token';

process.env.SERVICE_REGISTRY_TOKEN = process.env.SERVICE_REGISTRY_TOKEN ?? 'workflow-cancel-service-token';
process.env.APPHUB_OPERATOR_TOKENS = JSON.stringify([
  {
    subject: 'workflow-run-cancel-tests',
    token: OPERATOR_TOKEN,
    scopes: ['workflows:run']
  }
]);

async function createTestWorkflowDefinition() {
  const [{ createWorkflowDefinition }, { buildWorkflowDagMetadata }] = await Promise.all([
    import('../src/db/workflows'),
    import('../src/workflows/dag')
  ]);

  const stepId = 'pending-step';
  const steps = [
    {
      id: stepId,
      name: 'Pending Step',
      type: 'job',
      jobSlug: 'workflow-cancel-job'
    }
  ];

  const dag = buildWorkflowDagMetadata(steps);

  return createWorkflowDefinition({
    slug: `wf-cancel-${randomUUID()}`,
    name: 'Workflow Cancel Test',
    steps,
    dag
  });
}

runE2E(async ({ registerCleanup }) => {
  await ensureEmbeddedPostgres();
  const { buildServer } = await import('../src/server');
  const app = await buildServer();
  await app.ready();
  registerCleanup(() => app.close());

  const {
    createWorkflowRun,
    createWorkflowRunStep,
    getWorkflowRunById,
    getWorkflowRunStepById,
    listWorkflowRunExecutionHistory
  } = await import('../src/db/workflows');

  const workflow = await createTestWorkflowDefinition();

  const runningStepId = 'pending-step';
  const nowIso = new Date().toISOString();
  const runContext = {
    steps: {
      [runningStepId]: {
        status: 'running',
        attempt: 1,
        result: null,
        logsUrl: null,
        metrics: null,
        context: null,
        errorMessage: null,
        startedAt: nowIso,
        completedAt: null,
        resolutionError: false
      }
    },
    shared: {},
    lastUpdatedAt: nowIso
  } satisfies Record<string, unknown>;

  const run = await createWorkflowRun(workflow.id, {
    status: 'running',
    parameters: { tenant: 'cancel-test' },
    context: runContext,
    metrics: { totalSteps: 1, completedSteps: 0 },
    currentStepId: runningStepId,
    currentStepIndex: 0,
    triggeredBy: 'operator',
    trigger: null,
    startedAt: nowIso
  });

  const runStep = await createWorkflowRunStep(run.id, {
    stepId: runningStepId,
    status: 'running',
    attempt: 1,
    startedAt: nowIso,
    retryCount: 0,
    retryState: 'pending'
  });

  const unauthorizedResponse = await app.inject({
    method: 'POST',
    url: `/workflow-runs/${run.id}/cancel`,
    payload: { reason: 'unauthorized attempt' }
  });
  assert.equal(unauthorizedResponse.statusCode, 401);

  const cancelReason = 'cleanup requested by operator';
  const cancelResponse = await app.inject({
    method: 'POST',
    url: `/workflow-runs/${run.id}/cancel`,
    headers: {
      Authorization: `Bearer ${OPERATOR_TOKEN}`
    },
    payload: { reason: cancelReason }
  });
  assert.equal(cancelResponse.statusCode, 200);
  const cancelPayload = JSON.parse(cancelResponse.payload) as {
    data: { run: { id: string; status: string; errorMessage: string | null; metrics: unknown; context: unknown } };
  };
  const cancelledRunFromResponse = cancelPayload.data.run;
  assert.equal(cancelledRunFromResponse.id, run.id);
  assert.equal(cancelledRunFromResponse.status, 'canceled');
  assert.equal(cancelledRunFromResponse.errorMessage, cancelReason);

  const cancelMetrics = cancelledRunFromResponse.metrics as {
    cancelledSteps?: number;
    totalSteps?: number;
    completedSteps?: number;
  } | null;
  assert(cancelMetrics);
  assert.equal(cancelMetrics.cancelledSteps, 1);
  assert.equal(cancelMetrics.totalSteps, 1);
  assert.equal(cancelMetrics.completedSteps, 1);

  const cancelContext = cancelledRunFromResponse.context as { steps?: Record<string, unknown> };
  const stepContext = cancelContext.steps?.[runningStepId] as { status?: string; errorMessage?: string | null } | undefined;
  assert(stepContext);
  assert.equal(stepContext.status, 'skipped');
  assert.equal(stepContext.errorMessage, cancelReason);

  const cancelledRunRecord = await getWorkflowRunById(run.id);
  assert(cancelledRunRecord);
  assert.equal(cancelledRunRecord.status, 'canceled');
  assert.ok(cancelledRunRecord.completedAt);
  assert.equal(cancelledRunRecord.retrySummary.pendingSteps, 0);

  const runMetrics = cancelledRunRecord.metrics as {
    cancelledSteps?: number;
    totalSteps?: number;
    completedSteps?: number;
  } | null;
  assert(runMetrics);
  assert.equal(runMetrics.cancelledSteps, 1);
  assert.equal(runMetrics.totalSteps, 1);
  assert.equal(runMetrics.completedSteps, 1);

  const cancelledStepRecord = await getWorkflowRunStepById(runStep.id);
  assert(cancelledStepRecord);
  assert.equal(cancelledStepRecord.status, 'skipped');
  assert.equal(cancelledStepRecord.errorMessage, cancelReason);
  assert.equal(cancelledStepRecord.retryState, 'completed');
  assert.ok(cancelledStepRecord.completedAt);

  const historyEntries = await listWorkflowRunExecutionHistory(run.id);
  const cancellationEvent = historyEntries.find((entry) => entry.eventType === 'run.canceled');
  assert(cancellationEvent, 'expected run.canceled history entry');
  const cancellationPayload = (cancellationEvent.eventPayload ?? {}) as {
    reason?: string;
    cancelledStepIds?: unknown;
  };
  assert.equal(cancellationPayload.reason, cancelReason);
  const cancelledStepIds = Array.isArray(cancellationPayload.cancelledStepIds)
    ? (cancellationPayload.cancelledStepIds as string[])
    : [];
  assert(cancelledStepIds.includes(runStep.id));

  const idempotentResponse = await app.inject({
    method: 'POST',
    url: `/workflow-runs/${run.id}/cancel`,
    headers: {
      Authorization: `Bearer ${OPERATOR_TOKEN}`
    },
    payload: { reason: 'second attempt' }
  });
  assert.equal(idempotentResponse.statusCode, 200);
  const idempotentPayload = JSON.parse(idempotentResponse.payload) as {
    data: { run: { id: string; status: string } };
  };
  assert.equal(idempotentPayload.data.run.id, run.id);
  assert.equal(idempotentPayload.data.run.status, 'canceled');
}, { name: 'workflow-run-cancel.e2e' });

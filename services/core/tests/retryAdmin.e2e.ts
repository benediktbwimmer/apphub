import './setupTestEnv';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEmbeddedPostgres, stopEmbeddedPostgres, runE2E } from '@apphub/test-helpers';
import type EmbeddedPostgres from 'embedded-postgres';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';

let embeddedPostgres: EmbeddedPostgres | null = null;
let postgresDataDir: string | null = null;

async function ensureEmbeddedPostgres(): Promise<void> {
  if (embeddedPostgres) {
    return;
  }

  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dataRoot = await mkdtemp(`${tmpdir()}/retry-admin-pg-`);
  postgresDataDir = dataRoot;

  const port = 14_000 + Math.floor(Math.random() * 1_000);
  const postgres: EmbeddedPostgres = createEmbeddedPostgres({
    port,
    databaseDir: dataRoot,
    persistent: false,
    user: 'postgres',
    password: 'postgres'
  });

  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('apphub');

  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.PGPOOL_MAX = '8';

  embeddedPostgres = postgres;
}

async function shutdownEmbeddedPostgres(): Promise<void> {
  if (!embeddedPostgres) {
    return;
  }
  try {
    await stopEmbeddedPostgres(embeddedPostgres);
  } finally {
    embeddedPostgres = null;
    if (postgresDataDir) {
      const { rm } = await import('node:fs/promises');
      await rm(postgresDataDir, { recursive: true, force: true });
      postgresDataDir = null;
    }
  }
}

runE2E(async ({ registerCleanup }) => {
  const OPERATOR_TOKEN = 'retry-admin-e2e-token';
  process.env.APPHUB_EVENTS_MODE = 'inline';
  process.env.APPHUB_OPERATOR_TOKENS = JSON.stringify([
    {
      subject: 'retry-admin-tests',
      token: OPERATOR_TOKEN,
      scopes: ['workflows:run', 'workflows:write']
    }
  ]);

  await ensureEmbeddedPostgres();
  registerCleanup(() => shutdownEmbeddedPostgres());

  const db = await import('../src/db');
  const eventRetriesDb = await import('../src/db/eventIngressRetries');
  const workflowDb = await import('../src/db/workflows');
  const workflowEventsDb = await import('../src/db/workflowEvents');
  const { registerAdminRoutes } = await import('../src/routes/admin');

  await db.ensureDatabase();

  const app = Fastify();
  await app.register(cookie);
  await registerAdminRoutes(app);
  registerCleanup(() => app.close());

  const authorizationHeader = { authorization: `Bearer ${OPERATOR_TOKEN}` };

  async function createEventRetry(): Promise<string> {
    const eventId = randomUUID();
    await workflowEventsDb.insertWorkflowEvent({
      id: eventId,
      type: 'test.event',
      source: 'retry.test',
      occurredAt: new Date().toISOString(),
      payload: { foo: 'bar' },
      correlationId: null,
      ttlMs: null,
      metadata: null
    });

    const nextAttemptAt = new Date(Date.now() + 60_000).toISOString();
    await eventRetriesDb.upsertEventIngressRetry({
      eventId,
      source: 'retry.test',
      nextAttemptAt,
      retryState: 'scheduled',
      attempts: 2,
      lastError: 'throttled'
    });
    return eventId;
  }

  async function createTriggerRetry(workflowId: string, triggerId: string, eventId: string): Promise<string> {
    const delivery = await workflowDb.createWorkflowTriggerDelivery({
      triggerId,
      workflowDefinitionId: workflowId,
      eventId,
      status: 'throttled',
      attempts: 1,
      retryState: 'scheduled',
      retryAttempts: 1,
      nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
      lastError: 'throttled'
    });
    return delivery.id;
  }

  async function createWorkflowStepRetry(workflowId: string): Promise<{ runId: string; stepId: string; runStepId: string }> {
    const run = await workflowDb.createWorkflowRun(workflowId, {
      status: 'running',
      triggeredBy: 'retry-admin'
    });

    const step = await workflowDb.createWorkflowRunStep(run.id, {
      stepId: 'step-one',
      status: 'pending',
      attempt: 1
    });

    await workflowDb.updateWorkflowRunStep(step.id, {
      retryState: 'scheduled',
      retryAttempts: 1,
      nextAttemptAt: new Date(Date.now() + 120_000).toISOString(),
      retryMetadata: { reason: 'throttled' }
    });

    return { runId: run.id, stepId: step.stepId, runStepId: step.id };
  }

  // Event cancel
  {
    const eventId = await createEventRetry();
    const response = await app.inject({
      method: 'POST',
      url: `/admin/retries/events/${eventId}/cancel`,
      headers: authorizationHeader
    });
    assert.equal(response.statusCode, 200, response.body);
    const snapshot = await eventRetriesDb.getEventIngressRetryById(eventId);
    assert.equal(snapshot?.retryState, 'cancelled');
    assert.ok(snapshot?.nextAttemptAt, 'expected nextAttemptAt to remain set after cancellation');
  }

  // Event force
  {
    const eventId = await createEventRetry();
    const response = await app.inject({
      method: 'POST',
      url: `/admin/retries/events/${eventId}/force`,
      headers: authorizationHeader
    });
    assert.equal(response.statusCode, 202, response.body);
    const snapshot = await eventRetriesDb.getEventIngressRetryById(eventId);
    assert.equal(snapshot?.retryState, 'pending');
    assert.ok(snapshot?.nextAttemptAt, 'expected nextAttemptAt to be set');
  }

  // Workflow setup for trigger and step tests
  const workflowDefinition = await workflowDb.createWorkflowDefinition({
    slug: `wf-${randomUUID()}`,
    name: 'Retry Admin Workflow',
    description: null,
    steps: [
      {
        id: 'step-one',
        name: 'Step One',
        type: 'job',
        jobSlug: 'noop-job'
      }
    ],
    triggers: [],
    schedules: [],
    parametersSchema: {},
    metadata: null,
    outputSchema: {}
  });

  const trigger = await workflowDb.createWorkflowEventTrigger({
    workflowDefinitionId: workflowDefinition.id,
    eventType: 'retry.event',
    status: 'active'
  });

  const triggerEventId = randomUUID();
  await workflowEventsDb.insertWorkflowEvent({
    id: triggerEventId,
    type: 'retry.event',
    source: 'retry.test',
    occurredAt: new Date().toISOString(),
    payload: {},
    correlationId: null,
    ttlMs: null,
    metadata: null
  });

  // Trigger cancel
  {
    const deliveryId = await createTriggerRetry(workflowDefinition.id, trigger.id, triggerEventId);
    const response = await app.inject({
      method: 'POST',
      url: `/admin/retries/deliveries/${deliveryId}/cancel`,
      headers: authorizationHeader
    });
    assert.equal(response.statusCode, 200, response.body);
    const delivery = await workflowDb.getWorkflowTriggerDeliveryById(deliveryId);
    assert.equal(delivery?.retryState, 'cancelled');
    assert.equal(delivery?.nextAttemptAt, null);
  }

  // Trigger force
  {
    const deliveryId = await createTriggerRetry(workflowDefinition.id, trigger.id, triggerEventId);
    const response = await app.inject({
      method: 'POST',
      url: `/admin/retries/deliveries/${deliveryId}/force`,
      headers: authorizationHeader
    });
    assert.equal(response.statusCode, 202, response.body);
    const delivery = await workflowDb.getWorkflowTriggerDeliveryById(deliveryId);
    assert.equal(delivery?.retryState, 'pending');
    assert.ok(delivery?.nextAttemptAt, 'expected trigger retry nextAttemptAt to be set');
  }

  // Workflow step cancel
  {
    const stepRef = await createWorkflowStepRetry(workflowDefinition.id);
    const response = await app.inject({
      method: 'POST',
      url: `/admin/retries/workflow-steps/${stepRef.runStepId}/cancel`,
      headers: authorizationHeader
    });
    assert.equal(response.statusCode, 200, response.body);
    const step = await workflowDb.getWorkflowRunStepById(stepRef.runStepId);
    assert.equal(step?.retryState, 'cancelled');
    assert.equal(step?.nextAttemptAt, null);
  }

  // Workflow step force
  {
    const stepRef = await createWorkflowStepRetry(workflowDefinition.id);
    const response = await app.inject({
      method: 'POST',
      url: `/admin/retries/workflow-steps/${stepRef.runStepId}/force`,
      headers: authorizationHeader
    });
    assert.equal(response.statusCode, 202, response.body);
    const step = await workflowDb.getWorkflowRunStepById(stepRef.runStepId);
    assert.equal(step?.retryState, 'pending');
    assert.ok(step?.nextAttemptAt, 'expected workflow step retry nextAttemptAt to be set');
  }

  await db.closePool();
}, { name: 'retry-admin.e2e' });

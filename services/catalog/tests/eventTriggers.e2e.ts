import './setupTestEnv';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import { normalizeEventEnvelope } from '@apphub/event-bus';
import { runE2E } from '@apphub/test-helpers';
type CatalogDbModule = typeof import('../src/db');

let dbModule: CatalogDbModule | null = null;

async function loadCatalogDb(): Promise<CatalogDbModule> {
  if (!dbModule) {
    dbModule = await import('../src/db');
  }
  return dbModule;
}

let embeddedPostgres: EmbeddedPostgres | null = null;
let embeddedCleanup: (() => Promise<void>) | null = null;

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address) {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to determine available port')));
      }
    });
  });
}

async function ensureEmbeddedPostgres(): Promise<void> {
  if (embeddedPostgres) {
    return;
  }

  const dataRoot = await mkdtemp(path.join(tmpdir(), 'apphub-event-triggers-pg-'));
  const port = await findAvailablePort();

  const postgres = new EmbeddedPostgres({
    databaseDir: dataRoot,
    persistent: false,
    port,
    password: 'postgres',
    user: 'postgres'
  });

  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('apphub');

  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.PGPOOL_MAX = '6';

  embeddedPostgres = postgres;
  embeddedCleanup = async () => {
    try {
      await postgres.stop();
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  };
}

async function shutdownEmbeddedPostgres(): Promise<void> {
  if (!embeddedCleanup) {
    return;
  }
  const cleanup = embeddedCleanup;
  embeddedCleanup = null;
  embeddedPostgres = null;
  await cleanup();
}

async function testEventTriggerCrud(): Promise<void> {
  await ensureEmbeddedPostgres();
  const db = await loadCatalogDb();
  await db.ensureDatabase();
  const { processEventTriggersForEnvelope } = await import('../src/eventTriggerProcessor');

  await db.createJobDefinition({
    slug: 'noop-job',
    name: 'Noop Job',
    type: 'manual',
    runtime: 'node',
    entryPoint: 'tests.noop',
    parametersSchema: {},
    defaultParameters: {},
    outputSchema: {}
  });

  const workflow = await db.createWorkflowDefinition({
    slug: `wf-${randomUUID()}`.toLowerCase(),
    name: 'Event Trigger Workflow',
    steps: [
      {
        id: 'step-1',
        name: 'Noop Step',
        type: 'job',
        jobSlug: 'noop-job'
      }
    ],
    triggers: [{ type: 'manual' }]
  });

  const trigger = await db.createWorkflowEventTrigger({
    workflowDefinitionId: workflow.id,
    name: 'Metastore Updated',
    description: 'fires on metastore updates',
    eventType: 'metastore.record.updated',
    eventSource: 'metastore.api',
    predicates: [
      {
        type: 'jsonPath',
        path: '$.payload.namespace',
        operator: 'equals',
        value: 'feature-flags'
      },
      {
        type: 'jsonPath',
        path: '$.payload.status',
        operator: 'in',
        values: ['active', 'pending']
      }
    ],
    parameterTemplate: {
      namespace: '{{ event.payload.namespace }}',
      status: '{{ event.payload.status }}'
    },
    throttleWindowMs: 60_000,
    throttleCount: 5,
    maxConcurrency: 3,
    idempotencyKeyExpression: '{{ event.id }}',
    metadata: { source: 'test' },
    status: 'active',
    createdBy: 'event-trigger-test'
  });

  assert.equal(trigger.workflowDefinitionId, workflow.id);
  assert.equal(trigger.status, 'active');
  assert.equal(trigger.predicates.length, 2);
  assert.equal(trigger.throttleWindowMs, 60_000);
  assert.equal(trigger.maxConcurrency, 3);
  assert.equal(trigger.idempotencyKeyExpression, '{{ event.id }}');

  const listedForWorkflow = await db.listWorkflowEventTriggers({ workflowDefinitionId: workflow.id });
  assert.equal(listedForWorkflow.length, 1);
  assert.equal(listedForWorkflow[0].id, trigger.id);

  const updated = await db.updateWorkflowEventTrigger(trigger.id, {
    name: 'Metastore Updated (disabled)',
    status: 'disabled',
    eventSource: null,
    predicates: [
      {
        type: 'jsonPath',
        path: '$.payload.namespace',
        operator: 'equals',
        value: 'feature-flags'
      }
    ],
    metadata: { source: 'test', updated: true },
    updatedBy: 'event-trigger-test'
  });

  assert.ok(updated, 'expected trigger to update');
  assert.equal(updated?.status, 'disabled');
  assert.equal(updated?.predicates.length, 1);
  assert.equal(updated?.version, trigger.version + 1);
  assert.equal(updated?.eventSource, null);

  const getById = await db.getWorkflowEventTriggerById(trigger.id);
  assert.ok(getById);
  assert.equal(getById?.name, 'Metastore Updated (disabled)');

  const disabledList = await db.listWorkflowEventTriggers({ status: 'disabled' });
  assert.equal(disabledList.length >= 1, true);

  const delivery = await db.createWorkflowTriggerDelivery({
    triggerId: trigger.id,
    workflowDefinitionId: workflow.id,
    eventId: `event-${randomUUID()}`,
    status: 'pending',
    attempts: 0
  });

  assert.equal(delivery.status, 'pending');
  assert.equal(delivery.attempts, 0);

  const updatedDelivery = await db.updateWorkflowTriggerDelivery(delivery.id, {
    status: 'matched',
    attempts: 1,
    workflowRunId: `run-${randomUUID()}`
  });

  assert.ok(updatedDelivery);
  assert.equal(updatedDelivery?.status, 'matched');
  assert.equal(updatedDelivery?.attempts, 1);

  const deliveries = await db.listWorkflowTriggerDeliveries({ triggerId: trigger.id });
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].status, 'matched');

  const activeTrigger = await db.createWorkflowEventTrigger({
    workflowDefinitionId: workflow.id,
    name: 'Metastore Updated (active)',
    eventType: 'metastore.record.updated',
    predicates: [
      {
        type: 'jsonPath',
        path: '$.payload.namespace',
        operator: 'equals',
        value: 'feature-flags'
      }
    ],
    parameterTemplate: {
      namespace: '{{ event.payload.namespace }}'
    },
    status: 'active',
    createdBy: 'event-trigger-test'
  });

  const envelope = normalizeEventEnvelope({
    type: 'metastore.record.updated',
    source: 'metastore.worker',
    payload: {
      namespace: 'feature-flags',
      status: 'active'
    }
  });

  await processEventTriggersForEnvelope(envelope);

  const triggerDeliveries = await db.listWorkflowTriggerDeliveries({ triggerId: activeTrigger.id });
  assert.equal(triggerDeliveries.length, 1);
  assert.equal(triggerDeliveries[0].status, 'launched');

  const runs = await db.listWorkflowRunsForDefinition(workflow.id, { limit: 5 });
  const eventRun = runs.find((run) => run.triggeredBy === 'event-trigger');
  assert.ok(eventRun, 'expected event-triggered workflow run');
  const runParameters = (eventRun?.parameters ?? {}) as Record<string, unknown>;
  assert.equal(runParameters.namespace, 'feature-flags');
}

async function testEventTriggerApi(): Promise<void> {
  process.env.APPHUB_AUTH_DISABLED = '1';
  await ensureEmbeddedPostgres();
  const db = await loadCatalogDb();
  await db.ensureDatabase();

  const { buildServer } = await import('../src/server');
  const app = await buildServer();

  try {
    await db.createJobDefinition({
      slug: 'api-noop-job',
      name: 'API Noop Job',
      type: 'manual',
      runtime: 'node',
      entryPoint: 'tests.noop',
      parametersSchema: {},
      defaultParameters: {},
      outputSchema: {}
    });

    const workflow = await db.createWorkflowDefinition({
      slug: `api-wf-${randomUUID()}`.toLowerCase(),
      name: 'API Trigger Workflow',
      steps: [
        {
          id: 'step-1',
          name: 'Noop',
          type: 'job',
          jobSlug: 'api-noop-job'
        }
      ],
      triggers: [{ type: 'manual' }]
    });

    const createResponse = await app.inject({
      method: 'POST',
      url: `/workflows/${workflow.slug}/triggers`,
      payload: {
        name: 'API Trigger',
        description: 'Created via API test',
        eventType: 'metastore.record.created',
        eventSource: 'metastore.api',
        predicates: [
          {
            path: '$.payload.namespace',
            operator: 'equals',
            value: 'api-tests'
          }
        ],
        parameterTemplate: {
          namespace: '{{ event.payload.namespace }}'
        }
      }
    });

    assert.equal(createResponse.statusCode, 201);
    const createdBody = createResponse.json() as { data: { id: string; status: string } };
    const createdTrigger = createdBody.data;

    const listResponse = await app.inject({
      method: 'GET',
      url: `/workflows/${workflow.slug}/triggers`
    });
    assert.equal(listResponse.statusCode, 200);
    const listBody = listResponse.json() as { data: { triggers: Array<{ id: string }> } };
    assert.equal(listBody.data.triggers.length, 1);

    const getResponse = await app.inject({
      method: 'GET',
      url: `/workflows/${workflow.slug}/triggers/${createdTrigger.id}`
    });
    assert.equal(getResponse.statusCode, 200);
    const fetched = getResponse.json() as { data: { id: string; status: string } };
    assert.equal(fetched.data.id, createdTrigger.id);

    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/workflows/${workflow.slug}/triggers/${createdTrigger.id}`,
      payload: {
        status: 'disabled',
        description: 'updated via API'
      }
    });
    assert.equal(updateResponse.statusCode, 200);
    const updated = updateResponse.json() as { data: { status: string; description: string | null } };
    assert.equal(updated.data.status, 'disabled');

    await db.createWorkflowTriggerDelivery({
      triggerId: createdTrigger.id,
      workflowDefinitionId: workflow.id,
      eventId: `evt-${randomUUID()}`,
      status: 'matched'
    });

    const deliveriesResponse = await app.inject({
      method: 'GET',
      url: `/workflows/${workflow.slug}/triggers/${createdTrigger.id}/deliveries?status=matched&limit=5`
    });
    assert.equal(deliveriesResponse.statusCode, 200);
    const deliveriesBody = deliveriesResponse.json() as { data: Array<{ id: string; status: string }> };
    assert.equal(deliveriesBody.data.length, 1);
    assert.equal(deliveriesBody.data[0].status, 'matched');

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/workflows/${workflow.slug}/triggers/${createdTrigger.id}`
    });
    assert.equal(deleteResponse.statusCode, 204);

    const afterDelete = await app.inject({
      method: 'GET',
      url: `/workflows/${workflow.slug}/triggers/${createdTrigger.id}`
    });
    assert.equal(afterDelete.statusCode, 404);
  } finally {
    await app.close();
  }
}

runE2E(async ({ registerCleanup }) => {
  registerCleanup(() => shutdownEmbeddedPostgres());
  await testEventTriggerCrud();
  await testEventTriggerApi();
}, { name: 'catalog-event-triggers.e2e' });

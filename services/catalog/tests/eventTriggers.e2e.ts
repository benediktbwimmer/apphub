import './setupTestEnv';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
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
}

runE2E(async ({ registerCleanup }) => {
  registerCleanup(() => shutdownEmbeddedPostgres());
  await testEventTriggerCrud();
}, { name: 'catalog-event-triggers.e2e' });

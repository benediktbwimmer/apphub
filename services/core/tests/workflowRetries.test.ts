import './setupTestEnv';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEmbeddedPostgres, stopEmbeddedPostgres } from '@apphub/test-helpers';
import type EmbeddedPostgres from 'embedded-postgres';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import type { JobRetryPolicy, WorkflowDefinitionRecord } from '../src/db/types';
import { runWorkflowOrchestration } from '../src/workflowOrchestrator';
import { resetDatabasePool } from '../src/db/client';
import {
  WORKFLOW_RETRY_JOB_NAME,
  closeQueueConnection,
  type WorkflowRetryJobData
} from '../src/queue';
import { queueManager } from '../src/queueManager';

let embeddedPostgres: EmbeddedPostgres | null = null;
let embeddedCleanup: (() => Promise<void>) | null = null;
let embeddedDatabaseUrl: string | null = null;

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
    if (embeddedDatabaseUrl) {
      process.env.DATABASE_URL = embeddedDatabaseUrl;
      await resetDatabasePool({ connectionString: embeddedDatabaseUrl });
    }
    return;
  }

  const dataRoot = await mkdtemp(path.join(tmpdir(), 'apphub-workflow-retry-pg-'));
  const port = await findAvailablePort();

  const postgres: EmbeddedPostgres = createEmbeddedPostgres({
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
  embeddedDatabaseUrl = process.env.DATABASE_URL;
  await resetDatabasePool({ connectionString: embeddedDatabaseUrl, max: 6 });

  embeddedPostgres = postgres;
  embeddedCleanup = async () => {
    try {
      await stopEmbeddedPostgres(postgres);
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
  embeddedDatabaseUrl = null;
  await cleanup();
}

async function prepareDatabase() {
  const db = await import('../src/db');
  if (typeof db.markDatabaseUninitialized === 'function') {
    db.markDatabaseUninitialized();
  }
  await db.ensureDatabase();
  return db;
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

async function runInlineWorkflowRetryScenario(options: { retryPolicy?: JobRetryPolicy | null } = {}) {
  const { retryPolicy } = options;
  const previousEventsMode = process.env.APPHUB_EVENTS_MODE;
  const previousRedisUrl = process.env.REDIS_URL;
  const previousInlineAllowed = process.env.APPHUB_ALLOW_INLINE_MODE;
  const previousBase = process.env.WORKFLOW_RETRY_BASE_MS;
  const previousFactor = process.env.WORKFLOW_RETRY_FACTOR;
  const previousMax = process.env.WORKFLOW_RETRY_MAX_MS;
  const previousJitter = process.env.WORKFLOW_RETRY_JITTER_RATIO;

  process.env.APPHUB_EVENTS_MODE = 'inline';
  process.env.APPHUB_ALLOW_INLINE_MODE = '1';
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  process.env.WORKFLOW_RETRY_BASE_MS = '500';
  process.env.WORKFLOW_RETRY_FACTOR = '2';
  process.env.WORKFLOW_RETRY_MAX_MS = '10000';
  process.env.WORKFLOW_RETRY_JITTER_RATIO = '0';

  await ensureEmbeddedPostgres();
  let dbModule: typeof import('../src/db') | null = null;

  try {
    dbModule = await prepareDatabase();
    const db = dbModule;

    const definition = await db.createWorkflowDefinition({
      slug: `wf-retry-${randomUUID()}`.toLowerCase(),
      name: 'Retry Workflow',
      steps: [
        {
          id: 'service-step',
          name: 'Missing Service',
          type: 'service',
          serviceSlug: 'missing-service',
          request: {
            method: 'GET',
            path: '/healthz'
          },
          ...(retryPolicy ? { retryPolicy } : {})
        }
      ]
    });

    const run = await db.createWorkflowRun((definition as WorkflowDefinitionRecord).id, {
      status: 'running'
    });

    await runWorkflowOrchestration(run.id);

    const refreshedRun = await db.getWorkflowRunById(run.id);
    const stepRecord = await db.getWorkflowRunStep(run.id, 'service-step');
    assert.ok(stepRecord, 'expected step record to exist');
    assert.equal(stepRecord?.status, 'pending');
    assert.equal(stepRecord?.retryState, 'scheduled');
    assert.equal(stepRecord?.retryAttempts, 1);
    assert.ok(stepRecord?.nextAttemptAt, 'expected nextAttemptAt to be populated');

    assert.ok(refreshedRun, 'expected run to exist');
    assert.equal(refreshedRun?.status, 'running');
  } finally {
    if (dbModule) {
      await dbModule.closePool().catch(() => undefined);
    }
    process.env.APPHUB_EVENTS_MODE = 'inline';
    await closeQueueConnection().catch(() => undefined);
    restoreEnv('APPHUB_EVENTS_MODE', previousEventsMode);
    restoreEnv('REDIS_URL', previousRedisUrl);
    restoreEnv('APPHUB_ALLOW_INLINE_MODE', previousInlineAllowed);
    restoreEnv('WORKFLOW_RETRY_BASE_MS', previousBase);
    restoreEnv('WORKFLOW_RETRY_FACTOR', previousFactor);
    restoreEnv('WORKFLOW_RETRY_MAX_MS', previousMax);
    restoreEnv('WORKFLOW_RETRY_JITTER_RATIO', previousJitter);
    await shutdownEmbeddedPostgres();
  }
}

async function runQueuedWorkflowRetryScenario() {
  const previousEventsMode = process.env.APPHUB_EVENTS_MODE;
  const previousRedisUrl = process.env.REDIS_URL;
  const previousBase = process.env.WORKFLOW_RETRY_BASE_MS;
  const previousFactor = process.env.WORKFLOW_RETRY_FACTOR;
  const previousMax = process.env.WORKFLOW_RETRY_MAX_MS;
  const previousJitter = process.env.WORKFLOW_RETRY_JITTER_RATIO;

  process.env.APPHUB_EVENTS_MODE = 'redis';
  process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  process.env.WORKFLOW_RETRY_BASE_MS = '100';
  process.env.WORKFLOW_RETRY_FACTOR = '2';
  process.env.WORKFLOW_RETRY_MAX_MS = '500';
  process.env.WORKFLOW_RETRY_JITTER_RATIO = '0';

  const scheduled: Array<{
    name: string;
    data: WorkflowRetryJobData;
    delay: number;
    jobId: string | undefined;
  }> = [];

  const originalIsInlineMode = queueManager.isInlineMode;
  const originalGetQueue = queueManager.getQueue;

  (queueManager as unknown as { isInlineMode: () => boolean }).isInlineMode = () => false;
  (queueManager as unknown as { getQueue: typeof queueManager.getQueue }).getQueue = (() => {
    return {
      add: async (
        name: string,
        data: WorkflowRetryJobData,
        opts: { delay?: number; jobId?: string }
      ) => {
        scheduled.push({ name, data, delay: opts.delay ?? 0, jobId: opts.jobId });
        return undefined as unknown;
      }
    } as unknown as ReturnType<typeof queueManager.getQueue<WorkflowRetryJobData>>;
  }) as typeof queueManager.getQueue;

  await ensureEmbeddedPostgres();
  let dbModule: typeof import('../src/db') | null = null;

  try {
    dbModule = await prepareDatabase();
    const db = dbModule;

    const definition = await db.createWorkflowDefinition({
      slug: `wf-retry-queue-${randomUUID()}`.toLowerCase(),
      name: 'Queue Retry Workflow',
      steps: [
        {
          id: 'service-step',
          name: 'Missing Service',
          type: 'service',
          serviceSlug: 'missing-service',
          request: {
            method: 'GET',
            path: '/healthz'
          },
          retryPolicy: {
            maxAttempts: 3,
            strategy: 'fixed',
            initialDelayMs: 100
          }
        }
      ]
    });

    const run = await db.createWorkflowRun((definition as WorkflowDefinitionRecord).id, {
      status: 'running'
    });

    await runWorkflowOrchestration(run.id);

    assert.equal(scheduled.length, 1, 'expected initial retry job to be scheduled');
    assert.equal(scheduled[0]?.name, WORKFLOW_RETRY_JOB_NAME);
    assert.equal(scheduled[0]?.data.workflowRunId, run.id);
    assert.equal(scheduled[0]?.data.retryKind, 'workflow');
    assert.ok(scheduled[0]?.delay >= 0, 'expected retry delay to be non-negative');

    const firstStepState = await db.getWorkflowRunStep(run.id, 'service-step');
    assert.ok(firstStepState, 'expected step record after initial scheduling');
    assert.equal(firstStepState?.retryAttempts, 1);
    assert.equal(firstStepState?.retryState, 'scheduled');

    await runWorkflowOrchestration(run.id);

    assert.equal(scheduled.length, 2, 'expected retry to be re-scheduled after orchestration');
    const secondSchedule = scheduled[1];
    assert.equal(secondSchedule?.name, WORKFLOW_RETRY_JOB_NAME);
    assert.equal(secondSchedule?.data.workflowRunId, run.id);
    assert.equal(secondSchedule?.data.retryKind, 'workflow');

    const stepAfterSecondRun = await db.getWorkflowRunStep(run.id, 'service-step');
    assert.ok(stepAfterSecondRun, 'expected step state after requeue');
    assert.equal(stepAfterSecondRun?.retryAttempts, 2);
    assert.equal(stepAfterSecondRun?.retryState, 'scheduled');
    assert.ok(stepAfterSecondRun?.nextAttemptAt, 'expected next attempt timestamp after requeue');
  } finally {
    (queueManager as unknown as { isInlineMode: typeof queueManager.isInlineMode }).isInlineMode =
      originalIsInlineMode;
    (queueManager as unknown as { getQueue: typeof queueManager.getQueue }).getQueue = originalGetQueue;
    scheduled.length = 0;

    if (dbModule) {
      await dbModule.closePool().catch(() => undefined);
    }
    await closeQueueConnection().catch(() => undefined);
    restoreEnv('APPHUB_EVENTS_MODE', previousEventsMode);
    restoreEnv('REDIS_URL', previousRedisUrl);
    restoreEnv('WORKFLOW_RETRY_BASE_MS', previousBase);
    restoreEnv('WORKFLOW_RETRY_FACTOR', previousFactor);
    restoreEnv('WORKFLOW_RETRY_MAX_MS', previousMax);
    restoreEnv('WORKFLOW_RETRY_JITTER_RATIO', previousJitter);
    await shutdownEmbeddedPostgres();
  }
}

async function runWorkflowRetrySettlesAfterSuccessScenario() {
  const previousEventsMode = process.env.APPHUB_EVENTS_MODE;
  const previousRedisUrl = process.env.REDIS_URL;
  const previousBase = process.env.WORKFLOW_RETRY_BASE_MS;
  const previousFactor = process.env.WORKFLOW_RETRY_FACTOR;
  const previousMax = process.env.WORKFLOW_RETRY_MAX_MS;
  const previousJitter = process.env.WORKFLOW_RETRY_JITTER_RATIO;

  process.env.APPHUB_EVENTS_MODE = 'inline';
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  process.env.WORKFLOW_RETRY_BASE_MS = '500';
  process.env.WORKFLOW_RETRY_FACTOR = '2';
  process.env.WORKFLOW_RETRY_MAX_MS = '10000';
  process.env.WORKFLOW_RETRY_JITTER_RATIO = '0';

  await ensureEmbeddedPostgres();
  let dbModule: typeof import('../src/db') | null = null;

  const jobSlug = `retry-success-${randomUUID()}`.toLowerCase();
  const { registerJobHandler } = await import('../src/jobs/runtime');
  let attemptCount = 0;
  registerJobHandler(jobSlug, async () => {
    attemptCount += 1;
    if (attemptCount === 1) {
      return {
        status: 'failed',
        errorMessage: 'planned failure'
      };
    }
    return {
      status: 'succeeded',
      result: { attempt: attemptCount }
    };
  });

  try {
    dbModule = await prepareDatabase();
    const db = dbModule;

    await db.createJobDefinition({
      slug: jobSlug,
      name: 'Retry Success Job',
      type: 'manual',
      runtime: 'node',
      entryPoint: `tests.${jobSlug}`,
      timeoutMs: 10_000,
      retryPolicy: { maxAttempts: 3 },
      parametersSchema: {},
      defaultParameters: {}
    });

    const definition = await db.createWorkflowDefinition({
      slug: `wf-retry-success-${randomUUID()}`.toLowerCase(),
      name: 'Retry Success Workflow',
      steps: [
        {
          id: 'retry-job',
          name: 'Retry Job',
          type: 'job',
          jobSlug,
          retryPolicy: {
            maxAttempts: 3,
            strategy: 'fixed',
            initialDelayMs: 100
          }
        }
      ]
    });

    const run = await db.createWorkflowRun((definition as WorkflowDefinitionRecord).id, {
      status: 'running'
    });

    await runWorkflowOrchestration(run.id);

    const stepAfterFailure = await db.getWorkflowRunStep(run.id, 'retry-job');
    assert.ok(stepAfterFailure, 'expected step after initial failure');
    assert.equal(stepAfterFailure?.status, 'pending');
    assert.equal(stepAfterFailure?.retryState, 'scheduled');
    assert.equal(stepAfterFailure?.retryAttempts, 1);

    await runWorkflowOrchestration(run.id);

    const completedStep = await db.getWorkflowRunStep(run.id, 'retry-job');
    assert.ok(completedStep, 'expected step after retry success');
    assert.equal(completedStep?.status, 'succeeded');
    assert.equal(completedStep?.retryState, 'completed');
    assert.equal(completedStep?.nextAttemptAt, null);
    assert.ok(completedStep?.completedAt, 'expected completedAt to be set');
    assert.equal(completedStep?.retryAttempts, 1);

    const refreshedRun = await db.getWorkflowRunById(run.id);
    assert.ok(refreshedRun, 'expected refreshed workflow run');
    assert.equal(refreshedRun?.status, 'succeeded');
    assert.equal(attemptCount, 2);
  } finally {
    if (dbModule) {
      await dbModule.closePool().catch(() => undefined);
    }
    await closeQueueConnection().catch(() => undefined);
    restoreEnv('APPHUB_EVENTS_MODE', previousEventsMode);
    restoreEnv('REDIS_URL', previousRedisUrl);
    restoreEnv('WORKFLOW_RETRY_BASE_MS', previousBase);
    restoreEnv('WORKFLOW_RETRY_FACTOR', previousFactor);
    restoreEnv('WORKFLOW_RETRY_MAX_MS', previousMax);
    restoreEnv('WORKFLOW_RETRY_JITTER_RATIO', previousJitter);
    await shutdownEmbeddedPostgres();
  }
}

test('workflow workflow retries persist during throttling and failures', async (t) => {
  await t.test('workflow step retry schedules durable state when service missing', async () => {
    await runInlineWorkflowRetryScenario({
      retryPolicy: {
        maxAttempts: 3,
        strategy: 'fixed',
        initialDelayMs: 200
      }
    });
  });

  await t.test('workflow step retry schedules without explicit retry policy', async () => {
    await runInlineWorkflowRetryScenario();
  });

  await t.test('workflow retry enqueues durable job for subsequent processing', async () => {
    await runQueuedWorkflowRetryScenario();
  });

  await t.test('workflow step clears retry state after succeeding following a retry', async () => {
    await runWorkflowRetrySettlesAfterSuccessScenario();
  });
});

import './setupTestEnv';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { FastifyInstance } from 'fastify';
import type { JobRunContext, JobResult } from '../src/jobs/runtime';

let embeddedPostgres: EmbeddedPostgres | null = null;
let embeddedPostgresCleanup: (() => Promise<void>) | null = null;

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

  const dataRoot = await mkdtemp(path.join(tmpdir(), 'apphub-workflows-pg-'));
  const port = await findAvailablePort();

  const postgres = new EmbeddedPostgres({
    databaseDir: dataRoot,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false
  });

  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('apphub');

  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.PGPOOL_MAX = '8';

  embeddedPostgresCleanup = async () => {
    try {
      await postgres.stop();
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  };
  embeddedPostgres = postgres;
}

async function shutdownEmbeddedPostgres(): Promise<void> {
  const cleanup = embeddedPostgresCleanup;
  embeddedPostgres = null;
  embeddedPostgresCleanup = null;
  if (cleanup) {
    await cleanup();
  }
}

async function withServer(fn: (app: FastifyInstance) => Promise<void>): Promise<void> {
  await ensureEmbeddedPostgres();
  process.env.REDIS_URL = 'inline';
  const { buildServer } = await import('../src/server');
  const app = await buildServer();
  await app.ready();
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

async function registerWorkflowTestHandlers() {
  const { registerJobHandler } = await import('../src/jobs/runtime');

  registerJobHandler('workflow-step-one', async (context: JobRunContext): Promise<JobResult> => {
    const startedAt = Date.now();
    await context.update({ metrics: { step: 'one-started', startedAt } });
    return {
      status: 'succeeded',
      result: {
        step: 'one',
        parameters: context.parameters
      },
      logsUrl: 'https://example.com/logs/one'
    };
  });

  registerJobHandler('workflow-step-two', async (context: JobRunContext): Promise<JobResult> => {
    const shouldFail =
      context.parameters && typeof context.parameters === 'object' && !Array.isArray(context.parameters)
        ? Boolean((context.parameters as Record<string, unknown>).shouldFail)
        : false;
    if (shouldFail) {
      throw new Error('step-two failure requested');
    }
    return {
      status: 'succeeded',
      result: {
        step: 'two',
        parameters: context.parameters
      },
      logsUrl: 'https://example.com/logs/two'
    };
  });
}

async function createJobDefinition(app: FastifyInstance, payload: { slug: string; name: string }) {
  const response = await app.inject({
    method: 'POST',
    url: '/jobs',
    payload: {
      slug: payload.slug,
      name: payload.name,
      type: 'manual',
      entryPoint: `tests.${payload.slug}`,
      timeoutMs: 5_000,
      retryPolicy: { maxAttempts: 2 },
      parametersSchema: { type: 'object' },
      defaultParameters: {}
    }
  });
  assert.equal(response.statusCode, 201);
}

async function testWorkflowEndpoints(): Promise<void> {
  await ensureEmbeddedPostgres();
  await registerWorkflowTestHandlers();

  await withServer(async (app) => {
    await createJobDefinition(app, { slug: 'workflow-step-one', name: 'Workflow Step One' });
    await createJobDefinition(app, { slug: 'workflow-step-two', name: 'Workflow Step Two' });

    const createWorkflowResponse = await app.inject({
      method: 'POST',
      url: '/workflows',
      payload: {
        slug: 'wf-demo',
        name: 'Workflow Demo',
        description: 'Two step workflow for testing',
        steps: [
          {
            id: 'step-one',
            name: 'Step One',
            jobSlug: 'workflow-step-one'
          },
          {
            id: 'step-two',
            name: 'Step Two',
            jobSlug: 'workflow-step-two',
            dependsOn: ['step-one']
          }
        ],
        metadata: { purpose: 'test' }
      }
    });
    assert.equal(createWorkflowResponse.statusCode, 201);
    const createdWorkflow = JSON.parse(createWorkflowResponse.payload) as { data: { slug: string } };
    assert.equal(createdWorkflow.data.slug, 'wf-demo');

    const listResponse = await app.inject({ method: 'GET', url: '/workflows' });
    assert.equal(listResponse.statusCode, 200);
    const listBody = JSON.parse(listResponse.payload) as { data: Array<{ slug: string }> };
    assert(listBody.data.some((item) => item.slug === 'wf-demo'));

    const fetchWorkflowResponse = await app.inject({ method: 'GET', url: '/workflows/wf-demo' });
    assert.equal(fetchWorkflowResponse.statusCode, 200);
    const fetchWorkflowBody = JSON.parse(fetchWorkflowResponse.payload) as {
      data: { workflow: { slug: string; steps: unknown[] }; runs: unknown[] };
    };
    assert.equal(fetchWorkflowBody.data.workflow.slug, 'wf-demo');
    assert.equal(fetchWorkflowBody.data.workflow.steps.length, 2);
    assert.equal(fetchWorkflowBody.data.runs.length, 0);

    const triggerResponse = await app.inject({
      method: 'POST',
      url: '/workflows/wf-demo/run',
      payload: {
        parameters: { tenant: 'acme' }
      }
    });
    assert.equal(triggerResponse.statusCode, 202);
    const triggerBody = JSON.parse(triggerResponse.payload) as { data: { id: string; status: string } };
    assert.equal(triggerBody.data.status, 'succeeded');
    const runId = triggerBody.data.id;

    const fetchRunResponse = await app.inject({ method: 'GET', url: `/workflow-runs/${runId}` });
    assert.equal(fetchRunResponse.statusCode, 200);
    const runBody = JSON.parse(fetchRunResponse.payload) as {
      data: { id: string; status: string; metrics: { totalSteps: number; completedSteps: number }; context: { steps: Record<string, { status: string }> } };
    };
    assert.equal(runBody.data.status, 'succeeded');
    assert.equal(runBody.data.metrics.totalSteps, 2);
    assert.equal(runBody.data.metrics.completedSteps, 2);
    assert.equal(runBody.data.context.steps['step-one'].status, 'succeeded');
    assert.equal(runBody.data.context.steps['step-two'].status, 'succeeded');

    const runStepsResponse = await app.inject({ method: 'GET', url: `/workflow-runs/${runId}/steps` });
    assert.equal(runStepsResponse.statusCode, 200);
    const runStepsBody = JSON.parse(runStepsResponse.payload) as {
      data: { steps: Array<{ stepId: string; status: string }> };
    };
    assert.equal(runStepsBody.data.steps.length, 2);
    assert(runStepsBody.data.steps.every((step) => step.status === 'succeeded'));

    const failureResponse = await app.inject({
      method: 'POST',
      url: '/workflows/wf-demo/run',
      payload: {
        parameters: { shouldFail: true }
      }
    });
    assert.equal(failureResponse.statusCode, 202);
    const failureBody = JSON.parse(failureResponse.payload) as { data: { id: string; status: string; errorMessage: string | null } };
    assert.equal(failureBody.data.status, 'failed');
    assert(failureBody.data.errorMessage);
    const failedRunId = failureBody.data.id;

    const failedRunStepsResponse = await app.inject({ method: 'GET', url: `/workflow-runs/${failedRunId}/steps` });
    assert.equal(failedRunStepsResponse.statusCode, 200);
    const failedStepsBody = JSON.parse(failedRunStepsResponse.payload) as {
      data: { steps: Array<{ stepId: string; status: string }> };
    };
    const failedStepStatuses = failedStepsBody.data.steps.reduce<Record<string, string>>((acc, step) => {
      acc[step.stepId] = step.status;
      return acc;
    }, {});
    assert.equal(failedStepStatuses['step-one'], 'succeeded');
    assert.equal(failedStepStatuses['step-two'], 'failed');

    const runsListResponse = await app.inject({ method: 'GET', url: '/workflows/wf-demo/runs' });
    assert.equal(runsListResponse.statusCode, 200);
    const runsListBody = JSON.parse(runsListResponse.payload) as {
      data: { runs: Array<{ id: string }> };
    };
    assert(runsListBody.data.runs.some((run) => run.id === runId));
    assert(runsListBody.data.runs.some((run) => run.id === failedRunId));
  });
}

async function run() {
  try {
    await testWorkflowEndpoints();
  } finally {
    await shutdownEmbeddedPostgres();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

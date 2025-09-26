import './setupTestEnv';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import net from 'node:net';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { FastifyInstance } from 'fastify';
import type { JobRunContext, JobResult } from '../src/jobs/runtime';
import { refreshSecretStore } from '../src/secretStore';
import { emitApphubEvent } from '../src/events';
import { runE2E } from '@apphub/test-helpers';
let embeddedPostgres: EmbeddedPostgres | null = null;
let embeddedPostgresCleanup: (() => Promise<void>) | null = null;

process.env.SERVICE_REGISTRY_TOKEN = 'test-token';
const SERVICE_SECRET_VALUE = 'workflow-secret-token';
process.env.TEST_SERVICE_TOKEN = 'env-token-unused';

const OPERATOR_TOKEN = 'jobs-e2e-operator-token';

process.env.APPHUB_OPERATOR_TOKENS = JSON.stringify([
  {
    subject: 'workflows-e2e',
    token: OPERATOR_TOKEN,
    scopes: ['jobs:write', 'jobs:run', 'workflows:write', 'workflows:run']
  }
]);

process.env.APPHUB_SECRET_STORE = JSON.stringify({
  TEST_SERVICE_TOKEN: { value: SERVICE_SECRET_VALUE, version: 'v1' }
});
refreshSecretStore();

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

type TestServiceController = {
  port: number;
  url: string;
  close: () => Promise<void>;
  setMode: (mode: 'success' | 'fail-once' | 'always-fail') => void;
  getRequestCount: () => number;
};

async function startTestService(): Promise<TestServiceController> {
  let mode: 'success' | 'fail-once' | 'always-fail' = 'success';
  let requestCount = 0;
  const port = await findAvailablePort();

  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url && req.url.startsWith('/hook')) {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      });
      req.on('end', () => {
        requestCount += 1;
        const bodyRaw = Buffer.concat(chunks).toString('utf8');
        let parsedBody: unknown = null;
        if (bodyRaw) {
          try {
            parsedBody = JSON.parse(bodyRaw);
          } catch {
            parsedBody = bodyRaw;
          }
        }

        const expectedAuth = `Bearer ${SERVICE_SECRET_VALUE}`;
        if (req.headers.authorization !== expectedAuth) {
          res.statusCode = 401;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }

        if (mode === 'fail-once') {
          mode = 'success';
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'temporary' }));
          return;
        }

        if (mode === 'always-fail') {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'unavailable' }));
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            ok: true,
            attempt: requestCount,
            body: parsedBody
          })
        );
      });
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  });

  await new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', resolve);
  });

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },
    setMode(nextMode) {
      mode = nextMode;
    },
    getRequestCount() {
      return requestCount;
    }
  } satisfies TestServiceController;
}

async function registerTestService(app: FastifyInstance, controller: TestServiceController) {
  const response = await app.inject({
    method: 'POST',
    url: '/services',
    headers: {
      Authorization: `Bearer ${process.env.SERVICE_REGISTRY_TOKEN}`
    },
    payload: {
      slug: 'test-service',
      displayName: 'Test Service',
      kind: 'test',
      baseUrl: controller.url,
      status: 'healthy'
    }
  });
  assert.equal(response.statusCode, 201);
}

async function setTestServiceStatus(app: FastifyInstance, status: 'healthy' | 'degraded') {
  const response = await app.inject({
    method: 'PATCH',
    url: '/services/test-service',
    headers: {
      Authorization: `Bearer ${process.env.SERVICE_REGISTRY_TOKEN}`
    },
    payload: {
      status
    }
  });
  assert.equal(response.statusCode, 200);
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

  registerJobHandler('fanout-source', async (): Promise<JobResult> => {
    return {
      status: 'succeeded',
      result: {
        items: [
          { id: 'alpha', value: 1 },
          { id: 'beta', value: 2 }
        ]
      }
    };
  });

  registerJobHandler('fanout-child', async (context: JobRunContext): Promise<JobResult> => {
    const parameters = context.parameters as { item?: { id?: unknown; value?: unknown }; index?: unknown };
    const item = parameters?.item ?? context.parameters;
    assert(item && typeof item === 'object' && !Array.isArray(item));
    const id = String((item as { id?: unknown }).id ?? 'unknown');
    const valueRaw = (item as { value?: unknown }).value;
    const value = typeof valueRaw === 'number' ? valueRaw : Number(valueRaw ?? 0);
    const index = typeof parameters?.index === 'number' ? parameters.index : null;

    return {
      status: 'succeeded',
      result: {
        id,
        doubled: value * 2,
        index
      }
    };
  });

  registerJobHandler('fanout-collector', async (context: JobRunContext): Promise<JobResult> => {
    const params = context.parameters as { items?: unknown };
    const items = Array.isArray(params?.items) ? params?.items : [];
    return {
      status: 'succeeded',
      result: {
        receivedCount: items.length
      }
    };
  });

  registerJobHandler('workflow-asset-producer', async (context: JobRunContext): Promise<JobResult> => {
    const params = (context.parameters as { count?: unknown }) ?? {};
    const countRaw = params.count;
    const count =
      typeof countRaw === 'number'
        ? countRaw
        : Number.parseFloat(typeof countRaw === 'string' ? countRaw : '') || 0;
    const producedAt = new Date().toISOString();
    return {
      status: 'succeeded',
      result: {
        assets: [
          {
            assetId: 'inventory.dataset',
            payload: { count },
            schema: {
              type: 'object',
              properties: {
                count: { type: 'number' }
              }
            },
            freshness: { ttlMs: 3_600_000 },
            producedAt
          }
        ]
      }
    };
  });

  registerJobHandler('workflow-partitioned-producer', async (context: JobRunContext): Promise<JobResult> => {
    const params = (context.parameters as { value?: unknown }) ?? {};
    const valueRaw = params.value;
    const value =
      typeof valueRaw === 'number'
        ? valueRaw
        : Number.parseFloat(typeof valueRaw === 'string' ? valueRaw : '') || 0;
    return {
      status: 'succeeded',
      result: {
        assets: [
          {
            assetId: 'reports.partitioned',
            payload: { value },
            schema: {
              type: 'object',
              properties: {
                value: { type: 'number' }
              }
            }
          }
        ]
      }
    };
  });

  registerJobHandler('workflow-asset-consumer', async (): Promise<JobResult> => {
    return {
      status: 'succeeded',
      result: {
        consumed: true
      }
    };
  });
}

async function createJobDefinition(
  app: FastifyInstance,
  payload: { slug: string; name: string; entryPoint?: string }
) {
  const response = await app.inject({
    method: 'POST',
    url: '/jobs',
    headers: {
      Authorization: `Bearer ${OPERATOR_TOKEN}`
    },
    payload: {
      slug: payload.slug,
      name: payload.name,
      type: 'manual',
      entryPoint: payload.entryPoint ?? `tests.${payload.slug}`,
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
    await createJobDefinition(app, { slug: 'fanout-source', name: 'Fanout Source' });
    await createJobDefinition(app, { slug: 'fanout-child', name: 'Fanout Child' });
    await createJobDefinition(app, { slug: 'fanout-collector', name: 'Fanout Collector' });
    await createJobDefinition(app, { slug: 'workflow-asset-producer', name: 'Workflow Asset Producer' });
    await createJobDefinition(app, { slug: 'workflow-partitioned-producer', name: 'Workflow Partitioned Producer' });
    await createJobDefinition(app, { slug: 'workflow-asset-consumer', name: 'Workflow Asset Consumer' });

    const testService = await startTestService();
    await registerTestService(app, testService);

    try {
    const unauthorizedWorkflowResponse = await app.inject({
      method: 'POST',
      url: '/workflows',
      payload: {
        slug: 'wf-unauthorized',
        name: 'Unauthorized Workflow',
        steps: [
          {
            id: 'noop',
            name: 'Noop',
            jobSlug: 'workflow-step-one'
          }
        ]
      }
    });
    assert.equal(unauthorizedWorkflowResponse.statusCode, 401);

    const createWorkflowResponse = await app.inject({
      method: 'POST',
      url: '/workflows',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      },
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
            id: 'service-call',
            name: 'Service Call',
            type: 'service',
            serviceSlug: 'test-service',
            dependsOn: ['step-one'],
            retryPolicy: { maxAttempts: 2, strategy: 'fixed', initialDelayMs: 10 },
            request: {
              path: '/hook',
              method: 'POST',
              headers: {
                Authorization: {
                  secret: { source: 'store', key: 'TEST_SERVICE_TOKEN', version: 'v1' },
                  prefix: 'Bearer '
                }
              }
            },
            storeResponseAs: 'serviceResult',
            parameters: { action: 'workflow-test' }
          },
          {
            id: 'step-two',
            name: 'Step Two',
            jobSlug: 'workflow-step-two',
            dependsOn: ['service-call']
          }
        ],
        metadata: { purpose: 'test' }
      }
    });
    assert.equal(createWorkflowResponse.statusCode, 201);
    const createdWorkflow = JSON.parse(createWorkflowResponse.payload) as { data: { slug: string } };
    assert.equal(createdWorkflow.data.slug, 'wf-demo');

    const unauthorizedUpdateResponse = await app.inject({
      method: 'PATCH',
      url: '/workflows/wf-demo',
      payload: { name: 'Unauthorized Update' }
    });
    assert.equal(unauthorizedUpdateResponse.statusCode, 401);

    const updateWorkflowResponse = await app.inject({
      method: 'PATCH',
      url: '/workflows/wf-demo',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      },
      payload: {
        name: 'Workflow Demo Updated',
        description: null,
        version: 2,
        steps: [
          {
            id: 'step-one',
            name: 'Step One',
            jobSlug: 'workflow-step-one'
          },
          {
            id: 'service-call',
            name: 'Service Call',
            type: 'service',
            serviceSlug: 'test-service',
            dependsOn: ['step-one'],
            retryPolicy: { maxAttempts: 3, strategy: 'fixed', initialDelayMs: 10 },
            request: {
              path: '/hook',
              method: 'POST',
              headers: {
                Authorization: {
                  secret: { source: 'store', key: 'TEST_SERVICE_TOKEN', version: 'v1' },
                  prefix: 'Bearer '
                }
              },
              query: { tenant: 'acme' }
            },
            storeResponseAs: 'serviceResult',
            parameters: { action: 'workflow-test' }
          },
          {
            id: 'step-two',
            name: 'Step Two',
            jobSlug: 'workflow-step-two',
            dependsOn: ['service-call']
          }
        ],
        triggers: [],
        defaultParameters: { tenant: 'global' },
        metadata: { purpose: 'updated' }
      }
    });
    assert.equal(updateWorkflowResponse.statusCode, 200);
    const updatedWorkflow = JSON.parse(updateWorkflowResponse.payload) as {
      data: {
        name: string;
        version: number;
        triggers: Array<{ type: string }>;
        defaultParameters: unknown;
        metadata: unknown;
        description: string | null;
      };
    };
    assert.equal(updatedWorkflow.data.name, 'Workflow Demo Updated');
    assert.equal(updatedWorkflow.data.version, 2);
    assert.equal(updatedWorkflow.data.description, null);
    assert.equal(updatedWorkflow.data.triggers.length, 1);
    assert.equal(updatedWorkflow.data.triggers[0].type, 'manual');
    assert.deepEqual(updatedWorkflow.data.defaultParameters, { tenant: 'global' });
    assert.deepEqual(updatedWorkflow.data.metadata, { purpose: 'updated' });

    const listResponse = await app.inject({ method: 'GET', url: '/workflows' });
    assert.equal(listResponse.statusCode, 200);
    const listBody = JSON.parse(listResponse.payload) as { data: Array<{ slug: string }> };
    assert(listBody.data.some((item) => item.slug === 'wf-demo'));

      const fetchWorkflowResponse = await app.inject({ method: 'GET', url: '/workflows/wf-demo' });
      assert.equal(fetchWorkflowResponse.statusCode, 200);
      const fetchWorkflowBody = JSON.parse(fetchWorkflowResponse.payload) as {
        data: {
          workflow: {
            slug: string;
            name: string;
            description: string | null;
            steps: Array<Record<string, unknown>>;
            triggers: Array<{ type: string }>;
            defaultParameters: unknown;
            metadata: unknown;
          };
          runs: unknown[];
        };
      };
      assert.equal(fetchWorkflowBody.data.workflow.slug, 'wf-demo');
      assert.equal(fetchWorkflowBody.data.workflow.name, 'Workflow Demo Updated');
      assert.equal(fetchWorkflowBody.data.workflow.description, null);
      assert.equal(fetchWorkflowBody.data.workflow.steps.length, 3);
      const serviceStep = fetchWorkflowBody.data.workflow.steps.find((step) => step.id === 'service-call') as
        | { retryPolicy?: { maxAttempts?: number }; request?: { query?: Record<string, unknown> } }
        | undefined;
      assert.equal(serviceStep?.retryPolicy?.maxAttempts ?? 0, 3);
      assert.equal((serviceStep?.request?.query as { tenant?: string } | undefined)?.tenant ?? '', 'acme');
      assert.equal(fetchWorkflowBody.data.workflow.triggers[0]?.type ?? '', 'manual');
      assert.deepEqual(fetchWorkflowBody.data.workflow.defaultParameters, { tenant: 'global' });
      assert.deepEqual(fetchWorkflowBody.data.workflow.metadata, { purpose: 'updated' });
      const workflowDag = fetchWorkflowBody.data.workflow.dag as {
        roots?: string[];
        adjacency?: Record<string, string[]>;
      };
      assert(workflowDag);
      assert(Array.isArray(workflowDag.roots));
      assert(workflowDag.roots?.includes('step-one'));
      const serviceDependents = workflowDag.adjacency?.['service-call'] ?? [];
      assert.deepEqual(serviceDependents, ['step-two']);
      const stepOneDefinition = fetchWorkflowBody.data.workflow.steps.find(
        (step) => step.id === 'step-one'
      ) as { dependents?: string[] } | undefined;
      assert(stepOneDefinition);
      assert.deepEqual(stepOneDefinition?.dependents ?? [], ['service-call']);
      assert.deepEqual((serviceStep?.dependents ?? []) as string[], ['step-two']);
      assert.equal(fetchWorkflowBody.data.runs.length, 0);

      const missingDependencyResponse = await app.inject({
        method: 'POST',
        url: '/workflows',
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          slug: 'wf-missing-dep',
          name: 'Missing Dependency',
          steps: [
            {
              id: 'start',
              name: 'Start',
              jobSlug: 'workflow-step-one'
            },
            {
              id: 'broken',
              name: 'Broken',
              jobSlug: 'workflow-step-two',
              dependsOn: ['not-found']
            }
          ]
        }
      });
      assert.equal(missingDependencyResponse.statusCode, 400);
      const missingDependencyBody = JSON.parse(missingDependencyResponse.payload) as {
        error: { reason?: string; detail?: { dependencyId?: string } };
      };
      assert.equal(missingDependencyBody.error.reason, 'missing_dependency');
      assert.equal(missingDependencyBody.error.detail?.dependencyId, 'not-found');

      const cyclicWorkflowResponse = await app.inject({
        method: 'POST',
        url: '/workflows',
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          slug: 'wf-cyclic',
          name: 'Cyclic Workflow',
          steps: [
            {
              id: 'alpha',
              name: 'Alpha',
              jobSlug: 'workflow-step-one',
              dependsOn: ['beta']
            },
            {
              id: 'beta',
              name: 'Beta',
              jobSlug: 'workflow-step-two',
              dependsOn: ['alpha']
            }
          ]
        }
      });
      assert.equal(cyclicWorkflowResponse.statusCode, 400);
      const cyclicBody = JSON.parse(cyclicWorkflowResponse.payload) as {
        error: { reason?: string; detail?: { cycle?: string[] } };
      };
      assert.equal(cyclicBody.error.reason, 'cycle_detected');
      assert(Array.isArray(cyclicBody.error.detail?.cycle));

      await createJobDefinition(app, {
        slug: 'workflow-bundle-step',
        name: 'Workflow Bundle Step',
        entryPoint: 'bundle:example.workflow@1.2.3#handler'
      });

      const bundleWorkflowResponse = await app.inject({
        method: 'POST',
        url: '/workflows',
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          slug: 'wf-bundle-pinned',
          name: 'Workflow Bundle Pinned',
          steps: [
            {
              id: 'bundle-step',
              name: 'Bundle Step',
              jobSlug: 'workflow-bundle-step'
            }
          ]
        }
      });
      assert.equal(bundleWorkflowResponse.statusCode, 201);

      const fetchPinnedWorkflowResponse = await app.inject({
        method: 'GET',
        url: '/workflows/wf-bundle-pinned'
      });
      assert.equal(fetchPinnedWorkflowResponse.statusCode, 200);
      const fetchPinnedWorkflowBody = JSON.parse(fetchPinnedWorkflowResponse.payload) as {
        data: { workflow: { steps: Array<{ bundle?: { strategy?: string; version?: string | null; slug?: string; exportName?: string | null } | null }> } };
      };
      const pinnedStep = fetchPinnedWorkflowBody.data.workflow.steps[0];
      assert(pinnedStep);
      assert.equal(pinnedStep.bundle?.strategy ?? '', 'pinned');
      assert.equal(pinnedStep.bundle?.version ?? '', '1.2.3');
      assert.equal(pinnedStep.bundle?.slug ?? '', 'example.workflow');
      assert.equal(pinnedStep.bundle?.exportName ?? '', 'handler');

      const { upsertJobDefinition } = await import('../src/db/jobs');
      await upsertJobDefinition({
        slug: 'workflow-bundle-step',
        name: 'Workflow Bundle Step',
        type: 'manual',
        runtime: 'node',
        entryPoint: 'bundle:example.workflow@2.0.0#handler'
      });

      const fetchPinnedWorkflowAfterUpdate = await app.inject({
        method: 'GET',
        url: '/workflows/wf-bundle-pinned'
      });
      assert.equal(fetchPinnedWorkflowAfterUpdate.statusCode, 200);
      const pinnedAfterUpdateBody = JSON.parse(fetchPinnedWorkflowAfterUpdate.payload) as {
        data: { workflow: { steps: Array<{ bundle?: { version?: string | null } | null }> } };
      };
      const pinnedStepAfterUpdate = pinnedAfterUpdateBody.data.workflow.steps[0];
      assert(pinnedStepAfterUpdate);
      assert.equal(pinnedStepAfterUpdate.bundle?.version ?? '', '1.2.3');

      const latestWorkflowUpdateResponse = await app.inject({
        method: 'PATCH',
        url: '/workflows/wf-bundle-pinned',
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          steps: [
            {
              id: 'bundle-step',
              name: 'Bundle Step',
              jobSlug: 'workflow-bundle-step',
              bundle: {
                slug: 'example.workflow',
                strategy: 'latest'
              }
            }
          ]
        }
      });
      assert.equal(latestWorkflowUpdateResponse.statusCode, 200);

      const fetchLatestWorkflowResponse = await app.inject({
        method: 'GET',
        url: '/workflows/wf-bundle-pinned'
      });
      assert.equal(fetchLatestWorkflowResponse.statusCode, 200);
      const latestWorkflowBody = JSON.parse(fetchLatestWorkflowResponse.payload) as {
        data: { workflow: { steps: Array<{ bundle?: { strategy?: string; version?: string | null } | null }> } };
      };
      const latestStep = latestWorkflowBody.data.workflow.steps[0];
      assert(latestStep);
      assert.equal(latestStep.bundle?.strategy ?? '', 'latest');
      assert.equal(latestStep.bundle?.version ?? null, null);

      const triggerResponse = await app.inject({
      method: 'POST',
      url: '/workflows/wf-demo/run',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      },
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
        data: {
          id: string;
          status: string;
          metrics: { totalSteps: number; completedSteps: number };
          context: {
            steps: Record<string, { status: string; service?: { statusCode?: number } }>;
            shared?: Record<string, unknown>;
          };
        };
      };
      assert.equal(runBody.data.status, 'succeeded');
      assert.equal(runBody.data.metrics.totalSteps, 3);
      assert.equal(runBody.data.metrics.completedSteps, 3);
      assert.equal(runBody.data.context.steps['step-one'].status, 'succeeded');
      assert.equal(runBody.data.context.steps['service-call'].status, 'succeeded');
      assert.equal(runBody.data.context.steps['step-two'].status, 'succeeded');
      assert.equal(
        (runBody.data.context.steps['service-call'].service?.statusCode as number | undefined) ?? 0,
        200
      );
      assert(runBody.data.context.shared);
      assert.equal(
        (runBody.data.context.shared?.serviceResult as { ok?: boolean } | undefined)?.ok,
        true
      );

      const runStepsResponse = await app.inject({ method: 'GET', url: `/workflow-runs/${runId}/steps` });
      assert.equal(runStepsResponse.statusCode, 200);
      const runStepsBody = JSON.parse(runStepsResponse.payload) as {
        data: {
          steps: Array<{
            stepId: string;
            status: string;
            attempt: number;
            input: { request?: { headers?: Record<string, string> } };
            metrics: { service?: { statusCode?: number } };
          }>;
        };
      };
      assert.equal(runStepsBody.data.steps.length, 3);
      assert(runStepsBody.data.steps.every((step) => step.status === 'succeeded'));
      const serviceStepRecord = runStepsBody.data.steps.find((step) => step.stepId === 'service-call');
      assert(serviceStepRecord);
      assert.equal(serviceStepRecord.attempt, 1);
      assert.equal(serviceStepRecord?.metrics.service?.statusCode, 200);
      const headerRecord = (serviceStepRecord?.input as { headers?: Record<string, string> } | undefined)?.headers ?? {};
      const authHeader = headerRecord.Authorization ?? headerRecord.authorization;
      assert.equal(authHeader, '***');

      const metricsResponse = await app.inject({ method: 'GET', url: '/metrics' });
      assert.equal(metricsResponse.statusCode, 200);
      const metricsBody = JSON.parse(metricsResponse.payload) as {
        data: {
          workflows: { total: number; statusCounts: Record<string, number> };
          jobs: { total: number };
        };
      };
      assert(metricsBody.data.workflows.total >= 1);

      const workflowStatsResponse = await app.inject({
        method: 'GET',
        url: '/workflows/wf-demo/stats'
      });
      assert.equal(workflowStatsResponse.statusCode, 200);
      const workflowStatsBody = JSON.parse(workflowStatsResponse.payload) as {
        data: {
          workflowId: string;
          slug: string;
          range: { from: string; to: string; key: string };
          totalRuns: number;
          statusCounts: Record<string, number>;
          failureCategories: Array<{ category: string; count: number }>;
        };
      };
      assert.equal(workflowStatsBody.data.slug, 'wf-demo');
      assert.equal(workflowStatsBody.data.range.key, '7d');
      assert(workflowStatsBody.data.totalRuns >= 1);
      assert((workflowStatsBody.data.statusCounts.succeeded ?? 0) >= 1);
      assert(Array.isArray(workflowStatsBody.data.failureCategories));

      const workflowMetricsResponse = await app.inject({
        method: 'GET',
        url: '/workflows/wf-demo/run-metrics'
      });
      assert.equal(workflowMetricsResponse.statusCode, 200);
      const workflowMetricsBody = JSON.parse(workflowMetricsResponse.payload) as {
        data: {
          slug: string;
          range: { key: string };
          bucket: { interval: string; key: string | null };
          series: Array<{ bucketStart: string; totalRuns: number }>;
        };
      };
      assert.equal(workflowMetricsBody.data.slug, 'wf-demo');
      assert.equal(workflowMetricsBody.data.range.key, '7d');
      assert.equal(workflowMetricsBody.data.bucket.key, 'hour');
      assert(Array.isArray(workflowMetricsBody.data.series));

      const assetWorkflowSlug = 'wf-assets-demo';
      const assetSchema = {
        type: 'object',
        properties: {
          count: { type: 'number' }
        }
      };

      const createAssetWorkflowResponse = await app.inject({
        method: 'POST',
        url: '/workflows',
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          slug: assetWorkflowSlug,
          name: 'Workflow Asset Demo',
          steps: [
            {
              id: 'asset-producer',
              name: 'Asset Producer',
              jobSlug: 'workflow-asset-producer',
              produces: [
                {
                  assetId: 'inventory.dataset',
                  schema: assetSchema,
                  freshness: { ttlMs: 3_600_000 }
                }
              ]
            },
            {
              id: 'asset-consumer',
              name: 'Asset Consumer',
              jobSlug: 'workflow-asset-consumer',
              dependsOn: ['asset-producer'],
              consumes: [
                {
                  assetId: 'inventory.dataset'
                }
              ]
            }
          ]
        }
      });
      assert.equal(createAssetWorkflowResponse.statusCode, 201);

      const triggerFirstAssetRunResponse = await app.inject({
        method: 'POST',
        url: `/workflows/${assetWorkflowSlug}/run`,
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          parameters: { count: 7 }
        }
      });
      assert.equal(triggerFirstAssetRunResponse.statusCode, 202);
      const triggerFirstAssetRunBody = JSON.parse(triggerFirstAssetRunResponse.payload) as {
        data: { id: string; status: string };
      };
      assert.equal(triggerFirstAssetRunBody.data.status, 'succeeded');
      const firstAssetRunId = triggerFirstAssetRunBody.data.id;

      const assetInventoryResponse = await app.inject({
        method: 'GET',
        url: `/workflows/${assetWorkflowSlug}/assets`
      });
      assert.equal(assetInventoryResponse.statusCode, 200);
      const assetInventoryBody = JSON.parse(assetInventoryResponse.payload) as {
        data: {
          assets: Array<{
            assetId: string;
            available: boolean;
            latest: {
              runId: string;
              partitionKey: string | null;
              payload: unknown;
              schema: unknown;
              freshness: { ttlMs?: number | null } | null;
            } | null;
            producers: Array<{ stepId: string }>;
            consumers: Array<{ stepId: string }>;
          }>;
        };
      };
      const assetEntry = assetInventoryBody.data.assets.find((entry) => entry.assetId === 'inventory.dataset');
      assert(assetEntry, 'asset inventory should include inventory.dataset');
      assert(assetEntry?.available);
      assert(assetEntry?.producers.some((producer) => producer.stepId === 'asset-producer'));
      assert(assetEntry?.consumers.some((consumer) => consumer.stepId === 'asset-consumer'));
      assert.equal(assetEntry?.latest?.runId, firstAssetRunId);
      assert.equal(assetEntry?.latest?.partitionKey ?? null, null);
      const latestPayload = (assetEntry?.latest?.payload as { count?: number } | undefined) ?? {};
      assert.equal(latestPayload.count ?? 0, 7);
      assert.equal(assetEntry?.latest?.freshness?.ttlMs ?? 0, 3_600_000);
      assert.deepEqual(assetEntry?.latest?.schema, assetSchema);

      const triggerSecondAssetRunResponse = await app.inject({
        method: 'POST',
        url: `/workflows/${assetWorkflowSlug}/run`,
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          parameters: { count: 11 }
        }
      });
      assert.equal(triggerSecondAssetRunResponse.statusCode, 202);
      const triggerSecondAssetRunBody = JSON.parse(triggerSecondAssetRunResponse.payload) as {
        data: { id: string; status: string };
      };
      assert.equal(triggerSecondAssetRunBody.data.status, 'succeeded');
      const secondAssetRunId = triggerSecondAssetRunBody.data.id;

      const assetInventoryAfterResponse = await app.inject({
        method: 'GET',
        url: `/workflows/${assetWorkflowSlug}/assets`
      });
      assert.equal(assetInventoryAfterResponse.statusCode, 200);
      const assetInventoryAfterBody = JSON.parse(assetInventoryAfterResponse.payload) as {
        data: {
          assets: Array<{
            assetId: string;
            latest: { runId: string; partitionKey: string | null; payload: unknown } | null;
          }>;
        };
      };
      const assetEntryAfter = assetInventoryAfterBody.data.assets.find((entry) => entry.assetId === 'inventory.dataset');
      assert(assetEntryAfter);
      assert.equal(assetEntryAfter?.latest?.runId, secondAssetRunId);
      assert.equal(assetEntryAfter?.latest?.partitionKey ?? null, null);
      const latestAfterPayload = (assetEntryAfter?.latest?.payload as { count?: number } | undefined) ?? {};
      assert.equal(latestAfterPayload.count ?? 0, 11);

      const encodedAssetId = encodeURIComponent('inventory.dataset');
      const assetHistoryLimitedResponse = await app.inject({
        method: 'GET',
        url: `/workflows/${assetWorkflowSlug}/assets/${encodedAssetId}/history?limit=1`
      });
      assert.equal(assetHistoryLimitedResponse.statusCode, 200);
      const assetHistoryLimitedBody = JSON.parse(assetHistoryLimitedResponse.payload) as {
        data: {
          assetId: string;
          history: Array<{ runId: string; partitionKey?: string | null; payload: unknown }>;
          producers: Array<{ stepId: string }>;
          consumers: Array<{ stepId: string }>;
          limit: number;
        };
      };
      assert.equal(assetHistoryLimitedBody.data.assetId, 'inventory.dataset');
      assert.equal(assetHistoryLimitedBody.data.history.length, 1);
      assert.equal(assetHistoryLimitedBody.data.history[0]?.runId, secondAssetRunId);
      assert.equal(assetHistoryLimitedBody.data.history[0]?.partitionKey ?? null, null);
      const limitedPayload = (assetHistoryLimitedBody.data.history[0]?.payload as { count?: number } | undefined) ?? {};
      assert.equal(limitedPayload.count ?? 0, 11);
      assert(assetHistoryLimitedBody.data.producers.some((producer) => producer.stepId === 'asset-producer'));
      assert(assetHistoryLimitedBody.data.consumers.some((consumer) => consumer.stepId === 'asset-consumer'));

      const assetHistoryFullResponse = await app.inject({
        method: 'GET',
        url: `/workflows/${assetWorkflowSlug}/assets/${encodedAssetId}/history`
      });
      assert.equal(assetHistoryFullResponse.statusCode, 200);
      const assetHistoryFullBody = JSON.parse(assetHistoryFullResponse.payload) as {
        data: {
          history: Array<{ runId: string; partitionKey?: string | null; payload: unknown }>;
        };
      };
      const historyRunIds = assetHistoryFullBody.data.history.map((entry) => entry.runId);
      assert(historyRunIds.includes(firstAssetRunId));
      assert(historyRunIds.includes(secondAssetRunId));
      assert.equal(assetHistoryFullBody.data.history[0]?.runId, secondAssetRunId);
      assert.equal(assetHistoryFullBody.data.history[0]?.partitionKey ?? null, null);

      const missingAssetHistoryResponse = await app.inject({
        method: 'GET',
        url: `/workflows/${assetWorkflowSlug}/assets/${encodeURIComponent('unknown.asset')}/history`
      });
      assert.equal(missingAssetHistoryResponse.statusCode, 404);
      const missingAssetHistoryBody = JSON.parse(missingAssetHistoryResponse.payload) as { error?: string };
      assert.equal(missingAssetHistoryBody.error, 'asset not found for workflow');

      const partitionWorkflowSlug = 'wf-partition-demo';
      const partitionSchema = {
        type: 'object',
        properties: {
          value: { type: 'number' }
        }
      };

      const createPartitionWorkflowResponse = await app.inject({
        method: 'POST',
        url: '/workflows',
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          slug: partitionWorkflowSlug,
          name: 'Partition Workflow Demo',
          steps: [
            {
              id: 'partition-producer',
              name: 'Partition Producer',
              jobSlug: 'workflow-partitioned-producer',
              produces: [
                {
                  assetId: 'reports.partitioned',
                  schema: partitionSchema,
                  partitioning: {
                    type: 'static',
                    keys: ['2024-01', '2024-02', '2024-03']
                  }
                }
              ]
            }
          ]
        }
      });
      assert.equal(createPartitionWorkflowResponse.statusCode, 201);

      const partitionMissingKeyResponse = await app.inject({
        method: 'POST',
        url: `/workflows/${partitionWorkflowSlug}/run`,
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          parameters: { value: 5 }
        }
      });
      assert.equal(partitionMissingKeyResponse.statusCode, 400);

      const partitionInvalidKeyResponse = await app.inject({
        method: 'POST',
        url: `/workflows/${partitionWorkflowSlug}/run`,
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          partitionKey: '2024-09',
          parameters: { value: 7 }
        }
      });
      assert.equal(partitionInvalidKeyResponse.statusCode, 400);

      const partitionRunOneResponse = await app.inject({
        method: 'POST',
        url: `/workflows/${partitionWorkflowSlug}/run`,
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          partitionKey: '2024-01',
          parameters: { value: 10 }
        }
      });
      assert.equal(partitionRunOneResponse.statusCode, 202);
      const partitionRunOneBody = JSON.parse(partitionRunOneResponse.payload) as {
        data: { id: string; status: string; partitionKey: string | null };
      };
      assert.equal(partitionRunOneBody.data.status, 'succeeded');
      assert.equal(partitionRunOneBody.data.partitionKey, '2024-01');
      const partitionRunOneId = partitionRunOneBody.data.id;

      const partitionRunTwoResponse = await app.inject({
        method: 'POST',
        url: `/workflows/${partitionWorkflowSlug}/run`,
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          partitionKey: '2024-02',
          parameters: { value: 12 }
        }
      });
      assert.equal(partitionRunTwoResponse.statusCode, 202);
      const partitionRunTwoBody = JSON.parse(partitionRunTwoResponse.payload) as {
        data: { id: string; status: string; partitionKey: string | null };
      };
      assert.equal(partitionRunTwoBody.data.status, 'succeeded');
      assert.equal(partitionRunTwoBody.data.partitionKey, '2024-02');
      const partitionRunTwoId = partitionRunTwoBody.data.id;

      const partitionAssetsResponse = await app.inject({
        method: 'GET',
        url: `/workflows/${partitionWorkflowSlug}/assets`
      });
      assert.equal(partitionAssetsResponse.statusCode, 200);
      const partitionAssetsBody = JSON.parse(partitionAssetsResponse.payload) as {
        data: {
          assets: Array<{
            assetId: string;
            latest: {
              runId: string;
              partitionKey: string | null;
              payload: unknown;
            } | null;
          }>;
        };
      };
      const partitionAssetEntry = partitionAssetsBody.data.assets.find(
        (entry) => entry.assetId === 'reports.partitioned'
      );
      assert(partitionAssetEntry);
      assert.equal(partitionAssetEntry?.latest?.runId, partitionRunTwoId);
      assert.equal(partitionAssetEntry?.latest?.partitionKey, '2024-02');

      const partitionAssetEncoded = encodeURIComponent('reports.partitioned');
      const partitionHistoryAllResponse = await app.inject({
        method: 'GET',
        url: `/workflows/${partitionWorkflowSlug}/assets/${partitionAssetEncoded}/history`
      });
      assert.equal(partitionHistoryAllResponse.statusCode, 200);
      const partitionHistoryAllBody = JSON.parse(partitionHistoryAllResponse.payload) as {
        data: {
          history: Array<{ runId: string; partitionKey?: string | null }>;
        };
      };
      const partitionHistoryKeys = partitionHistoryAllBody.data.history.map((entry) => entry.partitionKey);
      assert(partitionHistoryKeys.includes('2024-01'));
      assert(partitionHistoryKeys.includes('2024-02'));

      const partitionHistoryFilteredResponse = await app.inject({
        method: 'GET',
        url: `/workflows/${partitionWorkflowSlug}/assets/${partitionAssetEncoded}/history?partitionKey=2024-01`
      });
      assert.equal(partitionHistoryFilteredResponse.statusCode, 200);
      const partitionHistoryFilteredBody = JSON.parse(partitionHistoryFilteredResponse.payload) as {
        data: {
          history: Array<{ runId: string; partitionKey?: string | null }>;
        };
      };
      assert.equal(partitionHistoryFilteredBody.data.history.length, 1);
      assert.equal(partitionHistoryFilteredBody.data.history[0]?.runId, partitionRunOneId);
      assert.equal(partitionHistoryFilteredBody.data.history[0]?.partitionKey, '2024-01');

      const partitionIndexResponse = await app.inject({
        method: 'GET',
        url: `/workflows/${partitionWorkflowSlug}/assets/${partitionAssetEncoded}/partitions?lookback=3`
      });
      assert.equal(partitionIndexResponse.statusCode, 200);
      const partitionIndexBody = JSON.parse(partitionIndexResponse.payload) as {
        data: {
          partitioning: unknown;
          partitions: Array<{
            partitionKey: string | null;
            materializations: number;
            latest: { runId: string | null } | null;
          }>;
        };
      };
      assert(Array.isArray(partitionIndexBody.data.partitions));
      assert.equal((partitionIndexBody.data.partitioning as { type?: string } | null)?.type ?? '', 'static');
      const partitionOneSummary = partitionIndexBody.data.partitions.find((entry) => entry.partitionKey === '2024-01');
      const partitionTwoSummary = partitionIndexBody.data.partitions.find((entry) => entry.partitionKey === '2024-02');
      const partitionThreeSummary = partitionIndexBody.data.partitions.find((entry) => entry.partitionKey === '2024-03');
      assert(partitionOneSummary);
      assert(partitionTwoSummary);
      assert(partitionThreeSummary);
      assert.equal(partitionOneSummary?.materializations ?? 0, 1);
      assert.equal(partitionOneSummary?.latest?.runId ?? null, partitionRunOneId);
      assert.equal(partitionTwoSummary?.materializations ?? 0, 1);
      assert.equal(partitionTwoSummary?.latest?.runId ?? null, partitionRunTwoId);
      assert.equal(partitionThreeSummary?.materializations ?? 0, 0);

      const dagWorkflowResponse = await app.inject({
        method: 'POST',
        url: '/workflows',
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          slug: 'wf-dag',
          name: 'DAG Workflow',
          steps: [
            {
              id: 'root-job',
              name: 'Root Job',
              jobSlug: 'workflow-step-one'
            },
            {
              id: 'branch-job',
              name: 'Branch Job',
              jobSlug: 'workflow-step-two',
              dependsOn: ['root-job'],
              storeResultAs: 'branchJob'
            },
            {
              id: 'branch-service',
              name: 'Branch Service',
              type: 'service',
              serviceSlug: 'test-service',
              dependsOn: ['root-job'],
              captureResponse: true,
              storeResponseAs: 'branchService',
              request: {
                path: '/hook',
                method: 'POST',
                headers: {
                  Authorization: {
                    secret: { source: 'store', key: 'TEST_SERVICE_TOKEN', version: 'v1' },
                    prefix: 'Bearer '
                  }
                },
                body: {
                  branch: 'service'
                }
              }
            },
            {
              id: 'fan-in',
              name: 'Fan In',
              jobSlug: 'workflow-step-two',
              dependsOn: ['branch-job', 'branch-service'],
              parameters: {
                jobStep: '{{ shared.branchJob.step }}',
                serviceOk: '{{ shared.branchService.ok }}'
              }
            }
          ]
        }
      });
      assert.equal(dagWorkflowResponse.statusCode, 201);

      const dagRunResponse = await app.inject({
        method: 'POST',
        url: '/workflows/wf-dag/run',
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          parameters: { run: 'dag' }
        }
      });
      assert.equal(dagRunResponse.statusCode, 202);
      const dagRunBody = JSON.parse(dagRunResponse.payload) as { data: { id: string; status: string } };
      assert.equal(dagRunBody.data.status, 'succeeded');
      const dagRunId = dagRunBody.data.id;

      const dagRunDetailResponse = await app.inject({ method: 'GET', url: `/workflow-runs/${dagRunId}` });
      assert.equal(dagRunDetailResponse.statusCode, 200);
      const dagRunDetailBody = JSON.parse(dagRunDetailResponse.payload) as {
        data: {
          metrics: { totalSteps: number; completedSteps: number };
          context: {
            steps: Record<string, { status: string }>;
            shared?: Record<string, unknown>;
          };
        };
      };
      assert.equal(dagRunDetailBody.data.metrics.totalSteps, 4);
      assert.equal(dagRunDetailBody.data.metrics.completedSteps, 4);
      assert.equal(dagRunDetailBody.data.context.steps['root-job'].status, 'succeeded');
      assert.equal(dagRunDetailBody.data.context.steps['branch-job'].status, 'succeeded');
      assert.equal(dagRunDetailBody.data.context.steps['branch-service'].status, 'succeeded');
      assert.equal(dagRunDetailBody.data.context.steps['fan-in'].status, 'succeeded');
      const dagShared = dagRunDetailBody.data.context.shared ?? {};
      const branchJobShared = dagShared.branchJob as Record<string, unknown> | undefined;
      const branchServiceShared = dagShared.branchService as Record<string, unknown> | undefined;
      assert.equal((branchJobShared?.step as string | undefined) ?? '', 'two');
      assert.equal((branchServiceShared?.ok as boolean | undefined) ?? false, true);

      const dagRunStepsResponse = await app.inject({
        method: 'GET',
        url: `/workflow-runs/${dagRunId}/steps`
      });
      assert.equal(dagRunStepsResponse.statusCode, 200);
      const dagRunStepsBody = JSON.parse(dagRunStepsResponse.payload) as {
        data: { steps: Array<{ stepId: string; status: string }> };
      };
      assert.equal(dagRunStepsBody.data.steps.length, 4);
      assert(dagRunStepsBody.data.steps.every((step) => step.status === 'succeeded'));

      const fanOutWorkflowResponse = await app.inject({
        method: 'POST',
        url: '/workflows',
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          slug: 'wf-fanout',
          name: 'Fan-Out Workflow',
          steps: [
            {
              id: 'seed',
              name: 'Seed Items',
              jobSlug: 'fanout-source'
            },
            {
              id: 'expand',
              name: 'Expand Items',
              type: 'fanout',
              dependsOn: ['seed'],
              collection: '{{ steps.seed.result.items }}',
              maxItems: 10,
              maxConcurrency: 2,
              storeResultsAs: 'processedItems',
              template: {
                id: 'process-item',
                name: 'Process Item',
                type: 'job',
                jobSlug: 'fanout-child',
                parameters: {
                  item: '{{ item }}',
                  index: '{{ fanout.index }}'
                }
              }
            },
            {
              id: 'fan-in',
              name: 'Collect Results',
              jobSlug: 'fanout-collector',
              dependsOn: ['expand'],
              parameters: {
                items: '{{ shared.processedItems }}'
              }
            }
          ]
        }
      });
      assert.equal(fanOutWorkflowResponse.statusCode, 201);

      const fanOutRunResponse = await app.inject({
        method: 'POST',
        url: '/workflows/wf-fanout/run',
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        }
      });
      assert.equal(fanOutRunResponse.statusCode, 202);
      const fanOutRunBody = JSON.parse(fanOutRunResponse.payload) as { data: { id: string; status: string } };
      assert.equal(fanOutRunBody.data.status, 'succeeded');
      const fanOutRunId = fanOutRunBody.data.id;

      const fanOutRunDetailResponse = await app.inject({
        method: 'GET',
        url: `/workflow-runs/${fanOutRunId}`
      });
      assert.equal(fanOutRunDetailResponse.statusCode, 200);
      const fanOutRunDetailBody = JSON.parse(fanOutRunDetailResponse.payload) as {
        data: {
          metrics: { totalSteps: number; completedSteps: number };
          context: {
            steps: Record<string, { status: string; result?: { receivedCount?: number } }>;
            shared?: Record<string, unknown>;
          };
        };
      };
      assert.equal(fanOutRunDetailBody.data.metrics.totalSteps, 5);
      assert.equal(fanOutRunDetailBody.data.metrics.completedSteps, 5);
      assert.equal(fanOutRunDetailBody.data.context.steps['fan-in'].result?.receivedCount ?? 0, 2);
      const aggregatedResults = fanOutRunDetailBody.data.context.shared?.processedItems as
        | Array<{ stepId?: string; status?: string; output?: { doubled?: number }; index?: number }>
        | undefined;
      assert(aggregatedResults);
      assert.equal(aggregatedResults?.length ?? 0, 2);
      assert(aggregatedResults?.every((entry) => entry.status === 'succeeded'));
      const aggregatedIds = aggregatedResults?.map((entry) => entry.stepId).sort();
      assert.deepEqual(aggregatedIds, ['expand:process-item:1', 'expand:process-item:2']);
      const aggregatedDoubles = aggregatedResults
        ?.map((entry) => entry.output?.doubled)
        .sort((a, b) => (a ?? 0) - (b ?? 0));
      assert.deepEqual(aggregatedDoubles, [2, 4]);

      const fanOutRunStepsResponse = await app.inject({
        method: 'GET',
        url: `/workflow-runs/${fanOutRunId}/steps`
      });
      assert.equal(fanOutRunStepsResponse.statusCode, 200);
      const fanOutRunStepsBody = JSON.parse(fanOutRunStepsResponse.payload) as {
        data: {
          steps: Array<{
            stepId: string;
            status: string;
            parentStepId: string | null;
            fanoutIndex: number | null;
            templateStepId: string | null;
            output?: { totalChildren?: number };
          }>;
        };
      };
      const fanOutChildSteps = fanOutRunStepsBody.data.steps.filter((step) => step.parentStepId === 'expand');
      assert.equal(fanOutChildSteps.length, 2);
      assert.deepEqual(
        fanOutChildSteps.map((step) => step.fanoutIndex ?? -1).sort((a, b) => a - b),
        [0, 1]
      );
      assert(fanOutChildSteps.every((step) => step.templateStepId === 'process-item'));
      const expandStepRecord = fanOutRunStepsBody.data.steps.find((step) => step.stepId === 'expand');
      assert(expandStepRecord);
      assert.equal(expandStepRecord?.output?.totalChildren ?? 0, 2);

      const updateFanOutWorkflowResponse = await app.inject({
        method: 'PATCH',
        url: '/workflows/wf-fanout',
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          steps: [
            {
              id: 'seed',
              name: 'Seed Items',
              jobSlug: 'fanout-source'
            },
            {
              id: 'expand',
              name: 'Expand Items',
              type: 'fanout',
              dependsOn: ['seed'],
              collection: '{{ steps.seed.result.items }}',
              maxItems: 1,
              maxConcurrency: 2,
              storeResultsAs: 'processedItems',
              template: {
                id: 'process-item',
                name: 'Process Item',
                type: 'job',
                jobSlug: 'fanout-child',
                parameters: {
                  item: '{{ item }}',
                  index: '{{ fanout.index }}'
                }
              }
            },
            {
              id: 'fan-in',
              name: 'Collect Results',
              jobSlug: 'fanout-collector',
              dependsOn: ['expand'],
              parameters: {
                items: '{{ shared.processedItems }}'
              }
            }
          ]
        }
      });
      assert.equal(updateFanOutWorkflowResponse.statusCode, 200);

      const guardRunResponse = await app.inject({
        method: 'POST',
        url: '/workflows/wf-fanout/run',
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        }
      });
      assert.equal(guardRunResponse.statusCode, 202);
      const guardRunBody = JSON.parse(guardRunResponse.payload) as {
        data: { id: string; status: string; errorMessage: string | null };
      };
      assert.equal(guardRunBody.data.status, 'failed');
      assert(guardRunBody.data.errorMessage);
      assert(guardRunBody.data.errorMessage?.includes('exceeds the limit'));
      const guardRunId = guardRunBody.data.id;

      const guardRunStepsResponse = await app.inject({
        method: 'GET',
        url: `/workflow-runs/${guardRunId}/steps`
      });
      assert.equal(guardRunStepsResponse.statusCode, 200);
      const guardRunStepsBody = JSON.parse(guardRunStepsResponse.payload) as {
        data: { steps: Array<{ stepId: string; status: string; parentStepId?: string | null }> };
      };
      const expandFailure = guardRunStepsBody.data.steps.find((step) => step.stepId === 'expand');
      assert(expandFailure);
      assert.equal(expandFailure?.status, 'failed');
      const childFailureCount = guardRunStepsBody.data.steps.filter((step) => step.parentStepId === 'expand').length;
      assert.equal(childFailureCount, 0);

    const failureResponse = await app.inject({
      method: 'POST',
      url: '/workflows/wf-demo/run',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      },
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
      assert.equal(failedStepStatuses['service-call'], 'succeeded');
      assert.equal(failedStepStatuses['step-two'], 'failed');

      testService.setMode('fail-once');
      const retryResponse = await app.inject({
        method: 'POST',
        url: '/workflows/wf-demo/run',
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          parameters: { tenant: 'acme-retry' }
        }
      });
      assert.equal(retryResponse.statusCode, 202);
      const retryBody = JSON.parse(retryResponse.payload) as { data: { id: string; status: string } };
      assert.equal(retryBody.data.status, 'succeeded');
      const retryRunId = retryBody.data.id;

      const retryStepsResponse = await app.inject({ method: 'GET', url: `/workflow-runs/${retryRunId}/steps` });
      assert.equal(retryStepsResponse.statusCode, 200);
      const retryStepsBody = JSON.parse(retryStepsResponse.payload) as {
        data: {
          steps: Array<{ stepId: string; attempt: number; status: string; metrics: { service?: { statusCode?: number } } }>;
        };
      };
      const retryServiceStep = retryStepsBody.data.steps.find((step) => step.stepId === 'service-call');
      assert(retryServiceStep);
      assert.equal(retryServiceStep?.attempt, 2);
      assert.equal(retryServiceStep?.metrics.service?.statusCode, 200);

      const beforeDegradedRequests = testService.getRequestCount();
      await setTestServiceStatus(app, 'degraded');

      const degradedResponse = await app.inject({
        method: 'POST',
        url: '/workflows/wf-demo/run',
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          parameters: { tenant: 'degraded-path' }
        }
      });
      assert.equal(degradedResponse.statusCode, 202);
      const degradedBody = JSON.parse(degradedResponse.payload) as { data: { id: string; status: string } };
      assert.equal(degradedBody.data.status, 'failed');
      assert.equal(testService.getRequestCount(), beforeDegradedRequests);

      await setTestServiceStatus(app, 'healthy');

      const runsListResponse = await app.inject({ method: 'GET', url: '/workflows/wf-demo/runs' });
      assert.equal(runsListResponse.statusCode, 200);
      const runsListBody = JSON.parse(runsListResponse.payload) as {
        data: { runs: Array<{ id: string }> };
      };
      assert(runsListBody.data.runs.some((run) => run.id === runId));
      assert(runsListBody.data.runs.some((run) => run.id === failedRunId));

      const tempDir = await mkdtemp(path.join(tmpdir(), 'workflow-fs-'));
      const sourceFilePath = path.join(tempDir, 'notes.txt');
      const summaryFileName = 'notes.summary.txt';
      const summaryFilePath = path.join(tempDir, summaryFileName);
      const sourceContent = '# Notes\nThis is a filesystem workflow test.';

      try {
        await writeFile(sourceFilePath, sourceContent, 'utf8');

        type EnsureJobPayload = {
          slug: string;
          name: string;
          type: string;
          entryPoint: string;
          parametersSchema: unknown;
          defaultParameters?: unknown;
          timeoutMs?: number;
          retryPolicy?: unknown;
        };

        async function ensureJobDefinition(payload: EnsureJobPayload): Promise<void> {
          const response = await app.inject({
            method: 'POST',
            url: '/jobs',
            headers: {
              Authorization: `Bearer ${OPERATOR_TOKEN}`
            },
            payload
          });
          if (![201, 409].includes(response.statusCode)) {
            throw new Error(`failed to ensure job definition for ${payload.slug}: ${response.statusCode}`);
          }
        }

        await ensureJobDefinition({
          slug: 'fs-read-file',
          name: 'Filesystem Read File',
          type: 'batch',
          entryPoint: 'workflows.fs.readFile',
          parametersSchema: {
            type: 'object',
            properties: {
              hostPath: { type: 'string', minLength: 1 },
              encoding: { type: 'string', minLength: 1 }
            },
            required: ['hostPath']
          },
          defaultParameters: { encoding: 'utf8' },
          timeoutMs: 60_000,
          retryPolicy: { maxAttempts: 1 }
        });

        await ensureJobDefinition({
          slug: 'fs-write-file',
          name: 'Filesystem Write File',
          type: 'batch',
          entryPoint: 'workflows.fs.writeFile',
          parametersSchema: {
            type: 'object',
            properties: {
              sourcePath: { type: 'string', minLength: 1 },
              content: { type: 'string' },
              outputPath: { type: 'string', minLength: 1 },
              outputFilename: { type: 'string', minLength: 1 },
              encoding: { type: 'string', minLength: 1 },
              overwrite: { type: 'boolean' }
            },
            required: ['sourcePath', 'content']
          },
          defaultParameters: { encoding: 'utf8', overwrite: true },
          timeoutMs: 60_000,
          retryPolicy: { maxAttempts: 1 }
        });

        const createFsWorkflowResponse = await app.inject({
          method: 'POST',
          url: '/workflows',
          headers: {
            Authorization: `Bearer ${OPERATOR_TOKEN}`
          },
          payload: {
            slug: 'wf-fs-summary',
            name: 'Filesystem Summary Workflow',
            steps: [
              {
                id: 'read-file',
                name: 'Read Source File',
                jobSlug: 'fs-read-file',
                parameters: {
                  hostPath: '{{ parameters.hostPath }}'
                },
                storeResultAs: 'inputFile'
              },
              {
                id: 'summarize',
                name: 'Summarize Content',
                type: 'service',
                serviceSlug: 'test-service',
                dependsOn: ['read-file'],
                storeResponseAs: 'summaryResponse',
                parameters: {
                  hostPath: '{{ parameters.hostPath }}'
                },
                request: {
                  path: '/hook',
                  method: 'POST',
                  headers: {
                    Authorization: {
                      secret: { source: 'store', key: 'TEST_SERVICE_TOKEN', version: 'v1' },
                      prefix: 'Bearer '
                    }
                  },
                  body: {
                    summary: 'Summary for {{ steps.read-file.result.fileName }}',
                    originalLength: '{{ shared.inputFile.byteLength }}',
                    absolutePath: '{{ run.parameters.hostPath }}',
                    content: '{{ shared.inputFile.content }}'
                  }
                }
              },
              {
                id: 'write-summary',
                name: 'Write Summary',
                jobSlug: 'fs-write-file',
                dependsOn: ['summarize'],
                parameters: {
                  sourcePath: '{{ shared.inputFile.hostPath }}',
                  content:
                    'Summary: {{ shared.summaryResponse.body.summary }}\nOriginal length: {{ shared.summaryResponse.body.originalLength }}',
                  outputFilename: summaryFileName,
                  overwrite: true
                }
              }
            ]
          }
        });
        assert.equal(createFsWorkflowResponse.statusCode, 201);

        const triggerFsWorkflowResponse = await app.inject({
          method: 'POST',
          url: '/workflows/wf-fs-summary/run',
          headers: {
            Authorization: `Bearer ${OPERATOR_TOKEN}`
          },
          payload: {
            parameters: { hostPath: sourceFilePath }
          }
        });
        assert.equal(triggerFsWorkflowResponse.statusCode, 202);
        const triggerFsWorkflowBody = JSON.parse(triggerFsWorkflowResponse.payload) as {
          data: { id: string; status: string };
        };
        assert.equal(
          triggerFsWorkflowBody.data.status,
          'succeeded',
          JSON.stringify(triggerFsWorkflowBody.data)
        );
        const fsRunId = triggerFsWorkflowBody.data.id;

        const summaryContent = await readFile(summaryFilePath, 'utf8');
        const expectedSummary = `Summary: Summary for ${path.basename(sourceFilePath)}\nOriginal length: ${Buffer.byteLength(sourceContent, 'utf8')}`;
        assert.equal(summaryContent, expectedSummary);

        const fsRunDetailResponse = await app.inject({ method: 'GET', url: `/workflow-runs/${fsRunId}` });
        assert.equal(fsRunDetailResponse.statusCode, 200);
        const fsRunDetailBody = JSON.parse(fsRunDetailResponse.payload) as {
          data: {
            context: {
              shared?: Record<string, unknown>;
              steps: Record<string, { status: string }>;
            };
          };
        };
        const sharedContext = fsRunDetailBody.data.context.shared ?? {};
        const inputFileShared = sharedContext.inputFile as Record<string, unknown> | undefined;
        const summaryShared = sharedContext.summaryResponse as { body?: Record<string, unknown> } | undefined;
        assert.equal((inputFileShared?.hostPath as string | undefined) ?? '', sourceFilePath);
        assert.equal(
          (summaryShared?.body?.summary as string | undefined) ?? '',
          `Summary for ${path.basename(sourceFilePath)}`
        );
        assert.equal(
          (summaryShared?.body?.absolutePath as string | undefined) ?? '',
          sourceFilePath
        );
        assert.equal(fsRunDetailBody.data.context.steps['write-summary'].status, 'succeeded');
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    } finally {
      await testService.close();
    }
  });
}


const delay = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

async function waitForWorkflowRunCount(
  workflowDefinitionId: string,
  expectedCount: number,
  timeoutMs = 2000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (runs.length >= expectedCount) {
      return runs;
    }
    await delay(20);
  }
  throw new Error(`Timed out waiting for ${expectedCount} workflow runs for ${workflowDefinitionId}`);
}

async function testAssetMaterializerAutoRuns(): Promise<void> {
  await ensureEmbeddedPostgres();

  const [{ ensureDatabase }, workflowsModule, { AssetMaterializer }] = await Promise.all([
    import('../src/db/index'),
    import('../src/db/workflows'),
    import('../src/assetMaterializerWorker')
  ]);
  const {
    createWorkflowDefinition,
    listWorkflowRunsForDefinition,
    getWorkflowRunById,
    updateWorkflowRun
  } = workflowsModule;

  await ensureDatabase();

  const materializer = new AssetMaterializer();
  await materializer.start();

  const waitForWorkflowRunCount = async (
    workflowDefinitionId: string,
    expectedCount: number,
    timeoutMs = 2000
  ) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const runs = await listWorkflowRunsForDefinition(workflowDefinitionId, {
        limit: Math.max(expectedCount, 5)
      });
      if (runs.length >= expectedCount) {
        return runs;
      }
      await delay(20);
    }
    throw new Error(`Timed out waiting for ${expectedCount} workflow runs for ${workflowDefinitionId}`);
  };

  const sourceAssetId = `asset.source.${randomUUID()}`;
  const targetAssetId = `asset.target.${randomUUID()}`;

  try {
    const sourceWorkflow = await createWorkflowDefinition({
      slug: `asset-source-${randomUUID()}`.toLowerCase(),
      name: 'Asset Source',
      version: 1,
      steps: [
        {
          id: 'emit-source',
          name: 'Emit Source',
          type: 'job',
          jobSlug: 'workflow-step-source',
          produces: [{ assetId: sourceAssetId }]
        }
      ],
      triggers: [{ type: 'manual' }]
    });

    const targetDefaults = {
      environment: 'production',
      region: 'us-east-1'
    };

    const targetWorkflow = await createWorkflowDefinition({
      slug: `asset-target-${randomUUID()}`.toLowerCase(),
      name: 'Asset Target',
      version: 1,
      steps: [
        {
          id: 'build-target',
          name: 'Build Target',
          type: 'job',
          jobSlug: 'workflow-step-target',
          consumes: [{ assetId: sourceAssetId }],
          produces: [
            {
              assetId: targetAssetId,
              autoMaterialize: { onUpstreamUpdate: true, priority: 5 }
            }
          ]
        }
      ],
      triggers: [{ type: 'manual' }],
      defaultParameters: targetDefaults
    });

    await delay(150);

    const firstProducedAt = new Date().toISOString();
    emitApphubEvent({
      type: 'asset.produced',
      data: {
        assetId: sourceAssetId,
        workflowDefinitionId: sourceWorkflow.id,
        workflowSlug: sourceWorkflow.slug,
        workflowRunId: `run-${randomUUID()}`,
        workflowRunStepId: `step-${randomUUID()}`,
        stepId: 'emit-source',
        producedAt: firstProducedAt,
        freshness: null
      }
    });

    const runsAfterFirst = await waitForWorkflowRunCount(targetWorkflow.id, 1);
    const firstRun = runsAfterFirst[0];
    assert.equal(firstRun.triggeredBy, 'asset-materializer');
    const trigger = firstRun.trigger as Record<string, unknown> | null;
    assert.ok(trigger && trigger.type === 'auto-materialize');
    assert.equal((trigger as { reason?: string }).reason, 'upstream-update');
    assert.deepEqual(firstRun.parameters, targetDefaults);

    const secondProducedAt = new Date(Date.now() + 1000).toISOString();
    emitApphubEvent({
      type: 'asset.produced',
      data: {
        assetId: sourceAssetId,
        workflowDefinitionId: sourceWorkflow.id,
        workflowSlug: sourceWorkflow.slug,
        workflowRunId: `run-${randomUUID()}`,
        workflowRunStepId: `step-${randomUUID()}`,
        stepId: 'emit-source',
        producedAt: secondProducedAt,
        freshness: null
      }
    });

    await delay(150);
    const runsAfterDuplicate = await listWorkflowRunsForDefinition(targetWorkflow.id);
    assert.equal(runsAfterDuplicate.length, 1);

    await updateWorkflowRun(firstRun.id, {
      status: 'succeeded',
      completedAt: new Date().toISOString()
    });
    const completedRun = await getWorkflowRunById(firstRun.id);
    assert.ok(completedRun);
    emitApphubEvent({ type: 'workflow.run.succeeded', data: { run: completedRun! } });
    await delay(100);

    const thirdProducedAt = new Date(Date.now() + 2000).toISOString();
    emitApphubEvent({
      type: 'asset.produced',
      data: {
        assetId: sourceAssetId,
        workflowDefinitionId: sourceWorkflow.id,
        workflowSlug: sourceWorkflow.slug,
        workflowRunId: `run-${randomUUID()}`,
        workflowRunStepId: `step-${randomUUID()}`,
        stepId: 'emit-source',
        producedAt: thirdProducedAt,
        freshness: null
      }
    });

    const runsAfterThird = await waitForWorkflowRunCount(targetWorkflow.id, 2);
    assert.equal(runsAfterThird.length, 2);
  } finally {
    await materializer.stop();
  }
}

async function testAssetMaterializerPartitionParameterReuse(): Promise<void> {
  await ensureEmbeddedPostgres();

  const [{ ensureDatabase }, workflowsModule, { AssetMaterializer }] = await Promise.all([
    import('../src/db/index'),
    import('../src/db/workflows'),
    import('../src/assetMaterializerWorker')
  ]);
  const {
    createWorkflowDefinition,
    createWorkflowRun,
    createWorkflowRunStep,
    recordWorkflowRunStepAssets,
    listWorkflowRunsForDefinition
  } = workflowsModule;

  await ensureDatabase();

  const materializer = new AssetMaterializer();
  await materializer.start();

  const waitForRunCount = async (
    workflowDefinitionId: string,
    expected: number,
    timeoutMs = 2000
  ) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const runs = await listWorkflowRunsForDefinition(workflowDefinitionId, {
        limit: Math.max(expected, 10)
      });
      if (runs.length >= expected) {
        return runs;
      }
      await delay(20);
    }
    throw new Error(`Timed out waiting for ${expected} workflow runs for ${workflowDefinitionId}`);
  };

  const sourceAssetId = `asset.source.${randomUUID()}`;
  const targetAssetId = `asset.target.${randomUUID()}`;

  try {
    const sourceWorkflow = await createWorkflowDefinition({
      slug: `asset-source-${randomUUID()}`.toLowerCase(),
      name: 'Asset Source',
      version: 1,
      steps: [
        {
          id: 'emit-source',
          name: 'Emit Source',
          type: 'job',
          jobSlug: 'workflow-step-source',
          produces: [{ assetId: sourceAssetId }]
        }
      ],
      triggers: [{ type: 'manual' }]
    });

    const targetDefaults = {
      reportsDir: '/default/reports',
      metastoreNamespace: 'default.namespace'
    } as const;

    const targetWorkflow = await createWorkflowDefinition({
      slug: `asset-target-${randomUUID()}`.toLowerCase(),
      name: 'Asset Target',
      version: 1,
      steps: [
        {
          id: 'build-target',
          name: 'Build Target',
          type: 'job',
          jobSlug: 'workflow-step-target',
          consumes: [{ assetId: sourceAssetId }],
          produces: [
            {
              assetId: targetAssetId,
              autoMaterialize: { onUpstreamUpdate: true, priority: 5 }
            }
          ]
        }
      ],
      triggers: [{ type: 'manual' }],
      defaultParameters: targetDefaults
    });

    await delay(150);

    const partitionKey = '2025-10-21T14:40';
    const customParameters = {
      partitionKey,
      reportsDir: '/custom/reports',
      metastoreNamespace: 'custom.namespace',
      siteFilter: 'site-42'
    } as const;

    const manualRun = await createWorkflowRun(targetWorkflow.id, {
      status: 'succeeded',
      partitionKey,
      parameters: customParameters
    });

    const manualStep = await createWorkflowRunStep(manualRun.id, {
      stepId: 'build-target',
      status: 'succeeded',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    });

    await recordWorkflowRunStepAssets(
      targetWorkflow.id,
      manualRun.id,
      manualStep.id,
      'build-target',
      [
        {
          assetId: targetAssetId,
          partitionKey,
          payload: { ok: true }
        }
      ]
    );

    const existingRuns = await listWorkflowRunsForDefinition(targetWorkflow.id, { limit: 10 });
    const baselineCount = existingRuns.length;

    emitApphubEvent({
      type: 'asset.produced',
      data: {
        assetId: sourceAssetId,
        workflowDefinitionId: sourceWorkflow.id,
        workflowSlug: sourceWorkflow.slug,
        workflowRunId: `run-${randomUUID()}`,
        workflowRunStepId: `step-${randomUUID()}`,
        stepId: 'emit-source',
        producedAt: new Date().toISOString(),
        freshness: null,
        partitionKey
      }
    });

    const runsAfterAuto = await waitForRunCount(targetWorkflow.id, baselineCount + 1);
    const autoRun = runsAfterAuto.find(
      (run) => run.triggeredBy === 'asset-materializer' && run.partitionKey === partitionKey
    );
    assert.ok(autoRun, 'expected auto-materialized run to exist');

    assert.ok(autoRun.parameters && typeof autoRun.parameters === 'object');
    const parameters = autoRun.parameters as Record<string, unknown>;
    assert.equal(parameters.reportsDir, customParameters.reportsDir);
    assert.equal(parameters.metastoreNamespace, customParameters.metastoreNamespace);
    assert.equal(parameters.siteFilter, customParameters.siteFilter);
    assert.equal(parameters.partitionKey, partitionKey);
  } finally {
    await materializer.stop();
  }
}

runE2E(async ({ registerCleanup }) => {
  registerCleanup(() => shutdownEmbeddedPostgres());
  await ensureEmbeddedPostgres();
  await testWorkflowEndpoints();
  await testAssetMaterializerAutoRuns();
  await testAssetMaterializerPartitionParameterReuse();
}, { name: 'catalog-workflows.e2e' });

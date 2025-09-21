import './setupTestEnv';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import net from 'node:net';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { FastifyInstance } from 'fastify';
import type { JobRunContext, JobResult } from '../src/jobs/runtime';
import { refreshSecretStore } from '../src/secretStore';

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
    if (req.method === 'POST' && req.url === '/hook') {
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
}

async function createJobDefinition(app: FastifyInstance, payload: { slug: string; name: string }) {
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
      assert.equal(fetchWorkflowBody.data.runs.length, 0);

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

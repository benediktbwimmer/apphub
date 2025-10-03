import './setupTestEnv';
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import type { JobDefinitionRecord, JobRunRecord, JsonValue } from '../src/db/types';
import { CapabilityRequestError } from '@apphub/module-sdk';
import * as jobsDbOriginal from '../src/db/jobs';

let runtimeModulePromise: Promise<typeof import('../src/jobs/runtime')> | null = null;

async function getRuntimeModule() {
  if (!runtimeModulePromise) {
    runtimeModulePromise = import('../src/jobs/runtime');
  }
  return runtimeModulePromise;
}

const originalJobsDb = {
  getJobRunById: jobsDbOriginal.getJobRunById,
  getJobDefinitionById: jobsDbOriginal.getJobDefinitionById,
  completeJobRun: jobsDbOriginal.completeJobRun
};

type RuntimeModule = Awaited<ReturnType<typeof getRuntimeModule>>;

async function withJobsDbOverrides<T>(
  overrides: Partial<typeof originalJobsDb>,
  fn: (runtime: RuntimeModule) => Promise<T>
): Promise<T> {
  const runtime = await getRuntimeModule();
  runtime.__setJobsDbForTesting({ ...originalJobsDb, ...overrides });
  try {
    return await fn(runtime);
  } finally {
    runtime.__setJobsDbForTesting(originalJobsDb);
  }
}

function createJobDefinition(overrides: Partial<JobDefinitionRecord> = {}): JobDefinitionRecord {
  const now = new Date().toISOString();
  return {
    id: 'job-def-1',
    slug: 'test-failure-job',
    name: 'Test Failure Job',
    version: 1,
    type: 'manual',
    runtime: 'node',
    entryPoint: 'dist/index.mjs',
    parametersSchema: {},
    defaultParameters: {},
    outputSchema: {},
    timeoutMs: null,
    retryPolicy: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  } satisfies JobDefinitionRecord;
}

function createJobRun(overrides: Partial<JobRunRecord> = {}): JobRunRecord {
  const now = new Date().toISOString();
  return {
    id: 'job-run-1',
    jobDefinitionId: 'job-def-1',
    status: 'running',
    parameters: {},
    result: null,
    errorMessage: null,
    logsUrl: null,
    metrics: null,
    context: null,
    timeoutMs: null,
    attempt: 1,
    maxAttempts: 1,
    durationMs: null,
    scheduledAt: now,
    startedAt: now,
    completedAt: null,
    lastHeartbeatAt: null,
    retryCount: 0,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  } satisfies JobRunRecord;
}

describe('executeJobRun error propagation', () => {
  it('persists stack trace details in job run context', async () => {
    const { executeJobRun, registerJobHandler, getJobHandler } = await getRuntimeModule();
    const definition = createJobDefinition();
    const run = createJobRun();

    const failure = new Error('handler blew up');
    failure.name = 'TestFailureError';
    failure.stack = 'TestFailureError: handler blew up\n    at handler (/bundle/index.mjs:1:1)';

    const previousHandler = getJobHandler(definition.slug);

    registerJobHandler(definition.slug, () => {
      throw failure;
    });

    const completeCalls: Array<{ status: string; context: JsonValue | null }> = [];
    const completeJobRunMock = mock.fn(async (_runId: string, status: string, input: { context?: JsonValue | null; errorMessage?: string | null }) => {
      completeCalls.push({ status, context: input.context ?? null });
      return {
        ...run,
        status,
        errorMessage: input.errorMessage ?? null,
        context: input.context ?? null,
        completedAt: new Date().toISOString()
      } satisfies JobRunRecord;
    });

    await withJobsDbOverrides(
      {
        getJobRunById: async () => run,
        getJobDefinitionById: async () => definition,
        completeJobRun: completeJobRunMock as unknown as typeof originalJobsDb.completeJobRun
      },
      async () => {
        const result = await executeJobRun(run.id);

        assert(result, 'expected executeJobRun to return a run record');
        assert.equal(result?.status, 'failed');
        assert.equal(result?.errorMessage, failure.message);
      const contextValue = result?.context as JsonValue | null;
      assert(contextValue && typeof contextValue === 'object' && !Array.isArray(contextValue));
      const contextObject = contextValue as Record<string, JsonValue>;
      assert(contextObject.stack && typeof contextObject.stack === 'string');
      assert(contextObject.stack.includes('handler blew up'));
      assert.equal(contextObject.errorName, failure.name);
      assert.equal(contextObject.error, failure.message);

      assert.equal(completeCalls.length, 1);
      const storedContext = completeCalls[0]?.context as JsonValue | null;
      assert(storedContext && typeof storedContext === 'object' && !Array.isArray(storedContext));
      const storedObject = storedContext as Record<string, JsonValue>;
      assert(storedObject.stack && typeof storedObject.stack === 'string');
      assert((storedObject.stack as string).includes('handler blew up'));
      assert.equal(storedObject.errorName, failure.name);
      }
    );
    if (previousHandler) {
      registerJobHandler(definition.slug, previousHandler);
    }
  });

  it('classifies capability errors and surfaces asset recovery context', async () => {
    const { executeJobRun, registerJobHandler, getJobHandler } = await getRuntimeModule();
    const definition = createJobDefinition({ slug: 'asset-missing-job' });
    const run = createJobRun({ id: 'job-run-asset-missing', jobDefinitionId: definition.id });

    const previousHandler = getJobHandler(definition.slug);

    registerJobHandler(definition.slug, () => {
      throw new CapabilityRequestError({
        method: 'GET',
        url: 'https://filestore.local/v1/nodes/by-path',
        status: 404,
        message: 'Node missing',
        code: 'asset_missing',
        metadata: {
          assetId: 'observatory.inbox.csv',
          partitionKey: '2024-09-16T00:00:00Z',
          resource: 'filestore.path',
          capability: 'filestore.getNodeByPath'
        }
      });
    });

    const completeJobRunMock = mock.fn(async (_runId: string, status: string, input: { context?: JsonValue | null; failureReason?: string | null; errorMessage?: string | null }) => {
      return {
        ...run,
        status,
        errorMessage: input.errorMessage ?? null,
        failureReason: input.failureReason ?? null,
        context: input.context ?? null,
        completedAt: new Date().toISOString()
      } satisfies JobRunRecord;
    });

    await withJobsDbOverrides(
      {
        getJobRunById: async () => run,
        getJobDefinitionById: async () => definition,
        completeJobRun: completeJobRunMock as unknown as typeof originalJobsDb.completeJobRun
      },
      async () => {
        const result = await executeJobRun(run.id);

        assert.equal(result?.status, 'failed');
        assert.equal(result?.failureReason, 'asset_missing');
        const contextValue = result?.context as JsonValue | null;
        assert(contextValue && typeof contextValue === 'object' && !Array.isArray(contextValue));
        const contextObject = contextValue as Record<string, JsonValue>;
        const recoveryNode = contextObject.assetRecovery;
        assert(recoveryNode && typeof recoveryNode === 'object' && !Array.isArray(recoveryNode));
        const recovery = recoveryNode as Record<string, JsonValue>;
        assert.equal(recovery.code, 'asset_missing');
        assert.equal(recovery.assetId, 'observatory.inbox.csv');
        assert.equal(recovery.partitionKey, '2024-09-16T00:00:00Z');
        assert.equal(recovery.capability, 'filestore.getNodeByPath');
      }
    );
    if (previousHandler) {
      registerJobHandler(definition.slug, previousHandler);
    }
  });
});

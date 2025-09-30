import './setupTestEnv';
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import type { JobDefinitionRecord, JobRunRecord, JsonValue } from '../src/db/types';
import * as jobsDb from '../src/db/jobs';
import { executeJobRun, registerJobHandler, getJobHandler } from '../src/jobs/runtime';

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
    const definition = createJobDefinition();
    const run = createJobRun();

    const failure = new Error('handler blew up');
    failure.name = 'TestFailureError';
    failure.stack = 'TestFailureError: handler blew up\n    at handler (/bundle/index.mjs:1:1)';

    const previousHandler = getJobHandler(definition.slug);

    registerJobHandler(definition.slug, () => {
      throw failure;
    });

    const getJobRunByIdMock = mock.method(jobsDb, 'getJobRunById', async () => run);
    const getJobDefinitionByIdMock = mock.method(jobsDb, 'getJobDefinitionById', async () => definition);
    const completeCalls: Array<{ status: string; context: JsonValue | null }> = [];
    const completeJobRunMock = mock.method(jobsDb, 'completeJobRun', async (_runId, status, input) => {
      completeCalls.push({ status, context: input.context ?? null });
      return {
        ...run,
        status,
        errorMessage: input.errorMessage ?? null,
        context: input.context ?? null,
        completedAt: new Date().toISOString()
      } satisfies JobRunRecord;
    });

    try {
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
    } finally {
      if (previousHandler) {
        registerJobHandler(definition.slug, previousHandler);
      }
      getJobRunByIdMock.mock.restore();
      getJobDefinitionByIdMock.mock.restore();
      completeJobRunMock.mock.restore();
    }
  });
});

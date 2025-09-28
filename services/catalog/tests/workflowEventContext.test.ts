import './setupTestEnv';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  getWorkflowEventContext,
  runWithWorkflowEventContext,
  type WorkflowEventContext
} from '../src/workflowEventContext';
import { sandboxRunner } from '../src/jobs/sandbox/runner';
import type { AcquiredBundle } from '../src/jobs/bundleCache';
import type { JobDefinitionRecord, JobRunRecord } from '../src/db/types';

function isoNow(): string {
  return new Date().toISOString();
}

test('workflow event context isolates concurrent async execution', async () => {
  const captured = new Map<string, WorkflowEventContext | null>();

  const makeContext = (index: number): WorkflowEventContext => ({
    workflowDefinitionId: `wf-${index}`,
    workflowRunId: `run-${index}`,
    workflowRunStepId: `step-${index}`,
    jobRunId: `job-run-${index}`,
    jobSlug: `job-${index}`
  });

  const tasks = Array.from({ length: 4 }, (_, index) =>
    runWithWorkflowEventContext(makeContext(index), async () => {
      await delay(5 * (index + 1));
      const store = getWorkflowEventContext();
      captured.set(`job-run-${index}`, store ?? null);
      await delay(5);
      const nextStore = getWorkflowEventContext();
      assert.equal(nextStore?.jobRunId, `job-run-${index}`);
    })
  );

  await Promise.all(tasks);

  assert.equal(captured.size, 4);
  for (const [jobRunId, context] of captured) {
    assert.ok(context, `expected context for ${jobRunId}`);
    assert.equal(context?.jobRunId, jobRunId);
  }
});

test('sandbox runner propagates workflow event context to child jobs', async () => {
  const bundleRoot = await mkdtemp(path.join(tmpdir(), 'apphub-workflow-ctx-'));
  try {
    const entryFile = path.join(bundleRoot, 'index.js');
    await writeFile(
      entryFile,
      `exports.handler = async (params, context) => {
        const raw = process.env.APPHUB_WORKFLOW_EVENT_CONTEXT || null;
        const envContext = raw ? JSON.parse(raw) : null;
        const getter = typeof context.getWorkflowEventContext === 'function'
          ? context.getWorkflowEventContext()
          : null;
        return {
          result: {
            envContext,
            contextValue: context.workflowEventContext ?? null,
            getterValue: getter,
            paramPrototype: params.workflowEventContext ?? null
          }
        };
      };`,
      'utf8'
    );

    const bundle: AcquiredBundle = {
      slug: 'sandbox-workflow-ctx',
      version: '1.0.0',
      checksum: 'checksum',
      directory: bundleRoot,
      entryFile,
      manifest: {
        entry: 'index.js',
        pythonEntry: null,
        runtime: 'node',
        capabilities: []
      },
      release: async () => {}
    } satisfies AcquiredBundle;

    const jobDefinition: JobDefinitionRecord = {
      id: randomUUID(),
      slug: 'workflow-context-job',
      name: 'Workflow Context Job',
      version: 1,
      type: 'batch',
      runtime: 'node',
      entryPoint: 'index.js',
      parametersSchema: {},
      defaultParameters: {},
      outputSchema: {},
      timeoutMs: null,
      retryPolicy: null,
      metadata: null,
      createdAt: isoNow(),
      updatedAt: isoNow()
    } satisfies JobDefinitionRecord;

    const jobRun: JobRunRecord = {
      id: randomUUID(),
      jobDefinitionId: jobDefinition.id,
      status: 'running',
      parameters: {},
      result: null,
      errorMessage: null,
      logsUrl: null,
      metrics: null,
      context: null,
      timeoutMs: null,
      attempt: 1,
      maxAttempts: null,
      durationMs: null,
      scheduledAt: isoNow(),
      startedAt: isoNow(),
      completedAt: null,
      lastHeartbeatAt: null,
      retryCount: 0,
      failureReason: null,
      createdAt: isoNow(),
      updatedAt: isoNow()
    } satisfies JobRunRecord;

    const workflowEventContext: WorkflowEventContext = {
      workflowDefinitionId: 'wf-ctx',
      workflowRunId: 'run-ctx',
      workflowRunStepId: 'step-ctx',
      jobRunId: jobRun.id,
      jobSlug: jobDefinition.slug
    };

    const outcome = await sandboxRunner.execute({
      bundle,
      jobDefinition,
      run: jobRun,
      parameters: {},
      timeoutMs: null,
      exportName: null,
      logger: () => {},
      update: async () => jobRun,
      resolveSecret: () => null,
      workflowEventContext
    });

    const resultRecord = outcome.result.result as Record<string, unknown> | null;
    assert.ok(resultRecord, 'expected job result payload');

    assert.deepEqual(resultRecord?.envContext, workflowEventContext);
    assert.deepEqual(resultRecord?.contextValue, workflowEventContext);
    assert.deepEqual(resultRecord?.getterValue, workflowEventContext);
    assert.deepEqual(resultRecord?.paramPrototype, workflowEventContext);
  } finally {
    await rm(bundleRoot, { recursive: true, force: true });
  }
});

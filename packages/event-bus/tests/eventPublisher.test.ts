import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import {
  createEventPublisher,
  normalizeEventEnvelope,
  resolveWorkflowContext,
  type EventEnvelope,
  type EventIngressJobData,
  type WorkflowMetadata
} from '../src/index';
import {
  runWithWorkflowEventContext,
  type WorkflowEventContext
} from '@apphub/core/workflowEventContext';
import type { JobsOptions, Queue } from 'bullmq';

const WORKFLOW_CONTEXT_ENV = 'APPHUB_WORKFLOW_EVENT_CONTEXT';
const WORKFLOW_METADATA_KEY = '__apphubWorkflow';

const trackedEnvVars = ['APPHUB_EVENTS_MODE', 'REDIS_URL', WORKFLOW_CONTEXT_ENV] as const;
const originalEnv = new Map<string, string | undefined>(
  trackedEnvVars.map((key) => [key, process.env[key]])
);

function restoreEnv(): void {
  for (const key of trackedEnvVars) {
    const original = originalEnv.get(key);
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
}

beforeEach(() => {
  for (const key of trackedEnvVars) {
    delete process.env[key];
  }
});

afterEach(() => {
  restoreEnv();
});

const baseContext: WorkflowEventContext = {
  workflowDefinitionId: 'wf-123',
  workflowRunId: 'run-456',
  workflowRunStepId: 'step-789',
  jobRunId: 'job-101',
  jobSlug: 'example-job',
  workflowRunKey: 'order-123'
};

function readWorkflowMetadata(envelope: EventEnvelope): WorkflowMetadata | undefined {
  const metadata = envelope.metadata as Record<string, unknown> | undefined;
  if (!metadata) {
    return undefined;
  }
  const workflow = metadata[WORKFLOW_METADATA_KEY];
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    return undefined;
  }
  return workflow as WorkflowMetadata;
}

class InMemoryQueue {
  public readonly jobs: Array<{
    name: string;
    data: EventIngressJobData | undefined;
    options: JobsOptions | undefined;
  }> = [];

  public closed = false;

  async add(
    name: string,
    data: EventIngressJobData | undefined,
    options?: JobsOptions
  ): Promise<void> {
    this.jobs.push({ name, data, options });
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

test('resolveWorkflowContext prefers AsyncLocalStorage context when available', async () => {
  const contextWithWhitespace: WorkflowEventContext = {
    ...baseContext,
    workflowRunStepId: ` ${baseContext.workflowRunStepId} `,
    jobSlug: `${baseContext.jobSlug} \n`,
    workflowRunKey: ` ${baseContext.workflowRunKey} `
  };
  const resolvedEnvelope = await runWithWorkflowEventContext(contextWithWhitespace, async () => {
    const resolved = resolveWorkflowContext();
    assert.deepEqual(resolved, {
      ...baseContext,
      workflowRunStepId: baseContext.workflowRunStepId,
      jobSlug: baseContext.jobSlug,
      workflowRunKey: baseContext.workflowRunKey
    });

    return normalizeEventEnvelope({
      type: 'test.inline.workflow-metadata',
      source: 'unit.inline'
    });
  });

  const metadata = readWorkflowMetadata(resolvedEnvelope);
  assert.deepEqual(metadata, {
    ...baseContext,
    workflowRunStepId: baseContext.workflowRunStepId,
    jobSlug: baseContext.jobSlug,
    workflowRunKey: baseContext.workflowRunKey
  });
});

test('normalizeEventEnvelope falls back to environment workflow context', () => {
  const envContext = {
    ...baseContext,
    workflowDefinitionId: 'wf-env',
    jobSlug: 'env-job ',
    extraField: 'ignored'
  } as Record<string, unknown>;
  process.env[WORKFLOW_CONTEXT_ENV] = JSON.stringify(envContext);

  const envelope = normalizeEventEnvelope({
    type: 'test.env.workflow-metadata',
    source: 'unit.env'
  });

  const metadata = readWorkflowMetadata(envelope);
  assert.deepEqual(metadata, {
    workflowDefinitionId: 'wf-env',
    workflowRunId: baseContext.workflowRunId,
    workflowRunStepId: baseContext.workflowRunStepId,
    jobRunId: baseContext.jobRunId,
    jobSlug: 'env-job',
    workflowRunKey: baseContext.workflowRunKey
  });
});

test('oversized workflow context is ignored', () => {
  const largeValue = 'x'.repeat(4096);
  const envContext = {
    ...baseContext,
    workflowRunId: largeValue
  } satisfies Record<string, unknown>;
  process.env[WORKFLOW_CONTEXT_ENV] = JSON.stringify(envContext);

  const envelope = normalizeEventEnvelope({
    type: 'test.env.workflow-large',
    source: 'unit.env'
  });

  assert.equal(readWorkflowMetadata(envelope), undefined);
});

test('existing workflow metadata is preserved', () => {
  const existingMetadata: Record<string, unknown> = {
    [WORKFLOW_METADATA_KEY]: {
      workflowDefinitionId: 'legacy-def',
      workflowRunId: 'legacy-run',
      workflowRunStepId: 'legacy-step',
      jobRunId: 'legacy-job',
      jobSlug: 'legacy-slug'
    }
  };
  process.env[WORKFLOW_CONTEXT_ENV] = JSON.stringify(baseContext);

  const envelope = normalizeEventEnvelope({
    type: 'test.env.workflow-existing',
    source: 'unit.env',
    metadata: existingMetadata
  });

  assert.deepEqual(readWorkflowMetadata(envelope), existingMetadata[WORKFLOW_METADATA_KEY]);
});

test('queue-backed publisher injects workflow metadata into queued jobs', async () => {
  process.env.APPHUB_EVENTS_MODE = 'redis';
  const queue = new InMemoryQueue();
  const publisher = createEventPublisher({
    queue: queue as unknown as Queue<EventIngressJobData>
  });

  const envelope = await runWithWorkflowEventContext(baseContext, () =>
    publisher.publish({
      type: 'test.queue.workflow-metadata',
      source: 'unit.queue'
    })
  );

  assert.deepEqual(readWorkflowMetadata(envelope), baseContext);
  assert.equal(queue.jobs.length, 1);
  const queuedEnvelope = queue.jobs[0].data?.envelope;
  assert.ok(queuedEnvelope, 'envelope should be enqueued');
  assert.deepEqual(readWorkflowMetadata(queuedEnvelope as EventEnvelope), baseContext);

  await publisher.close();
  assert.equal(queue.closed, false);
});

test('inline publisher attaches workflow metadata per invocation', async () => {
  process.env.APPHUB_EVENTS_MODE = 'inline';
  const publisher = createEventPublisher();

  const firstEnvelope = await runWithWorkflowEventContext(baseContext, () =>
    publisher.publish({
      type: 'test.inline.first',
      source: 'unit.inline'
    })
  );
  assert.deepEqual(readWorkflowMetadata(firstEnvelope), baseContext);

  const secondEnvelope = await publisher.publish({
    type: 'test.inline.second',
    source: 'unit.inline'
  });
  assert.equal(readWorkflowMetadata(secondEnvelope), undefined);

  await publisher.close();
});

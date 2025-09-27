import type { Redis } from 'ioredis';
import {
  DEFAULT_EVENT_JOB_NAME,
  DEFAULT_EVENT_QUEUE_NAME,
  normalizeEventEnvelope,
  type EventEnvelope,
  type EventEnvelopeInput,
  type EventIngressJobData
} from '@apphub/event-bus';
import { createJobRunForSlug, executeJobRun } from './jobs/runtime';
import { getJobRunById } from './db/jobs';
import { type JobRunRecord, type JsonValue } from './db/types';
import { runWorkflowOrchestration } from './workflowOrchestrator';
import type { ExampleDescriptorReference } from '@apphub/example-bundler';
import type { ExampleBundleJobData, ExampleBundleJobResult } from './exampleBundleWorker';
import { ingestWorkflowEvent } from './workflowEvents';
import {
  recordEventIngress,
  recordEventIngressFailure
} from './eventSchedulerMetrics';
import { registerSourceEvent } from './eventSchedulerState';
import { queueManager } from './queueManager';

export const INGEST_QUEUE_NAME = process.env.INGEST_QUEUE_NAME ?? 'apphub_queue';
export const BUILD_QUEUE_NAME = process.env.BUILD_QUEUE_NAME ?? 'apphub_build_queue';
export const LAUNCH_QUEUE_NAME = process.env.LAUNCH_QUEUE_NAME ?? 'apphub_launch_queue';
export const WORKFLOW_QUEUE_NAME = process.env.WORKFLOW_QUEUE_NAME ?? 'apphub_workflow_queue';
export const ASSET_EVENT_QUEUE_NAME = process.env.ASSET_EVENT_QUEUE_NAME ?? 'apphub_asset_event_queue';
export const EXAMPLE_BUNDLE_QUEUE_NAME = process.env.EXAMPLE_BUNDLE_QUEUE_NAME ?? 'apphub_example_bundle_queue';
export const EVENT_QUEUE_NAME = process.env.APPHUB_EVENT_QUEUE_NAME ?? DEFAULT_EVENT_QUEUE_NAME;
export const EVENT_TRIGGER_QUEUE_NAME =
  process.env.APPHUB_EVENT_TRIGGER_QUEUE_NAME ?? 'apphub_event_trigger_queue';
export const EVENT_TRIGGER_JOB_NAME = 'apphub.event.trigger';

export type EventTriggerJobData = {
  envelope: EventEnvelope;
};

const QUEUE_KEYS = {
  ingest: 'catalog:ingest',
  build: 'catalog:build',
  launch: 'catalog:launch',
  workflow: 'catalog:workflow',
  exampleBundle: 'catalog:example-bundle',
  event: 'catalog:event',
  eventTrigger: 'catalog:event-trigger'
} as const;

const EVENT_TRIGGER_ATTEMPTS = Number(process.env.EVENT_TRIGGER_ATTEMPTS ?? 3);
const EVENT_TRIGGER_BACKOFF_MS = Number(process.env.EVENT_TRIGGER_BACKOFF_MS ?? 5_000);

queueManager.registerQueue({
  key: QUEUE_KEYS.ingest,
  queueName: INGEST_QUEUE_NAME,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100
  },
  workerLoader: async () => {
    await import('./ingestionWorker');
  }
});

queueManager.registerQueue({
  key: QUEUE_KEYS.build,
  queueName: BUILD_QUEUE_NAME,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 50,
    attempts: 1
  },
  workerLoader: async () => {
    await import('./buildRunner');
  }
});

queueManager.registerQueue({
  key: QUEUE_KEYS.launch,
  queueName: LAUNCH_QUEUE_NAME,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 25
  }
});

queueManager.registerQueue({
  key: QUEUE_KEYS.workflow,
  queueName: WORKFLOW_QUEUE_NAME,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 50
  }
});

queueManager.registerQueue({
  key: QUEUE_KEYS.exampleBundle,
  queueName: EXAMPLE_BUNDLE_QUEUE_NAME,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 25
  },
  workerLoader: async () => {
    await import('./exampleBundleWorker');
  }
});

queueManager.registerQueue({
  key: QUEUE_KEYS.event,
  queueName: EVENT_QUEUE_NAME,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 100
  }
});

queueManager.registerQueue({
  key: QUEUE_KEYS.eventTrigger,
  queueName: EVENT_TRIGGER_QUEUE_NAME,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: EVENT_TRIGGER_ATTEMPTS,
    backoff: {
      type: 'exponential',
      delay: EVENT_TRIGGER_BACKOFF_MS
    }
  }
});

export async function enqueueRepositoryIngestion(
  repositoryId: string,
  options: {
    jobRunId?: string;
    parameters?: JsonValue;
  } = {}
): Promise<JobRunRecord> {
  const inlineMode = queueManager.isInlineMode();
  const trimmedId = repositoryId.trim();
  if (!trimmedId) {
    throw new Error('repositoryId is required');
  }

  const baseParameters =
    options.parameters && typeof options.parameters === 'object' && !Array.isArray(options.parameters)
      ? (options.parameters as Record<string, JsonValue>)
      : {};
  const parameters: Record<string, JsonValue> = {
    ...baseParameters,
    repositoryId: trimmedId
  };

  let run: JobRunRecord | null = null;

  if (options.jobRunId) {
    run = await getJobRunById(options.jobRunId);
    if (!run) {
      throw new Error(`Job run ${options.jobRunId} not found`);
    }
  }

  if (!run) {
    run = await createJobRunForSlug('repository-ingest', {
      parameters
    });
  }

  if (inlineMode) {
    await queueManager.ensureWorker(QUEUE_KEYS.ingest);
    const executed = await executeJobRun(run.id);
    return executed ?? run;
  }

  const queue = queueManager.getQueue(QUEUE_KEYS.ingest);
  await queue.add(
    'repository-ingest',
    { repositoryId: trimmedId, jobRunId: run.id },
    {
      attempts: Number(process.env.INGEST_JOB_ATTEMPTS ?? 3),
      backoff: {
        type: 'exponential',
        delay: Number(process.env.INGEST_JOB_BACKOFF_MS ?? 10_000)
      }
    }
  );

  return run;
}

export async function enqueueWorkflowEvent(
  input: EventEnvelopeInput
): Promise<EventEnvelope> {
  const inlineMode = queueManager.isInlineMode();
  const envelope = normalizeEventEnvelope(input);

  if (inlineMode) {
    try {
      await ingestWorkflowEvent(envelope);
    } catch (err) {
      await recordEventIngressFailure(envelope.source ?? 'unknown');
      throw err;
    }

    const registration = await registerSourceEvent(envelope.source ?? 'unknown');
    await recordEventIngress(envelope, {
      throttled: registration.reason === 'rate_limit' && registration.allowed === false,
      dropped: registration.allowed === false
    });

    if (!registration.allowed) {
      console.warn('[event-scheduler] Dropping event in inline mode due to source pause', {
        source: envelope.source,
        reason: registration.reason,
        resumeAt: registration.until
      });
      return envelope;
    }

    const { processEventTriggersForEnvelope } = await import('./eventTriggerProcessor');
    try {
      await processEventTriggersForEnvelope(envelope);
    } catch (err) {
      await recordEventIngressFailure(envelope.source ?? 'unknown');
      throw err;
    }
    return envelope;
  }

  const queue = queueManager.getQueue<EventIngressJobData>(QUEUE_KEYS.event);
  await queue.add(DEFAULT_EVENT_JOB_NAME, { envelope });
  return envelope;
}

export async function enqueueEventTriggerEvaluation(envelope: EventEnvelope): Promise<void> {
  const inlineMode = queueManager.isInlineMode();
  if (inlineMode) {
    const { processEventTriggersForEnvelope } = await import('./eventTriggerProcessor');
    await processEventTriggersForEnvelope(envelope);
    return;
  }

  const queue = queueManager.getQueue<EventTriggerJobData>(QUEUE_KEYS.eventTrigger);
  await queue.add(EVENT_TRIGGER_JOB_NAME, { envelope });
}

export async function getEventQueueStats(): Promise<{
  mode: 'inline' | 'queue' | 'disabled';
  counts?: Record<string, number>;
}> {
  const inlineMode = queueManager.isInlineMode();
  if (inlineMode) {
    return { mode: 'inline' };
  }

  const queue = queueManager.tryGetQueue<EventIngressJobData>(QUEUE_KEYS.event);
  if (!queue) {
    return { mode: 'disabled' };
  }

  return {
    mode: 'queue',
    counts: await queueManager.getQueueCounts(QUEUE_KEYS.event)
  };
}

export async function getEventTriggerQueueStats(): Promise<{
  mode: 'inline' | 'queue' | 'disabled';
  counts?: Record<string, number>;
}> {
  const inlineMode = queueManager.isInlineMode();
  if (inlineMode) {
    return { mode: 'inline' };
  }

  const queue = queueManager.tryGetQueue<EventTriggerJobData>(QUEUE_KEYS.eventTrigger);
  if (!queue) {
    return { mode: 'disabled' };
  }

  return {
    mode: 'queue',
    counts: await queueManager.getQueueCounts(QUEUE_KEYS.eventTrigger)
  };
}

export function getQueueConnection() {
  return queueManager.getConnection();
}

export function isInlineQueueMode() {
  return queueManager.isInlineMode();
}

export async function closeQueueConnection(instance?: Redis | null) {
  await queueManager.closeConnection(instance ?? null);
}

export async function enqueueBuildJob(
  buildId: string,
  repositoryId: string,
  options: { jobRunId?: string } = {}
): Promise<JobRunRecord> {
  const inlineMode = queueManager.isInlineMode();
  const trimmedBuildId = buildId.trim();
  if (!trimmedBuildId) {
    throw new Error('buildId is required');
  }

  const trimmedRepositoryId = repositoryId.trim();
  if (!trimmedRepositoryId) {
    throw new Error('repositoryId is required');
  }

  let run: JobRunRecord | null = null;

  if (options.jobRunId) {
    run = await getJobRunById(options.jobRunId);
    if (!run) {
      throw new Error(`Job run ${options.jobRunId} not found`);
    }
  }

  if (!run) {
    run = await createJobRunForSlug('repository-build', {
      parameters: { buildId: trimmedBuildId, repositoryId: trimmedRepositoryId }
    });
  }

  if (inlineMode) {
    await queueManager.ensureWorker(QUEUE_KEYS.build);
    const executed = await executeJobRun(run.id);
    return executed ?? run;
  }

  const queue = queueManager.getQueue(QUEUE_KEYS.build);
  await queue.add('repository-build', {
    buildId: trimmedBuildId,
    repositoryId: trimmedRepositoryId,
    jobRunId: run.id
  });

  return run;
}

export async function enqueueLaunchStart(launchId: string) {
  if (queueManager.isInlineMode()) {
    return;
  }

  const queue = queueManager.getQueue(QUEUE_KEYS.launch);
  await queue.add('launch-start', { launchId, type: 'start' });
}

export async function enqueueLaunchStop(launchId: string) {
  if (queueManager.isInlineMode()) {
    return;
  }

  const queue = queueManager.getQueue(QUEUE_KEYS.launch);
  await queue.add('launch-stop', { launchId, type: 'stop' });
}

export async function enqueueWorkflowRun(workflowRunId: string): Promise<void> {
  const inlineMode = queueManager.isInlineMode();
  const trimmedId = workflowRunId.trim();
  if (!trimmedId) {
    throw new Error('workflowRunId is required');
  }

  if (inlineMode) {
    await runWorkflowOrchestration(trimmedId);
    return;
  }

  const queue = queueManager.getQueue(QUEUE_KEYS.workflow);
  await queue.add('workflow-run', { workflowRunId: trimmedId });
}

export type EnqueueExampleBundleResult = {
  jobId: string;
  slug: string;
  mode: 'inline' | 'queued';
  result?: ExampleBundleJobResult;
};

export async function enqueueExampleBundleJob(
  slug: string,
  options: {
    force?: boolean;
    skipBuild?: boolean;
    minify?: boolean;
    descriptor?: ExampleDescriptorReference | null;
  } = {}
): Promise<EnqueueExampleBundleResult> {
  const inlineMode = queueManager.isInlineMode();
  const trimmedSlug = slug.trim().toLowerCase();
  if (!trimmedSlug) {
    throw new Error('slug is required');
  }

  const payload: ExampleBundleJobData = {
    slug: trimmedSlug,
    force: options.force,
    skipBuild: options.skipBuild,
    minify: options.minify,
    descriptor: options.descriptor ?? null
  };

  if (inlineMode) {
    await queueManager.ensureWorker(QUEUE_KEYS.exampleBundle);
    const jobId = `inline:${Date.now()}`;
    const module = await import('./exampleBundleWorker');
    const result = await module.processExampleBundleJob(payload, jobId);
    return {
      jobId,
      slug: trimmedSlug,
      mode: 'inline',
      result
    } satisfies EnqueueExampleBundleResult;
  }

  const queue = queueManager.getQueue<ExampleBundleJobData>(QUEUE_KEYS.exampleBundle);
  const job = await queue.add(trimmedSlug, payload, {
    jobId: trimmedSlug
  });

  return {
    jobId: String(job.id),
    slug: trimmedSlug,
    mode: 'queued'
  } satisfies EnqueueExampleBundleResult;
}

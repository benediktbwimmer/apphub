import type { Redis } from 'ioredis';
import {
  DEFAULT_EVENT_JOB_NAME,
  normalizeEventEnvelope,
  type EventEnvelope,
  type EventEnvelopeInput,
  type EventIngressJobData
} from '@apphub/event-bus';
import { createJobRunForSlug, executeJobRun } from './jobs/runtime';
import { getJobRunById } from './db/jobs';
import { getWorkflowRunById } from './db/workflows';
import { type JobRunRecord, type JsonValue } from './db/types';
import type { ExampleDescriptorReference } from '@apphub/example-bundler';
import type { ExampleBundleJobData, ExampleBundleJobResult } from './exampleBundleWorker';
import { ingestWorkflowEvent } from './workflowEvents';
import {
  recordEventIngress,
  recordEventIngressFailure
} from './eventSchedulerMetrics';
import { registerSourceEvent } from './eventSchedulerState';
import { queueManager } from './queueManager';
import {
  ASSET_EVENT_QUEUE_NAME,
  BUILD_QUEUE_NAME,
  EVENT_QUEUE_NAME,
  EVENT_RETRY_JOB_NAME,
  EVENT_TRIGGER_JOB_NAME,
  EVENT_TRIGGER_QUEUE_NAME,
  EVENT_TRIGGER_RETRY_JOB_NAME,
  EXAMPLE_BUNDLE_QUEUE_NAME,
  INGEST_QUEUE_NAME,
  LAUNCH_QUEUE_NAME,
  QUEUE_KEYS,
  WORKFLOW_QUEUE_NAME,
  WORKFLOW_RETRY_JOB_NAME
} from './queueConstants';

export {
  ASSET_EVENT_QUEUE_NAME,
  BUILD_QUEUE_NAME,
  EVENT_QUEUE_NAME,
  EVENT_RETRY_JOB_NAME,
  EVENT_TRIGGER_JOB_NAME,
  EVENT_TRIGGER_QUEUE_NAME,
  EVENT_TRIGGER_RETRY_JOB_NAME,
  EXAMPLE_BUNDLE_QUEUE_NAME,
  INGEST_QUEUE_NAME,
  LAUNCH_QUEUE_NAME,
  QUEUE_KEYS,
  WORKFLOW_QUEUE_NAME,
  WORKFLOW_RETRY_JOB_NAME
} from './queueConstants';

export type EventTriggerJobData = {
  envelope?: EventEnvelope;
  deliveryId?: string;
  eventId?: string;
  retryKind?: 'trigger';
};

export type WorkflowRetryJobData = {
  workflowRunId: string;
  runKey?: string | null;
  stepId?: string | null;
  retryKind: 'workflow';
};

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

function computeDelayMs(runAtIso: string): number {
  if (!runAtIso) {
    return 0;
  }
  const runAt = Date.parse(runAtIso);
  if (Number.isNaN(runAt)) {
    return 0;
  }
  return Math.max(runAt - Date.now(), 0);
}

export async function scheduleEventRetryJob(
  eventId: string,
  runAtIso: string,
  attempt: number
): Promise<void> {
  if (queueManager.isInlineMode()) {
    console.warn('[event-retry] Inline mode active; skipping retry scheduling', {
      eventId,
      runAtIso
    });
    return;
  }

  const queue = queueManager.getQueue<EventIngressJobData>(QUEUE_KEYS.event);
  try {
    await queue.add(
      EVENT_RETRY_JOB_NAME,
      { eventId, retryKind: 'source' },
      {
        delay: computeDelayMs(runAtIso),
        jobId: buildJobId('event-retry', eventId, attempt),
        removeOnComplete: 100,
        removeOnFail: 100
      }
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes('jobId already exists')) {
      return;
    }
    throw err;
  }
}

export async function removeEventRetryJob(eventId: string, attempt: number): Promise<void> {
  if (queueManager.isInlineMode()) {
    return;
  }
  const queue = queueManager.tryGetQueue<EventIngressJobData>(QUEUE_KEYS.event);
  if (!queue) {
    return;
  }
  const safeAttempt = Math.max(Math.floor(attempt) || 1, 1);
  const jobId = buildJobId('event-retry', eventId, safeAttempt);
  try {
    await queue.remove(jobId);
  } catch (err) {
    if (err instanceof Error && err.message.includes('no queue name')) {
      return;
    }
    throw err;
  }
}

export async function scheduleEventTriggerRetryJob(
  deliveryId: string,
  eventId: string,
  runAtIso: string,
  attempt: number
): Promise<void> {
  if (queueManager.isInlineMode()) {
    console.warn('[event-trigger-retry] Inline mode active; skipping retry scheduling', {
      deliveryId,
      eventId,
      runAtIso
    });
    return;
  }

  const queue = queueManager.getQueue<EventTriggerJobData>(QUEUE_KEYS.eventTrigger);

  try {
    await queue.add(
      EVENT_TRIGGER_RETRY_JOB_NAME,
      { deliveryId, eventId, retryKind: 'trigger' },
      {
        delay: computeDelayMs(runAtIso),
        jobId: buildJobId('event-trigger-retry', deliveryId, attempt),
        removeOnComplete: 100,
        removeOnFail: 100
      }
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes('jobId already exists')) {
      return;
    }
    throw err;
  }
}

export async function removeEventTriggerRetryJob(deliveryId: string, attempt: number): Promise<void> {
  if (queueManager.isInlineMode()) {
    return;
  }
  const queue = queueManager.tryGetQueue<EventTriggerJobData>(QUEUE_KEYS.eventTrigger);
  if (!queue) {
    return;
  }
  const safeAttempt = Math.max(Math.floor(attempt) || 1, 1);
  const jobId = buildJobId('event-trigger-retry', deliveryId, safeAttempt);
  try {
    await queue.remove(jobId);
  } catch (err) {
    if (err instanceof Error && err.message.includes('no queue name')) {
      return;
    }
    throw err;
  }
}

function computeWorkflowRetryDelayMs(runAtIso: string): number {
  if (!runAtIso) {
    return 0;
  }
  const parsed = Date.parse(runAtIso);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return Math.max(parsed - Date.now(), 0);
}

const JOB_ID_SEGMENT_SEPARATOR = '--';

function sanitizeRunKeyForJobId(value: string): string {
  const lowered = value.toLowerCase();
  const sanitized = lowered.replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized.slice(0, 48) || 'run';
}

function buildJobId(...segments: Array<string | number | null | undefined>): string {
  const sanitizedSegments = segments
    .map((segment) => (segment == null ? '' : String(segment)))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.replace(/[:]/g, '-'));
  if (sanitizedSegments.length === 0) {
    return 'job';
  }
  return sanitizedSegments.join(JOB_ID_SEGMENT_SEPARATOR);
}

export async function scheduleWorkflowRetryJob(
  workflowRunId: string,
  stepId: string | null,
  runAtIso: string,
  attempt: number,
  options: { runKey?: string | null } = {}
): Promise<void> {
  if (queueManager.isInlineMode()) {
    console.warn('[workflow-retry] Inline mode active; skipping retry scheduling', {
      workflowRunId,
      stepId,
      runAtIso
    });
    return;
  }

  const queue = queueManager.getQueue<WorkflowRetryJobData>(QUEUE_KEYS.workflow);
  const safeStepId = (stepId ?? 'run').replace(/:/g, '-');
  const runKeyToken = options.runKey ? sanitizeRunKeyForJobId(options.runKey) : workflowRunId;
  const jobId = buildJobId('workflow-retry', runKeyToken, workflowRunId, `${safeStepId}-${attempt}`);

  try {
    await queue.add(
      WORKFLOW_RETRY_JOB_NAME,
      {
        workflowRunId,
        runKey: options.runKey ?? null,
        stepId,
        retryKind: 'workflow'
      },
      {
        delay: computeWorkflowRetryDelayMs(runAtIso),
        jobId,
        removeOnComplete: 100,
        removeOnFail: 100
      }
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes('jobId already exists')) {
      return;
    }
    throw err;
  }
}

export async function removeWorkflowRetryJob(
  workflowRunId: string,
  stepId: string | null,
  attempt: number,
  options: { runKey?: string | null } = {}
): Promise<void> {
  if (queueManager.isInlineMode()) {
    return;
  }
  const queue = queueManager.tryGetQueue<WorkflowRetryJobData>(QUEUE_KEYS.workflow);
  if (!queue) {
    return;
  }
  const safeAttempt = Math.max(Math.floor(attempt) || 1, 1);
  const safeStepId = (stepId ?? 'run').replace(/:/g, '-');
  const runKeyToken = options.runKey ? sanitizeRunKeyForJobId(options.runKey) : workflowRunId;
  const jobId = buildJobId('workflow-retry', runKeyToken, workflowRunId, `${safeStepId}-${safeAttempt}`);
  try {
    await queue.remove(jobId);
  } catch (err) {
    if (err instanceof Error && err.message.includes('no queue name')) {
      return;
    }
    throw err;
  }
}

export type QueueStats = {
  key: string;
  queueName: string;
  mode: 'inline' | 'queue';
  counts?: Record<string, number>;
  metrics?: {
    processingAvgMs?: number | null;
    waitingAvgMs?: number | null;
  } | null;
  error?: string;
};

async function resolveQueueStats(key: string): Promise<QueueStats> {
  const inlineMode = queueManager.isInlineMode();
  if (inlineMode) {
    return {
      key,
      queueName: key,
      mode: 'inline'
    };
  }

  try {
    const snapshot = await queueManager.getQueueStatistics(key);
    return {
      key,
      queueName: snapshot.queueName,
      mode: snapshot.mode,
      counts: snapshot.counts,
      metrics: snapshot.metrics ?? null
    };
  } catch (err) {
    return {
      key,
      queueName: key,
      mode: 'queue',
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export async function getEventQueueStats(): Promise<{
  mode: 'inline' | 'queue' | 'disabled';
  counts?: Record<string, number>;
  metrics?: QueueStats['metrics'];
}> {
  const stats = await resolveQueueStats(QUEUE_KEYS.event);
  if (stats.mode === 'inline') {
    return { mode: 'inline' };
  }
  if (stats.error) {
    return { mode: 'disabled' };
  }
  return {
    mode: 'queue',
    counts: stats.counts ?? {},
    metrics: stats.metrics ?? null
  };
}

export async function getEventTriggerQueueStats(): Promise<{
  mode: 'inline' | 'queue' | 'disabled';
  counts?: Record<string, number>;
  metrics?: QueueStats['metrics'];
}> {
  const stats = await resolveQueueStats(QUEUE_KEYS.eventTrigger);
  if (stats.mode === 'inline') {
    return { mode: 'inline' };
  }
  if (stats.error) {
    return { mode: 'disabled' };
  }
  return {
    mode: 'queue',
    counts: stats.counts ?? {},
    metrics: stats.metrics ?? null
  };
}

const QUEUE_HEALTH_KEYS = [
  { key: QUEUE_KEYS.ingest, label: 'ingest' },
  { key: QUEUE_KEYS.build, label: 'build' },
  { key: QUEUE_KEYS.launch, label: 'launch' },
  { key: QUEUE_KEYS.workflow, label: 'workflow' },
  { key: QUEUE_KEYS.exampleBundle, label: 'exampleBundle' },
  { key: QUEUE_KEYS.event, label: 'event' },
  { key: QUEUE_KEYS.eventTrigger, label: 'eventTrigger' }
] as const;

export async function getQueueHealthSnapshot(): Promise<{
  generatedAt: string;
  inlineMode: boolean;
  queues: Array<QueueStats & { label: string }>;
}> {
  const inlineMode = queueManager.isInlineMode();
  const results = await Promise.all(
    QUEUE_HEALTH_KEYS.map(async ({ key, label }) => {
      const stats = await resolveQueueStats(key);
      return { ...stats, label };
    })
  );

  return {
    generatedAt: new Date().toISOString(),
    inlineMode,
    queues: results
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

export function getQueueKeyStatistics(key: string) {
  return queueManager.getQueueStatistics(key);
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

export async function enqueueWorkflowRun(
  workflowRunId: string,
  options: { runKey?: string | null } = {}
): Promise<void> {
  const inlineMode = queueManager.isInlineMode();
  const trimmedId = workflowRunId.trim();
  if (!trimmedId) {
    throw new Error('workflowRunId is required');
  }

  if (inlineMode) {
    const { runWorkflowOrchestration } = await import('./workflowOrchestrator');
    await runWorkflowOrchestration(trimmedId);
    return;
  }

  let runKey = options.runKey ?? null;
  if (runKey === undefined) {
    runKey = null;
  }
  if (runKey === null) {
    try {
      const existing = await getWorkflowRunById(trimmedId);
      runKey = existing?.runKey ?? null;
    } catch (err) {
      console.error('[enqueueWorkflowRun] failed to resolve workflow run key', {
        workflowRunId: trimmedId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  const runKeyToken = runKey ? sanitizeRunKeyForJobId(runKey) : trimmedId;

  const queue = queueManager.getQueue(QUEUE_KEYS.workflow);
  const baseOptions = queue.opts.defaultJobOptions ?? {};
  const jobId = buildJobId('workflow-run', runKeyToken, trimmedId, 'run');
  console.log('[enqueueWorkflowRun] scheduling run', {
    workflowRunId: trimmedId,
    jobId,
    runKey: runKey ?? null
  });
  try {
    await queue.add(
      'workflow-run',
      { workflowRunId: trimmedId, runKey: runKey ?? null },
      {
        ...baseOptions,
        jobId
      }
    );
  } catch (err) {
    console.error('[enqueueWorkflowRun] queue.add failed', {
      jobId,
      error: err instanceof Error ? err.message : String(err)
    });
    throw err;
  }
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
    const jobId = buildJobId('inline', Date.now());
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

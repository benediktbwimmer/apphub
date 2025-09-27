import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
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
import type { ExampleBundleJobData, ExampleBundleJobResult } from './exampleBundleWorker';
import { ingestWorkflowEvent } from './workflowEvents';
import {
  recordEventIngress,
  recordEventIngressFailure
} from './eventSchedulerMetrics';
import { registerSourceEvent } from './eventSchedulerState';

function normalize(value: string | undefined) {
  return value ? value.trim() : undefined;
}

function isInlineValue(value: string | undefined) {
  return normalize(value)?.toLowerCase() === 'inline';
}

function computeInlineMode(): boolean {
  return isInlineValue(process.env.REDIS_URL) || isInlineValue(process.env.APPHUB_EVENTS_MODE);
}

function resolveRedisUrl(): string {
  const normalized = normalize(process.env.REDIS_URL);
  if (isInlineValue(normalized)) {
    throw new Error('Redis URL requested while inline queue mode is active');
  }
  return normalized ?? 'redis://127.0.0.1:6379';
}

let inlineMode = computeInlineMode();
let connection: Redis | null = null;

let ingestQueue: Queue | null = null;
let buildQueue: Queue | null = null;
let launchQueue: Queue | null = null;
let workflowQueue: Queue | null = null;
let exampleBundleQueue: Queue | null = null;
let eventQueue: Queue<EventIngressJobData> | null = null;
let eventTriggerQueue: Queue<EventTriggerJobData> | null = null;

let ingestionHandlerLoaded = false;
async function ensureIngestionJobHandler(): Promise<void> {
  if (ingestionHandlerLoaded) {
    return;
  }
  await import('./ingestionWorker');
  ingestionHandlerLoaded = true;
}

let buildHandlerLoaded = false;
async function ensureBuildJobHandler(): Promise<void> {
  if (buildHandlerLoaded) {
    return;
  }
  await import('./buildRunner');
  buildHandlerLoaded = true;
}

let exampleBundleHandlerLoaded = false;
async function ensureExampleBundleJobHandler(): Promise<void> {
  if (exampleBundleHandlerLoaded) {
    return;
  }
  await import('./exampleBundleWorker');
  exampleBundleHandlerLoaded = true;
}

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

function createConnection(): Redis | null {
  if (inlineMode) {
    return null;
  }
  const redisUrl = resolveRedisUrl();
  const instance = new IORedis(redisUrl, {
    maxRetriesPerRequest: null
  });
  instance.on('error', (err) => {
    console.error('[queue] Redis connection error', err);
  });
  return instance;
}

function disposeQueue(instance: Queue | null): void {
  if (!instance) {
    return;
  }
  void instance.close().catch(() => {});
}

function disposeEventQueue(instance: Queue<EventIngressJobData> | null): void {
  if (!instance) {
    return;
  }
  void instance.close().catch(() => {});
}

function disposeEventTriggerQueue(instance: Queue<EventTriggerJobData> | null): void {
  if (!instance) {
    return;
  }
  void instance.close().catch(() => {});
}

function disposeConnection(instance: Redis | null): void {
  if (!instance) {
    return;
  }
  void instance.quit().catch(() => {});
}

function resetQueues(): void {
  disposeQueue(ingestQueue);
  disposeQueue(buildQueue);
  disposeQueue(launchQueue);
  disposeQueue(workflowQueue);
  disposeQueue(exampleBundleQueue);
  disposeEventQueue(eventQueue);
  disposeEventTriggerQueue(eventTriggerQueue);
  ingestQueue = null;
  buildQueue = null;
  launchQueue = null;
  workflowQueue = null;
  exampleBundleQueue = null;
  eventQueue = null;
  eventTriggerQueue = null;
}

function initializeQueues(): void {
  if (inlineMode) {
    resetQueues();
    disposeConnection(connection);
    connection = null;
    return;
  }

  if (!connection) {
    connection = createConnection();
  }
  if (!connection) {
    return;
  }

  if (!ingestQueue) {
    ingestQueue = new Queue(INGEST_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 100
      }
    });
  }

  if (!buildQueue) {
    buildQueue = new Queue(BUILD_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 50,
        attempts: 1
      }
    });
  }

  if (!launchQueue) {
    launchQueue = new Queue(LAUNCH_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 25
      }
    });
  }

  if (!workflowQueue) {
    workflowQueue = new Queue(WORKFLOW_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 50
      }
    });
  }

  if (!exampleBundleQueue) {
    exampleBundleQueue = new Queue(EXAMPLE_BUNDLE_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 25
      }
    });
  }

  if (!eventQueue) {
    eventQueue = new Queue<EventIngressJobData>(EVENT_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 100
      }
    });
  }

  if (!eventTriggerQueue) {
    eventTriggerQueue = new Queue<EventTriggerJobData>(EVENT_TRIGGER_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: Number(process.env.EVENT_TRIGGER_ATTEMPTS ?? 3),
        backoff: {
          type: 'exponential',
          delay: Number(process.env.EVENT_TRIGGER_BACKOFF_MS ?? 5_000)
        }
      }
    });
  }
}

function synchronizeQueueMode(): void {
  const desiredInline = computeInlineMode();
  if (desiredInline !== inlineMode) {
    inlineMode = desiredInline;
    resetQueues();
    disposeConnection(connection);
    connection = null;
  }

  if (inlineMode) {
    return;
  }

  if (!connection) {
    connection = createConnection();
  }

  initializeQueues();
}

synchronizeQueueMode();

export async function enqueueRepositoryIngestion(
  repositoryId: string,
  options: {
    jobRunId?: string;
    parameters?: JsonValue;
  } = {}
): Promise<JobRunRecord> {
  synchronizeQueueMode();
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
    await ensureIngestionJobHandler();
    const executed = await executeJobRun(run.id);
    return executed ?? run;
  }

  if (!ingestQueue) {
    throw new Error('Queue not initialised');
  }

  await ingestQueue.add(
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
  synchronizeQueueMode();
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

  if (!eventQueue) {
    throw new Error('Event queue not initialised');
  }

  await eventQueue.add(DEFAULT_EVENT_JOB_NAME, { envelope });
  return envelope;
}

export async function enqueueEventTriggerEvaluation(envelope: EventEnvelope): Promise<void> {
  synchronizeQueueMode();
  if (inlineMode) {
    const { processEventTriggersForEnvelope } = await import('./eventTriggerProcessor');
    await processEventTriggersForEnvelope(envelope);
    return;
  }

  if (!eventTriggerQueue) {
    throw new Error('Event trigger queue not initialised');
  }

  await eventTriggerQueue.add(EVENT_TRIGGER_JOB_NAME, { envelope });
}

async function getQueueCounts(target: Queue | null): Promise<Record<string, number>> {
  if (!target) {
    return {};
  }
  try {
    return await target.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
  } catch (err) {
    console.error('[event-scheduler] Failed to collect queue counts', err);
    return {};
  }
}

export async function getEventQueueStats(): Promise<{
  mode: 'inline' | 'queue' | 'disabled';
  counts?: Record<string, number>;
}> {
  synchronizeQueueMode();
  if (inlineMode) {
    return { mode: 'inline' };
  }
  if (!eventQueue) {
    return { mode: 'disabled' };
  }
  return {
    mode: 'queue',
    counts: await getQueueCounts(eventQueue)
  };
}

export async function getEventTriggerQueueStats(): Promise<{
  mode: 'inline' | 'queue' | 'disabled';
  counts?: Record<string, number>;
}> {
  synchronizeQueueMode();
  if (inlineMode) {
    return { mode: 'inline' };
  }
  if (!eventTriggerQueue) {
    return { mode: 'disabled' };
  }
  return {
    mode: 'queue',
    counts: await getQueueCounts(eventTriggerQueue)
  };
}

export function getQueueConnection() {
  synchronizeQueueMode();
  if (inlineMode || !connection) {
    throw new Error('Redis connection not initialised');
  }
  return connection;
}

export function isInlineQueueMode() {
  synchronizeQueueMode();
  return inlineMode;
}

function connectionIsClosed(instance: Redis) {
  return instance.status === 'end' || instance.status === 'close';
}

export async function closeQueueConnection(instance?: Redis | null) {
  const target = instance ?? connection;

  if (!target) {
    return;
  }

  if (connectionIsClosed(target)) {
    return;
  }

  try {
    await target.quit();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Connection is closed')) {
      return;
    }
    throw err;
  }

  if (!instance || target === connection) {
    resetQueues();
    if (target === connection) {
      connection = null;
    }
  }
}

export async function enqueueBuildJob(
  buildId: string,
  repositoryId: string,
  options: { jobRunId?: string } = {}
): Promise<JobRunRecord> {
  synchronizeQueueMode();
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
    await ensureBuildJobHandler();
    const executed = await executeJobRun(run.id);
    return executed ?? run;
  }

  if (!buildQueue) {
    throw new Error('Build queue not initialised');
  }

  await buildQueue.add('repository-build', {
    buildId: trimmedBuildId,
    repositoryId: trimmedRepositoryId,
    jobRunId: run.id
  });

  return run;
}

export async function enqueueLaunchStart(launchId: string) {
  synchronizeQueueMode();
  if (inlineMode) {
    return;
  }

  if (!launchQueue) {
    throw new Error('Launch queue not initialised');
  }

  await launchQueue.add('launch-start', { launchId, type: 'start' });
}

export async function enqueueLaunchStop(launchId: string) {
  synchronizeQueueMode();
  if (inlineMode) {
    return;
  }

  if (!launchQueue) {
    throw new Error('Launch queue not initialised');
  }

  await launchQueue.add('launch-stop', { launchId, type: 'stop' });
}

export async function enqueueWorkflowRun(workflowRunId: string): Promise<void> {
  synchronizeQueueMode();
  const trimmedId = workflowRunId.trim();
  if (!trimmedId) {
    throw new Error('workflowRunId is required');
  }

  if (inlineMode) {
    await runWorkflowOrchestration(trimmedId);
    return;
  }

  if (!workflowQueue) {
    throw new Error('Workflow queue not initialised');
  }

  await workflowQueue.add('workflow-run', { workflowRunId: trimmedId });
}

export type EnqueueExampleBundleResult = {
  jobId: string;
  slug: string;
  mode: 'inline' | 'queued';
  result?: ExampleBundleJobResult;
};

export async function enqueueExampleBundleJob(
  slug: string,
  options: { force?: boolean; skipBuild?: boolean; minify?: boolean } = {}
): Promise<EnqueueExampleBundleResult> {
  synchronizeQueueMode();
  const trimmedSlug = slug.trim().toLowerCase();
  if (!trimmedSlug) {
    throw new Error('slug is required');
  }

  const payload: ExampleBundleJobData = {
    slug: trimmedSlug,
    force: options.force,
    skipBuild: options.skipBuild,
    minify: options.minify
  };

  if (inlineMode) {
    await ensureExampleBundleJobHandler();
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

  if (!exampleBundleQueue) {
    throw new Error('Example bundle queue not initialised');
  }

  const job = await exampleBundleQueue.add(trimmedSlug, payload, {
    jobId: trimmedSlug
  });

  return {
    jobId: String(job.id),
    slug: trimmedSlug,
    mode: 'queued'
  } satisfies EnqueueExampleBundleResult;
}

import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { createJobRunForSlug, executeJobRun } from './jobs/runtime';
import { getJobRunById } from './db/jobs';
import { type JobRunRecord, type JsonValue } from './db/types';
import { runWorkflowOrchestration } from './workflowOrchestrator';
import type { ExampleBundleJobData, ExampleBundleJobResult } from './exampleBundleWorker';

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const inlineMode = redisUrl === 'inline';

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

function createConnection() {
  if (inlineMode) {
    return null;
  }
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null
  });
  connection.on('error', (err) => {
    console.error('[queue] Redis connection error', err);
  });
  return connection;
}

const connection = createConnection();

export const INGEST_QUEUE_NAME = process.env.INGEST_QUEUE_NAME ?? 'apphub_queue';
export const BUILD_QUEUE_NAME = process.env.BUILD_QUEUE_NAME ?? 'apphub_build_queue';
export const LAUNCH_QUEUE_NAME = process.env.LAUNCH_QUEUE_NAME ?? 'apphub_launch_queue';
export const WORKFLOW_QUEUE_NAME = process.env.WORKFLOW_QUEUE_NAME ?? 'apphub_workflow_queue';
export const ASSET_EVENT_QUEUE_NAME = process.env.ASSET_EVENT_QUEUE_NAME ?? 'apphub_asset_event_queue';
export const EXAMPLE_BUNDLE_QUEUE_NAME = process.env.EXAMPLE_BUNDLE_QUEUE_NAME ?? 'apphub_example_bundle_queue';

const queue = !inlineMode && connection
  ? new Queue(INGEST_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 100
      }
    })
  : null;

const buildQueue = !inlineMode && connection
  ? new Queue(BUILD_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 50,
        attempts: 1
      }
    })
  : null;

const launchQueue = !inlineMode && connection
  ? new Queue(LAUNCH_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 25
      }
    })
  : null;

const workflowQueue = !inlineMode && connection
  ? new Queue(WORKFLOW_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 50
      }
    })
  : null;

const exampleBundleQueue = !inlineMode && connection
  ? new Queue(EXAMPLE_BUNDLE_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 25
      }
    })
  : null;

export async function enqueueRepositoryIngestion(
  repositoryId: string,
  options: {
    jobRunId?: string;
    parameters?: JsonValue;
  } = {}
): Promise<JobRunRecord> {
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

  if (!queue) {
    throw new Error('Queue not initialised');
  }

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

export function getQueueConnection() {
  if (inlineMode || !connection) {
    throw new Error('Redis connection not initialised');
  }
  return connection;
}

export function isInlineQueueMode() {
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
}

export async function enqueueBuildJob(
  buildId: string,
  repositoryId: string,
  options: { jobRunId?: string } = {}
): Promise<JobRunRecord> {
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
  if (inlineMode) {
    return;
  }

  if (!launchQueue) {
    throw new Error('Launch queue not initialised');
  }

  await launchQueue.add('launch-start', { launchId, type: 'start' });
}

export async function enqueueLaunchStop(launchId: string) {
  if (inlineMode) {
    return;
  }

  if (!launchQueue) {
    throw new Error('Launch queue not initialised');
  }

  await launchQueue.add('launch-stop', { launchId, type: 'stop' });
}

export async function enqueueWorkflowRun(workflowRunId: string): Promise<void> {
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
    throw new Error('Queue not initialised');
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

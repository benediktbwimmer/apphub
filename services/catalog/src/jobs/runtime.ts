import {
  completeJobRun,
  createJobRun,
  getJobDefinitionById,
  getJobDefinitionBySlug,
  getJobRunById,
  startJobRun,
  updateJobRun
} from '../db/jobs';
import {
  type JobDefinitionRecord,
  type JobRunCompletionInput,
  type JobRunCreateInput,
  type JobRunRecord,
  type JobRunStatus,
  type JsonValue,
  type SecretReference
} from '../db/types';
import { resolveSecret } from '../secrets';
import { logger } from '../observability/logger';
import { normalizeMeta } from '../observability/meta';

const handlers = new Map<string, JobHandler>();

export type JobRunContext = {
  definition: JobDefinitionRecord;
  run: JobRunRecord;
  parameters: JsonValue;
  update(updates: {
    parameters?: JsonValue;
    logsUrl?: string | null;
    metrics?: JsonValue | null;
    context?: JsonValue | null;
    timeoutMs?: number | null;
  }): Promise<JobRunRecord>;
  logger: (message: string, meta?: Record<string, unknown>) => void;
  resolveSecret(reference: SecretReference): string | null;
};

export type JobResult = {
  status?: Extract<JobRunStatus, 'succeeded' | 'failed' | 'canceled' | 'expired'>;
  result?: JsonValue | null;
  errorMessage?: string | null;
  logsUrl?: string | null;
  metrics?: JsonValue | null;
  context?: JsonValue | null;
};

export type JobHandler = (context: JobRunContext) => Promise<JobResult | void> | JobResult | void;

function log(slug: string, message: string, meta?: Record<string, unknown>) {
  const payload = normalizeMeta({ jobSlug: slug, ...(meta ?? {}) }) ?? { jobSlug: slug };
  logger.info(message, payload);
}

export function registerJobHandler(slug: string, handler: JobHandler): void {
  handlers.set(slug, handler);
}

export function getJobHandler(slug: string): JobHandler | undefined {
  return handlers.get(slug);
}

export async function ensureJobDefinitionExists(slug: string): Promise<JobDefinitionRecord> {
  const definition = await getJobDefinitionBySlug(slug);
  if (!definition) {
    throw new Error(`Job definition not found for slug ${slug}`);
  }
  return definition;
}

export async function createJobRunForSlug(
  slug: string,
  input: JobRunCreateInput = {}
): Promise<JobRunRecord> {
  const definition = await ensureJobDefinitionExists(slug);
  return createJobRun(definition.id, input);
}

export async function executeJobRun(runId: string): Promise<JobRunRecord | null> {
  let currentRun = await getJobRunById(runId);
  if (!currentRun) {
    return null;
  }
  let latestRun = currentRun;

  const definition = await getJobDefinitionById(currentRun.jobDefinitionId);
  if (!definition) {
    await completeJobRun(runId, 'failed', {
      errorMessage: 'Job definition missing for run'
    });
    return getJobRunById(runId);
  }

  const handler = handlers.get(definition.slug);
  if (!handler) {
    await completeJobRun(runId, 'failed', {
      errorMessage: `No handler registered for job ${definition.slug}`
    });
    return getJobRunById(runId);
  }

  if (currentRun.status === 'pending') {
    const started = await startJobRun(runId, { startedAt: new Date().toISOString() });
    if (started) {
      currentRun = started;
      latestRun = started;
    }
  }

  if (currentRun.status !== 'running') {
    return currentRun;
  }

  const context: JobRunContext = {
    definition,
    run: latestRun,
    parameters: latestRun.parameters,
    async update(updates) {
      const updated = await updateJobRun(runId, updates);
      if (updated) {
        currentRun = updated;
        latestRun = updated;
      }
      context.run = latestRun;
      context.parameters = latestRun.parameters;
      return latestRun;
    },
    logger(message, meta) {
      log(definition.slug, message, meta);
    },
    resolveSecret(reference) {
      const result = resolveSecret(reference, {
        actor: `job-run:${runId}`,
        actorType: 'job',
        metadata: {
          jobSlug: definition.slug,
          jobRunId: runId
        }
      });
      return result.value;
    }
  };

  try {
    const result = (await handler(context)) ?? {};
    const status = result.status ?? 'succeeded';
    const completion: JobRunCompletionInput = {
      result: result.result ?? null,
      errorMessage: result.errorMessage ?? null,
      logsUrl: result.logsUrl ?? null,
      metrics: result.metrics ?? null,
      context: result.context ?? null
    };
    const completed = await completeJobRun(runId, status, completion);
    return completed ?? currentRun;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Job execution failed';
    context.logger('Job handler threw error', {
      error: errorMessage
    });
    const errorContext: Record<string, JsonValue> = {
      error: errorMessage
    };
    if (err instanceof Error && err.stack) {
      errorContext.stack = err.stack;
    }
    const completed = await completeJobRun(runId, 'failed', {
      errorMessage,
      context: errorContext
    });
    return completed ?? currentRun;
  }
}

import { Worker } from 'bullmq';
import {
  DEFAULT_EVENT_JOB_NAME,
  validateEventEnvelope,
  type EventEnvelope,
  type EventIngressJobData
} from '@apphub/event-bus';
import {
  EVENT_QUEUE_NAME,
  EVENT_RETRY_JOB_NAME,
  closeQueueConnection,
  enqueueEventTriggerEvaluation,
  getQueueConnection,
  isInlineQueueMode,
  scheduleEventRetryJob
} from './queue';
import {
  deleteEventIngressRetry,
  getEventIngressRetryById,
  listScheduledEventIngressRetries,
  updateEventIngressRetry,
  upsertEventIngressRetry
} from './db/eventIngressRetries';
import { getWorkflowEventById, ingestWorkflowEvent } from './workflowEvents';
import { logger } from './observability/logger';
import { normalizeMeta } from './observability/meta';
import { recordEventIngress, recordEventIngressFailure } from './eventSchedulerMetrics';
import { registerSourceEvent } from './eventSchedulerState';
import { computeNextAttemptTimestamp } from '@apphub/shared/retries/backoff';
import { resolveRetryBackoffConfig } from '@apphub/shared/retries/config';
import type { EventIngressRetryRecord, WorkflowEventRecord, JsonValue } from './db/types';

const EVENT_WORKER_CONCURRENCY = Number(process.env.EVENT_INGRESS_CONCURRENCY ?? 5);
const inlineMode = isInlineQueueMode();

const EVENT_RETRY_BACKOFF = resolveRetryBackoffConfig(
  {
    baseMs: 5_000,
    factor: 2,
    maxMs: 10 * 60_000,
    jitterRatio: 0.2
  },
  { prefix: 'EVENT_RETRY' }
);

function toEventEnvelope(record: WorkflowEventRecord): EventEnvelope {
  const metadataValue =
    record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, JsonValue>)
      : undefined;

  return {
    id: record.id,
    type: record.type,
    source: record.source ?? 'unknown',
    occurredAt: record.occurredAt,
    payload: record.payload ?? {},
    correlationId: record.correlationId ?? undefined,
    ttl: record.ttlMs ?? undefined,
    metadata: metadataValue,
    schemaVersion: record.schemaVersion ?? undefined,
    schemaHash: record.schemaHash ?? undefined
  } satisfies EventEnvelope;
}

function computeNextRunTimestamp(
  attempts: number,
  resumeAt?: string | null,
  now: Date = new Date()
): string {
  const backoffAt = computeNextAttemptTimestamp(attempts, EVENT_RETRY_BACKOFF, now);
  if (!resumeAt) {
    return backoffAt;
  }
  const resumeTs = Date.parse(resumeAt);
  const backoffTs = Date.parse(backoffAt);
  if (Number.isNaN(resumeTs)) {
    return backoffAt;
  }
  if (Number.isNaN(backoffTs)) {
    return new Date(Math.max(resumeTs, now.getTime())).toISOString();
  }
  const scheduled = Math.max(resumeTs, backoffTs);
  return new Date(scheduled).toISOString();
}

async function scheduleSourceRetry(
  envelope: EventEnvelope,
  evaluation: { reason?: string; until?: string | null },
  existingState?: EventIngressRetryRecord | null
): Promise<void> {
  const current = existingState ?? (await getEventIngressRetryById(envelope.id));
  if (current && current.retryState === 'cancelled') {
    logger.info(
      'Source retry cancelled; skipping reschedule',
      normalizeMeta({ eventId: envelope.id, source: envelope.source ?? 'unknown' })
    );
    return;
  }

  const attempts = (current?.attempts ?? 0) + 1;
  const nextAttemptAt = computeNextRunTimestamp(attempts, evaluation.until ?? null);

  const metadata = {
    reason: evaluation.reason ?? 'paused',
    resumeAt: evaluation.until ?? null
  } satisfies Record<string, JsonValue>;

  await upsertEventIngressRetry({
    eventId: envelope.id,
    source: envelope.source ?? 'unknown',
    retryState: 'scheduled',
    attempts,
    nextAttemptAt,
    lastError: evaluation.reason ?? null,
    metadata
  });

  try {
    await scheduleEventRetryJob(envelope.id, nextAttemptAt, attempts);
  } catch (err) {
    logger.error(
      'Failed to enqueue source retry job',
      normalizeMeta({
        eventId: envelope.id,
        source: envelope.source ?? 'unknown',
        attempts,
        nextAttemptAt,
        error: err instanceof Error ? err.message : String(err)
      })
    );
    throw err;
  }

  logger.info(
    'Scheduled source event retry',
    normalizeMeta({
      eventId: envelope.id,
      source: envelope.source ?? 'unknown',
      attempts,
      nextAttemptAt,
      reason: evaluation.reason ?? 'paused'
    })
  );
}

async function processEventEnvelope(envelope: EventEnvelope): Promise<void> {
  try {
    await ingestWorkflowEvent(envelope);
  } catch (err) {
    await recordEventIngressFailure(envelope.source ?? 'unknown');
    throw err;
  }

  const evaluation = await registerSourceEvent(envelope.source ?? 'unknown');
  await recordEventIngress(envelope, {
    throttled: evaluation.allowed === false,
    dropped: false
  });

  if (!evaluation.allowed) {
    await scheduleSourceRetry(envelope, evaluation);
    return;
  }

  await deleteEventIngressRetry(envelope.id);

  try {
    await enqueueEventTriggerEvaluation(envelope);
  } catch (err) {
    await recordEventIngressFailure(envelope.source ?? 'unknown');
    throw err;
  }
}

async function processSourceRetry(eventId: string): Promise<void> {
  const state = await getEventIngressRetryById(eventId);
  if (state && state.retryState === 'cancelled') {
    logger.info('Skipping cancelled source retry', normalizeMeta({ eventId }));
    return;
  }

  const eventRecord = await getWorkflowEventById(eventId);
  if (!eventRecord) {
    logger.warn('Event record missing for retry; cleaning up state', normalizeMeta({ eventId }));
    await deleteEventIngressRetry(eventId);
    return;
  }

  if (state) {
    await updateEventIngressRetry(eventId, { retryState: 'pending' });
  }

  const envelope = toEventEnvelope(eventRecord);
  const evaluation = await registerSourceEvent(envelope.source ?? 'unknown');
  await recordEventIngress(envelope, {
    throttled: evaluation.allowed === false,
    dropped: false
  });

  if (!evaluation.allowed) {
    await scheduleSourceRetry(envelope, evaluation, state ?? null);
    return;
  }

  await deleteEventIngressRetry(eventId);

  try {
    await enqueueEventTriggerEvaluation(envelope);
  } catch (err) {
    await recordEventIngressFailure(envelope.source ?? 'unknown');
    throw err;
  }
}

async function reconcileScheduledEventRetries(): Promise<void> {
  const scheduled = await listScheduledEventIngressRetries();
  if (scheduled.length === 0) {
    return;
  }

  for (const entry of scheduled) {
    try {
      await scheduleEventRetryJob(entry.eventId, entry.nextAttemptAt, entry.attempts);
    } catch (err) {
      logger.error(
        'Failed to requeue scheduled source retry',
        normalizeMeta({
          eventId: entry.eventId,
          attempts: entry.attempts,
          nextAttemptAt: entry.nextAttemptAt,
          error: err instanceof Error ? err.message : String(err)
        })
      );
    }
  }

  logger.info('Reconciled scheduled source retries', normalizeMeta({ count: scheduled.length }));
}

async function runInlineMode(): Promise<void> {
  logger.info('Event ingress worker running in inline mode; events process synchronously via queue helpers');
}

async function runQueuedWorker(): Promise<void> {
  const connection = getQueueConnection();
  const worker = new Worker<EventIngressJobData>(
    EVENT_QUEUE_NAME,
    async (job) => {
      if (job.name === EVENT_RETRY_JOB_NAME) {
        const eventId = job.data.eventId;
        if (!eventId) {
          logger.warn('Received event retry job without eventId', normalizeMeta({ jobId: job.id }));
          return;
        }
        await processSourceRetry(eventId);
        return;
      }

      const payload = job.data.envelope;
      if (!payload) {
        logger.warn('Event ingress job missing envelope payload', normalizeMeta({ jobId: job.id }));
        return;
      }

      const validated = validateEventEnvelope(payload);
      await processEventEnvelope(validated);
    },
    {
      connection,
      concurrency: EVENT_WORKER_CONCURRENCY
    }
  );

  worker.on('failed', (job, err) => {
    logger.error(
      'Workflow event ingestion failed',
      normalizeMeta({ jobId: job?.id ?? null, error: err?.message ?? 'unknown error' })
    );
  });

  worker.on('completed', (job) => {
    logger.info('Workflow event processed', normalizeMeta({ jobId: job.id }));
  });

  await worker.waitUntilReady();
  await reconcileScheduledEventRetries();
  logger.info(
    'Event ingress worker ready',
    normalizeMeta({ queue: EVENT_QUEUE_NAME, concurrency: EVENT_WORKER_CONCURRENCY })
  );

  const shutdown = async () => {
    logger.info('Event ingress worker shutting down');
    await worker.close();
    try {
      await closeQueueConnection(connection);
    } catch (err) {
      logger.error('Failed to close Redis connection for event worker', normalizeMeta({ error: (err as Error).message }));
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main(): Promise<void> {
  if (inlineMode) {
    await runInlineMode();
    return;
  }
  await runQueuedWorker();
}

if (require.main === module) {
  main().catch((err) => {
    logger.error('Event ingress worker crashed', normalizeMeta({ error: err?.message ?? 'unknown error' }));
    process.exit(1);
  });
}

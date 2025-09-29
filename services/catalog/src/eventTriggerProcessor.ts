import { JSONPath } from 'jsonpath-plus';
import type { EventEnvelope } from '@apphub/event-bus';
import { Liquid } from 'liquidjs';
import {
  countActiveWorkflowTriggerDeliveries,
  countRecentWorkflowTriggerDeliveries,
  createWorkflowRun,
  createWorkflowTriggerDelivery,
  findWorkflowTriggerDeliveryByDedupeKey,
  getActiveWorkflowRunByKey,
  getWorkflowEventTriggerById,
  getWorkflowTriggerDeliveryById,
  isRunKeyConflict,
  listScheduledWorkflowTriggerDeliveries,
  listWorkflowEventTriggersForEvent,
  updateWorkflowTriggerDelivery
} from './db/workflows';
import type {
  JsonValue,
  WorkflowEventTriggerPredicate,
  WorkflowEventTriggerRecord,
  WorkflowEventRecord,
  WorkflowTriggerDeliveryRecord
} from './db/types';
import { enqueueWorkflowRun, scheduleEventTriggerRetryJob } from './queue';
import { logger } from './observability/logger';
import { normalizeMeta } from './observability/meta';
import { recordTriggerEvaluation } from './eventSchedulerMetrics';
import { isTriggerPaused, registerTriggerFailure, registerTriggerSuccess } from './eventSchedulerState';
import { computeNextAttemptTimestamp } from '@apphub/shared/retries/backoff';
import { getWorkflowEventById } from './workflowEvents';
import { buildRunKeyFromParts, computeRunKeyColumns } from './workflows/runKey';

const liquid = new Liquid({ cache: false, strictFilters: false, strictVariables: false });

const TRIGGER_RETRY_BACKOFF = {
  baseMs: normalizePositiveNumber(process.env.EVENT_TRIGGER_RETRY_BASE_MS, 10_000),
  factor: normalizePositiveNumber(process.env.EVENT_TRIGGER_RETRY_FACTOR, 2),
  maxMs: normalizePositiveNumber(process.env.EVENT_TRIGGER_RETRY_MAX_MS, 15 * 60_000),
  jitterRatio: normalizeRatio(process.env.EVENT_TRIGGER_RETRY_JITTER_RATIO, 0.2)
} as const;

function normalizePositiveNumber(value: string | undefined, fallback: number, minimum = 1): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed >= minimum ? parsed : fallback;
}

function normalizeRatio(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, 0), 1);
}

function computeNextTriggerAttemptTimestamp(
  attempts: number,
  throttledUntil: string | null | undefined,
  now: Date = new Date()
): string {
  const backoffAt = computeNextAttemptTimestamp(attempts, TRIGGER_RETRY_BACKOFF, now);
  if (!throttledUntil) {
    return backoffAt;
  }
  const throttleTs = Date.parse(throttledUntil);
  const backoffTs = Date.parse(backoffAt);
  if (Number.isNaN(throttleTs)) {
    return backoffAt;
  }
  if (Number.isNaN(backoffTs)) {
    return new Date(Math.max(throttleTs, now.getTime())).toISOString();
  }
  return new Date(Math.max(throttleTs, backoffTs)).toISOString();
}

function workflowEventRecordToEnvelope(record: WorkflowEventRecord): EventEnvelope {
  const metadata =
    record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, JsonValue>)
      : undefined;

  return {
    id: record.id,
    type: record.type,
    source: record.source,
    occurredAt: record.occurredAt,
    payload: (record.payload as JsonValue) ?? {},
    correlationId: record.correlationId ?? undefined,
    ttl: record.ttlMs ?? undefined,
    metadata
  } satisfies EventEnvelope;
}

function evaluatePredicate(predicate: WorkflowEventTriggerPredicate, event: EventEnvelope): boolean {
  const results = JSONPath({ path: predicate.path, json: event, wrap: true }) as JsonValue[];

  switch (predicate.operator) {
    case 'exists':
      return results.length > 0;
    case 'equals':
    case 'notEquals': {
      if (results.length === 0) {
        return predicate.operator === 'notEquals';
      }
      return results.some((value) =>
        compareJsonValues(value, predicate.value, predicate.caseSensitive ?? false)
      ) === (predicate.operator === 'equals');
    }
    case 'in':
    case 'notIn': {
      if (results.length === 0) {
        return predicate.operator === 'notIn';
      }
      const list = predicate.values ?? [];
      const isMatch = results.some((value) =>
        list.some((entry) => compareJsonValues(value, entry, predicate.caseSensitive ?? false))
      );
      return predicate.operator === 'in' ? isMatch : !isMatch;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (results.length === 0) {
        return false;
      }
      return results.some((value) =>
        matchesNumericComparison(value, predicate.value, predicate.operator)
      );
    }
    case 'contains': {
      if (results.length === 0) {
        return false;
      }
      return results.some((value) =>
        matchesContains(value, predicate.value, predicate.caseSensitive ?? false)
      );
    }
    case 'regex': {
      if (results.length === 0) {
        return false;
      }
      const regex = buildPredicateRegex(predicate);
      if (!regex) {
        logger.warn(
          'Failed to compile regex predicate',
          normalizeMeta({
            predicate
          })
        );
        return false;
      }
      return results.some((value) => typeof value === 'string' && regex.test(value));
    }
    default:
      return false;
  }
}

function compareJsonValues(left: JsonValue, right: JsonValue, caseSensitive: boolean): boolean {
  if (!caseSensitive && typeof left === 'string' && typeof right === 'string') {
    return left.toLowerCase() === right.toLowerCase();
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function matchesNumericComparison(
  value: JsonValue,
  expected: number,
  operator: 'gt' | 'gte' | 'lt' | 'lte'
): boolean {
  const candidates = extractNumericValues(value);
  if (candidates.length === 0) {
    return false;
  }
  switch (operator) {
    case 'gt':
      return candidates.some((candidate) => candidate > expected);
    case 'gte':
      return candidates.some((candidate) => candidate >= expected);
    case 'lt':
      return candidates.some((candidate) => candidate < expected);
    case 'lte':
      return candidates.some((candidate) => candidate <= expected);
    default:
      return false;
  }
}

function extractNumericValues(value: JsonValue): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return [value];
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return [];
    }
    const parsed = Number(trimmed);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return [parsed];
    }
    return [];
  }
  if (Array.isArray(value)) {
    const results: number[] = [];
    for (const entry of value) {
      results.push(...extractNumericValues(entry as JsonValue));
    }
    return results;
  }
  return [];
}

function matchesContains(
  value: JsonValue,
  expected: JsonValue,
  caseSensitive: boolean
): boolean {
  if (typeof value === 'string' && typeof expected === 'string') {
    const haystack = caseSensitive ? value : value.toLowerCase();
    const needle = caseSensitive ? expected : expected.toLowerCase();
    if (needle.length === 0) {
      return true;
    }
    return haystack.includes(needle);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = entry as JsonValue;
      if (matchesContains(candidate, expected, caseSensitive)) {
        return true;
      }
      if (compareJsonValues(candidate, expected, caseSensitive)) {
        return true;
      }
    }
    return false;
  }

  return false;
}

function buildPredicateRegex(
  predicate: Extract<WorkflowEventTriggerPredicate, { operator: 'regex' }>
): RegExp | null {
  const flagsSet = new Set<string>();
  if (predicate.flags) {
    for (const flag of predicate.flags) {
      flagsSet.add(flag);
    }
  }
  if (predicate.caseSensitive === false) {
    flagsSet.add('i');
  }
  if (predicate.caseSensitive === true) {
    flagsSet.delete('i');
  }
  const flags = Array.from(flagsSet).sort().join('');
  try {
    return new RegExp(predicate.value, flags);
  } catch (error) {
    logger.warn(
      'Invalid regex predicate',
      normalizeMeta({
        err: error instanceof Error ? error.message : String(error),
        predicate
      })
    );
    return null;
  }
}

async function renderStringTemplate(template: string, context: Record<string, unknown>): Promise<string> {
  if (!template.includes('{{') && !template.includes('{%')) {
    return template;
  }
  return liquid.parseAndRender(template, context);
}

async function renderJsonTemplate(
  value: JsonValue | null,
  context: Record<string, unknown>
): Promise<JsonValue | null> {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    const rendered = await renderStringTemplate(value, context);
    return rendered;
  }
  if (Array.isArray(value)) {
    const results: JsonValue[] = [];
    for (const entry of value) {
      results.push((await renderJsonTemplate(entry, context)) as JsonValue);
    }
    return results;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    const output: Record<string, JsonValue> = {};
    for (const [key, entry] of entries) {
      output[key] = (await renderJsonTemplate(entry as JsonValue, context)) as JsonValue;
    }
    return output;
  }
  return value;
}

function buildTriggerContext(trigger: WorkflowEventTriggerRecord, event: EventEnvelope) {
  return {
    event,
    trigger,
    now: new Date().toISOString()
  } satisfies Record<string, unknown>;
}

function normalizeDedupeKey(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const sanitized = trimmed.replace(/:+/g, '-');
  return sanitized.length > 0 ? sanitized : null;
}

async function handleThrottle(
  trigger: WorkflowEventTriggerRecord,
  windowMs: number,
  maxCount: number,
  excludeDeliveryId?: string | null
): Promise<{ throttled: boolean; until: string | null }> {
  const now = new Date();
  const since = new Date(now.getTime() - windowMs).toISOString();
  const count = await countRecentWorkflowTriggerDeliveries(
    trigger.id,
    since,
    excludeDeliveryId ?? undefined
  );
  if (count >= maxCount) {
    return { throttled: true, until: new Date(now.getTime() + windowMs).toISOString() };
  }
  return { throttled: false, until: null };
}

async function handleConcurrency(
  trigger: WorkflowEventTriggerRecord,
  maxConcurrency: number
): Promise<boolean> {
  const active = await countActiveWorkflowTriggerDeliveries(trigger.id);
  return active >= maxConcurrency;
}

async function createDeliveryRecord(
  trigger: WorkflowEventTriggerRecord,
  event: EventEnvelope,
  status: 'pending' | 'matched' | 'throttled' | 'skipped',
  options: {
    dedupeKey?: string | null;
    throttledUntil?: string | null;
    lastError?: string | null;
    workflowRunId?: string | null;
  } = {}
) {
  return createWorkflowTriggerDelivery({
    triggerId: trigger.id,
    workflowDefinitionId: trigger.workflowDefinitionId,
    eventId: event.id,
    status,
    dedupeKey: options.dedupeKey ?? null,
    throttledUntil: options.throttledUntil ?? null,
    lastError: options.lastError ?? null,
    workflowRunId: options.workflowRunId ?? null
  });
}

async function scheduleTriggerRetry(
  trigger: WorkflowEventTriggerRecord,
  delivery: WorkflowTriggerDeliveryRecord,
  reason: string,
  throttledUntil?: string | null
): Promise<void> {
  const attempts = (delivery.retryAttempts ?? 0) + 1;
  const nextAttemptAt = computeNextTriggerAttemptTimestamp(
    attempts,
    throttledUntil ?? delivery.throttledUntil ?? null
  );

  const metadata: Record<string, JsonValue> = {
    reason,
    throttledUntil: throttledUntil ?? delivery.throttledUntil ?? null
  };

  const updated = await updateWorkflowTriggerDelivery(delivery.id, {
    retryState: 'scheduled',
    retryAttempts: attempts,
    nextAttemptAt,
    throttledUntil: throttledUntil ?? delivery.throttledUntil ?? null,
    retryMetadata: metadata
  });

  const effective = updated ?? {
    ...delivery,
    retryAttempts: attempts,
    nextAttemptAt,
    throttledUntil: throttledUntil ?? delivery.throttledUntil ?? null,
    retryState: 'scheduled',
    retryMetadata: metadata as JsonValue
  } satisfies WorkflowTriggerDeliveryRecord;

  await scheduleEventTriggerRetryJob(effective.id, effective.eventId, nextAttemptAt, effective.retryAttempts);

  logger.info(
    'Scheduled trigger delivery retry',
    normalizeMeta({
      triggerId: trigger.id,
      workflowDefinitionId: trigger.workflowDefinitionId,
      deliveryId: delivery.id,
      attempts: effective.retryAttempts,
      nextAttemptAt,
      throttledUntil: metadata.throttledUntil,
      reason
    })
  );
}

async function processTrigger(
  trigger: WorkflowEventTriggerRecord,
  event: EventEnvelope,
  options: { existingDelivery?: WorkflowTriggerDeliveryRecord } = {}
): Promise<void> {
  let currentDelivery = options.existingDelivery ?? null;

  if (currentDelivery) {
    const cleared = await updateWorkflowTriggerDelivery(currentDelivery.id, {
      retryState: 'pending',
      nextAttemptAt: null,
      retryMetadata: null
    });
    currentDelivery = cleared ?? {
      ...currentDelivery,
      retryState: 'pending',
      nextAttemptAt: null,
      retryMetadata: null
    };
  }

  const context = buildTriggerContext(trigger, event);
  const pauseState = await isTriggerPaused(trigger.id);
  if (pauseState.paused) {
    if (currentDelivery) {
      await updateWorkflowTriggerDelivery(currentDelivery.id, {
        status: 'skipped',
        lastError: `Trigger paused until ${pauseState.until ?? 'unspecified'}`,
        retryState: 'cancelled',
        retryMetadata: {
          reason: 'trigger_paused',
          resumeAt: pauseState.until ?? null
        }
      });
    } else {
      await createDeliveryRecord(trigger, event, 'skipped', {
        dedupeKey: null,
        lastError: `Trigger paused until ${pauseState.until ?? 'unspecified'}`
      });
    }
    await recordTriggerEvaluation(trigger, 'paused');
    return;
  }

  const predicatesMatch = trigger.predicates.every((predicate) =>
    evaluatePredicate(predicate, event)
  );
  if (!predicatesMatch) {
    await recordTriggerEvaluation(trigger, 'filtered');
    return;
  }

  let dedupeKey: string | null = currentDelivery?.dedupeKey ?? null;
  if (!currentDelivery && trigger.idempotencyKeyExpression) {
    const rendered = await renderStringTemplate(trigger.idempotencyKeyExpression, context);
    dedupeKey = normalizeDedupeKey(rendered);
  }

  if (!currentDelivery && dedupeKey) {
    const existing = await findWorkflowTriggerDeliveryByDedupeKey(trigger.id, dedupeKey);
    if (existing && ['pending', 'matched', 'launched', 'throttled'].includes(existing.status)) {
      await createDeliveryRecord(trigger, event, 'skipped', {
        dedupeKey,
        workflowRunId: existing.workflowRunId ?? null,
        lastError: 'Duplicate event (idempotency key)'
      });
      await recordTriggerEvaluation(trigger, 'skipped');
      await registerTriggerSuccess(trigger.id);
      return;
    }
  }

  const excludeDeliveryId = currentDelivery?.id ?? null;

  if (trigger.throttleWindowMs && trigger.throttleCount) {
    const { throttled, until } = await handleThrottle(
      trigger,
      trigger.throttleWindowMs,
      trigger.throttleCount,
      excludeDeliveryId
    );
    if (throttled) {
      let deliveryRecord = currentDelivery;
      if (!deliveryRecord) {
        deliveryRecord = await createDeliveryRecord(trigger, event, 'throttled', {
          dedupeKey,
          throttledUntil: until,
          lastError: 'Throttle window exceeded'
        });
      } else {
        const updated = await updateWorkflowTriggerDelivery(deliveryRecord.id, {
          status: 'throttled',
          throttledUntil: until ?? null,
          lastError: 'Throttle window exceeded'
        });
        deliveryRecord = updated ?? {
          ...deliveryRecord,
          status: 'throttled',
          throttledUntil: until ?? null,
          lastError: 'Throttle window exceeded'
        };
      }

      await scheduleTriggerRetry(trigger, deliveryRecord, 'throttle_window', until ?? null);
      await recordTriggerEvaluation(trigger, 'throttled');
      return;
    }
  }

  if (trigger.maxConcurrency && (await handleConcurrency(trigger, trigger.maxConcurrency))) {
    let deliveryRecord = currentDelivery;
    if (!deliveryRecord) {
      deliveryRecord = await createDeliveryRecord(trigger, event, 'throttled', {
        dedupeKey,
        lastError: 'Max concurrency reached'
      });
    } else {
      const updated = await updateWorkflowTriggerDelivery(deliveryRecord.id, {
        status: 'throttled',
        lastError: 'Max concurrency reached'
      });
      deliveryRecord = updated ?? {
        ...deliveryRecord,
        status: 'throttled',
        lastError: 'Max concurrency reached'
      };
    }

    await scheduleTriggerRetry(trigger, deliveryRecord, 'max_concurrency', null);
    await recordTriggerEvaluation(trigger, 'throttled');
    return;
  }

  let delivery = currentDelivery;
  if (!delivery) {
    delivery = await createDeliveryRecord(trigger, event, 'matched', { dedupeKey });
  } else {
    const updated = await updateWorkflowTriggerDelivery(delivery.id, {
      status: 'matched',
      dedupeKey,
      nextAttemptAt: null,
      retryState: 'pending',
      retryMetadata: null
    });
    delivery = updated ?? {
      ...delivery,
      status: 'matched',
      dedupeKey,
      nextAttemptAt: null,
      retryState: 'pending',
      retryMetadata: null
    };
  }

  await recordTriggerEvaluation(trigger, 'matched');

  const runKeyParts: Array<string | null> = [
    'trigger',
    trigger.id,
    dedupeKey ?? null,
    delivery.id
  ];
  if (event.id) {
    runKeyParts.push(event.id);
  }
  const autoRunKeyCandidate = buildRunKeyFromParts(...runKeyParts);
  let runKeyColumns: { runKey: string | null; runKeyNormalized: string | null } = {
    runKey: null,
    runKeyNormalized: null
  };

  try {
    const renderedParameters = await renderJsonTemplate(trigger.parameterTemplate, context);
    const parameterContext =
      renderedParameters && typeof renderedParameters === 'object' && !Array.isArray(renderedParameters)
        ? (renderedParameters as Record<string, unknown>)
        : {};

    let runKeyInput = autoRunKeyCandidate;
    if (trigger.runKeyTemplate) {
      const runKeyContext = {
        ...context,
        parameters: parameterContext
      } satisfies Record<string, unknown>;
      const renderedRunKey = await renderStringTemplate(trigger.runKeyTemplate, runKeyContext);
      const trimmedRunKey = renderedRunKey.trim();
      if (trimmedRunKey) {
        runKeyInput = trimmedRunKey;
      } else if (autoRunKeyCandidate) {
        logger.warn('Run key template produced empty value; falling back to auto-generated run key', {
          triggerId: trigger.id,
          workflowDefinitionId: trigger.workflowDefinitionId
        });
        runKeyInput = autoRunKeyCandidate;
      } else {
        logger.warn('Run key template produced empty value and no fallback available', {
          triggerId: trigger.id,
          workflowDefinitionId: trigger.workflowDefinitionId
        });
        await recordTriggerEvaluation(trigger, 'skipped');
        return;
      }
    }

    if (runKeyInput) {
      try {
        runKeyColumns = computeRunKeyColumns(runKeyInput);
      } catch (err) {
        if (trigger.runKeyTemplate && autoRunKeyCandidate && runKeyInput !== autoRunKeyCandidate) {
          try {
            runKeyColumns = computeRunKeyColumns(autoRunKeyCandidate);
            logger.warn('Run key template produced invalid value; falling back to auto-generated run key', {
              triggerId: trigger.id,
              workflowDefinitionId: trigger.workflowDefinitionId,
              runKey: runKeyInput,
              error: (err as Error).message ?? 'unknown'
            });
          } catch (fallbackErr) {
            logger.warn('Event trigger run skipped due to invalid run key after fallback attempt', {
              triggerId: trigger.id,
              workflowDefinitionId: trigger.workflowDefinitionId,
              runKey: autoRunKeyCandidate,
              error: (fallbackErr as Error).message ?? 'unknown'
            });
            await recordTriggerEvaluation(trigger, 'skipped');
            return;
          }
        } else {
          logger.warn('Event trigger run skipped due to invalid run key', {
            triggerId: trigger.id,
            workflowDefinitionId: trigger.workflowDefinitionId,
            runKey: runKeyInput,
            error: (err as Error).message ?? 'unknown'
          });
          await recordTriggerEvaluation(trigger, 'skipped');
          return;
        }
      }
    }

    const run = await createWorkflowRun(trigger.workflowDefinitionId, {
      parameters: renderedParameters ?? {},
      triggeredBy: 'event-trigger',
      trigger: {
        type: 'event',
        event: {
          id: event.id,
          type: event.type,
          source: event.source,
          occurredAt: event.occurredAt,
          correlationId: event.correlationId ?? null
        },
        triggerId: trigger.id,
        triggerName: trigger.name ?? null,
        dedupeKey,
        deliveryId: delivery.id
      },
      runKey: runKeyColumns.runKey
    });

    await updateWorkflowTriggerDelivery(delivery.id, {
      status: 'launched',
      workflowRunId: run.id,
      lastError: null,
      retryState: 'pending',
      retryMetadata: null,
      nextAttemptAt: null
    });

    await enqueueWorkflowRun(run.id, { runKey: run.runKey ?? runKeyColumns.runKey ?? null });
    await recordTriggerEvaluation(trigger, 'launched');
    await registerTriggerSuccess(trigger.id);
  } catch (err) {
    if (runKeyColumns.runKeyNormalized && isRunKeyConflict(err)) {
      const existing = await getActiveWorkflowRunByKey(
        trigger.workflowDefinitionId,
        runKeyColumns.runKeyNormalized
      );
      if (existing) {
        await updateWorkflowTriggerDelivery(delivery.id, {
          status: 'launched',
          workflowRunId: existing.id,
          lastError: null,
          retryState: 'pending',
          retryMetadata: null,
          nextAttemptAt: null
        });
        await recordTriggerEvaluation(trigger, 'launched');
        await registerTriggerSuccess(trigger.id);
        logger.info('Reused existing workflow run for trigger run key', {
          triggerId: trigger.id,
          workflowDefinitionId: trigger.workflowDefinitionId,
          runKey: runKeyColumns.runKey,
          workflowRunId: existing.id
        });
        return;
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    await updateWorkflowTriggerDelivery(delivery.id, {
      status: 'failed',
      lastError: message,
      retryState: 'pending',
      retryMetadata: null,
      nextAttemptAt: null
    });
    await recordTriggerEvaluation(trigger, 'failed', { error: message });
    const pauseOutcome = await registerTriggerFailure(trigger.id, message);
    if (pauseOutcome.paused) {
      await recordTriggerEvaluation(trigger, 'paused', { error: message });
      logger.warn(
        'Trigger paused due to repeated failures',
        normalizeMeta({
          triggerId: trigger.id,
          workflowDefinitionId: trigger.workflowDefinitionId,
          resumeAt: pauseOutcome.until ?? null
        })
      );
    }
    throw err;
  }
}

export async function processEventTriggersForEnvelope(envelope: EventEnvelope): Promise<void> {
  const triggers = await listWorkflowEventTriggersForEvent(envelope.type, envelope.source ?? null);
  if (triggers.length === 0) {
    return;
  }

  for (const trigger of triggers) {
    try {
      await processTrigger(trigger, envelope);
    } catch (err) {
      logger.error(
        'Workflow event trigger processing failed',
        normalizeMeta({
          triggerId: trigger.id,
          workflowDefinitionId: trigger.workflowDefinitionId,
          eventId: envelope.id,
          error: err instanceof Error ? err.message : String(err)
        })
      );
    }
  }
}

export async function retryWorkflowTriggerDelivery(deliveryId: string): Promise<void> {
  const delivery = await getWorkflowTriggerDeliveryById(deliveryId);
  if (!delivery) {
    logger.warn('Trigger delivery not found for retry', normalizeMeta({ deliveryId }));
    return;
  }

  if (delivery.retryState === 'cancelled') {
    logger.info('Trigger delivery retry cancelled; skipping', normalizeMeta({ deliveryId }));
    return;
  }

  const trigger = await getWorkflowEventTriggerById(delivery.triggerId);
  if (!trigger) {
    await updateWorkflowTriggerDelivery(delivery.id, {
      status: 'failed',
      lastError: 'Trigger definition not found',
      retryState: 'cancelled',
      retryMetadata: {
        reason: 'missing_trigger'
      },
      nextAttemptAt: null
    });
    logger.warn('Trigger definition missing during retry', normalizeMeta({ deliveryId, triggerId: delivery.triggerId }));
    return;
  }

  if (trigger.status !== 'active') {
    await updateWorkflowTriggerDelivery(delivery.id, {
      status: 'skipped',
      lastError: 'Trigger is not active',
      retryState: 'cancelled',
      retryMetadata: {
        reason: 'trigger_inactive'
      },
      nextAttemptAt: null
    });
    logger.info('Trigger inactive; cancelling retry', normalizeMeta({ deliveryId, triggerId: delivery.triggerId }));
    return;
  }

  const eventRecord = await getWorkflowEventById(delivery.eventId);
  if (!eventRecord) {
    await updateWorkflowTriggerDelivery(delivery.id, {
      status: 'failed',
      lastError: 'Event payload not found',
      retryState: 'cancelled',
      retryMetadata: {
        reason: 'missing_event'
      },
      nextAttemptAt: null
    });
    logger.warn('Event payload missing during trigger retry', normalizeMeta({ deliveryId, eventId: delivery.eventId }));
    return;
  }

  const envelope = workflowEventRecordToEnvelope(eventRecord);

  try {
    await processTrigger(trigger, envelope, { existingDelivery: delivery });
  } catch (err) {
    logger.error(
      'Trigger retry processing failed',
      normalizeMeta({
        deliveryId,
        triggerId: trigger.id,
        workflowDefinitionId: trigger.workflowDefinitionId,
        eventId: envelope.id,
        error: err instanceof Error ? err.message : String(err)
      })
    );
    throw err;
  }
}

export async function reconcileScheduledTriggerRetries(): Promise<void> {
  const scheduled = await listScheduledWorkflowTriggerDeliveries();
  if (scheduled.length === 0) {
    return;
  }

  for (const delivery of scheduled) {
    const runAt = delivery.nextAttemptAt ?? new Date().toISOString();
    try {
      await scheduleEventTriggerRetryJob(delivery.id, delivery.eventId, runAt, delivery.retryAttempts ?? 0);
    } catch (err) {
      logger.error(
        'Failed to requeue scheduled trigger retry',
        normalizeMeta({
          deliveryId: delivery.id,
          triggerId: delivery.triggerId,
          eventId: delivery.eventId,
          nextAttemptAt: runAt,
          error: err instanceof Error ? err.message : String(err)
        })
      );
    }
  }

  logger.info('Reconciled scheduled trigger retries', normalizeMeta({ count: scheduled.length }));
}

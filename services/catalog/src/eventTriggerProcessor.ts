import { JSONPath } from 'jsonpath-plus';
import type { EventEnvelope } from '@apphub/event-bus';
import { Liquid } from 'liquidjs';
import {
  countActiveWorkflowTriggerDeliveries,
  countRecentWorkflowTriggerDeliveries,
  createWorkflowRun,
  createWorkflowTriggerDelivery,
  findWorkflowTriggerDeliveryByDedupeKey,
  listWorkflowEventTriggersForEvent,
  updateWorkflowTriggerDelivery
} from './db/workflows';
import type {
  JsonValue,
  WorkflowEventTriggerPredicate,
  WorkflowEventTriggerRecord
} from './db/types';
import { enqueueWorkflowRun } from './queue';
import { logger } from './observability/logger';
import { normalizeMeta } from './observability/meta';
import { recordTriggerEvaluation } from './eventSchedulerMetrics';
import { isTriggerPaused, registerTriggerFailure, registerTriggerSuccess } from './eventSchedulerState';

const liquid = new Liquid({ cache: false, strictFilters: false, strictVariables: false });

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
  return trimmed.length > 0 ? trimmed : null;
}

async function handleThrottle(
  trigger: WorkflowEventTriggerRecord,
  windowMs: number,
  maxCount: number
): Promise<{ throttled: boolean; until: string | null }> {
  const now = new Date();
  const since = new Date(now.getTime() - windowMs).toISOString();
  const count = await countRecentWorkflowTriggerDeliveries(trigger.id, since);
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

async function processTrigger(
  trigger: WorkflowEventTriggerRecord,
  event: EventEnvelope
): Promise<void> {
  const context = buildTriggerContext(trigger, event);
  const pauseState = isTriggerPaused(trigger.id);
  if (pauseState.paused) {
    await createDeliveryRecord(trigger, event, 'skipped', {
      dedupeKey: null,
      lastError: `Trigger paused until ${pauseState.until ?? 'unspecified'}`
    });
    recordTriggerEvaluation(trigger, 'paused');
    return;
  }

  const predicatesMatch = trigger.predicates.every((predicate) =>
    evaluatePredicate(predicate, event)
  );
  if (!predicatesMatch) {
    recordTriggerEvaluation(trigger, 'filtered');
    return;
  }

  let dedupeKey: string | null = null;
  if (trigger.idempotencyKeyExpression) {
    const rendered = await renderStringTemplate(trigger.idempotencyKeyExpression, context);
    dedupeKey = normalizeDedupeKey(rendered);
  }

  if (dedupeKey) {
    const existing = await findWorkflowTriggerDeliveryByDedupeKey(trigger.id, dedupeKey);
    if (existing && ['pending', 'matched', 'launched'].includes(existing.status)) {
      await createDeliveryRecord(trigger, event, 'skipped', {
        dedupeKey,
        workflowRunId: existing.workflowRunId ?? null,
        lastError: 'Duplicate event (idempotency key)'
      });
      recordTriggerEvaluation(trigger, 'skipped');
      registerTriggerSuccess(trigger.id);
      return;
    }
  }

  if (trigger.throttleWindowMs && trigger.throttleCount) {
    const { throttled, until } = await handleThrottle(
      trigger,
      trigger.throttleWindowMs,
      trigger.throttleCount
    );
    if (throttled) {
      await createDeliveryRecord(trigger, event, 'throttled', {
        dedupeKey,
        throttledUntil: until,
        lastError: 'Throttle window exceeded'
      });
      recordTriggerEvaluation(trigger, 'throttled');
      return;
    }
  }

  if (trigger.maxConcurrency && (await handleConcurrency(trigger, trigger.maxConcurrency))) {
    await createDeliveryRecord(trigger, event, 'throttled', {
      dedupeKey,
      lastError: 'Max concurrency reached'
    });
    recordTriggerEvaluation(trigger, 'throttled');
    return;
  }

  const delivery = await createDeliveryRecord(trigger, event, 'matched', { dedupeKey });
  recordTriggerEvaluation(trigger, 'matched');

  try {
    const renderedParameters = await renderJsonTemplate(trigger.parameterTemplate, context);
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
      }
    });

    await updateWorkflowTriggerDelivery(delivery.id, {
      status: 'launched',
      workflowRunId: run.id,
      lastError: null
    });

    await enqueueWorkflowRun(run.id);
    recordTriggerEvaluation(trigger, 'launched');
    registerTriggerSuccess(trigger.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateWorkflowTriggerDelivery(delivery.id, {
      status: 'failed',
      lastError: message
    });
    recordTriggerEvaluation(trigger, 'failed', { error: message });
    const pauseOutcome = registerTriggerFailure(trigger.id, message);
    if (pauseOutcome.paused) {
      recordTriggerEvaluation(trigger, 'paused', { error: message });
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

import type { WorkflowScenario } from './examples/types';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type WorkflowProvisioningEventTriggerPredicate = {
  path: string;
  operator:
    | 'exists'
    | 'equals'
    | 'notEquals'
    | 'in'
    | 'notIn'
    | 'contains'
    | 'regex'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte';
  value?: JsonValue;
  values?: JsonValue[];
  caseSensitive?: boolean;
  flags?: string;
};

export type WorkflowProvisioningEventTrigger = {
  name?: string;
  description?: string;
  eventType: string;
  eventSource?: string | null;
  predicates: WorkflowProvisioningEventTriggerPredicate[];
  parameterTemplate?: Record<string, JsonValue> | null;
  runKeyTemplate?: string;
  metadata?: JsonValue;
  throttleWindowMs?: number;
  throttleCount?: number;
  maxConcurrency?: number;
  idempotencyKeyExpression?: string;
  status?: 'active' | 'disabled';
};

export type WorkflowProvisioningSchedule = {
  name?: string;
  description?: string;
  cron: string;
  timezone?: string | null;
  startWindow?: string | null;
  endWindow?: string | null;
  catchUp?: boolean;
  isActive?: boolean;
  parameters?: Record<string, JsonValue> | null;
};

export type WorkflowProvisioningPlan = {
  schedules: WorkflowProvisioningSchedule[];
  eventTriggers: WorkflowProvisioningEventTrigger[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJsonValue(entry as JsonValue)) as JsonValue;
  }
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, JsonValue>)) {
      result[key] = cloneJsonValue(entry);
    }
    return result;
  }
  return value;
}

const TEMPLATE_PATTERN = /{{\s*([^}]+)\s*}}/g;

function resolveScopePath(scope: Record<string, unknown>, expression: string): unknown {
  const segments = expression
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return undefined;
  }
  let current: unknown = scope;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isNaN(index) && index >= 0 && index < current.length) {
        current = current[index];
        continue;
      }
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }
    return undefined;
  }
  return current;
}

function shouldPreserveExpression(expression: string): boolean {
  const trimmed = expression.trim();
  return trimmed.startsWith('trigger.') || trimmed.startsWith('event.') || trimmed.startsWith('run.');
}

function coerceJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => coerceJsonValue(entry)) as JsonValue;
  }
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = coerceJsonValue(entry);
    }
    return result;
  }
  return String(value);
}

function resolveTemplateString(value: string, scope: Record<string, unknown>): JsonValue {
  const matches = [...value.matchAll(TEMPLATE_PATTERN)];
  if (matches.length === 0) {
    return value;
  }
  const trimmed = value.trim();
  if (matches.length === 1 && trimmed === matches[0][0]) {
    const expression = matches[0][1];
    const resolved = resolveScopePath(scope, expression);
    if (resolved === undefined) {
      return shouldPreserveExpression(expression) ? value : null;
    }
    return coerceJsonValue(resolved);
  }
  return value.replace(TEMPLATE_PATTERN, (_match, expression) => {
    const resolved = resolveScopePath(scope, expression);
    if (resolved === undefined || resolved === null) {
      return '';
    }
    if (typeof resolved === 'string' || typeof resolved === 'number' || typeof resolved === 'boolean') {
      return String(resolved);
    }
    if (Array.isArray(resolved) || typeof resolved === 'object') {
      return JSON.stringify(resolved);
    }
    return '';
  }) as JsonValue;
}

function resolveJsonTemplates(value: JsonValue, scope: Record<string, unknown>): JsonValue {
  if (typeof value === 'string') {
    return resolveTemplateString(value, scope);
  }
  if (value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveJsonTemplates(entry as JsonValue, scope)) as JsonValue;
  }
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, JsonValue>)) {
      result[key] = resolveJsonTemplates(entry, scope);
    }
    return result;
  }
  return value;
}

function ensureJsonObject(value: JsonValue | null | undefined): Record<string, JsonValue> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, JsonValue>;
}

function pruneNullishValues(record: Record<string, JsonValue>): void {
  for (const key of Object.keys(record)) {
    const entry = record[key];
    if (entry === null || entry === undefined) {
      delete record[key];
    } else if (Array.isArray(entry)) {
      record[key] = entry.filter((item) => item !== null && item !== undefined) as JsonValue;
    }
  }
}

function extractWorkflowProvisioningPlan(
  workflow: WorkflowScenario['form']
): { schedules?: Array<Record<string, unknown>>; eventTriggers?: Array<Record<string, unknown>> } | null {
  const metadata = workflow.metadata;
  if (!isRecord(metadata)) {
    return null;
  }
  const provisioning = metadata.provisioning;
  if (!isRecord(provisioning)) {
    return null;
  }
  const result: { schedules?: Array<Record<string, unknown>>; eventTriggers?: Array<Record<string, unknown>> } = {};
  if (Array.isArray(provisioning.schedules)) {
    result.schedules = provisioning.schedules.filter((entry) => isRecord(entry)) as Array<Record<string, unknown>>;
  }
  if (Array.isArray(provisioning.eventTriggers)) {
    result.eventTriggers = provisioning.eventTriggers.filter((entry) => isRecord(entry)) as Array<
      Record<string, unknown>
    >;
  }
  if ((result.schedules?.length ?? 0) === 0 && (result.eventTriggers?.length ?? 0) === 0) {
    return null;
  }
  return result;
}

export function resolveWorkflowProvisioningPlan(
  workflow: WorkflowScenario['form']
): WorkflowProvisioningPlan {
  const template = extractWorkflowProvisioningPlan(workflow);
  if (!template) {
    return { schedules: [], eventTriggers: [] };
  }

  const defaultParameters = isRecord(workflow.defaultParameters)
    ? (workflow.defaultParameters as Record<string, JsonValue>)
    : {};
  const metadata = isRecord(workflow.metadata) ? (workflow.metadata as Record<string, JsonValue>) : {};

  const scope: Record<string, unknown> = {
    workflow: {
      slug: workflow.slug,
      name: workflow.name,
      version: workflow.version ?? null
    },
    defaultParameters,
    metadata
  };

  const schedules: WorkflowProvisioningSchedule[] = [];
  for (const scheduleTemplate of template.schedules ?? []) {
    const scheduleScope = { ...scope, schedule: scheduleTemplate };
    const resolvedParameters = scheduleTemplate.parameters
      ? resolveJsonTemplates(scheduleTemplate.parameters as JsonValue, scheduleScope)
      : undefined;
    const parameterObject = ensureJsonObject(resolvedParameters ?? null);
    if (parameterObject) {
      pruneNullishValues(parameterObject);
    }
    schedules.push({
      name: (scheduleTemplate.name as string | undefined) ?? undefined,
      description: (scheduleTemplate.description as string | undefined) ?? undefined,
      cron: String(scheduleTemplate.cron),
      timezone: (scheduleTemplate.timezone as string | undefined) ?? null,
      startWindow: (scheduleTemplate.startWindow as string | undefined) ?? null,
      endWindow: (scheduleTemplate.endWindow as string | undefined) ?? null,
      catchUp: typeof scheduleTemplate.catchUp === 'boolean' ? scheduleTemplate.catchUp : undefined,
      isActive: typeof scheduleTemplate.isActive === 'boolean' ? scheduleTemplate.isActive : undefined,
      parameters: parameterObject && Object.keys(parameterObject).length > 0 ? parameterObject : null
    });
  }

  const eventTriggers: WorkflowProvisioningEventTrigger[] = [];
  for (const triggerTemplate of template.eventTriggers ?? []) {
    const resolvedPredicates: WorkflowProvisioningEventTriggerPredicate[] = [];
    for (const predicate of (triggerTemplate.predicates as Array<Record<string, unknown>> | undefined) ?? []) {
      if (!predicate.path || !predicate.operator) {
        continue;
      }
      const predicateClone: WorkflowProvisioningEventTriggerPredicate = {
        path: String(predicate.path),
        operator: predicate.operator as WorkflowProvisioningEventTriggerPredicate['operator']
      };
      if (predicate.value !== undefined) {
        predicateClone.value = resolveJsonTemplates(predicate.value as JsonValue, scope);
      }
      if (Array.isArray(predicate.values)) {
        predicateClone.values = predicate.values.map((entry) =>
          resolveJsonTemplates(entry as JsonValue, scope)
        ) as JsonValue[];
      }
      if (typeof predicate.caseSensitive === 'boolean') {
        predicateClone.caseSensitive = predicate.caseSensitive;
      }
      if (typeof predicate.flags === 'string') {
        predicateClone.flags = predicate.flags;
      }
      resolvedPredicates.push(predicateClone);
    }

    const parameterTemplate = triggerTemplate.parameterTemplate
      ? resolveJsonTemplates(cloneJsonValue(triggerTemplate.parameterTemplate as JsonValue), scope)
      : undefined;

    const runKeyTemplate =
      typeof triggerTemplate.runKeyTemplate === 'string'
        ? String(resolveTemplateString(triggerTemplate.runKeyTemplate, scope))
        : undefined;

    const resolvedMetadata = triggerTemplate.metadata
      ? resolveJsonTemplates(cloneJsonValue(triggerTemplate.metadata as JsonValue), scope)
      : undefined;

    const parameterObject = ensureJsonObject(parameterTemplate ?? null);
    if (parameterObject) {
      pruneNullishValues(parameterObject);
    }

    eventTriggers.push({
      name: (triggerTemplate.name as string | undefined) ?? undefined,
      description: (triggerTemplate.description as string | undefined) ?? undefined,
      eventType: String(triggerTemplate.eventType ?? ''),
      eventSource: (triggerTemplate.eventSource as string | undefined) ?? null,
      predicates: resolvedPredicates,
      parameterTemplate: parameterObject && Object.keys(parameterObject).length > 0 ? parameterObject : undefined,
      runKeyTemplate: runKeyTemplate && runKeyTemplate.trim().length > 0 ? runKeyTemplate : undefined,
      metadata: resolvedMetadata ?? undefined,
      throttleWindowMs:
        typeof triggerTemplate.throttleWindowMs === 'number' ? triggerTemplate.throttleWindowMs : undefined,
      throttleCount: typeof triggerTemplate.throttleCount === 'number' ? triggerTemplate.throttleCount : undefined,
      maxConcurrency: typeof triggerTemplate.maxConcurrency === 'number' ? triggerTemplate.maxConcurrency : undefined,
      idempotencyKeyExpression:
        typeof triggerTemplate.idempotencyKeyExpression === 'string'
          ? triggerTemplate.idempotencyKeyExpression
          : undefined,
      status:
        triggerTemplate.status === 'active' || triggerTemplate.status === 'disabled'
          ? triggerTemplate.status
          : undefined
    });
  }

  return { schedules, eventTriggers };
}

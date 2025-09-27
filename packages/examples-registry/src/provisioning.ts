import type {
  JsonValue,
  WorkflowDefinitionTemplate,
  WorkflowProvisioningEventTriggerPredicateTemplate,
  WorkflowProvisioningEventTriggerTemplate,
  WorkflowProvisioningPlanTemplate,
  WorkflowProvisioningScheduleTemplate
} from './types';

export type { WorkflowProvisioningPlanTemplate } from './types';

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
  const trimmed = expression.trim();
  if (!trimmed) {
    return undefined;
  }
  const segments = trimmed.split('.').map((segment) => segment.trim()).filter(Boolean);
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
  if (value === undefined || value === null) {
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
      return shouldPreserveExpression(expression) ? (value as JsonValue) : null;
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
      continue;
    }
    if (Array.isArray(entry)) {
      record[key] = entry.filter((item) => item !== null && item !== undefined) as JsonValue;
      continue;
    }
    if (typeof entry === 'object') {
      const nested = entry as Record<string, JsonValue>;
      pruneNullishValues(nested);
      if (Object.keys(nested).length === 0) {
        delete record[key];
      }
    }
  }
}

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

export type WorkflowProvisioningEventTriggerPredicate = WorkflowProvisioningEventTriggerPredicateTemplate;

export type WorkflowProvisioningEventTrigger = {
  name?: string;
  description?: string;
  eventType: string;
  eventSource?: string | null;
  predicates: WorkflowProvisioningEventTriggerPredicate[];
  parameterTemplate?: Record<string, JsonValue>;
  metadata?: JsonValue;
  throttleWindowMs?: number;
  throttleCount?: number;
  maxConcurrency?: number;
  idempotencyKeyExpression?: string;
  status?: 'active' | 'disabled';
};

export type WorkflowProvisioningPlan = {
  schedules: WorkflowProvisioningSchedule[];
  eventTriggers: WorkflowProvisioningEventTrigger[];
};

export function extractWorkflowProvisioningPlan(
  workflow: WorkflowDefinitionTemplate
): WorkflowProvisioningPlanTemplate | null {
  const metadata = workflow.metadata;
  if (!isRecord(metadata)) {
    return null;
  }
  const provisioning = metadata.provisioning;
  if (!isRecord(provisioning)) {
    return null;
  }

  const result: WorkflowProvisioningPlanTemplate = {};

  if (Array.isArray(provisioning.schedules)) {
    result.schedules = provisioning.schedules.filter((entry): entry is WorkflowProvisioningScheduleTemplate =>
      isRecord(entry)
    ) as WorkflowProvisioningScheduleTemplate[];
  }

  if (Array.isArray(provisioning.eventTriggers)) {
    result.eventTriggers = provisioning.eventTriggers.filter((entry): entry is WorkflowProvisioningEventTriggerTemplate =>
      isRecord(entry)
    ) as WorkflowProvisioningEventTriggerTemplate[];
  }

  if ((result.schedules?.length ?? 0) === 0 && (result.eventTriggers?.length ?? 0) === 0) {
    return null;
  }

  return result;
}

export function resolveWorkflowProvisioningPlan(
  workflow: WorkflowDefinitionTemplate
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
    const normalizedParameters = parameterObject && Object.keys(parameterObject).length > 0 ? parameterObject : null;
    schedules.push({
      name: scheduleTemplate.name,
      description: scheduleTemplate.description,
      cron: scheduleTemplate.cron,
      timezone: scheduleTemplate.timezone ?? null,
      startWindow: scheduleTemplate.startWindow ?? null,
      endWindow: scheduleTemplate.endWindow ?? null,
      catchUp: scheduleTemplate.catchUp ?? undefined,
      isActive: scheduleTemplate.isActive ?? undefined,
      parameters: normalizedParameters
    });
  }

  const eventTriggers: WorkflowProvisioningEventTrigger[] = [];
  for (const triggerTemplate of template.eventTriggers ?? []) {
    const resolvedPredicates: WorkflowProvisioningEventTriggerPredicate[] = [];
    for (const predicate of triggerTemplate.predicates ?? []) {
      const predicateClone: WorkflowProvisioningEventTriggerPredicate = {
        path: predicate.path,
        operator: predicate.operator
      };
      if (predicate.value !== undefined) {
        predicateClone.value = resolveJsonTemplates(predicate.value as JsonValue, scope);
      }
      if (predicate.values) {
        predicateClone.values = predicate.values.map((entry) =>
          resolveJsonTemplates(entry as JsonValue, scope)
        ) as JsonValue[];
      }
      resolvedPredicates.push(predicateClone);
    }

    const parameterTemplate = triggerTemplate.parameterTemplate
      ? resolveJsonTemplates(cloneJsonValue(triggerTemplate.parameterTemplate), scope)
      : undefined;

    const resolvedMetadata = triggerTemplate.metadata
      ? resolveJsonTemplates(cloneJsonValue(triggerTemplate.metadata), scope)
      : undefined;

    const parameterObject = ensureJsonObject(parameterTemplate ?? null);
    if (parameterObject) {
      pruneNullishValues(parameterObject);
    }
    const normalizedParameterTemplate = parameterObject && Object.keys(parameterObject).length > 0 ? parameterObject : undefined;

    eventTriggers.push({
      name: triggerTemplate.name,
      description: triggerTemplate.description,
      eventType: triggerTemplate.eventType,
      eventSource: triggerTemplate.eventSource ?? null,
      predicates: resolvedPredicates,
      parameterTemplate: normalizedParameterTemplate,
      metadata: resolvedMetadata ?? undefined,
      throttleWindowMs: triggerTemplate.throttleWindowMs,
      throttleCount: triggerTemplate.throttleCount,
      maxConcurrency: triggerTemplate.maxConcurrency,
      idempotencyKeyExpression: triggerTemplate.idempotencyKeyExpression,
      status: triggerTemplate.status
    });
  }

  return { schedules, eventTriggers };
}

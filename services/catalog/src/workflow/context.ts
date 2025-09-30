import type {
  JsonValue,
  ServiceStatus,
  WorkflowAssetFreshness,
  WorkflowRunRecord,
  WorkflowRunStepStatus
} from '../db/types';

export type WorkflowStepServiceContext = {
  slug: string;
  status: ServiceStatus;
  method: string;
  path: string;
  baseUrl?: string | null;
  statusCode?: number | null;
  latencyMs?: number | null;
};

export type StepAssetRuntimeSummary = {
  assetId: string;
  producedAt: string | null;
  partitionKey?: string | null;
  payload?: JsonValue | null;
  schema?: JsonValue | null;
  freshness?: WorkflowAssetFreshness | null;
};

export type WorkflowStepRuntimeContext = {
  status: WorkflowRunStepStatus;
  jobRunId: string | null;
  result?: JsonValue | null;
  errorMessage?: string | null;
  logsUrl?: string | null;
  metrics?: JsonValue | null;
  startedAt?: string | null;
  completedAt?: string | null;
  attempt?: number;
  service?: WorkflowStepServiceContext;
  assets?: StepAssetRuntimeSummary[];
};

export type WorkflowRuntimeContext = {
  steps: Record<string, WorkflowStepRuntimeContext>;
  lastUpdatedAt: string;
  shared?: Record<string, JsonValue | null>;
};

export type FanOutRuntimeMetadata = {
  parentStepId: string;
  templateStepId: string;
  index: number;
  item: JsonValue;
};

export type TemplateScope = {
  shared: Record<string, JsonValue | null>;
  steps: Record<string, WorkflowStepRuntimeContext>;
  run: {
    id: string;
    parameters: JsonValue;
    triggeredBy: string | null;
    trigger: JsonValue | null;
  };
  parameters: JsonValue;
  step?: {
    id: string;
    parameters: JsonValue;
  };
  stepParameters?: JsonValue;
  fanout?: FanOutRuntimeMetadata;
  item?: JsonValue;
};

const TEMPLATE_PATTERN = /\$?{{\s*([^}]+)\s*}}/g;
const LEGACY_SIMPLE_TEMPLATE_PATTERN = /^(?:\$)([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)$/;
const LEGACY_INLINE_TEMPLATE_PATTERN = /\$([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)/g;

function deepCopyShared(shared: Record<string, JsonValue | null> | undefined): Record<string, JsonValue | null> | undefined {
  if (!shared) {
    return undefined;
  }
  return { ...shared };
}

export function isJsonObject(value: JsonValue | null | undefined): value is Record<string, JsonValue> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function buildTemplateScope(run: WorkflowRunRecord, context: WorkflowRuntimeContext): TemplateScope {
  return {
    shared: context.shared ?? {},
    steps: context.steps,
    run: {
      id: run.id,
      parameters: (run.parameters ?? null) as JsonValue,
      triggeredBy: run.triggeredBy ?? null,
      trigger: (run.trigger ?? null) as JsonValue
    },
    parameters: (run.parameters ?? null) as JsonValue
  };
}

export function withStepScope(
  scope: TemplateScope,
  stepId: string,
  parameters: JsonValue,
  fanOut?: FanOutRuntimeMetadata
): TemplateScope {
  const next: TemplateScope = {
    ...scope,
    step: { id: stepId, parameters },
    stepParameters: parameters
  };

  if (fanOut) {
    next.fanout = fanOut;
    next.item = fanOut.item;
  } else {
    if ('fanout' in next) {
      delete (next as Record<string, unknown>).fanout;
    }
    if ('item' in next) {
      delete (next as Record<string, unknown>).item;
    }
  }

  return next;
}

function coerceTemplateResult(value: unknown): JsonValue {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => coerceTemplateResult(entry)) as JsonValue;
  }
  if (typeof value === 'object') {
    const record: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      record[key] = coerceTemplateResult(entry);
    }
    return record;
  }
  return String(value);
}

export function templateValueToString(value: unknown): string {
  const normalized = coerceTemplateResult(value);
  if (normalized === null) {
    return '';
  }
  if (typeof normalized === 'string') {
    return normalized;
  }
  if (typeof normalized === 'number' || typeof normalized === 'boolean') {
    return String(normalized);
  }
  return JSON.stringify(normalized);
}

function lookupTemplateValue(scope: TemplateScope, expression: string): unknown {
  const trimmed = expression.trim();
  if (!trimmed) {
    return undefined;
  }
  const segments = trimmed.split('.').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    return undefined;
  }

  const root: Record<string, unknown> = {
    shared: scope.shared,
    steps: scope.steps,
    run: scope.run,
    parameters: scope.parameters,
    runParameters: scope.parameters,
    step: scope.step,
    stepParameters: scope.step?.parameters ?? scope.stepParameters,
    fanout: scope.fanout,
    item: scope.item ?? scope.fanout?.item
  };

  let current: unknown = root;
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

function applyLegacyExpressionAliases(expression: string): string {
  return expression.replace(/(^|\.)(output)(?=\.|$)/g, (_match, prefix) => `${prefix ?? ''}result`);
}

function postProcessLegacyValue(expression: string, value: unknown): unknown {
  if (!expression.includes('.output')) {
    return value;
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const files = record.files;
    if (Array.isArray(files)) {
      return files;
    }
  }
  return value;
}

function resolveTemplateExpression(expression: string, scope: TemplateScope): unknown {
  const trimmed = expression.trim();
  if (!trimmed) {
    return undefined;
  }
  const direct = lookupTemplateValue(scope, trimmed);
  if (direct !== undefined) {
    return postProcessLegacyValue(trimmed, direct);
  }
  const aliasedExpression = applyLegacyExpressionAliases(trimmed);
  if (aliasedExpression !== trimmed) {
    const aliased = lookupTemplateValue(scope, aliasedExpression);
    if (aliased !== undefined) {
      return postProcessLegacyValue(trimmed, aliased);
    }
  }
  return undefined;
}

export function resolveTemplateString(input: string, scope: TemplateScope): JsonValue {
  const trimmed = input.trim();
  const legacySimpleMatch = LEGACY_SIMPLE_TEMPLATE_PATTERN.exec(trimmed);
  if (legacySimpleMatch) {
    const value = resolveTemplateExpression(legacySimpleMatch[1], scope);
    return coerceTemplateResult(value);
  }

  const matches = [...input.matchAll(TEMPLATE_PATTERN)];
  if (matches.length > 0) {
    if (matches.length === 1 && trimmed === matches[0][0]) {
      const value = resolveTemplateExpression(matches[0][1], scope);
      return coerceTemplateResult(value);
    }

    const replaced = input.replace(TEMPLATE_PATTERN, (_match, expr) => {
      const value = resolveTemplateExpression(expr, scope);
      return templateValueToString(value);
    });
    return replaced as JsonValue;
  }

  let performedLegacyReplacement = false;
  const replacedLegacy = input.replace(LEGACY_INLINE_TEMPLATE_PATTERN, (_match, expr) => {
    const value = resolveTemplateExpression(expr, scope);
    performedLegacyReplacement = true;
    return templateValueToString(value);
  });
  if (performedLegacyReplacement) {
    return replacedLegacy as JsonValue;
  }

  return input;
}

export function resolveJsonTemplates(value: JsonValue, scope: TemplateScope): JsonValue {
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
    const record: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, JsonValue>)) {
      record[key] = resolveJsonTemplates(entry, scope);
    }
    return record;
  }
  return value;
}

export function mergeParameters(runParameters: JsonValue, stepParameters: JsonValue | null | undefined): JsonValue {
  const runIsObject = isJsonObject(runParameters);
  const stepIsObject = isJsonObject(stepParameters);

  if (runIsObject || stepIsObject) {
    const base: Record<string, JsonValue> = runIsObject ? { ...runParameters } : {};
    if (stepIsObject) {
      for (const [key, value] of Object.entries(stepParameters as Record<string, JsonValue>)) {
        base[key] = value;
      }
    }
    return base as JsonValue;
  }

  if (stepParameters !== undefined && stepParameters !== null) {
    return stepParameters;
  }

  return runParameters;
}

export function updateStepContext(
  context: WorkflowRuntimeContext,
  stepId: string,
  patch: Partial<WorkflowStepRuntimeContext>
): WorkflowRuntimeContext {
  const next: WorkflowRuntimeContext = {
    steps: { ...context.steps },
    lastUpdatedAt: new Date().toISOString(),
    shared: deepCopyShared(context.shared)
  };
  const previous = next.steps[stepId] ?? { status: 'pending', jobRunId: null };
  next.steps[stepId] = {
    ...previous,
    ...patch
  };
  return next;
}

export function setSharedValue(
  context: WorkflowRuntimeContext,
  key: string,
  value: JsonValue | string | null
): WorkflowRuntimeContext {
  const shared: Record<string, JsonValue | null> = { ...(context.shared ?? {}) };
  const next: WorkflowRuntimeContext = {
    steps: { ...context.steps },
    lastUpdatedAt: new Date().toISOString(),
    shared
  };
  shared[key] = (value ?? null) as JsonValue | null;
  return next;
}

export function serializeContext(context: WorkflowRuntimeContext): JsonValue {
  const payload: Record<string, JsonValue> = {
    steps: context.steps as unknown as JsonValue,
    lastUpdatedAt: context.lastUpdatedAt
  };
  if (context.shared) {
    payload.shared = context.shared as unknown as JsonValue;
  }
  return payload as JsonValue;
}

export function resolveWorkflowOutput(context: WorkflowRuntimeContext): JsonValue | null {
  if (!context.shared) {
    return null;
  }
  const entries = Object.entries(context.shared).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return null;
  }
  const snapshot: Record<string, JsonValue | null> = {};
  for (const [key, value] of entries) {
    snapshot[key] = (value ?? null) as JsonValue | null;
  }
  return snapshot as JsonValue;
}

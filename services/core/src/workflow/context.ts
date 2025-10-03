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
  errorStack?: string | null;
  errorName?: string | null;
  errorProperties?: Record<string, JsonValue> | null;
  context?: JsonValue | null;
  resolutionError?: boolean;
};

export type WorkflowRuntimeContext = {
  steps: Record<string, WorkflowStepRuntimeContext>;
  lastUpdatedAt: string;
  shared?: Record<string, JsonValue | null>;
};

export type TemplateResolutionIssue = {
  path: string;
  expression: string;
};

export type TemplateResolutionTracker = {
  record(issue: TemplateResolutionIssue): void;
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

type TemplateFilter = {
  name: string;
  args: string[];
};

function splitPipelineSegments(expression: string): string[] {
  const segments: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (char === "'" && !inDoubleQuote) {
      const escaped = index > 0 && expression[index - 1] === '\\';
      if (!escaped) {
        inSingleQuote = !inSingleQuote;
      }
    } else if (char === '"' && !inSingleQuote) {
      const escaped = index > 0 && expression[index - 1] === '\\';
      if (!escaped) {
        inDoubleQuote = !inDoubleQuote;
      }
    }

    if (char === '|' && !inSingleQuote && !inDoubleQuote) {
      segments.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  segments.push(current);
  return segments;
}

function parseFilterArguments(argumentString: string): string[] {
  if (!argumentString) {
    return [];
  }
  const args: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < argumentString.length; index += 1) {
    const char = argumentString[index];
    if (char === "'" && !inDoubleQuote) {
      const escaped = index > 0 && argumentString[index - 1] === '\\';
      if (!escaped) {
        inSingleQuote = !inSingleQuote;
      }
    } else if (char === '"' && !inSingleQuote) {
      const escaped = index > 0 && argumentString[index - 1] === '\\';
      if (!escaped) {
        inDoubleQuote = !inDoubleQuote;
      }
    }

    if (char === ',' && !inSingleQuote && !inDoubleQuote) {
      if (current.trim().length > 0) {
        args.push(current.trim());
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) {
    args.push(current.trim());
  }

  return args;
}

function parseFilterPipeline(expression: string): { base: string; filters: TemplateFilter[] } {
  const segments = splitPipelineSegments(expression);
  const [rawBase, ...rawFilters] = segments;
  const base = (rawBase ?? '').trim();
  const filters = rawFilters
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const colonIndex = segment.indexOf(':');
      if (colonIndex === -1) {
        return {
          name: segment.trim(),
          args: []
        } satisfies TemplateFilter;
      }
      const name = segment.slice(0, colonIndex).trim();
      const args = parseFilterArguments(segment.slice(colonIndex + 1));
      return {
        name,
        args
      } satisfies TemplateFilter;
    });

  return {
    base,
    filters
  };
}

function unescapeStringLiteral(value: string): string {
  return value.replace(/\\(['"\\])/g, '$1');
}

function evaluateFilterArgument(token: string, scope: TemplateScope): unknown {
  const trimmed = token.trim();
  if (!trimmed) {
    return undefined;
  }
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return unescapeStringLiteral(trimmed.slice(1, -1));
  }
  if (trimmed === 'null') {
    return null;
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric) && trimmed.match(/^-?\d+(?:\.\d+)?$/)) {
    return numeric;
  }
  // Treat remaining as template lookup path
  const resolved = resolveLookupWithAliases(trimmed, scope);
  return resolved;
}

function isBlankTemplateValue(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.length === 0);
}

function resolveLookupWithAliases(expression: string, scope: TemplateScope): unknown {
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

function resolveTemplateExpression(
  expression: string,
  scope: TemplateScope,
  tracker?: TemplateResolutionTracker,
  path?: string
): unknown {
  const trimmed = expression.trim();
  if (!trimmed) {
    return undefined;
  }

  const { base, filters } = parseFilterPipeline(trimmed);
  let value = resolveLookupWithAliases(base, scope);
  let resolved = value !== undefined;

  for (const filter of filters) {
    const name = filter.name.toLowerCase();
    if (name === 'default') {
      const fallbackToken = filter.args[0];
      const fallbackValue = fallbackToken !== undefined ? evaluateFilterArgument(fallbackToken, scope) : undefined;
      if (isBlankTemplateValue(value)) {
        value = fallbackValue;
        resolved = value !== undefined;
      }
      continue;
    }

    if (value === undefined || value === null) {
      resolved = value !== undefined;
      continue;
    }

    switch (name) {
      case 'slice': {
        const startArg = filter.args[0];
        const lengthArg = filter.args[1];
        const start = Number(startArg ?? 0);
        const hasStart = startArg !== undefined && !Number.isNaN(start);
        const length = lengthArg !== undefined ? Number(lengthArg) : undefined;
        const hasLength = lengthArg !== undefined && !Number.isNaN(length);
        if (typeof value === 'string') {
          const begin = hasStart ? start : 0;
          value = hasLength ? value.slice(begin, begin + (length as number)) : value.slice(begin);
          resolved = true;
        } else if (Array.isArray(value)) {
          const begin = hasStart ? start : 0;
          value = hasLength ? value.slice(begin, begin + (length as number)) : value.slice(begin);
          resolved = true;
        } else {
          resolved = false;
        }
        break;
      }
      case 'replace': {
        const searchToken = filter.args[0];
        const replaceToken = filter.args[1] ?? "";
        const searchValue = searchToken !== undefined ? evaluateFilterArgument(searchToken, scope) : undefined;
        const replacementValue = evaluateFilterArgument(replaceToken, scope);
        if (typeof value === 'string' && typeof searchValue === 'string') {
          const replacement = typeof replacementValue === 'string' ? replacementValue : String(replacementValue ?? '');
          value = value.split(searchValue).join(replacement);
          resolved = true;
        } else {
          resolved = false;
        }
        break;
      }
      default: {
        // Unsupported filter
        resolved = false;
        break;
      }
    }
  }

  if (value === undefined && tracker) {
    tracker.record({
      path: path ?? '$',
      expression: trimmed
    });
  }
  return value;
}

export function resolveTemplateString(
  input: string,
  scope: TemplateScope,
  tracker?: TemplateResolutionTracker,
  path = '$'
): JsonValue {
  const trimmed = input.trim();
  const legacySimpleMatch = LEGACY_SIMPLE_TEMPLATE_PATTERN.exec(trimmed);
  if (legacySimpleMatch) {
    const value = resolveTemplateExpression(legacySimpleMatch[1], scope, tracker, path);
    return coerceTemplateResult(value);
  }

  const matches = [...input.matchAll(TEMPLATE_PATTERN)];
  if (matches.length > 0) {
    if (matches.length === 1 && trimmed === matches[0][0]) {
      const value = resolveTemplateExpression(matches[0][1], scope, tracker, path);
      return coerceTemplateResult(value);
    }

    const replaced = input.replace(TEMPLATE_PATTERN, (_match, expr) => {
      const value = resolveTemplateExpression(expr, scope, tracker, path);
      return templateValueToString(value);
    });
    return replaced as JsonValue;
  }

  let performedLegacyReplacement = false;
  const replacedLegacy = input.replace(LEGACY_INLINE_TEMPLATE_PATTERN, (_match, expr) => {
    const value = resolveTemplateExpression(expr, scope, tracker, path);
    performedLegacyReplacement = true;
    return templateValueToString(value);
  });
  if (performedLegacyReplacement) {
    return replacedLegacy as JsonValue;
  }

  return input;
}

export function resolveJsonTemplates(
  value: JsonValue,
  scope: TemplateScope,
  tracker?: TemplateResolutionTracker,
  path = '$'
): JsonValue {
  if (typeof value === 'string') {
    return resolveTemplateString(value, scope, tracker, path);
  }
  if (value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      resolveJsonTemplates(entry as JsonValue, scope, tracker, `${path}[${index}]`)
    ) as JsonValue;
  }
  if (typeof value === 'object') {
    const record: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, JsonValue>)) {
      const nextPath = `${path}.${key}`;
      record[key] = resolveJsonTemplates(entry, scope, tracker, nextPath);
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
  const previous = next.steps[stepId] ?? { status: 'pending', jobRunId: null, resolutionError: false };
  const merged: WorkflowStepRuntimeContext = {
    ...previous,
    ...patch
  };

  const nextStatus = merged.status;

  if (Object.prototype.hasOwnProperty.call(patch, 'context')) {
    merged.context = patch.context ?? null;
  } else if (nextStatus !== 'failed') {
    merged.context = null;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'errorStack')) {
    merged.errorStack = patch.errorStack ?? null;
  } else if (nextStatus !== 'failed') {
    merged.errorStack = null;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'errorName')) {
    merged.errorName = patch.errorName ?? null;
  } else if (nextStatus !== 'failed') {
    merged.errorName = null;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'errorProperties')) {
    merged.errorProperties = patch.errorProperties ?? null;
  } else if (nextStatus !== 'failed') {
    merged.errorProperties = null;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'resolutionError')) {
    merged.resolutionError = Boolean(patch.resolutionError);
  } else if (nextStatus !== 'failed') {
    merged.resolutionError = false;
  }

  next.steps[stepId] = merged;
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

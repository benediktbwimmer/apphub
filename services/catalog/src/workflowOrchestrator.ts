import {
  createWorkflowRunStep,
  getWorkflowDefinitionById,
  getWorkflowRunById,
  getWorkflowRunStep,
  getWorkflowRunStepById,
  appendWorkflowExecutionHistory,
  updateWorkflowRun,
  updateWorkflowRunStep
} from './db/workflows';
import {
  type JsonValue,
  type JobRunStatus,
  type WorkflowDefinitionRecord,
  type WorkflowRunRecord,
  type WorkflowRunStatus,
  type WorkflowRunStepRecord,
  type WorkflowRunStepStatus,
  type WorkflowRunStepUpdateInput,
  type WorkflowStepDefinition,
  type WorkflowJobStepDefinition,
  type WorkflowServiceStepDefinition,
  type WorkflowFanOutStepDefinition,
  type WorkflowFanOutTemplateDefinition,
  type JobRetryPolicy,
  type ServiceRecord,
  type ServiceStatus,
  type SecretReference,
  type WorkflowRunUpdateInput,
  type WorkflowAssetDeclaration,
  type WorkflowAssetFreshness,
  type WorkflowRunStepAssetRecord,
  type WorkflowRunStepAssetInput
} from './db/types';
import { getServiceBySlug } from './db/services';
import { fetchFromService } from './clients/serviceClient';
import { clearStepAssets, persistStepAssets } from './assets/assetEvents';
import { resolveSecret, maskSecret, describeSecret } from './secrets';
import {
  createJobRunForSlug,
  executeJobRun,
  WORKFLOW_BUNDLE_CONTEXT_KEY
} from './jobs/runtime';
import { logger } from './observability/logger';
import { handleWorkflowFailureAlert } from './observability/alerts';
import { buildWorkflowDagMetadata } from './workflows/dag';

function log(message: string, meta?: Record<string, unknown>) {
  const serialized = meta ? (meta as Record<string, JsonValue>) : undefined;
  logger.info(message, serialized);
}

type StepHistoryPayload = Record<string, JsonValue | null>;

type StepUpdateOptions = {
  eventType?: string;
  eventPayload?: StepHistoryPayload;
  heartbeat?: boolean;
};

async function appendRunHistoryEvent(
  run: WorkflowRunRecord,
  event: string,
  payload: StepHistoryPayload = {}
): Promise<void> {
  await appendWorkflowExecutionHistory({
    workflowRunId: run.id,
    eventType: `run.${event}`,
    eventPayload: {
      status: run.status,
      currentStepId: run.currentStepId ?? null,
      currentStepIndex: run.currentStepIndex ?? null,
      ...payload
    }
  });
}

async function appendStepHistoryEvent(
  step: WorkflowRunStepRecord,
  event: string,
  payload: StepHistoryPayload = {}
): Promise<void> {
  await appendWorkflowExecutionHistory({
    workflowRunId: step.workflowRunId,
    workflowRunStepId: step.id,
    stepId: step.stepId,
    eventType: `step.${event}`,
    eventPayload: {
      status: step.status,
      attempt: step.attempt,
      retryCount: step.retryCount,
      lastHeartbeatAt: step.lastHeartbeatAt,
      ...payload
    }
  });
}

async function applyStepUpdateWithHistory(
  step: WorkflowRunStepRecord,
  updates: WorkflowRunStepUpdateInput,
  options: StepUpdateOptions = {}
): Promise<WorkflowRunStepRecord> {
  const effectiveUpdates: WorkflowRunStepUpdateInput = { ...updates };
  if (
    options.heartbeat !== false &&
    !Object.prototype.hasOwnProperty.call(effectiveUpdates, 'lastHeartbeatAt')
  ) {
    effectiveUpdates.lastHeartbeatAt = new Date().toISOString();
  }
  const updated = await updateWorkflowRunStep(step.id, effectiveUpdates);
  const next = updated ?? step;
  if (options.eventType) {
    await appendStepHistoryEvent(next, options.eventType, options.eventPayload);
  }
  return next;
}

async function recordStepHeartbeat(step: WorkflowRunStepRecord): Promise<WorkflowRunStepRecord> {
  return applyStepUpdateWithHistory(step, {}, { eventType: 'heartbeat' });
}

type WorkflowStepServiceContext = {
  slug: string;
  status: ServiceStatus;
  method: string;
  path: string;
  baseUrl?: string | null;
  statusCode?: number | null;
  latencyMs?: number | null;
};

type StepAssetRuntimeSummary = {
  assetId: string;
  producedAt: string | null;
  partitionKey?: string | null;
  payload?: JsonValue | null;
  schema?: JsonValue | null;
  freshness?: WorkflowAssetFreshness | null;
};

type WorkflowStepRuntimeContext = {
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

type WorkflowRuntimeContext = {
  steps: Record<string, WorkflowStepRuntimeContext>;
  lastUpdatedAt: string;
  shared?: Record<string, JsonValue | null>;
};

type FanOutRuntimeMetadata = {
  parentStepId: string;
  templateStepId: string;
  index: number;
  item: JsonValue;
};

type StepExecutionResult = {
  context: WorkflowRuntimeContext;
  stepStatus: WorkflowRunStepStatus;
  completed: boolean;
  stepPatch: WorkflowStepRuntimeContext;
  sharedPatch?: Record<string, JsonValue | null>;
  errorMessage?: string | null;
  fanOut?: FanOutExpansion;
};

type FanOutChildStep = {
  definition: WorkflowStepDefinition;
  fanOut: FanOutRuntimeMetadata;
};

type FanOutExpansion = {
  parentStepId: string;
  parentRunStepId: string;
  storeKey?: string;
  maxConcurrency: number;
  templateStepId: string;
  childSteps: FanOutChildStep[];
};

type RuntimeStep = {
  definition: WorkflowStepDefinition;
  index: number;
  fanOut?: FanOutRuntimeMetadata;
};

type FanOutChildAggregate = {
  index: number;
  stepId: string;
  item: JsonValue;
  status: WorkflowRunStepStatus;
  output: JsonValue | null;
  errorMessage?: string | null;
  assets?: StepAssetRuntimeSummary[];
};

type FanOutState = {
  parentStepId: string;
  parentRunStepId: string;
  storeKey?: string;
  maxConcurrency: number;
  templateStepId: string;
  childStepIds: string[];
  pending: Set<string>;
  active: Set<string>;
  results: Map<string, FanOutChildAggregate>;
};

type TemplateScope = {
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
  fanout?: {
    parentStepId: string;
    templateStepId: string;
    index: number;
    item: JsonValue;
  };
  item?: JsonValue;
};

const TEMPLATE_PATTERN = /\$?{{\s*([^}]+)\s*}}/g;
const LEGACY_SIMPLE_TEMPLATE_PATTERN = /^(?:\$)([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)$/;
const LEGACY_INLINE_TEMPLATE_PATTERN = /\$([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)/g;

const FANOUT_GLOBAL_MAX_ITEMS = Math.max(
  1,
  Math.min(10_000, Number.parseInt(process.env.WORKFLOW_FANOUT_MAX_ITEMS ?? '100', 10) || 100)
);

const FANOUT_GLOBAL_MAX_CONCURRENCY = Math.max(
  1,
  Math.min(1_000, Number.parseInt(process.env.WORKFLOW_FANOUT_MAX_CONCURRENCY ?? '10', 10) || 10)
);

function buildTemplateScope(run: WorkflowRunRecord, context: WorkflowRuntimeContext): TemplateScope {
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

function withStepScope(
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
    next.fanout = {
      parentStepId: fanOut.parentStepId,
      templateStepId: fanOut.templateStepId,
      index: fanOut.index,
      item: fanOut.item
    };
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

function templateValueToString(value: unknown): string {
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
  const alias = applyLegacyExpressionAliases(trimmed);
  if (alias !== trimmed) {
    const aliased = lookupTemplateValue(scope, alias);
    if (aliased !== undefined) {
      return postProcessLegacyValue(trimmed, aliased);
    }
  }
  return undefined;
}

function resolveTemplateString(input: string, scope: TemplateScope): JsonValue {
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

    const replacedWithTemplates = input.replace(TEMPLATE_PATTERN, (_match, expr) => {
      const value = resolveTemplateExpression(expr, scope);
      return templateValueToString(value);
    });
    return replacedWithTemplates as JsonValue;
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

function resolveJsonTemplates(value: JsonValue, scope: TemplateScope): JsonValue {
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

type PreparedServiceRequest = {
  method: string;
  path: string;
  fullPath: string;
  query: Record<string, string | number | boolean>;
  headers: Headers;
  sanitizedHeaders: Record<string, string>;
  requestInput: JsonValue;
  hasBody: boolean;
  bodyText?: string;
  bodyForRecord?: JsonValue | null;
  captureResponse: boolean;
  storeResponseAs?: string;
  timeoutMs?: number | null;
};

const loadedHandlers = new Set<string>();

async function ensureJobHandler(slug: string): Promise<void> {
  if (loadedHandlers.has(slug)) {
    return;
  }
  switch (slug) {
    case 'repository-ingest':
      await import('./ingestionWorker');
      loadedHandlers.add(slug);
      break;
    case 'repository-build':
      await import('./buildRunner');
      loadedHandlers.add(slug);
      break;
    case 'fs-read-file':
    case 'fs-write-file':
      await import('./jobs/filesystem');
      loadedHandlers.add('fs-read-file');
      loadedHandlers.add('fs-write-file');
      break;
    default:
      loadedHandlers.add(slug);
  }
}

function isJsonObject(value: JsonValue | null | undefined): value is Record<string, JsonValue> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeAssetFreshness(value: unknown): WorkflowAssetFreshness | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const freshness: WorkflowAssetFreshness = {};

  const maxAge = record.maxAgeMs ?? record.max_age_ms;
  if (typeof maxAge === 'number' && Number.isFinite(maxAge) && maxAge > 0) {
    freshness.maxAgeMs = Math.floor(maxAge);
  }

  const ttl = record.ttlMs ?? record.ttl_ms;
  if (typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0) {
    freshness.ttlMs = Math.floor(ttl);
  }

  const cadence = record.cadenceMs ?? record.cadence_ms;
  if (typeof cadence === 'number' && Number.isFinite(cadence) && cadence > 0) {
    freshness.cadenceMs = Math.floor(cadence);
  }

  return Object.keys(freshness).length > 0 ? freshness : null;
}

function toRuntimeAssetSummaries(
  records: WorkflowRunStepAssetRecord[] | undefined
): StepAssetRuntimeSummary[] | undefined {
  if (!records || records.length === 0) {
    return undefined;
  }
  return records.map((record) => ({
    assetId: record.assetId,
    producedAt: record.producedAt ?? null,
    partitionKey: record.partitionKey ?? null,
    payload: (record.payload ?? null) as JsonValue | null,
    schema: (record.schema ?? null) as JsonValue | null,
    freshness: record.freshness ?? null
  }));
}

function parseRuntimeAssets(value: JsonValue | null | undefined): StepAssetRuntimeSummary[] | undefined {
  if (!value) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }

  const summaries: StepAssetRuntimeSummary[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, JsonValue>;
    const assetId = typeof record.assetId === 'string' ? record.assetId.trim() : '';
    if (!assetId) {
      continue;
    }
    const producedAtRaw = record.producedAt ?? record.produced_at;
    let producedAt: string | null = null;
    if (typeof producedAtRaw === 'string' && producedAtRaw.trim().length > 0) {
      const parsed = new Date(producedAtRaw);
      producedAt = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }

    const partitionRaw = record.partitionKey ?? record.partition_key;
    const partitionKey =
      typeof partitionRaw === 'string' && partitionRaw.trim().length > 0
        ? partitionRaw.trim()
        : null;

    const schemaValue = record.schema ?? record.assetSchema ?? record.asset_schema;
    const schema =
      schemaValue && typeof schemaValue === 'object' && !Array.isArray(schemaValue)
        ? (schemaValue as JsonValue)
        : null;

    const freshnessValue = record.freshness ?? record.assetFreshness ?? record.asset_freshness;
    const freshness = normalizeAssetFreshness(freshnessValue);

    const payloadValue = record.payload ?? null;
    const payload = (payloadValue ?? null) as JsonValue | null;

    summaries.push({
      assetId,
      producedAt,
      partitionKey,
      payload,
      schema,
      freshness
    });
  }

  return summaries.length > 0 ? summaries : undefined;
}

type ExtractAssetOptions = {
  defaultPartitionKey?: string | null;
};

function extractProducedAssetsFromResult(
  step: WorkflowStepDefinition,
  result: JsonValue | null,
  options: ExtractAssetOptions = {}
): WorkflowRunStepAssetInput[] {
  if (!result || !Array.isArray(step.produces) || step.produces.length === 0) {
    return [];
  }

  const declarations = new Map<string, WorkflowAssetDeclaration>();
  for (const declaration of step.produces) {
    if (!declaration || typeof declaration.assetId !== 'string') {
      continue;
    }
    const normalized = declaration.assetId.trim();
    if (!normalized) {
      continue;
    }
    declarations.set(normalized.toLowerCase(), declaration);
  }

  if (declarations.size === 0) {
    return [];
  }

  const outputs = new Map<string, WorkflowRunStepAssetInput>();
  const defaultPartitionKey =
    typeof options.defaultPartitionKey === 'string' && options.defaultPartitionKey.trim().length > 0
      ? options.defaultPartitionKey.trim()
      : null;

  const applyAsset = (rawAssetId: string, value: unknown) => {
    const normalizedKey = rawAssetId.trim().toLowerCase();
    if (!normalizedKey) {
      return;
    }
    const declaration = declarations.get(normalizedKey);
    if (!declaration) {
      return;
    }

    const assetId = declaration.assetId;
    const input: WorkflowRunStepAssetInput = {
      assetId
    };

    let partitionKey: string | null = null;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;

      if (Object.prototype.hasOwnProperty.call(record, 'payload')) {
        const payloadValue = record.payload as JsonValue | null | undefined;
        input.payload = (payloadValue ?? null) as JsonValue | null;
      } else {
        const clone = { ...record };
        delete clone.assetId;
        delete clone.asset_id;
        delete clone.schema;
        delete clone.assetSchema;
        delete clone.asset_schema;
        delete clone.freshness;
        delete clone.assetFreshness;
        delete clone.asset_freshness;
        delete clone.producedAt;
        delete clone.produced_at;
        delete clone.partitionKey;
        delete clone.partition_key;
        if (Object.keys(clone).length > 0) {
          input.payload = clone as unknown as JsonValue;
        }
      }

      const schemaValue = record.schema ?? record.assetSchema ?? record.asset_schema;
      if (schemaValue && typeof schemaValue === 'object' && !Array.isArray(schemaValue)) {
        input.schema = schemaValue as JsonValue;
      }

      const freshnessValue = record.freshness ?? record.assetFreshness ?? record.asset_freshness;
      const freshness = normalizeAssetFreshness(freshnessValue);
      if (freshness) {
        input.freshness = freshness;
      }

      const producedAtValue = record.producedAt ?? record.produced_at;
      if (typeof producedAtValue === 'string' && producedAtValue.trim().length > 0) {
        const parsed = new Date(producedAtValue);
        if (!Number.isNaN(parsed.getTime())) {
          input.producedAt = parsed.toISOString();
        }
      }

      const partitionValue = record.partitionKey ?? record.partition_key;
      if (typeof partitionValue === 'string' && partitionValue.trim().length > 0) {
        partitionKey = partitionValue.trim();
      }
    } else if (value !== undefined) {
      input.payload = (value ?? null) as JsonValue | null;
    }

    if (!input.schema && declaration.schema) {
      input.schema = declaration.schema;
    }
    if (!input.freshness && declaration.freshness) {
      input.freshness = declaration.freshness;
    }

    if (declaration.partitioning) {
      if (!partitionKey && defaultPartitionKey) {
        partitionKey = defaultPartitionKey;
      }
      if (!partitionKey) {
        throw new Error(`Partition key required for asset ${assetId}`);
      }
      input.partitionKey = partitionKey;
    } else if (partitionKey) {
      input.partitionKey = partitionKey;
    }

    const dedupeKey = `${normalizedKey}::${input.partitionKey ?? ''}`;
    outputs.set(dedupeKey, {
      assetId,
      payload: input.payload ?? null,
      schema: input.schema ?? null,
      freshness: input.freshness ?? null,
      partitionKey: input.partitionKey ?? null,
      producedAt: input.producedAt
    });
  };

  const container = isJsonObject(result) && 'assets' in result ? (result.assets as JsonValue) : result;

  if (Array.isArray(container)) {
    for (const entry of container) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const assetId = typeof record.assetId === 'string' ? record.assetId : typeof record.asset_id === 'string' ? record.asset_id : '';
      if (!assetId) {
        continue;
      }
      applyAsset(assetId, record);
    }
  } else if (isJsonObject(container)) {
    const record = container as Record<string, unknown>;
    const directAssetId =
      typeof record.assetId === 'string'
        ? record.assetId
        : typeof record.asset_id === 'string'
          ? record.asset_id
          : '';
    if (directAssetId) {
      applyAsset(directAssetId, record);
    } else {
      for (const [key, value] of Object.entries(record)) {
        if (typeof value === 'object' && value && !Array.isArray(value)) {
          applyAsset(key, value as Record<string, unknown>);
        }
      }
    }
  }

  return Array.from(outputs.values()).map((output) => {
    const declaration = declarations.get(output.assetId.toLowerCase());
    const next: WorkflowRunStepAssetInput = { ...output };
    if (!next.schema && declaration?.schema) {
      next.schema = declaration.schema;
    }
    if (!next.freshness && declaration?.freshness) {
      next.freshness = declaration.freshness;
    }
    return next;
  });
}
function parseServiceRuntimeContext(value: JsonValue | null | undefined): WorkflowStepServiceContext | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const slug = typeof value.slug === 'string' ? value.slug : null;
  const status = typeof value.status === 'string' ? (value.status as ServiceStatus) : null;
  if (!slug || !status) {
    return undefined;
  }
  const context: WorkflowStepServiceContext = {
    slug,
    status,
    method: typeof value.method === 'string' ? value.method : 'GET',
    path: typeof value.path === 'string' ? value.path : '/'
  };
  if (typeof value.baseUrl === 'string') {
    context.baseUrl = value.baseUrl;
  }
  if (typeof value.statusCode === 'number' && Number.isFinite(value.statusCode)) {
    context.statusCode = value.statusCode;
  }
  if (typeof value.latencyMs === 'number' && Number.isFinite(value.latencyMs)) {
    context.latencyMs = value.latencyMs;
  }
  return context;
}

function toWorkflowContext(raw: JsonValue | null | undefined): WorkflowRuntimeContext {
  if (isJsonObject(raw)) {
    const stepsValue = raw.steps;
    const steps: Record<string, WorkflowStepRuntimeContext> = {};
    const sharedValue = raw.shared;
    let shared: Record<string, JsonValue | null> | undefined;
    if (isJsonObject(stepsValue)) {
      for (const [key, entry] of Object.entries(stepsValue)) {
        if (!isJsonObject(entry)) {
          continue;
        }
        const normalized: WorkflowStepRuntimeContext = {
          status: (typeof entry.status === 'string' ? (entry.status as WorkflowRunStepStatus) : 'pending') ?? 'pending',
          jobRunId: typeof entry.jobRunId === 'string' ? entry.jobRunId : null,
          result: (entry.result as JsonValue | null | undefined) ?? null,
          errorMessage: typeof entry.errorMessage === 'string' ? entry.errorMessage : null,
          logsUrl: typeof entry.logsUrl === 'string' ? entry.logsUrl : null,
          metrics: (entry.metrics as JsonValue | null | undefined) ?? null,
          startedAt: typeof entry.startedAt === 'string' ? entry.startedAt : null,
          completedAt: typeof entry.completedAt === 'string' ? entry.completedAt : null,
          attempt: typeof entry.attempt === 'number' ? entry.attempt : undefined
        };
        const serviceContext = parseServiceRuntimeContext(entry.service as JsonValue | null | undefined);
        if (serviceContext) {
          normalized.service = serviceContext;
        }
        const assets = parseRuntimeAssets(entry.assets as JsonValue | null | undefined);
        if (assets) {
          normalized.assets = assets;
        }
        steps[key] = normalized;
      }
    }
    if (isJsonObject(sharedValue)) {
      const sharedRecord: Record<string, JsonValue | null> = {};
      for (const [key, value] of Object.entries(sharedValue)) {
        sharedRecord[key] = (value as JsonValue | null | undefined) ?? null;
      }
      if (Object.keys(sharedRecord).length > 0) {
        shared = sharedRecord;
      }
    }
    return {
      steps,
      lastUpdatedAt: typeof raw.lastUpdatedAt === 'string' ? raw.lastUpdatedAt : new Date().toISOString(),
      shared
    };
  }
  return {
    steps: {},
    lastUpdatedAt: new Date().toISOString()
  };
}

function serializeContext(context: WorkflowRuntimeContext): JsonValue {
  const payload: Record<string, JsonValue> = {
    steps: context.steps as unknown as JsonValue,
    lastUpdatedAt: context.lastUpdatedAt
  };
  if (context.shared) {
    payload.shared = context.shared as unknown as JsonValue;
  }
  return payload as unknown as JsonValue;
}

function resolveWorkflowOutput(context: WorkflowRuntimeContext): JsonValue | null {
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
  return snapshot as unknown as JsonValue;
}

function updateStepContext(
  context: WorkflowRuntimeContext,
  stepId: string,
  patch: Partial<WorkflowStepRuntimeContext>
): WorkflowRuntimeContext {
  const next: WorkflowRuntimeContext = {
    steps: { ...context.steps },
    lastUpdatedAt: new Date().toISOString(),
    shared: context.shared ? { ...context.shared } : undefined
  };
  const previous = next.steps[stepId] ?? { status: 'pending', jobRunId: null };
  next.steps[stepId] = {
    ...previous,
    ...patch
  };
  return next;
}

function setSharedValue(
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

async function applyRunContextPatch(
  runId: string,
  stepId: string,
  patch: Partial<WorkflowStepRuntimeContext> | null,
  options: {
    shared?: Record<string, JsonValue | null>;
    metrics?: { totalSteps: number; completedSteps: number };
    status?: WorkflowRunStatus;
    errorMessage?: string | null;
    currentStepId?: string | null;
    currentStepIndex?: number | null;
    startedAt?: string | null;
    completedAt?: string | null;
    durationMs?: number | null;
  } = {}
): Promise<void> {
  const update: WorkflowRunUpdateInput = {};
  if (patch || options.shared) {
    update.contextPatch = {};
    if (patch) {
      update.contextPatch.steps = { [stepId]: patch };
    }
    if (options.shared) {
      update.contextPatch.shared = options.shared;
    }
  }
  if (options.metrics) {
    update.metrics = {
      totalSteps: options.metrics.totalSteps,
      completedSteps: options.metrics.completedSteps
    } as JsonValue;
  }
  if (options.status) {
    update.status = options.status;
  }
  if (options.errorMessage !== undefined) {
    update.errorMessage = options.errorMessage;
  }
  if (options.currentStepId !== undefined) {
    update.currentStepId = options.currentStepId;
  }
  if (options.currentStepIndex !== undefined) {
    update.currentStepIndex = options.currentStepIndex;
  }
  if (options.startedAt !== undefined) {
    update.startedAt = options.startedAt;
  }
  if (options.completedAt !== undefined) {
    update.completedAt = options.completedAt;
  }
  if (options.durationMs !== undefined) {
    update.durationMs = options.durationMs;
  }

  if (Object.keys(update).length === 0) {
    return;
  }

  await updateWorkflowRun(runId, update);
}

function mergeParameters(
  runParameters: JsonValue,
  stepParameters: JsonValue | null | undefined
): JsonValue {
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

function calculateRetryDelay(attempt: number, policy: JobRetryPolicy | null | undefined): number {
  if (!policy || attempt <= 1) {
    return 0;
  }

  const strategy = policy.strategy ?? 'fixed';
  const baseDelay = policy.initialDelayMs ?? 1_000;
  let delay = 0;

  switch (strategy) {
    case 'none':
      delay = 0;
      break;
    case 'exponential':
      delay = baseDelay * Math.pow(2, attempt - 2);
      break;
    case 'fixed':
    default:
      delay = baseDelay;
      break;
  }

  if (policy.maxDelayMs !== undefined && policy.maxDelayMs !== null && policy.maxDelayMs >= 0) {
    delay = Math.min(delay, policy.maxDelayMs);
  }

  if (!Number.isFinite(delay) || delay <= 0) {
    return 0;
  }

  return Math.floor(delay);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer === 'object' && typeof (timer as NodeJS.Timeout).unref === 'function') {
      (timer as NodeJS.Timeout).unref();
    }
  });
}

function jobStatusToStepStatus(status: JobRunStatus): WorkflowRunStepStatus {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'skipped';
    case 'expired':
      return 'failed';
    case 'running':
    case 'pending':
    default:
      return 'running';
  }
}

function resolveRunConcurrency(
  definition: WorkflowDefinitionRecord,
  run: WorkflowRunRecord,
  steps: WorkflowStepDefinition[]
): number {
  const envValue = Number(process.env.WORKFLOW_MAX_PARALLEL ?? process.env.WORKFLOW_CONCURRENCY ?? 1);
  let limit = Number.isFinite(envValue) && envValue > 0 ? Math.floor(envValue) : 1;

  const metadata = definition.metadata;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const scheduler = (metadata as Record<string, unknown>).scheduler;
    if (scheduler && typeof scheduler === 'object' && !Array.isArray(scheduler)) {
      const metaValue = Number((scheduler as Record<string, unknown>).maxParallel);
      if (Number.isFinite(metaValue) && metaValue > 0) {
        limit = Math.floor(metaValue);
      }
    }
  }

  const parameters = run.parameters;
  if (parameters && typeof parameters === 'object' && !Array.isArray(parameters)) {
    const paramRecord = parameters as Record<string, unknown>;
    const overrideValue = Number(
      paramRecord.workflowConcurrency ?? paramRecord.maxConcurrency ?? paramRecord.concurrency
    );
    if (Number.isFinite(overrideValue) && overrideValue > 0) {
      limit = Math.floor(overrideValue);
    }
  }

  const maxAllowed = Math.max(1, steps.length);
  return Math.max(1, Math.min(limit, maxAllowed));
}

async function ensureRunIsStartable(run: WorkflowRunRecord, steps: WorkflowStepDefinition[]) {
  if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'canceled') {
    return run;
  }
  if (run.status === 'running' && run.startedAt) {
    return run;
  }
  const startedAt = run.startedAt ?? new Date().toISOString();
  const metrics = { totalSteps: steps.length, completedSteps: 0 } as JsonValue;
  const updated = await updateWorkflowRun(run.id, {
    status: 'running',
    startedAt,
    metrics
  });
  if (updated) {
    await appendRunHistoryEvent(updated, 'status', {
      previousStatus: run.status,
      startedAt
    });
    return updated;
  }
  return (await getWorkflowRunById(run.id)) ?? run;
}

async function recordRunFailure(
  runId: string,
  errorMessage: string,
  context: WorkflowRuntimeContext,
  totals: { totalSteps: number; completedSteps: number },
  startedAt: number
) {
  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startedAt;
  const updated = await updateWorkflowRun(runId, {
    status: 'failed',
    errorMessage,
    context: serializeContext(context),
    completedAt,
    durationMs,
    metrics: { totalSteps: totals.totalSteps, completedSteps: totals.completedSteps }
  });
  const latest = updated ?? (await getWorkflowRunById(runId));
  if (latest) {
    await appendRunHistoryEvent(latest, 'status', {
      failure: errorMessage,
      completedAt,
      durationMs
    });
    await handleWorkflowFailureAlert(latest);
  }
}

async function recordRunSuccess(
  runId: string,
  context: WorkflowRuntimeContext,
  totals: { totalSteps: number; completedSteps: number },
  startedAt: number,
  output: JsonValue | null
) {
  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startedAt;
  const updated = await updateWorkflowRun(runId, {
    status: 'succeeded',
    context: serializeContext(context),
    output,
    completedAt,
    durationMs,
    metrics: { totalSteps: totals.totalSteps, completedSteps: totals.completedSteps }
  });
  const latest = updated ?? (await getWorkflowRunById(runId));
  if (latest) {
    await appendRunHistoryEvent(latest, 'status', {
      completedAt,
      durationMs
    });
  }
}

async function loadOrCreateStepRecord(
  runId: string,
  step: WorkflowStepDefinition,
  inputParameters: JsonValue,
  options: {
    parentStepId?: string | null;
    fanoutIndex?: number | null;
    templateStepId?: string | null;
  } = {}
): Promise<WorkflowRunStepRecord> {
  const existing = await getWorkflowRunStep(runId, step.id);
  if (existing) {
    if (existing.status === 'pending' || existing.status === 'running') {
      return existing;
    }
    if (existing.status === 'succeeded') {
      return existing;
    }
    if (existing.status === 'failed' || existing.status === 'skipped') {
      return existing;
    }
  }
  const created = await createWorkflowRunStep(runId, {
    stepId: step.id,
    status: 'running',
    input: inputParameters,
    startedAt: new Date().toISOString(),
    parentStepId: options.parentStepId ?? null,
    fanoutIndex: options.fanoutIndex ?? null,
    templateStepId: options.templateStepId ?? null
  });
  await appendStepHistoryEvent(created, 'status', {
    previousStatus: 'created',
    status: 'running',
    startedAt: created.startedAt
  });
  return created;
}

function cloneServiceQuery(query?: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  if (!query) {
    return {};
  }
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(query)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[normalizedKey] = value;
    }
  }
  return result;
}

function appendQuery(path: string, query: Record<string, string | number | boolean>): string {
  const entries = Object.entries(query);
  if (entries.length === 0) {
    return path;
  }
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    params.append(key, String(value));
  }
  const hasQuery = path.includes('?');
  const separator = hasQuery ? (path.endsWith('?') || path.endsWith('&') ? '' : '&') : '?';
  const queryString = params.toString();
  return queryString.length > 0 ? `${path}${separator}${queryString}` : path;
}

function normalizeQueryValue(value: JsonValue): string | number | boolean {
  if (value === null) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return templateValueToString(value);
}

function createMinimalServiceContext(
  step: WorkflowServiceStepDefinition,
  prepared: PreparedServiceRequest | null,
  service: ServiceRecord | null
): WorkflowStepServiceContext {
  return {
    slug: service?.slug ?? step.serviceSlug,
    status: service?.status ?? 'unknown',
    method: prepared?.method ?? (step.request.method ?? 'GET'),
    path: prepared?.fullPath ?? step.request.path,
    baseUrl: service?.baseUrl ?? null,
    statusCode: undefined,
    latencyMs: undefined
  };
}

function buildServiceContextFromPrepared(
  step: WorkflowServiceStepDefinition,
  prepared: PreparedServiceRequest,
  service: ServiceRecord | null,
  extras?: { statusCode?: number | null; latencyMs?: number | null; baseUrl?: string | null }
): WorkflowStepServiceContext {
  const context = createMinimalServiceContext(step, prepared, service);
  if (extras?.baseUrl !== undefined) {
    context.baseUrl = extras.baseUrl ?? null;
  }
  if (extras?.statusCode !== undefined) {
    context.statusCode = extras.statusCode ?? null;
  }
  if (extras?.latencyMs !== undefined) {
    context.latencyMs = extras.latencyMs ?? null;
  }
  return context;
}

function serviceContextToJson(context: WorkflowStepServiceContext): JsonValue {
  const payload: Record<string, JsonValue> = {
    slug: context.slug,
    status: context.status,
    method: context.method,
    path: context.path
  };
  if (context.baseUrl !== undefined && context.baseUrl !== null) {
    payload.baseUrl = context.baseUrl;
  }
  if (context.statusCode !== undefined && context.statusCode !== null) {
    payload.statusCode = context.statusCode;
  }
  if (context.latencyMs !== undefined && context.latencyMs !== null) {
    payload.latencyMs = context.latencyMs;
  }
  return { service: payload } as JsonValue;
}

function buildServiceMetrics(options: {
  step: WorkflowServiceStepDefinition;
  service: ServiceRecord | null;
  statusCode: number | null;
  latencyMs: number | null;
  responseSize?: number | null;
  truncated?: boolean;
  attempt: number;
}): JsonValue {
  const serviceInfo: Record<string, JsonValue> = {
    slug: options.service?.slug ?? options.step.serviceSlug,
    status: options.service?.status ?? 'unknown',
    attempt: options.attempt
  };
  if (options.statusCode !== null && options.statusCode !== undefined) {
    serviceInfo.statusCode = options.statusCode;
  }
  if (options.latencyMs !== null && options.latencyMs !== undefined) {
    serviceInfo.latencyMs = options.latencyMs;
  }
  if (options.responseSize !== null && options.responseSize !== undefined) {
    serviceInfo.responseSizeBytes = options.responseSize;
  }
  if (options.truncated !== undefined) {
    serviceInfo.truncated = options.truncated;
  }
  if (options.service?.baseUrl) {
    serviceInfo.baseUrl = options.service.baseUrl;
  }
  return { service: serviceInfo } as JsonValue;
}

function isServiceAvailable(service: ServiceRecord, step: WorkflowServiceStepDefinition): boolean {
  if (service.status === 'healthy') {
    return true;
  }
  const requireHealthy = step.requireHealthy ?? true;
  if (!requireHealthy && (service.status === 'degraded' || service.status === 'unknown')) {
    return step.allowDegraded ?? false;
  }
  return false;
}

function createStepAbortSignal(timeoutMs?: number | null): AbortSignal | undefined {
  if (!timeoutMs || timeoutMs <= 0) {
    return undefined;
  }
  if (typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer === 'object' && typeof (timer as NodeJS.Timeout).unref === 'function') {
    (timer as NodeJS.Timeout).unref();
  }
  controller.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
    },
    { once: true }
  );
  return controller.signal;
}

const MAX_RESPONSE_CHARS = 8_192;

async function extractResponseBody(response: Response): Promise<{ body: JsonValue | string | null; truncated: boolean; size: number }> {
  try {
    const rawText = await response.text();
    const size = rawText.length;
    const truncated = rawText.length > MAX_RESPONSE_CHARS;
    const snippet = truncated ? rawText.slice(0, MAX_RESPONSE_CHARS) : rawText;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        return { body: JSON.parse(snippet) as JsonValue, truncated, size };
      } catch {
        return { body: snippet, truncated, size };
      }
    }
    return { body: snippet, truncated, size };
  } catch {
    return { body: null, truncated: false, size: 0 };
  }
}

async function prepareServiceRequest(
  run: WorkflowRunRecord,
  step: WorkflowServiceStepDefinition,
  parameters: JsonValue,
  scope: TemplateScope
): Promise<PreparedServiceRequest> {
  const scoped = withStepScope(scope, step.id, parameters);
  const request = step.request;
  const query = cloneServiceQuery(request.query);
  const hasExplicitBody = Object.prototype.hasOwnProperty.call(request, 'body');
  const runHasBody = isJsonObject(parameters) ? Object.keys(parameters as Record<string, JsonValue>).length > 0 : parameters !== null;
  const defaultMethod = hasExplicitBody || runHasBody ? 'POST' : 'GET';
  const methodCandidate = request.method ? request.method.toUpperCase() : undefined;
  const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
  const method = allowedMethods.includes(methodCandidate ?? '') ? (methodCandidate as PreparedServiceRequest['method']) : (defaultMethod as PreparedServiceRequest['method']);

  const headers = new Headers();
  const sanitizedHeaders: Record<string, string> = {};

  if (request.headers) {
    for (const [headerName, headerValue] of Object.entries(request.headers)) {
      const name = headerName.trim();
      if (!name) {
        continue;
      }
      if (typeof headerValue === 'string') {
        const resolvedHeader = resolveTemplateString(headerValue, scoped);
        const headerText = templateValueToString(resolvedHeader);
        headers.set(name, headerText);
        sanitizedHeaders[name] = headerText;
        continue;
      }
      const secretRef = headerValue?.secret;
      if (!secretRef) {
        continue;
      }
      const resolved = resolveSecret(secretRef as SecretReference, {
        actor: `workflow-run:${run.id}`,
        actorType: 'workflow',
        metadata: {
          workflowDefinitionId: run.workflowDefinitionId,
          workflowRunId: run.id,
          stepId: step.id,
          serviceSlug: step.serviceSlug,
          headerName: name
        }
      });
      if (!resolved.value) {
        throw new Error(`Secret ${describeSecret(secretRef as SecretReference)} not found for header ${name}`);
      }
      const prefix = typeof headerValue.prefix === 'string' ? headerValue.prefix : '';
      const finalValue = `${prefix}${resolved.value}`;
      headers.set(name, finalValue);
      sanitizedHeaders[name] = maskSecret(finalValue);
    }
  }

  if (!headers.has('accept')) {
    headers.set('accept', 'application/json');
    sanitizedHeaders['accept'] = 'application/json';
  }

  let hasBody = false;
  let bodyForRecord: JsonValue | null = null;
  if (hasExplicitBody) {
    bodyForRecord = resolveJsonTemplates(((request.body ?? null) as JsonValue) ?? null, scoped);
    hasBody = method !== 'GET' && method !== 'HEAD';
  } else if (method !== 'GET' && method !== 'HEAD') {
    bodyForRecord = parameters ?? null;
    hasBody = true;
  }

  let bodyText: string | undefined;
  if (hasBody) {
    bodyText = JSON.stringify(bodyForRecord ?? null);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
      sanitizedHeaders['content-type'] = 'application/json';
    }
  }

  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') {
      const resolved = resolveTemplateString(value, scoped);
      query[key] = normalizeQueryValue(resolved);
    }
  }

  const resolvedPathValue = resolveTemplateString(request.path, scoped);
  const requestPath = templateValueToString(resolvedPathValue) || request.path;
  const fullPath = appendQuery(requestPath, query);

  const requestInput: Record<string, JsonValue> = {
    method,
    path: requestPath
  };
  if (Object.keys(query).length > 0) {
    requestInput.query = { ...query } as unknown as JsonValue;
  }
  if (Object.keys(sanitizedHeaders).length > 0) {
    requestInput.headers = { ...sanitizedHeaders } as unknown as JsonValue;
  }
  if (hasBody) {
    requestInput.body = (bodyForRecord ?? null) as JsonValue;
  }

  return {
    method,
    path: requestPath,
    fullPath,
    query,
    headers,
    sanitizedHeaders,
    requestInput: requestInput as JsonValue,
    hasBody,
    bodyText,
    bodyForRecord: bodyForRecord ?? null,
    captureResponse: step.captureResponse ?? true,
    storeResponseAs: step.storeResponseAs,
    timeoutMs: step.timeoutMs ?? null
  };
}

type ServiceInvocationResult = {
  success: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  responseBody: JsonValue | string | null;
  truncated: boolean;
  responseSize: number | null;
  baseUrl: string | null;
  errorMessage?: string;
};

async function invokePreparedService(
  service: ServiceRecord,
  prepared: PreparedServiceRequest
): Promise<ServiceInvocationResult> {
  const abortSignal = createStepAbortSignal(prepared.timeoutMs ?? undefined);
  const init: RequestInit & { signal?: AbortSignal } = {
    method: prepared.method,
    headers: prepared.headers,
    body: prepared.hasBody ? prepared.bodyText : undefined
  };
  if (abortSignal) {
    init.signal = abortSignal;
  }

  const start = Date.now();
  try {
    const { response, baseUrl: resolvedBaseUrl } = await fetchFromService(
      service,
      prepared.fullPath,
      init
    );
    const latencyMs = Date.now() - start;
    const statusCode = response.status;

    if (!prepared.captureResponse) {
      response.body?.cancel?.();
      return {
        success: statusCode >= 200 && statusCode < 300,
        statusCode,
        latencyMs,
        responseBody: null,
        truncated: false,
        responseSize: null,
        baseUrl: resolvedBaseUrl
      };
    }

    const extracted = await extractResponseBody(response);
    const success = statusCode >= 200 && statusCode < 300;
    return {
      success,
      statusCode,
      latencyMs,
      responseBody: extracted.body,
      truncated: extracted.truncated,
      responseSize: extracted.size,
      baseUrl: resolvedBaseUrl
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const errorMessage = err instanceof Error ? err.message : 'Service invocation failed';
    return {
      success: false,
      statusCode: null,
      latencyMs,
      responseBody: null,
      truncated: false,
      responseSize: null,
      baseUrl: null,
      errorMessage
    };
  }
}

function extractServiceContextFromRecord(
  stepRecord: WorkflowRunStepRecord,
  fallback: WorkflowStepServiceContext
): WorkflowStepServiceContext {
  const contextValue = stepRecord.context as JsonValue | null;
  if (contextValue && typeof contextValue === 'object' && !Array.isArray(contextValue)) {
    const serviceValue = (contextValue as Record<string, JsonValue>).service as JsonValue | null | undefined;
    const parsed = parseServiceRuntimeContext(serviceValue);
    if (parsed) {
      return parsed;
    }
  }
  return fallback;
}

async function executeStep(
  run: WorkflowRunRecord,
  definition: WorkflowDefinitionRecord,
  step: WorkflowStepDefinition,
  context: WorkflowRuntimeContext,
  stepIndex: number,
  runtimeStep?: RuntimeStep
): Promise<StepExecutionResult> {
  const dependencies = step.dependsOn ?? [];
  const blocked = dependencies.filter((dependencyId) => {
    const summary = context.steps[dependencyId];
    return !summary || summary.status !== 'succeeded';
  });
  if (blocked.length > 0) {
    throw new Error(
      `Step ${step.id} is blocked by incomplete dependencies: ${blocked.join(', ')}`
    );
  }

  const baseScope = buildTemplateScope(run, context);

  if (step.type === 'fanout') {
    const fanOutScope = runtimeStep?.fanOut
      ? withStepScope(baseScope, step.id, null, runtimeStep.fanOut)
      : withStepScope(baseScope, step.id, null);
    return executeFanOutStep(run, definition, step, context, stepIndex, null, fanOutScope);
  }

  const mergedParameters = mergeParameters(run.parameters, step.parameters ?? null);
  const resolutionScope = runtimeStep?.fanOut
    ? withStepScope(baseScope, step.id, mergedParameters as JsonValue, runtimeStep.fanOut)
    : withStepScope(baseScope, step.id, mergedParameters as JsonValue);
  const resolvedParameters = resolveJsonTemplates(mergedParameters as JsonValue, resolutionScope);
  const stepScope = runtimeStep?.fanOut
    ? withStepScope(baseScope, step.id, resolvedParameters, runtimeStep.fanOut)
    : withStepScope(baseScope, step.id, resolvedParameters);

  if (step.type === 'service') {
    return executeServiceStep(run, definition, step, context, stepIndex, resolvedParameters, stepScope, runtimeStep?.fanOut);
  }

  return executeJobStep(run, definition, step, context, stepIndex, resolvedParameters, runtimeStep?.fanOut);
}

async function executeFanOutStep(
  run: WorkflowRunRecord,
  definition: WorkflowDefinitionRecord,
  step: WorkflowFanOutStepDefinition,
  context: WorkflowRuntimeContext,
  stepIndex: number,
  _parameters: JsonValue,
  scope: TemplateScope
): Promise<StepExecutionResult> {
  const evaluatedCollection = resolveJsonTemplates(step.collection as JsonValue, scope);
  const collectionInput = (evaluatedCollection ?? null) as JsonValue;

  let stepRecord = await loadOrCreateStepRecord(run.id, step, collectionInput);
  const startedAt = stepRecord.startedAt ?? new Date().toISOString();

  const fail = async (message: string): Promise<StepExecutionResult> => {
    const completedAt = new Date().toISOString();
    const previousStatus = stepRecord.status;
    stepRecord = await applyStepUpdateWithHistory(
      stepRecord,
      {
        status: 'failed',
        errorMessage: message,
        completedAt,
        startedAt
      },
      {
        eventType: 'status',
        eventPayload: {
          previousStatus,
          status: 'failed',
          errorMessage: message,
          completedAt
        }
      }
    );

    const failureContext = updateStepContext(context, step.id, {
      status: 'failed',
      jobRunId: null,
      result: null,
      errorMessage: message,
      logsUrl: null,
      metrics: null,
      startedAt,
      completedAt,
      attempt: stepRecord.attempt ?? 1
    });

    await applyRunContextPatch(run.id, step.id, failureContext.steps[step.id], {
      currentStepId: step.id,
      currentStepIndex: stepIndex,
      errorMessage: message
    });

    return {
      context: failureContext,
      stepStatus: 'failed',
      completed: true,
      stepPatch: failureContext.steps[step.id],
      errorMessage: message
    } satisfies StepExecutionResult;
  };

  if (!Array.isArray(evaluatedCollection)) {
    return fail('Fan-out collection must resolve to an array');
  }

  const items = evaluatedCollection as JsonValue[];
  const configuredMaxItems =
    typeof step.maxItems === 'number' && Number.isFinite(step.maxItems) && step.maxItems > 0
      ? Math.floor(step.maxItems)
      : FANOUT_GLOBAL_MAX_ITEMS;
  const maxItems = Math.max(0, Math.min(FANOUT_GLOBAL_MAX_ITEMS, configuredMaxItems));

  if (items.length > maxItems) {
    return fail(
      `Fan-out step "${step.id}" attempted to generate ${items.length} items which exceeds the limit of ${maxItems}`
    );
  }

  const requestedConcurrency =
    typeof step.maxConcurrency === 'number' && Number.isFinite(step.maxConcurrency) && step.maxConcurrency > 0
      ? Math.floor(step.maxConcurrency)
      : FANOUT_GLOBAL_MAX_CONCURRENCY;
  const maxConcurrency = Math.max(
    1,
    Math.min(items.length === 0 ? 1 : items.length, requestedConcurrency, FANOUT_GLOBAL_MAX_CONCURRENCY)
  );

  const fanOutMetrics = { fanOut: { totalChildren: items.length } } as JsonValue;
  const wasRunning = stepRecord.status === 'running';
  const statusPayload: StepHistoryPayload = {
    status: 'running',
    startedAt,
    metrics: fanOutMetrics
  };
  if (!wasRunning) {
    statusPayload.previousStatus = stepRecord.status;
  }
  stepRecord = await applyStepUpdateWithHistory(
    stepRecord,
    {
      status: 'running',
      startedAt,
      metrics: fanOutMetrics,
      input: collectionInput
    },
    {
      eventType: wasRunning ? 'heartbeat' : 'status',
      eventPayload: statusPayload
    }
  );

  let nextContext = updateStepContext(context, step.id, {
    status: 'running',
    jobRunId: null,
    result: fanOutMetrics,
    errorMessage: null,
    logsUrl: null,
    metrics: fanOutMetrics,
    startedAt,
    completedAt: null,
    attempt: stepRecord.attempt ?? 1
  });

  let sharedPatch: Record<string, JsonValue | null> | undefined;
  if (step.storeResultsAs) {
    const placeholder = [] as JsonValue[];
    nextContext = setSharedValue(nextContext, step.storeResultsAs, placeholder as unknown as JsonValue);
    sharedPatch = { [step.storeResultsAs]: placeholder as unknown as JsonValue };
  }

  await applyRunContextPatch(run.id, step.id, nextContext.steps[step.id], {
    shared: sharedPatch,
    currentStepId: step.id,
    currentStepIndex: stepIndex
  });

  const parentDependencies = Array.isArray(step.dependsOn) ? step.dependsOn.filter(Boolean) : [];
  const templateDependencies = Array.isArray(step.template.dependsOn)
    ? step.template.dependsOn.filter(Boolean)
    : [];
  const baseDependencies = Array.from(
    new Set([...parentDependencies, ...templateDependencies].filter((dep) => dep !== step.id))
  );

  const childSteps: FanOutChildStep[] = items.map((item, index) => {
    const childId = generateFanOutChildId(step.id, step.template.id, index);
    const childNameBase = step.template.name ?? step.template.id;
    const childName = `${childNameBase} [${index + 1}]`;
    const metadata: FanOutRuntimeMetadata = {
      parentStepId: step.id,
      templateStepId: step.template.id,
      index,
      item
    };

    if (step.template.type === 'service') {
      const { dependents: _ignored, ...rest } = step.template;
      const definition: WorkflowServiceStepDefinition = {
        ...rest,
        id: childId,
        name: childName,
        dependsOn: baseDependencies.length > 0 ? baseDependencies : undefined
      };
      return {
        definition,
        fanOut: metadata
      } satisfies FanOutChildStep;
    }

    const { dependents: _ignoredJob, ...restJob } = step.template;
    const definition: WorkflowJobStepDefinition = {
      ...restJob,
      id: childId,
      name: childName,
      dependsOn: baseDependencies.length > 0 ? baseDependencies : undefined
    };
    return {
      definition,
      fanOut: metadata
    } satisfies FanOutChildStep;
  });

  return {
    context: nextContext,
    stepStatus: 'running',
    completed: false,
    stepPatch: nextContext.steps[step.id],
    sharedPatch,
    fanOut: {
      parentStepId: step.id,
      parentRunStepId: stepRecord.id,
      storeKey: step.storeResultsAs ?? undefined,
      maxConcurrency,
      templateStepId: step.template.id,
      childSteps
    }
  } satisfies StepExecutionResult;
}

function generateFanOutChildId(parentStepId: string, templateStepId: string, index: number): string {
  const normalize = (value: string) => value.replace(/[^a-z0-9-_:.]/gi, '-');
  const safeParent = normalize(parentStepId);
  const safeTemplate = normalize(templateStepId);
  return `${safeParent}:${safeTemplate}:${index + 1}`;
}

async function executeJobStep(
  run: WorkflowRunRecord,
  definition: WorkflowDefinitionRecord,
  step: WorkflowJobStepDefinition,
  context: WorkflowRuntimeContext,
  stepIndex: number,
  parameters: JsonValue,
  fanOutMeta?: FanOutRuntimeMetadata
): Promise<StepExecutionResult> {
  let stepRecord = await loadOrCreateStepRecord(run.id, step, parameters, {
    parentStepId: fanOutMeta?.parentStepId ?? null,
    fanoutIndex: fanOutMeta?.index ?? null,
    templateStepId: fanOutMeta?.templateStepId ?? null
  });

  if (stepRecord.status === 'succeeded') {
    let nextContext = updateStepContext(context, step.id, {
      status: stepRecord.status,
      jobRunId: stepRecord.jobRunId,
      result: stepRecord.output,
      errorMessage: stepRecord.errorMessage,
      logsUrl: stepRecord.logsUrl,
      metrics: stepRecord.metrics,
      startedAt: stepRecord.startedAt,
      completedAt: stepRecord.completedAt,
      attempt: stepRecord.attempt,
      assets: toRuntimeAssetSummaries(stepRecord.producedAssets)
    });
    let sharedPatch: Record<string, JsonValue | null> | undefined;
    if (step.storeResultAs) {
      const storedValue = (stepRecord.output ?? null) as JsonValue | null;
      nextContext = setSharedValue(nextContext, step.storeResultAs, storedValue);
      sharedPatch = { [step.storeResultAs]: storedValue };
    }
    return {
      context: nextContext,
      stepStatus: 'succeeded',
      completed: true,
      stepPatch: nextContext.steps[step.id],
      sharedPatch,
      errorMessage: stepRecord.errorMessage ?? null
    } satisfies StepExecutionResult;
  }

  const startedAt = stepRecord.startedAt ?? new Date().toISOString();
  if (stepRecord.status !== 'running') {
    const previousStatus = stepRecord.status;
    stepRecord = await applyStepUpdateWithHistory(
      stepRecord,
      {
        status: 'running',
        startedAt,
        input: parameters
      },
      {
        eventType: 'status',
        eventPayload: {
          previousStatus,
          status: 'running',
          startedAt
        }
      }
    );
    await clearStepAssets({ run, stepId: step.id, stepRecordId: stepRecord.id });
    stepRecord = { ...stepRecord, producedAssets: [] };
  } else {
    stepRecord = await recordStepHeartbeat(stepRecord);
  }

  let nextContext = updateStepContext(context, step.id, {
    status: 'running',
    jobRunId: stepRecord.jobRunId,
    startedAt,
    attempt: stepRecord.attempt,
    result: stepRecord.output ?? null,
    errorMessage: stepRecord.errorMessage ?? null,
    logsUrl: stepRecord.logsUrl ?? null,
    metrics: stepRecord.metrics ?? null,
    completedAt: stepRecord.completedAt ?? null,
    assets: toRuntimeAssetSummaries(stepRecord.producedAssets)
  });

  await applyRunContextPatch(run.id, step.id, nextContext.steps[step.id], {
    currentStepId: step.id,
    currentStepIndex: stepIndex
  });

  await ensureJobHandler(step.jobSlug);

  let bundleOverrideContext: Record<string, JsonValue> | undefined;
  if (step.bundle && step.bundle.strategy !== 'latest') {
    const version = typeof step.bundle.version === 'string' ? step.bundle.version.trim() : '';
    const slug = step.bundle.slug?.trim().toLowerCase() ?? '';
    if (slug && version) {
      const exportNameValue =
        typeof step.bundle.exportName === 'string' && step.bundle.exportName.trim().length > 0
          ? step.bundle.exportName.trim()
          : null;
      bundleOverrideContext = {
        [WORKFLOW_BUNDLE_CONTEXT_KEY]: {
          slug,
          version,
          exportName: exportNameValue
        }
      } satisfies Record<string, JsonValue>;
    }
  }

  const jobRun = await createJobRunForSlug(step.jobSlug, {
    parameters,
    timeoutMs: step.timeoutMs ?? null,
    maxAttempts: step.retryPolicy?.maxAttempts ?? null,
    context: bundleOverrideContext
  });

  stepRecord = await applyStepUpdateWithHistory(
    stepRecord,
    {
      jobRunId: jobRun.id
    },
    {
      eventType: 'heartbeat',
      eventPayload: {
        jobRunId: jobRun.id,
        reason: 'job-run-linked'
      }
    }
  );

  const executed = await executeJobRun(jobRun.id);
  if (!executed) {
    throw new Error(`Job run ${jobRun.id} not found after execution`);
  }

  const stepStatus = jobStatusToStepStatus(executed.status);
  const completedAt = executed.completedAt ?? new Date().toISOString();

  const previousStatus = stepRecord.status;
  stepRecord = await applyStepUpdateWithHistory(
    stepRecord,
    {
      status: stepStatus,
      output: executed.result ?? null,
      errorMessage: executed.errorMessage ?? null,
      logsUrl: executed.logsUrl ?? null,
      metrics: executed.metrics ?? null,
      context: executed.context ?? null,
      completedAt,
      startedAt: executed.startedAt ?? startedAt,
      jobRunId: executed.id
    },
    {
      eventType: 'status',
      eventPayload: {
        previousStatus,
        status: stepStatus,
        completedAt,
        jobRunStatus: executed.status,
        failure: executed.errorMessage ?? null
      }
    }
  );

  if (stepRecord.status === 'succeeded') {
    const assetInputs = extractProducedAssetsFromResult(step, executed.result ?? null, {
      defaultPartitionKey: run.partitionKey
    });
    const storedAssets = await persistStepAssets({
      definition,
      run,
      stepId: step.id,
      stepRecordId: stepRecord.id,
      assets: assetInputs
    });
    stepRecord = { ...stepRecord, producedAssets: storedAssets };
  } else if (stepRecord.status === 'failed' || stepRecord.status === 'skipped') {
    await clearStepAssets({ run, stepId: step.id, stepRecordId: stepRecord.id });
    stepRecord = { ...stepRecord, producedAssets: [] };
  }

  nextContext = updateStepContext(nextContext, step.id, {
    status: stepRecord.status,
    jobRunId: executed.id,
    result: executed.result ?? null,
    errorMessage: executed.errorMessage ?? null,
    logsUrl: executed.logsUrl ?? null,
    metrics: executed.metrics ?? null,
    startedAt: executed.startedAt ?? startedAt,
    completedAt,
    assets: toRuntimeAssetSummaries(stepRecord.producedAssets)
  });

  if (stepRecord.status === 'succeeded') {
    let successContext = nextContext;
    let sharedPatch: Record<string, JsonValue | null> | undefined;
    if (step.storeResultAs) {
      const storedValue = (executed.result ?? null) as JsonValue | null;
      successContext = setSharedValue(successContext, step.storeResultAs, storedValue);
      sharedPatch = { [step.storeResultAs]: storedValue };
    }
    await applyRunContextPatch(run.id, step.id, successContext.steps[step.id], {
      shared: sharedPatch
    });
    return {
      context: successContext,
      stepStatus: stepRecord.status,
      completed: true,
      stepPatch: successContext.steps[step.id],
      sharedPatch,
      errorMessage: null
    } satisfies StepExecutionResult;
  }

  return {
    context: nextContext,
    stepStatus: stepRecord.status,
    completed: false,
    stepPatch: nextContext.steps[step.id],
    errorMessage: stepRecord.errorMessage ?? null
  } satisfies StepExecutionResult;
}

async function executeServiceStep(
  run: WorkflowRunRecord,
  definition: WorkflowDefinitionRecord,
  step: WorkflowServiceStepDefinition,
  context: WorkflowRuntimeContext,
  stepIndex: number,
  parameters: JsonValue,
  scope: TemplateScope,
  fanOutMeta?: FanOutRuntimeMetadata
): Promise<StepExecutionResult> {
  let prepared: PreparedServiceRequest;
  try {
    prepared = await prepareServiceRequest(run, step, parameters, scope);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to prepare service request';
    let stepRecord = await loadOrCreateStepRecord(run.id, step, parameters);
    const startedAt = stepRecord.startedAt ?? new Date().toISOString();
    const completedAt = new Date().toISOString();
    const attempt = stepRecord.attempt ?? 1;
    const metrics = buildServiceMetrics({ step, service: null, statusCode: null, latencyMs: null, attempt });
    const previousStatus = stepRecord.status;
    stepRecord = await applyStepUpdateWithHistory(
      stepRecord,
      {
        status: 'failed',
        startedAt,
        completedAt,
        errorMessage,
        metrics
      },
      {
        eventType: 'status',
        eventPayload: {
          previousStatus,
          status: 'failed',
          errorMessage,
          completedAt
        }
      }
    );

    await clearStepAssets({ run, stepId: step.id, stepRecordId: stepRecord.id });
    stepRecord = { ...stepRecord, producedAssets: [] };

    const failureContext = updateStepContext(context, step.id, {
      status: 'failed',
      jobRunId: null,
      startedAt,
      completedAt,
      attempt,
      errorMessage,
      metrics,
      service: createMinimalServiceContext(step, null, null),
      assets: toRuntimeAssetSummaries(stepRecord.producedAssets)
    });

    await applyRunContextPatch(run.id, step.id, failureContext.steps[step.id], {
      currentStepId: step.id,
      currentStepIndex: stepIndex
    });

    return {
      context: failureContext,
      stepStatus: 'failed',
      completed: false,
      stepPatch: failureContext.steps[step.id],
      errorMessage
    } satisfies StepExecutionResult;
  }

  let stepRecord = await loadOrCreateStepRecord(run.id, step, prepared.requestInput, {
    parentStepId: fanOutMeta?.parentStepId ?? null,
    fanoutIndex: fanOutMeta?.index ?? null,
    templateStepId: fanOutMeta?.templateStepId ?? null
  });

  if (stepRecord.status === 'succeeded') {
    const fallbackContext = buildServiceContextFromPrepared(step, prepared, null);
    const serviceContext = extractServiceContextFromRecord(stepRecord, fallbackContext);
    let nextContext = updateStepContext(context, step.id, {
      status: 'succeeded',
      jobRunId: null,
      result: stepRecord.output ?? null,
      errorMessage: stepRecord.errorMessage ?? null,
      logsUrl: stepRecord.logsUrl ?? null,
      metrics: stepRecord.metrics ?? null,
      startedAt: stepRecord.startedAt ?? null,
      completedAt: stepRecord.completedAt ?? null,
      attempt: stepRecord.attempt,
      service: serviceContext,
      assets: toRuntimeAssetSummaries(stepRecord.producedAssets)
    });
    let sharedPatch: Record<string, JsonValue | null> | undefined;
    if (step.storeResponseAs) {
      const storedResponse = (stepRecord.output ?? null) as JsonValue | null;
      nextContext = setSharedValue(nextContext, step.storeResponseAs, storedResponse);
      sharedPatch = { [step.storeResponseAs]: storedResponse };
    }
    return {
      context: nextContext,
      stepStatus: 'succeeded',
      completed: true,
      stepPatch: nextContext.steps[step.id],
      sharedPatch,
      errorMessage: stepRecord.errorMessage ?? null
    } satisfies StepExecutionResult;
  }

  const startedAt = stepRecord.startedAt ?? new Date().toISOString();
  if (stepRecord.status !== 'running') {
    const previousStatus = stepRecord.status;
    stepRecord = await applyStepUpdateWithHistory(
      stepRecord,
      {
        status: 'running',
        startedAt,
        input: prepared.requestInput
      },
      {
        eventType: 'status',
        eventPayload: {
          previousStatus,
          status: 'running',
          startedAt
        }
      }
    );
    await clearStepAssets({ run, stepId: step.id, stepRecordId: stepRecord.id });
    stepRecord = { ...stepRecord, producedAssets: [] };
  } else {
    stepRecord = await recordStepHeartbeat(stepRecord);
  }

  let nextContext = updateStepContext(context, step.id, {
    status: 'running',
    jobRunId: null,
    startedAt,
    attempt: stepRecord.attempt,
    result: stepRecord.output ?? null,
    errorMessage: stepRecord.errorMessage ?? null,
    logsUrl: stepRecord.logsUrl ?? null,
    metrics: stepRecord.metrics ?? null,
    completedAt: stepRecord.completedAt ?? null,
    service: createMinimalServiceContext(step, prepared, null),
    assets: toRuntimeAssetSummaries(stepRecord.producedAssets)
  });

  await applyRunContextPatch(run.id, step.id, nextContext.steps[step.id], {
    currentStepId: step.id,
    currentStepIndex: stepIndex
  });

  const maxAttempts = Math.max(1, step.retryPolicy?.maxAttempts ?? 1);
  const initialAttempt = Math.max(stepRecord.attempt ?? 1, 1);
  let finalContext = nextContext;
  let lastErrorMessage: string | null = null;
  let lastMetrics: JsonValue | null = stepRecord.metrics ?? null;
  let lastServiceContext = createMinimalServiceContext(step, prepared, null);

  for (let attempt = initialAttempt; attempt <= maxAttempts; attempt++) {
    if (attempt > initialAttempt) {
      const delayMs = calculateRetryDelay(attempt, step.retryPolicy ?? null);
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }

    const isRetry = attempt > initialAttempt;
    stepRecord = await applyStepUpdateWithHistory(
      stepRecord,
      {
        attempt,
        input: prepared.requestInput
      },
      {
        eventType: isRetry ? 'retry' : 'heartbeat',
        eventPayload: {
          attempt,
          reason: isRetry ? 'retry-attempt' : 'attempt-initial'
        }
      }
    );

    const service = await getServiceBySlug(step.serviceSlug);
    const serviceContext = buildServiceContextFromPrepared(step, prepared, service ?? null);
    lastServiceContext = serviceContext;

    finalContext = updateStepContext(finalContext, step.id, {
      attempt,
      service: serviceContext
    });

    await applyRunContextPatch(run.id, step.id, finalContext.steps[step.id]);

    if (!service) {
      lastErrorMessage = `Service "${step.serviceSlug}" not found`;
      lastMetrics = buildServiceMetrics({ step, service: null, statusCode: null, latencyMs: null, attempt });
      stepRecord = await applyStepUpdateWithHistory(
        stepRecord,
        {
          errorMessage: lastErrorMessage,
          metrics: lastMetrics,
          context: serviceContextToJson(serviceContext)
        },
        {
          eventType: 'heartbeat',
          eventPayload: {
            reason: 'service-missing',
            errorMessage: lastErrorMessage,
            metrics: lastMetrics
          }
        }
      );
      finalContext = updateStepContext(finalContext, step.id, {
        errorMessage: lastErrorMessage,
        metrics: lastMetrics,
        service: serviceContext
      });
      if (attempt < maxAttempts) {
        continue;
      }
      break;
    }

    if (!isServiceAvailable(service, step)) {
      lastErrorMessage = `Service ${service.slug} unavailable (status: ${service.status})`;
      lastMetrics = buildServiceMetrics({ step, service, statusCode: null, latencyMs: null, attempt });
      stepRecord = await applyStepUpdateWithHistory(
        stepRecord,
        {
          errorMessage: lastErrorMessage,
          metrics: lastMetrics,
          context: serviceContextToJson(serviceContext)
        },
        {
          eventType: 'heartbeat',
          eventPayload: {
            reason: 'service-unavailable',
            errorMessage: lastErrorMessage,
            metrics: lastMetrics,
            serviceStatus: service.status
          }
        }
      );
      finalContext = updateStepContext(finalContext, step.id, {
        errorMessage: lastErrorMessage,
        metrics: lastMetrics,
        service: serviceContext
      });
      if (attempt < maxAttempts) {
        continue;
      }
      break;
    }

    const invocation = await invokePreparedService(service, prepared);
    const serviceContextWithMetrics = buildServiceContextFromPrepared(step, prepared, service, {
      statusCode: invocation.statusCode,
      latencyMs: invocation.latencyMs,
      baseUrl: invocation.baseUrl
    });
    lastServiceContext = serviceContextWithMetrics;

    lastMetrics = buildServiceMetrics({
      step,
      service,
      statusCode: invocation.statusCode,
      latencyMs: invocation.latencyMs,
      responseSize: invocation.responseSize,
      truncated: invocation.truncated,
      attempt
    });

    stepRecord = await applyStepUpdateWithHistory(
      stepRecord,
      {
        metrics: lastMetrics,
        context: serviceContextToJson(serviceContextWithMetrics)
      },
      {
        eventType: 'heartbeat',
        eventPayload: {
          reason: 'service-invocation',
          metrics: lastMetrics,
          statusCode: invocation.statusCode,
          latencyMs: invocation.latencyMs
        }
      }
    );

    if (invocation.success) {
      const completedAt = new Date().toISOString();
      const output = prepared.captureResponse ? (invocation.responseBody ?? null) : null;

      const previousStatus = stepRecord.status;
      stepRecord = await applyStepUpdateWithHistory(
        stepRecord,
        {
          status: 'succeeded',
          output,
          errorMessage: null,
          metrics: lastMetrics,
          completedAt
        },
        {
          eventType: 'status',
          eventPayload: {
            previousStatus,
            status: 'succeeded',
            completedAt,
            serviceStatus: invocation.statusCode,
            latencyMs: invocation.latencyMs
          }
        }
      );

      const assetInputs = extractProducedAssetsFromResult(step, output, {
        defaultPartitionKey: run.partitionKey
      });
      const storedAssets = await persistStepAssets({
        definition,
        run,
        stepId: step.id,
        stepRecordId: stepRecord.id,
        assets: assetInputs
      });
      stepRecord = { ...stepRecord, producedAssets: storedAssets };

      let successContext = updateStepContext(finalContext, step.id, {
        status: 'succeeded',
        jobRunId: null,
        result: output,
        errorMessage: null,
        metrics: lastMetrics,
        completedAt,
        service: serviceContextWithMetrics,
        assets: toRuntimeAssetSummaries(stepRecord.producedAssets)
      });

      let sharedPatch: Record<string, JsonValue | null> | undefined;
      if (prepared.storeResponseAs && prepared.captureResponse) {
        const storedResponse = (output ?? null) as JsonValue | null;
        successContext = setSharedValue(successContext, prepared.storeResponseAs, storedResponse);
        sharedPatch = { [prepared.storeResponseAs]: storedResponse };
      }

      await applyRunContextPatch(run.id, step.id, successContext.steps[step.id], {
        shared: sharedPatch
      });

      return {
        context: successContext,
        stepStatus: 'succeeded',
        completed: true,
        stepPatch: successContext.steps[step.id],
        sharedPatch,
        errorMessage: null
      } satisfies StepExecutionResult;
    }

    lastErrorMessage =
      invocation.errorMessage ??
      (invocation.statusCode !== null
        ? `Service responded with status ${invocation.statusCode}`
        : 'Service invocation failed');

    stepRecord = await applyStepUpdateWithHistory(
      stepRecord,
      {
        errorMessage: lastErrorMessage,
        metrics: lastMetrics,
        context: serviceContextToJson(serviceContextWithMetrics)
      },
      {
        eventType: 'heartbeat',
        eventPayload: {
          reason: 'service-error',
          errorMessage: lastErrorMessage,
          metrics: lastMetrics,
          statusCode: invocation.statusCode
        }
      }
    );

    finalContext = updateStepContext(finalContext, step.id, {
      errorMessage: lastErrorMessage,
      metrics: lastMetrics,
      service: serviceContextWithMetrics
    });

    if (attempt < maxAttempts) {
      continue;
    }

    break;
  }

  const failureCompletedAt = new Date().toISOString();
  const failureMessage = lastErrorMessage ?? 'Service invocation failed';
  const failureMetrics = lastMetrics ?? buildServiceMetrics({
    step,
    service: null,
    statusCode: null,
    latencyMs: null,
    attempt: stepRecord.attempt ?? 1
  });

  const finalPreviousStatus = stepRecord.status;
  stepRecord = await applyStepUpdateWithHistory(
    stepRecord,
    {
      status: 'failed',
      completedAt: failureCompletedAt,
      errorMessage: failureMessage,
      metrics: failureMetrics,
      context: serviceContextToJson(lastServiceContext)
    },
    {
      eventType: 'status',
      eventPayload: {
        previousStatus: finalPreviousStatus,
        status: 'failed',
        completedAt: failureCompletedAt,
        errorMessage: failureMessage
      }
    }
  );

  await clearStepAssets({ run, stepId: step.id, stepRecordId: stepRecord.id });
  stepRecord = { ...stepRecord, producedAssets: [] };

  const failureContext = updateStepContext(finalContext, step.id, {
    status: 'failed',
    completedAt: failureCompletedAt,
    errorMessage: failureMessage,
    metrics: failureMetrics,
    service: lastServiceContext,
    assets: toRuntimeAssetSummaries(stepRecord.producedAssets)
  });

  await applyRunContextPatch(run.id, step.id, failureContext.steps[step.id]);

  return {
    context: failureContext,
    stepStatus: 'failed',
    completed: false,
    stepPatch: failureContext.steps[step.id],
    errorMessage: failureMessage
  } satisfies StepExecutionResult;
}

export async function runWorkflowOrchestration(workflowRunId: string): Promise<WorkflowRunRecord | null> {
  const startTime = Date.now();
  let run = await getWorkflowRunById(workflowRunId);
  if (!run) {
    log('Workflow run missing', { workflowRunId });
    return null;
  }

  const definition: WorkflowDefinitionRecord | null = await getWorkflowDefinitionById(run.workflowDefinitionId);
  if (!definition) {
    log('Workflow definition missing for run', {
      workflowRunId,
      workflowDefinitionId: run.workflowDefinitionId
    });
    await recordRunFailure(run.id, 'Workflow definition missing', {
      steps: {},
      lastUpdatedAt: new Date().toISOString()
    }, { totalSteps: 0, completedSteps: 0 }, startTime);
    return await getWorkflowRunById(run.id);
  }

  const steps = definition.steps ?? [];
  if (steps.length === 0) {
    const emptyContext: WorkflowRuntimeContext = { steps: {}, lastUpdatedAt: new Date().toISOString() };
    await recordRunSuccess(
      run.id,
      emptyContext,
      { totalSteps: 0, completedSteps: 0 },
      startTime,
      resolveWorkflowOutput(emptyContext)
    );
    return await getWorkflowRunById(run.id);
  }

  run = await ensureRunIsStartable(run, steps);
  let context = toWorkflowContext(run.context);
  let totals = { totalSteps: steps.length, completedSteps: 0 };

  try {
    const dag = definition.dag && Object.keys(definition.dag.adjacency ?? {}).length > 0
      ? definition.dag
      : buildWorkflowDagMetadata(steps);

    const runtimeSteps = new Map<string, RuntimeStep>();
    const dependenciesMap = new Map<string, Set<string>>();
    const dependentsMap = new Map<string, Set<string>>();
    let runtimeIndexCounter = 0;

    const ensureDependentsEntry = (stepId: string): Set<string> => {
      let dependents = dependentsMap.get(stepId);
      if (!dependents) {
        dependents = new Set<string>();
        dependentsMap.set(stepId, dependents);
      }
      return dependents;
    };

    for (const step of steps) {
      runtimeSteps.set(step.id, { definition: step, index: runtimeIndexCounter++ });
      const dependsOn = Array.isArray(step.dependsOn) ? step.dependsOn.filter(Boolean) : [];
      dependenciesMap.set(step.id, new Set(dependsOn));
      ensureDependentsEntry(step.id);
    }

    for (const [parentId, adjacencyDependents] of Object.entries(dag.adjacency ?? {})) {
      const dependentsSet = ensureDependentsEntry(parentId);
      for (const dependent of adjacencyDependents) {
        dependentsSet.add(dependent);
      }
    }

    for (const [stepId, dependencySet] of dependenciesMap.entries()) {
      for (const dependencyId of dependencySet) {
        ensureDependentsEntry(dependencyId).add(stepId);
      }
    }

    const fanOutStates = new Map<string, FanOutState>();

    const statusById = new Map<string, WorkflowRunStepStatus>();
    const readySet = new Set<string>();
    let readyQueue: string[] = [];
    const completedSteps = new Set<string>();

    for (const step of steps) {
      const existing = context.steps[step.id];
      if (existing?.status === 'succeeded') {
        statusById.set(step.id, 'succeeded');
        completedSteps.add(step.id);
      } else {
        statusById.set(step.id, 'pending');
        if (existing) {
          context = updateStepContext(context, step.id, {
            status: 'pending',
            jobRunId: null,
            result: null,
            errorMessage: null,
            logsUrl: null,
            metrics: null,
            startedAt: null,
            completedAt: null
          });
        }
        if (step.type === 'job' && step.storeResultAs) {
          context = setSharedValue(context, step.storeResultAs, null);
        }
        if (step.type === 'service' && step.storeResponseAs) {
          context = setSharedValue(context, step.storeResponseAs, null);
        }
        if (step.type === 'fanout' && step.storeResultsAs) {
          const placeholder = [] as JsonValue[];
          context = setSharedValue(context, step.storeResultsAs, placeholder as unknown as JsonValue);
        }
      }
    }

    totals.completedSteps = completedSteps.size;
    let remainingSteps = steps.length - completedSteps.size;

    const concurrencyLimit = resolveRunConcurrency(definition, run, steps);

    await updateWorkflowRun(run.id, {
      metrics: { totalSteps: totals.totalSteps, completedSteps: totals.completedSteps }
    });

    const canSchedule = (stepId: string): boolean => {
      const dependencies = dependenciesMap.get(stepId);
      if (!dependencies || dependencies.size === 0) {
        return true;
      }
      for (const dependencyId of dependencies) {
        if (statusById.get(dependencyId) !== 'succeeded') {
          return false;
        }
      }
      return true;
    };

    for (const step of steps) {
      if (statusById.get(step.id) === 'pending' && canSchedule(step.id)) {
        readyQueue.push(step.id);
        readySet.add(step.id);
      }
    }

    const inFlight = new Map<
      string,
      Promise<{ stepId: string; result?: StepExecutionResult; error?: unknown }>
    >();
    const activeSteps = new Set<string>();
    let failure: { stepId: string; message: string } | null = null;

    const updateRunMetrics = async () => {
      await updateWorkflowRun(run.id, {
        metrics: { totalSteps: totals.totalSteps, completedSteps: totals.completedSteps }
      });
    };

    const enqueueIfReady = (stepId: string) => {
      if (
        statusById.get(stepId) === 'pending' &&
        !readySet.has(stepId) &&
        !activeSteps.has(stepId) &&
        canSchedule(stepId)
      ) {
        readyQueue.push(stepId);
        readySet.add(stepId);
      }
    };

    const buildFanOutAggregatedResults = (state: FanOutState): JsonValue => {
      const ordered = state.childStepIds
        .map((childId) => state.results.get(childId))
        .filter((entry): entry is FanOutChildAggregate => Boolean(entry))
        .sort((a, b) => a.index - b.index)
        .map((entry) => ({
          stepId: entry.stepId,
          index: entry.index,
          status: entry.status,
          output: entry.output ?? null,
          errorMessage: entry.errorMessage ?? null,
          item: entry.item ?? null,
          assets: entry.assets ?? null
        }));
      return ordered as unknown as JsonValue;
    };

    const updateFanOutSharedValue = async (state: FanOutState) => {
      if (!state.storeKey) {
        return;
      }
      const aggregated = buildFanOutAggregatedResults(state);
      context = setSharedValue(context, state.storeKey, aggregated);
      await applyRunContextPatch(run.id, state.parentStepId, null, {
        shared: { [state.storeKey]: aggregated }
      });
    };

    const buildFanOutParentAssets = (
      state: FanOutState,
      parentDefinition: WorkflowFanOutStepDefinition
    ): WorkflowRunStepAssetInput[] => {
      if (!Array.isArray(parentDefinition.produces) || parentDefinition.produces.length === 0) {
        return [];
      }

      const inputs: WorkflowRunStepAssetInput[] = [];
      const declarationMap = new Map<string, WorkflowAssetDeclaration>();
      for (const declaration of parentDefinition.produces) {
        if (!declaration || typeof declaration.assetId !== 'string') {
          continue;
        }
        const normalized = declaration.assetId.trim().toLowerCase();
        if (!normalized) {
          continue;
        }
        declarationMap.set(normalized, declaration);
      }

      for (const [normalizedId, declaration] of declarationMap.entries()) {
        const sources: { aggregate: FanOutChildAggregate; asset: StepAssetRuntimeSummary }[] = [];
        for (const aggregate of state.results.values()) {
          if (!aggregate || !Array.isArray(aggregate.assets)) {
            continue;
          }
          for (const asset of aggregate.assets) {
            if (asset.assetId.trim().toLowerCase() === normalizedId) {
              sources.push({ aggregate, asset });
            }
          }
        }

        if (sources.length === 0) {
          continue;
        }

        const payloadSources = sources.map(({ aggregate, asset }) => ({
          stepId: aggregate.stepId,
          producedAt: asset.producedAt,
          payload: asset.payload ?? null
        }));

        let latestProducedAt: string | null = null;
        for (const { asset } of sources) {
          if (!asset.producedAt) {
            continue;
          }
          if (!latestProducedAt || asset.producedAt > latestProducedAt) {
            latestProducedAt = asset.producedAt;
          }
        }

        const input: WorkflowRunStepAssetInput = {
          assetId: declaration.assetId,
          payload: {
            sources: payloadSources
          } as unknown as JsonValue,
          schema: declaration.schema ?? null,
          freshness: declaration.freshness ?? null,
          producedAt: latestProducedAt
        };

        inputs.push(input);
      }

      return inputs;
    };

    const settleFanOutParent = async (state: FanOutState) => {
      const allResults = state.childStepIds.map((id) => state.results.get(id));
      if (allResults.length !== state.childStepIds.length) {
        return;
      }

      const completedAt = new Date().toISOString();
      const aggregated = buildFanOutAggregatedResults(state);
      const basePatch = {
        jobRunId: null,
        logsUrl: null,
        metrics: { fanOut: { totalChildren: state.childStepIds.length } } as JsonValue,
        startedAt: context.steps[state.parentStepId]?.startedAt ?? null,
        completedAt,
        attempt: context.steps[state.parentStepId]?.attempt
      };

      const anyFailed = allResults.some((entry) => !entry || entry.status !== 'succeeded');

      if (anyFailed) {
        const failedDetails = allResults
          .filter((entry): entry is FanOutChildAggregate => Boolean(entry))
          .filter((entry) => entry.status === 'failed')
          .map((entry) => ({
            stepId: entry.stepId,
            index: entry.index,
            errorMessage: entry.errorMessage ?? 'Child step failed'
          }));

        const message =
          failedDetails.length > 0
            ? `Fan-out step "${state.parentStepId}" failed: ${failedDetails
                .map((detail) => `${detail.stepId} (item ${detail.index + 1}): ${detail.errorMessage}`)
                .join('; ')}`
            : `Fan-out step "${state.parentStepId}" failed because one or more children did not succeed`;

        context = updateStepContext(context, state.parentStepId, {
          ...basePatch,
          status: 'failed',
          result: null,
          errorMessage: message,
          assets: []
        });

        statusById.set(state.parentStepId, 'failed');
        failure = { stepId: state.parentStepId, message };

        const parentRecord = await getWorkflowRunStepById(state.parentRunStepId);
        if (parentRecord) {
          await applyStepUpdateWithHistory(
            parentRecord,
            {
              status: 'failed',
              errorMessage: message,
              completedAt
            },
            {
              eventType: 'status',
              eventPayload: {
                previousStatus: parentRecord.status,
                status: 'failed',
                errorMessage: message,
                completedAt,
                reason: 'fanout-child-failure'
              }
            }
          );
        } else {
          await updateWorkflowRunStep(state.parentRunStepId, {
            status: 'failed',
            errorMessage: message,
            completedAt
          });
        }

        await clearStepAssets({
          run,
          stepId: state.parentStepId,
          stepRecordId: state.parentRunStepId
        });

        await applyRunContextPatch(run.id, state.parentStepId, context.steps[state.parentStepId], {
          errorMessage: message
        });
      } else {
        const parentResult = {
          totalChildren: state.childStepIds.length,
          results: aggregated
        } as JsonValue;

        statusById.set(state.parentStepId, 'succeeded');
        completedSteps.add(state.parentStepId);
        remainingSteps -= 1;
        totals.completedSteps += 1;

        const parentRecord = await getWorkflowRunStepById(state.parentRunStepId);
        if (parentRecord) {
          await applyStepUpdateWithHistory(
            parentRecord,
            {
              status: 'succeeded',
              output: parentResult,
              metrics: { fanOut: { totalChildren: state.childStepIds.length } } as JsonValue,
              completedAt
            },
            {
              eventType: 'status',
              eventPayload: {
                previousStatus: parentRecord.status,
                status: 'succeeded',
                completedAt,
                totalChildren: state.childStepIds.length
              }
            }
          );
        } else {
          await updateWorkflowRunStep(state.parentRunStepId, {
            status: 'succeeded',
            output: parentResult,
            metrics: { fanOut: { totalChildren: state.childStepIds.length } } as JsonValue,
            completedAt
          });
        }

        const parentRuntime = runtimeSteps.get(state.parentStepId);
        const parentDefinition =
          parentRuntime && parentRuntime.definition.type === 'fanout'
            ? (parentRuntime.definition as WorkflowFanOutStepDefinition)
            : null;

        let storedParentAssets: WorkflowRunStepAssetRecord[] = [];
        if (parentDefinition) {
          storedParentAssets = await persistStepAssets({
            definition,
            run,
            stepId: state.parentStepId,
            stepRecordId: state.parentRunStepId,
            assets: buildFanOutParentAssets(state, parentDefinition)
          });
        } else {
          await clearStepAssets({
            run,
            stepId: state.parentStepId,
            stepRecordId: state.parentRunStepId
          });
        }

        const parentAssetSummaries = toRuntimeAssetSummaries(storedParentAssets);

        context = updateStepContext(context, state.parentStepId, {
          ...basePatch,
          status: 'succeeded',
          result: parentResult,
          errorMessage: null,
          assets: parentAssetSummaries
        });

        await updateRunMetrics();

        for (const dependentId of dependentsMap.get(state.parentStepId) ?? []) {
          enqueueIfReady(dependentId);
        }
      }

      await updateFanOutSharedValue(state);
      fanOutStates.delete(state.parentStepId);
    };

    const registerFanOutExpansion = async (expansion: FanOutExpansion) => {
      const state: FanOutState = {
        parentStepId: expansion.parentStepId,
        parentRunStepId: expansion.parentRunStepId,
        storeKey: expansion.storeKey,
        maxConcurrency: Math.max(1, expansion.maxConcurrency),
        templateStepId: expansion.templateStepId,
        childStepIds: [],
        pending: new Set<string>(),
        active: new Set<string>(),
        results: new Map<string, FanOutChildAggregate>()
      };

      for (const child of expansion.childSteps) {
        const { definition, fanOut } = child;
        state.childStepIds.push(definition.id);

        const normalizedDependsOn = Array.isArray(definition.dependsOn)
          ? definition.dependsOn.filter(Boolean)
          : [];
        definition.dependsOn = normalizedDependsOn.length > 0 ? normalizedDependsOn : undefined;

        runtimeSteps.set(definition.id, { definition, index: runtimeIndexCounter++, fanOut });
        dependenciesMap.set(definition.id, new Set(normalizedDependsOn));
        ensureDependentsEntry(definition.id);

        for (const dependencyId of normalizedDependsOn) {
          ensureDependentsEntry(dependencyId).add(definition.id);
        }

        const existingContext = context.steps[definition.id];
        const existingStatus = existingContext?.status ?? 'pending';

        if (existingStatus === 'succeeded') {
          statusById.set(definition.id, 'succeeded');
          completedSteps.add(definition.id);
          totals.totalSteps += 1;
          totals.completedSteps += 1;
        state.results.set(definition.id, {
          index: fanOut.index,
          stepId: definition.id,
          item: fanOut.item,
          status: 'succeeded',
          output: existingContext?.result ?? null,
          errorMessage: existingContext?.errorMessage ?? null,
          assets: existingContext?.assets
        });
        } else {
          statusById.set(definition.id, 'pending');
          totals.totalSteps += 1;
          remainingSteps += 1;
          state.pending.add(definition.id);
          enqueueIfReady(definition.id);
        }
      }

      fanOutStates.set(expansion.parentStepId, state);
      await updateRunMetrics();

      if (state.storeKey) {
        await updateFanOutSharedValue(state);
      }

      if (state.pending.size === 0) {
        await settleFanOutParent(state);
      }
    };

    const handleFanOutChildCompletion = async (
      stepId: string,
      runtime: RuntimeStep,
      result: StepExecutionResult
    ) => {
      const fanOutMeta = runtime.fanOut;
      if (!fanOutMeta) {
        return;
      }
      const state = fanOutStates.get(fanOutMeta.parentStepId);
      if (!state) {
        return;
      }
      state.active.delete(stepId);
      state.pending.delete(stepId);
      state.results.set(stepId, {
        index: fanOutMeta.index,
        stepId,
        item: fanOutMeta.item,
        status: result.stepStatus,
        output: result.stepPatch.result ?? null,
        errorMessage: result.errorMessage ?? null,
        assets: result.stepPatch.assets ?? undefined
      });

      if (state.storeKey) {
        await updateFanOutSharedValue(state);
      }

      if (state.pending.size === 0) {
        await settleFanOutParent(state);
      }
    };

    const scheduleStep = (stepId: string, runtimeOverride?: RuntimeStep) => {
      if (statusById.get(stepId) !== 'pending' || failure) {
        return;
      }
      readySet.delete(stepId);
      statusById.set(stepId, 'running');
      activeSteps.add(stepId);
      const runtime = runtimeOverride ?? runtimeSteps.get(stepId);
      if (!runtime) {
        failure = { stepId, message: `Unknown step ${stepId}` };
        return;
      }
      const contextClone = toWorkflowContext(serializeContext(context));
      const wrapped = executeStep(run, definition, runtime.definition, contextClone, runtime.index, runtime)
        .then((result) => ({ stepId, result }))
        .catch((error) => ({ stepId, error }));
      inFlight.set(stepId, wrapped);
    };

    const trySchedule = () => {
      if (failure) {
        return;
      }
      const deferred: string[] = [];
      while (!failure && inFlight.size < concurrencyLimit && readyQueue.length > 0) {
        const nextStepId = readyQueue.shift();
        if (!nextStepId) {
          break;
        }
        const runtime = runtimeSteps.get(nextStepId);
        if (!runtime) {
          failure = { stepId: nextStepId, message: `Unknown step ${nextStepId}` };
          break;
        }
        if (statusById.get(nextStepId) !== 'pending') {
          readySet.delete(nextStepId);
          continue;
        }
        const fanOutMeta = runtime.fanOut;
        if (fanOutMeta) {
          const state = fanOutStates.get(fanOutMeta.parentStepId);
          if (state) {
            if (state.active.size >= state.maxConcurrency) {
              deferred.push(nextStepId);
              continue;
            }
            state.active.add(nextStepId);
          }
        }
        scheduleStep(nextStepId, runtime);
      }
      if (deferred.length > 0) {
        readyQueue = deferred.concat(readyQueue);
      }
    };

    trySchedule();

    while (!failure && (remainingSteps > 0 || inFlight.size > 0)) {
      if (inFlight.size === 0) {
        failure = {
          stepId: 'scheduler',
          message: 'Workflow blocked by unsatisfied dependencies'
        };
        break;
      }

      const completion = await Promise.race(inFlight.values());
      const { stepId } = completion;
      inFlight.delete(stepId);
      activeSteps.delete(stepId);

      const runtime = runtimeSteps.get(stepId);
      if (runtime?.fanOut) {
        const state = fanOutStates.get(runtime.fanOut.parentStepId);
        state?.active.delete(stepId);
      }

      if (completion.error) {
        const message =
          completion.error instanceof Error
            ? completion.error.message
            : 'Step execution failed';
        failure = { stepId, message };
        break;
      }

      const result = completion.result!;
      context = updateStepContext(context, stepId, result.stepPatch);

      if (runtime?.fanOut) {
        await handleFanOutChildCompletion(stepId, runtime, result);
      }

      if (result.sharedPatch) {
        for (const [key, value] of Object.entries(result.sharedPatch)) {
          context = setSharedValue(context, key, value);
        }
      }

      if (!result.completed) {
        if (result.fanOut) {
          await registerFanOutExpansion(result.fanOut);
        }
        statusById.set(stepId, result.stepStatus);
        trySchedule();
        continue;
      }

      if (result.stepStatus !== 'succeeded') {
        failure = {
          stepId,
          message: result.errorMessage ?? `Step ${stepId} failed`
        };
        break;
      }

      statusById.set(stepId, 'succeeded');
      completedSteps.add(stepId);
      remainingSteps -= 1;
      totals.completedSteps += 1;

      await updateRunMetrics();

      for (const dependentId of dependentsMap.get(stepId) ?? []) {
        enqueueIfReady(dependentId);
      }

      trySchedule();
    }

    if (failure) {
      await Promise.allSettled(Array.from(inFlight.values()));
      await recordRunFailure(run.id, failure.message, context, totals, startTime);
      return await getWorkflowRunById(run.id);
    }

    if (remainingSteps > 0) {
      await recordRunFailure(
        run.id,
        'Workflow terminated before completing all steps',
        context,
        totals,
        startTime
      );
      return await getWorkflowRunById(run.id);
    }

    await recordRunSuccess(run.id, context, totals, startTime, resolveWorkflowOutput(context));
    return await getWorkflowRunById(run.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Workflow orchestration failed';
    log('Workflow orchestration error', { workflowRunId, error: message });
    await recordRunFailure(run.id, message, context, totals, startTime);
    return await getWorkflowRunById(run.id);
  }
}

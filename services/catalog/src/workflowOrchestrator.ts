import {
  createWorkflowRunStep,
  getWorkflowDefinitionById,
  getWorkflowRunById,
  getWorkflowRunStep,
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
  type WorkflowStepDefinition,
  type WorkflowJobStepDefinition,
  type WorkflowServiceStepDefinition,
  type JobRetryPolicy,
  type ServiceRecord,
  type ServiceStatus,
  type SecretReference,
  type WorkflowRunUpdateInput
} from './db/types';
import { getServiceBySlug } from './db/services';
import { fetchFromService } from './clients/serviceClient';
import { resolveSecret, maskSecret, describeSecret } from './secrets';
import { createJobRunForSlug, executeJobRun } from './jobs/runtime';
import { logger } from './observability/logger';
import { handleWorkflowFailureAlert } from './observability/alerts';
import { buildWorkflowDagMetadata } from './workflows/dag';

function log(message: string, meta?: Record<string, unknown>) {
  const serialized = meta ? (meta as Record<string, JsonValue>) : undefined;
  logger.info(message, serialized);
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
};

type WorkflowRuntimeContext = {
  steps: Record<string, WorkflowStepRuntimeContext>;
  lastUpdatedAt: string;
  shared?: Record<string, JsonValue | null>;
};

type StepExecutionResult = {
  context: WorkflowRuntimeContext;
  stepStatus: WorkflowRunStepStatus;
  completed: boolean;
  stepPatch: WorkflowStepRuntimeContext;
  sharedPatch?: Record<string, JsonValue | null>;
  errorMessage?: string | null;
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
};

const TEMPLATE_PATTERN = /{{\s*([^}]+)\s*}}/g;

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

function withStepScope(scope: TemplateScope, stepId: string, parameters: JsonValue): TemplateScope {
  return {
    ...scope,
    step: { id: stepId, parameters },
    stepParameters: parameters
  };
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
    stepParameters: scope.step?.parameters ?? scope.stepParameters
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

function resolveTemplateString(input: string, scope: TemplateScope): JsonValue {
  const matches = [...input.matchAll(TEMPLATE_PATTERN)];
  if (matches.length === 0) {
    return input;
  }

  const trimmed = input.trim();
  if (matches.length === 1 && trimmed === matches[0][0]) {
    const value = lookupTemplateValue(scope, matches[0][1]);
    return coerceTemplateResult(value);
  }

  const replaced = input.replace(TEMPLATE_PATTERN, (_match, expr) => {
    const value = lookupTemplateValue(scope, expr);
    return templateValueToString(value);
  });
  return replaced as JsonValue;
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
  await updateWorkflowRun(runId, {
    status: 'failed',
    errorMessage,
    context: serializeContext(context),
    completedAt,
    durationMs,
    metrics: { totalSteps: totals.totalSteps, completedSteps: totals.completedSteps }
  });
  const latest = await getWorkflowRunById(runId);
  if (latest) {
    await handleWorkflowFailureAlert(latest);
  }
}

async function recordRunSuccess(
  runId: string,
  context: WorkflowRuntimeContext,
  totals: { totalSteps: number; completedSteps: number },
  startedAt: number
) {
  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startedAt;
  await updateWorkflowRun(runId, {
    status: 'succeeded',
    context: serializeContext(context),
    completedAt,
    durationMs,
    metrics: { totalSteps: totals.totalSteps, completedSteps: totals.completedSteps }
  });
}

async function loadOrCreateStepRecord(
  runId: string,
  step: WorkflowStepDefinition,
  inputParameters: JsonValue
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
  return createWorkflowRunStep(runId, {
    stepId: step.id,
    status: 'running',
    input: inputParameters,
    startedAt: new Date().toISOString()
  });
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
  step: WorkflowStepDefinition,
  context: WorkflowRuntimeContext,
  stepIndex: number
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
  const mergedParameters = mergeParameters(run.parameters, step.parameters ?? null);
  const resolvedParameters = resolveJsonTemplates(mergedParameters as JsonValue, baseScope);
  const stepScope = withStepScope(baseScope, step.id, resolvedParameters);

  if (step.type === 'service') {
    return executeServiceStep(run, step, context, stepIndex, resolvedParameters, stepScope);
  }

  return executeJobStep(run, step, context, stepIndex, resolvedParameters);
}

async function executeJobStep(
  run: WorkflowRunRecord,
  step: WorkflowJobStepDefinition,
  context: WorkflowRuntimeContext,
  stepIndex: number,
  parameters: JsonValue
): Promise<StepExecutionResult> {
  let stepRecord = await loadOrCreateStepRecord(run.id, step, parameters);

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
      attempt: stepRecord.attempt
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
    stepRecord =
      (await updateWorkflowRunStep(stepRecord.id, {
        status: 'running',
        startedAt,
        input: parameters
      })) ?? stepRecord;
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
    completedAt: stepRecord.completedAt ?? null
  });

  await applyRunContextPatch(run.id, step.id, nextContext.steps[step.id], {
    currentStepId: step.id,
    currentStepIndex: stepIndex
  });

  await ensureJobHandler(step.jobSlug);

  const jobRun = await createJobRunForSlug(step.jobSlug, {
    parameters,
    timeoutMs: step.timeoutMs ?? null,
    maxAttempts: step.retryPolicy?.maxAttempts ?? null
  });

  await updateWorkflowRunStep(stepRecord.id, {
    jobRunId: jobRun.id
  });

  const executed = await executeJobRun(jobRun.id);
  if (!executed) {
    throw new Error(`Job run ${jobRun.id} not found after execution`);
  }

  const stepStatus = jobStatusToStepStatus(executed.status);
  const completedAt = executed.completedAt ?? new Date().toISOString();

  stepRecord =
    (await updateWorkflowRunStep(stepRecord.id, {
      status: stepStatus,
      output: executed.result ?? null,
      errorMessage: executed.errorMessage ?? null,
      logsUrl: executed.logsUrl ?? null,
      metrics: executed.metrics ?? null,
      context: executed.context ?? null,
      completedAt,
      startedAt: executed.startedAt ?? startedAt,
      jobRunId: executed.id
    })) ?? stepRecord;

  nextContext = updateStepContext(nextContext, step.id, {
    status: stepRecord.status,
    jobRunId: executed.id,
    result: executed.result ?? null,
    errorMessage: executed.errorMessage ?? null,
    logsUrl: executed.logsUrl ?? null,
    metrics: executed.metrics ?? null,
    startedAt: executed.startedAt ?? startedAt,
    completedAt
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
  step: WorkflowServiceStepDefinition,
  context: WorkflowRuntimeContext,
  stepIndex: number,
  parameters: JsonValue,
  scope: TemplateScope
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
    stepRecord =
      (await updateWorkflowRunStep(stepRecord.id, {
        status: 'failed',
        startedAt,
        completedAt,
        errorMessage,
        metrics
      })) ?? stepRecord;

    const failureContext = updateStepContext(context, step.id, {
      status: 'failed',
      jobRunId: null,
      startedAt,
      completedAt,
      attempt,
      errorMessage,
      metrics,
      service: createMinimalServiceContext(step, null, null)
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

  let stepRecord = await loadOrCreateStepRecord(run.id, step, prepared.requestInput);

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
      service: serviceContext
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
    stepRecord =
      (await updateWorkflowRunStep(stepRecord.id, {
        status: 'running',
        startedAt,
        input: prepared.requestInput
      })) ?? stepRecord;
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
    service: createMinimalServiceContext(step, prepared, null)
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

    stepRecord =
      (await updateWorkflowRunStep(stepRecord.id, {
        attempt,
        input: prepared.requestInput
      })) ?? stepRecord;

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
      stepRecord =
        (await updateWorkflowRunStep(stepRecord.id, {
          errorMessage: lastErrorMessage,
          metrics: lastMetrics,
          context: serviceContextToJson(serviceContext)
        })) ?? stepRecord;
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
      stepRecord =
        (await updateWorkflowRunStep(stepRecord.id, {
          errorMessage: lastErrorMessage,
          metrics: lastMetrics,
          context: serviceContextToJson(serviceContext)
        })) ?? stepRecord;
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

    stepRecord =
      (await updateWorkflowRunStep(stepRecord.id, {
        metrics: lastMetrics,
        context: serviceContextToJson(serviceContextWithMetrics)
      })) ?? stepRecord;

    if (invocation.success) {
      const completedAt = new Date().toISOString();
      const output = prepared.captureResponse ? (invocation.responseBody ?? null) : null;

      stepRecord =
        (await updateWorkflowRunStep(stepRecord.id, {
          status: 'succeeded',
          output,
          errorMessage: null,
          metrics: lastMetrics,
          completedAt
        })) ?? stepRecord;

      let successContext = updateStepContext(finalContext, step.id, {
        status: 'succeeded',
        jobRunId: null,
        result: output,
        errorMessage: null,
        metrics: lastMetrics,
        completedAt,
        service: serviceContextWithMetrics
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

    stepRecord =
      (await updateWorkflowRunStep(stepRecord.id, {
        errorMessage: lastErrorMessage,
        metrics: lastMetrics,
        context: serviceContextToJson(serviceContextWithMetrics)
      })) ?? stepRecord;

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

  stepRecord =
    (await updateWorkflowRunStep(stepRecord.id, {
      status: 'failed',
      completedAt: failureCompletedAt,
      errorMessage: failureMessage,
      metrics: failureMetrics,
      context: serviceContextToJson(lastServiceContext)
    })) ?? stepRecord;

  const failureContext = updateStepContext(finalContext, step.id, {
    status: 'failed',
    completedAt: failureCompletedAt,
    errorMessage: failureMessage,
    metrics: failureMetrics,
    service: lastServiceContext
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
    await recordRunSuccess(run.id, { steps: {}, lastUpdatedAt: new Date().toISOString() }, { totalSteps: 0, completedSteps: 0 }, startTime);
    return await getWorkflowRunById(run.id);
  }

  run = await ensureRunIsStartable(run, steps);
  let context = toWorkflowContext(run.context);
  let totals = { totalSteps: steps.length, completedSteps: 0 };

  try {
    const dag = definition.dag && Object.keys(definition.dag.adjacency ?? {}).length > 0
      ? definition.dag
      : buildWorkflowDagMetadata(steps);

    const stepById = new Map<string, WorkflowStepDefinition>();
    const stepIndexById = new Map<string, number>();
    const dependenciesMap = new Map<string, string[]>();
    const dependentsMap = new Map<string, string[]>();

    steps.forEach((step, index) => {
      stepById.set(step.id, step);
      stepIndexById.set(step.id, index);
      dependenciesMap.set(step.id, Array.isArray(step.dependsOn) ? step.dependsOn : []);
      const dependents =
        Array.isArray(step.dependents) && step.dependents.length > 0
          ? step.dependents
          : dag.adjacency[step.id] ?? [];
      dependentsMap.set(step.id, dependents);
    });

    const statusById = new Map<string, WorkflowRunStepStatus>();
    const readyQueue: string[] = [];
    const readySet = new Set<string>();
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
      }
    }

    totals.completedSteps = completedSteps.size;
    let remainingSteps = steps.length - completedSteps.size;

    const concurrencyLimit = resolveRunConcurrency(definition, run, steps);

    await updateWorkflowRun(run.id, {
      metrics: { totalSteps: totals.totalSteps, completedSteps: totals.completedSteps }
    });

    const canSchedule = (stepId: string) => {
      const dependencies = dependenciesMap.get(stepId) ?? [];
      return dependencies.every((depId) => statusById.get(depId) === 'succeeded');
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

    const scheduleStep = (stepId: string) => {
      if (statusById.get(stepId) !== 'pending' || failure) {
        return;
      }
      readySet.delete(stepId);
      statusById.set(stepId, 'running');
      activeSteps.add(stepId);
      const stepDefinition = stepById.get(stepId);
      if (!stepDefinition) {
        failure = { stepId, message: `Unknown step ${stepId}` };
        return;
      }
      const stepIndex = stepIndexById.get(stepId) ?? 0;
      const contextClone = toWorkflowContext(serializeContext(context));
      const wrapped = executeStep(run, stepDefinition, contextClone, stepIndex)
        .then((result) => ({ stepId, result }))
        .catch((error) => ({ stepId, error }));
      inFlight.set(stepId, wrapped);
    };

    const trySchedule = () => {
      while (!failure && inFlight.size < concurrencyLimit && readyQueue.length > 0) {
        const nextStepId = readyQueue.shift();
        if (!nextStepId) {
          break;
        }
        scheduleStep(nextStepId);
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
      if (result.sharedPatch) {
        for (const [key, value] of Object.entries(result.sharedPatch)) {
          context = setSharedValue(context, key, value);
        }
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

      await updateWorkflowRun(run.id, {
        metrics: { totalSteps: totals.totalSteps, completedSteps: totals.completedSteps }
      });

      for (const dependentId of dependentsMap.get(stepId) ?? []) {
        if (
          statusById.get(dependentId) === 'pending' &&
          !readySet.has(dependentId) &&
          !activeSteps.has(dependentId) &&
          canSchedule(dependentId)
        ) {
          readyQueue.push(dependentId);
          readySet.add(dependentId);
        }
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

    await recordRunSuccess(run.id, context, totals, startTime);
    return await getWorkflowRunById(run.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Workflow orchestration failed';
    log('Workflow orchestration error', { workflowRunId, error: message });
    await recordRunFailure(run.id, message, context, totals, startTime);
    return await getWorkflowRunById(run.id);
  }
}

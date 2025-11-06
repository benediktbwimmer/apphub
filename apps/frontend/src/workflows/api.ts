import type { WorkflowTopologyGraph } from '@apphub/shared/workflowTopology';
import { z } from 'zod';

import { API_BASE_URL } from '../config';
import { coreRequest, CoreApiError } from '../core/api';
import { ApiError, createApiClient } from '../lib/apiClient';
export { ApiError } from '../lib/apiClient';
export type { AuthorizedFetch } from '../lib/apiClient';
import type { AuthorizedFetch as AuthorizedFetchInput, QueryValue } from '../lib/apiClient';
import type {
  WorkflowAssetDetail,
  WorkflowAssetInventoryEntry,
  WorkflowAssetPartitions,
  WorkflowAssetAutoMaterialize,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRunStep,
  WorkflowEventTrigger,
  WorkflowTriggerDelivery,
  WorkflowEventSample,
  WorkflowEventSchema,
  WorkflowEventSchedulerHealth,
  WorkflowEventTriggerStatus,
  WorkflowAutoMaterializeOps,
  WorkflowTimelineSnapshot,
  WorkflowTimelineMeta,
  WorkflowTimelineRangeKey,
  WorkflowTimelineTriggerStatus
} from './types';
import {
  normalizeWorkflowDefinition,
  normalizeWorkflowRun,
  normalizeWorkflowRunMetrics,
  normalizeWorkflowRunStats,
  normalizeWorkflowRunStep,
  normalizeWorkflowAssetInventoryResponse,
  normalizeWorkflowAssetDetailResponse,
  normalizeWorkflowAssetPartitionsResponse,
  normalizeWorkflowEventTriggers,
  normalizeWorkflowEventTrigger,
  normalizeWorkflowTriggerDeliveries,
  normalizeWorkflowEventSamples,
  normalizeWorkflowEventSchema,
  normalizeWorkflowEventHealth,
  normalizeWorkflowAutoMaterializeOps,
  normalizeWorkflowTimeline,
  normalizeWorkflowTimelineMeta
} from './normalizers';

export type WorkflowGraphCacheStats = {
  hits: number;
  misses: number;
  invalidations: number;
};

export type WorkflowGraphCacheMeta = {
  hit: boolean;
  cachedAt: string | null;
  ageMs: number | null;
  expiresAt: string | null;
  stats: WorkflowGraphCacheStats | null;
  lastInvalidatedAt: string | null;
  lastInvalidationReason: string | null;
};

export type WorkflowGraphFetchMeta = {
  cache: WorkflowGraphCacheMeta | null;
};

export type WorkflowGraphFetchResult = {
  graph: WorkflowTopologyGraph;
  meta: WorkflowGraphFetchMeta;
};

type Token = string | null | undefined;
type TokenInput = Token | AuthorizedFetchInput;

type ModuleScopeOption = 'inherit' | 'global';

type RequestJsonOptions<T> = {
  method?: string;
  headers?: HeadersInit;
  query?: Record<string, QueryValue>;
  body?: unknown;
  json?: unknown;
  schema?: z.ZodType<T>;
  errorMessage: string;
  signal?: AbortSignal;
  moduleScope?: ModuleScopeOption;
};

function parseWorkflowAssetAutoMaterialize(value: unknown): WorkflowAssetAutoMaterialize | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const auto: WorkflowAssetAutoMaterialize = {};
  if (typeof record.enabled === 'boolean') {
    auto.enabled = record.enabled;
  }
  if (typeof record.onUpstreamUpdate === 'boolean') {
    auto.onUpstreamUpdate = record.onUpstreamUpdate;
  }
  if (typeof record.priority === 'number' && Number.isFinite(record.priority)) {
    auto.priority = record.priority;
  }
  if (Object.prototype.hasOwnProperty.call(record, 'parameterDefaults')) {
    auto.parameterDefaults = record.parameterDefaults ?? null;
  }
  return Object.keys(auto).length > 0 ? auto : null;
}

type FetchWithMetadata = AuthorizedFetchInput & {
  authToken?: string | null | undefined;
  authOptional?: boolean | null | undefined;
};

function ensureToken(input: TokenInput): string | undefined {
  if (typeof input === 'function') {
    const fetcher = input as FetchWithMetadata;
    const candidate = typeof fetcher.authToken === 'string' ? fetcher.authToken.trim() : '';
    if (candidate.length > 0) {
      return candidate;
    }
    if (fetcher.authOptional) {
      return undefined;
    }
  } else if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
    return undefined;
  } else if (input === null || input === undefined) {
    return undefined;
  }
  throw new Error('Authentication required for core workflow requests.');
}

function toApiError(error: CoreApiError, fallback: string): ApiError {
  const message = error.message && error.message.trim().length > 0 ? error.message : fallback;
  return new ApiError(message, error.status ?? 500, error.details ?? null);
}

async function requestJson<T = unknown>(token: TokenInput, path: string, options: RequestJsonOptions<T>): Promise<T> {
  const {
    method,
    headers,
    query,
    body,
    json,
    schema,
    errorMessage,
    signal,
    moduleScope = 'inherit'
  } = options;
  let resolvedHeaders: HeadersInit | undefined = headers;
  if (moduleScope === 'global') {
    const globalHeaders = new Headers(headers ?? undefined);
    if (!globalHeaders.has('X-AppHub-Module-Id')) {
      globalHeaders.set('X-AppHub-Module-Id', '');
    }
    resolvedHeaders = globalHeaders;
  }
  const requestBody = json !== undefined ? json : body;
  if (typeof token === 'function') {
    const client = createApiClient(token, { baseUrl: API_BASE_URL });
    const baseOptions = {
      method,
      headers: resolvedHeaders,
      query,
      body: json !== undefined ? undefined : (body as BodyInit | undefined),
      json,
      errorMessage
    };
    if (schema) {
      return client.request(path, { ...baseOptions, schema });
    }
    return client.request(path, baseOptions) as Promise<T>;
  }
  try {
    const resolvedToken = ensureToken(token);
    const response = await coreRequest(resolvedToken, {
      method,
      url: path,
      query,
      body: requestBody,
      headers: resolvedHeaders,
      signal
    });
    if (schema) {
      return schema.parse(response);
    }
    return response as T;
  } catch (error) {
    if (error instanceof CoreApiError) {
      throw toApiError(error, errorMessage);
    }
    throw error;
  }
}

const optionalDataSchema = z.object({ data: z.unknown().optional() });
const requiredDataSchema = z.object({ data: z.unknown() });
const optionalDataArraySchema = z.object({ data: z.array(z.unknown()).optional() });

function parseNullableString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function parseNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function parseWorkflowGraphCacheStats(value: unknown): WorkflowGraphCacheStats | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const hits = parseNullableNumber(record.hits);
  const misses = parseNullableNumber(record.misses);
  const invalidations = parseNullableNumber(record.invalidations);
  if (hits === null && misses === null && invalidations === null) {
    return null;
  }
  return {
    hits: hits ?? 0,
    misses: misses ?? 0,
    invalidations: invalidations ?? 0
  };
}

function parseWorkflowGraphCacheMeta(value: unknown): WorkflowGraphCacheMeta | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    hit: Boolean(record.hit),
    cachedAt: parseNullableString(record.cachedAt),
    ageMs: parseNullableNumber(record.ageMs),
    expiresAt: parseNullableString(record.expiresAt),
    stats: parseWorkflowGraphCacheStats(record.stats),
    lastInvalidatedAt: parseNullableString(record.lastInvalidatedAt),
    lastInvalidationReason: parseNullableString(record.lastInvalidationReason)
  };
}

export type WorkflowTriggerInput = {
  type: string;
  options?: unknown;
};

export type WorkflowEventTriggerPredicateInput =
  | {
      path: string;
      operator: 'exists';
      caseSensitive?: boolean;
    }
  | {
      path: string;
      operator: 'equals' | 'notEquals';
      value: unknown;
      caseSensitive?: boolean;
    }
  | {
      path: string;
      operator: 'in' | 'notIn';
      values: unknown[];
      caseSensitive?: boolean;
    }
  | {
      path: string;
      operator: 'gt' | 'gte' | 'lt' | 'lte';
      value: number;
    }
  | {
      path: string;
      operator: 'contains';
      value: unknown;
      caseSensitive?: boolean;
    }
  | {
      path: string;
      operator: 'regex';
      value: string;
      caseSensitive?: boolean;
      flags?: string;
    };

export type WorkflowEventTriggerCreateInput = {
  name?: string | null;
  description?: string | null;
  eventType: string;
  eventSource?: string | null;
  predicates?: WorkflowEventTriggerPredicateInput[];
  parameterTemplate?: unknown;
  runKeyTemplate?: string | null;
  throttleWindowMs?: number | null;
  throttleCount?: number | null;
  maxConcurrency?: number | null;
  idempotencyKeyExpression?: string | null;
  metadata?: unknown;
  status?: WorkflowEventTriggerStatus;
  sampleEvent?: unknown;
};

export type WorkflowEventTriggerUpdateInput = {
  name?: string | null;
  description?: string | null;
  eventType?: string;
  eventSource?: string | null;
  predicates?: WorkflowEventTriggerPredicateInput[];
  parameterTemplate?: unknown;
  runKeyTemplate?: string | null;
  throttleWindowMs?: number | null;
  throttleCount?: number | null;
  maxConcurrency?: number | null;
  idempotencyKeyExpression?: string | null;
  metadata?: unknown;
  status?: WorkflowEventTriggerStatus;
  sampleEvent?: unknown;
};

export type WorkflowEventTriggerFilters = {
  status?: WorkflowEventTriggerStatus;
  eventType?: string;
  eventSource?: string;
};

export type WorkflowEventTriggerListResponse = {
  workflow: {
    id: string;
    slug: string;
    name: string;
  };
  triggers: WorkflowEventTrigger[];
};

export type WorkflowTriggerDeliveriesQuery = {
  limit?: number;
  status?: WorkflowTriggerDelivery['status'];
  eventId?: string;
  dedupeKey?: string;
};

export type WorkflowTriggerDeliveriesResponse = {
  deliveries: WorkflowTriggerDelivery[];
  workflow: {
    id: string;
    slug: string;
    name: string;
  };
  trigger: {
    id: string;
    name: string | null;
    eventType: string;
    status: WorkflowEventTriggerStatus;
  };
  limit: number;
};

export type WorkflowEventSampleQuery = {
  type?: string;
  source?: string;
  from?: string;
  to?: string;
  limit?: number;
  correlationId?: string;
  jsonPath?: string;
  cursor?: string;
};

export type WorkflowEventSamplesResponse = {
  samples: WorkflowEventSample[];
  schema: WorkflowEventSchema | null;
  page: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
  } | null;
};

export type WorkflowTimelineQuery = {
  from?: string;
  to?: string;
  range?: WorkflowTimelineRangeKey;
  limit?: number;
  statuses?: WorkflowTimelineTriggerStatus[];
  moduleId?: string | null;
  moduleScope?: ModuleScopeOption;
};

export type WorkflowTimelineResult = {
  snapshot: WorkflowTimelineSnapshot;
  meta: WorkflowTimelineMeta | null;
};

export type WorkflowJobStepInput = {
  id: string;
  name: string;
  type?: 'job';
  jobSlug: string;
  description?: string | null;
  dependsOn?: string[];
  parameters?: unknown;
  timeoutMs?: number | null;
  retryPolicy?: unknown;
  storeResultAs?: string;
  produces?: WorkflowAssetDeclarationInput[];
  consumes?: WorkflowAssetDeclarationInput[];
  bundle?: {
    slug: string;
    version?: string | null;
    exportName?: string | null;
    strategy?: 'pinned' | 'latest';
  } | null;
};

export type WorkflowServiceRequestInput = {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string | { secret: { source: 'env' | 'store'; key: string; prefix?: string } }>;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
};

export type WorkflowAssetFreshnessInput = {
  maxAgeMs?: number;
  ttlMs?: number;
  cadenceMs?: number;
};

export type WorkflowAssetAutoMaterializeInput = {
  onUpstreamUpdate?: boolean;
  priority?: number;
  parameterDefaults?: unknown;
};

export type WorkflowAssetPartitioningInput =
  | {
      type: 'static';
      keys: string[];
    }
  | {
      type: 'timeWindow';
      granularity: 'minute' | 'hour' | 'day' | 'week' | 'month';
      timezone?: string;
      format?: string;
      lookbackWindows?: number;
    }
  | {
      type: 'dynamic';
      maxKeys?: number;
      retentionDays?: number;
    };

export type WorkflowAssetDeclarationInput = {
  assetId: string;
  schema?: Record<string, unknown>;
  freshness?: WorkflowAssetFreshnessInput;
  autoMaterialize?: WorkflowAssetAutoMaterializeInput;
  partitioning?: WorkflowAssetPartitioningInput;
};

export type WorkflowServiceStepInput = {
  id: string;
  name: string;
  type: 'service';
  serviceSlug: string;
  description?: string | null;
  dependsOn?: string[];
  parameters?: unknown;
  timeoutMs?: number | null;
  retryPolicy?: unknown;
  requireHealthy?: boolean;
  allowDegraded?: boolean;
  captureResponse?: boolean;
  storeResponseAs?: string;
  request: WorkflowServiceRequestInput;
  produces?: WorkflowAssetDeclarationInput[];
  consumes?: WorkflowAssetDeclarationInput[];
};

export type WorkflowStepInput = WorkflowJobStepInput | WorkflowServiceStepInput;

export type WorkflowMetadataInput = Record<string, unknown> | null;

export type WorkflowCreateInput = {
  slug: string;
  name: string;
  version?: number;
  description?: string | null;
  steps: WorkflowStepInput[];
  triggers?: WorkflowTriggerInput[];
  parametersSchema?: Record<string, unknown>;
  defaultParameters?: unknown;
  outputSchema?: Record<string, unknown>;
  metadata?: WorkflowMetadataInput;
};

export type WorkflowUpdateInput = {
  name?: string;
  version?: number;
  description?: string | null;
  steps?: WorkflowStepInput[];
  triggers?: WorkflowTriggerInput[];
  parametersSchema?: Record<string, unknown>;
  defaultParameters?: unknown;
  outputSchema?: Record<string, unknown>;
  metadata?: WorkflowMetadataInput;
};

export type JobDefinitionCreateInput = {
  slug: string;
  name: string;
  version?: number;
  type: 'batch' | 'service-triggered' | 'manual';
  runtime?: 'node' | 'python' | 'docker' | 'module';
  entryPoint: string;
  timeoutMs?: number | null;
  retryPolicy?: unknown;
  parametersSchema?: Record<string, unknown>;
  defaultParameters?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  metadata?: unknown;
};

export type JobDefinitionSummary = {
  id: string;
  slug: string;
  name: string;
  version: number;
  type: string;
  runtime: 'node' | 'python' | 'docker' | 'module';
  entryPoint: string;
  registryRef: string | null;
  parametersSchema: unknown;
  defaultParameters: unknown;
  outputSchema: unknown;
  timeoutMs: number | null;
  retryPolicy: unknown;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
};

export type ServiceSummary = {
  id: string;
  slug: string;
  displayName: string | null;
  kind: string | null;
  baseUrl: string | null;
  status: string | null;
  statusMessage: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
};

export type JobBundleVersionSummary = {
  id: string;
  version: string;
  status: string | null;
  immutable: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OperatorIdentity = {
  subject: string;
  scopes: string[];
  kind: 'user' | 'service';
};

export async function fetchWorkflowTopologyGraph(
  token: TokenInput
): Promise<WorkflowGraphFetchResult> {
  const payload = await requestJson(token,  '/workflows/graph', {
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache'
    },
    schema: z.object({ data: z.unknown(), meta: z.object({ cache: z.unknown().optional() }).optional() }),
    errorMessage: 'Failed to load workflow graph'
  });
  const graph = payload.data;
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
    throw new ApiError('Invalid workflow graph response', 500, payload);
  }
  const graphPayload = graph as { version?: unknown; edges?: unknown } & Record<string, unknown>;
  const version = graphPayload.version;
  if (version !== 'v1' && version !== 'v2') {
    throw new ApiError('Unsupported workflow graph version', 500, graphPayload);
  }
  const edges = graphPayload.edges;
  if (!edges || typeof edges !== 'object' || Array.isArray(edges)) {
    throw new ApiError('Invalid workflow graph payload', 500, graphPayload);
  }
  const edgePayload = edges as { stepToEventSource?: unknown[] } & Record<string, unknown>;
  if (!Array.isArray(edgePayload.stepToEventSource)) {
    edgePayload.stepToEventSource = [];
  }
  const cacheMeta = parseWorkflowGraphCacheMeta(payload.meta?.cache);
  return {
    graph: graphPayload as WorkflowTopologyGraph,
    meta: { cache: cacheMeta }
  };
}

export async function listWorkflowDefinitions(
  token: TokenInput,
  params: { moduleId?: string | null; moduleScope?: ModuleScopeOption } = {}
): Promise<WorkflowDefinition[]> {
  const searchParams = new URLSearchParams();
  if (params.moduleId && params.moduleScope !== 'global') {
    searchParams.set('moduleId', params.moduleId);
  }
  const query = searchParams.toString();
  const path = `/workflows${query ? `?${query}` : ''}`;
  const payload = await requestJson(token, path, {
    schema: optionalDataArraySchema,
    errorMessage: 'Failed to load workflows',
    moduleScope: params.moduleScope
  });
  if (!Array.isArray(payload.data)) {
    return [];
  }
  return payload.data
    .map((entry) => normalizeWorkflowDefinition(entry))
    .filter((entry): entry is WorkflowDefinition => Boolean(entry))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export type WorkflowDefinitionRunListMeta = {
  limit: number;
  offset: number;
};

export async function listWorkflowRunsForSlug(
  token: TokenInput,
  slug: string,
  params: { limit?: number; offset?: number; moduleId?: string | null; moduleScope?: ModuleScopeOption } = {}
): Promise<{ runs: WorkflowRun[]; meta: WorkflowDefinitionRunListMeta }> {
  const searchParams = new URLSearchParams();
  if (typeof params.limit === 'number') {
    searchParams.set('limit', String(params.limit));
  }
  if (typeof params.offset === 'number') {
    searchParams.set('offset', String(params.offset));
  }
  if (params.moduleId && params.moduleScope !== 'global') {
    searchParams.set('moduleId', params.moduleId);
  }
  const query = searchParams.toString();
  const response = await requestJson(token,  `/workflows/${encodeURIComponent(slug)}/runs${query ? `?${query}` : ''}`, {
    errorMessage: 'Failed to load workflow runs',
    moduleScope: params.moduleScope
  });

  const payload = response && typeof response === 'object' ? (response as Record<string, unknown>) : {};
  const data = payload.data && typeof payload.data === 'object' ? (payload.data as Record<string, unknown>) : {};
  const runsRaw = Array.isArray(data.runs) ? data.runs : [];
  const runs = runsRaw
    .map((entry) => normalizeWorkflowRun(entry))
    .filter((run): run is WorkflowRun => Boolean(run));

  const metaRecord = payload.meta && typeof payload.meta === 'object' ? (payload.meta as Record<string, unknown>) : {};
  const limit = typeof metaRecord.limit === 'number' && Number.isFinite(metaRecord.limit)
    ? metaRecord.limit
    : params.limit ?? runs.length;
  const offset = typeof metaRecord.offset === 'number' && Number.isFinite(metaRecord.offset)
    ? metaRecord.offset
    : params.offset ?? 0;

  return {
    runs,
    meta: { limit, offset }
  };
}

export async function getWorkflowRun(
  token: TokenInput,
  runId: string
): Promise<WorkflowRun> {
  const payload = await requestJson(token,  `/workflow-runs/${encodeURIComponent(runId)}`, {
    schema: requiredDataSchema,
    errorMessage: 'Failed to load workflow run'
  });
  const run = normalizeWorkflowRun(payload.data);
  if (!run) {
    throw new ApiError('Workflow run response missing data', 500, payload);
  }
  return run;
}

export type WorkflowRunSearchResult = {
  run: WorkflowRun;
  workflow: {
    id: string;
    slug: string;
    name: string;
    version: number;
  };
};

export async function searchWorkflowRuns(
  token: TokenInput,
  params: { search: string; limit?: number }
): Promise<WorkflowRunSearchResult[]> {
  const trimmed = params.search.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const searchParams = new URLSearchParams();
  searchParams.set('search', trimmed);
  if (typeof params.limit === 'number' && Number.isFinite(params.limit)) {
    searchParams.set('limit', String(Math.max(1, Math.min(50, Math.trunc(params.limit)))));
  }
  const query = searchParams.toString();
  const response = await requestJson(token,  `/workflow-runs${query ? `?${query}` : ''}`, {
    errorMessage: 'Failed to search workflow runs'
  });
  const payload = response && typeof response === 'object' ? (response as Record<string, unknown>) : {};
  const data = Array.isArray(payload.data) ? payload.data : [];
  const results: WorkflowRunSearchResult[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const run = normalizeWorkflowRun(record.run);
    const workflowRaw = record.workflow as Record<string, unknown> | undefined;
    const workflowId = typeof workflowRaw?.id === 'string' ? workflowRaw.id : null;
    const workflowSlug = typeof workflowRaw?.slug === 'string' ? workflowRaw.slug : null;
    const workflowName = typeof workflowRaw?.name === 'string' ? workflowRaw.name : workflowSlug;
    const workflowVersion = typeof workflowRaw?.version === 'number' ? workflowRaw.version : null;
    if (!run || !workflowId || !workflowSlug || workflowVersion === null) {
      continue;
    }
    results.push({
      run,
      workflow: {
        id: workflowId,
        slug: workflowSlug,
        name: workflowName ?? workflowSlug,
        version: workflowVersion
      }
    });
  }
  return results;
}

export type WorkflowAnalyticsQuery = {
  range?: '24h' | '7d' | '30d';
  bucket?: '15m' | 'hour' | 'day';
  from?: string;
  to?: string;
  moduleId?: string | null;
  moduleScope?: ModuleScopeOption;
};

function buildAnalyticsQuery(params?: WorkflowAnalyticsQuery): string {
  if (!params) {
    return '';
  }
  const searchParams = new URLSearchParams();
  if (params.range) {
    searchParams.set('range', params.range);
  }
  if (params.bucket) {
    searchParams.set('bucket', params.bucket);
  }
  if (params.from) {
    searchParams.set('from', params.from);
  }
  if (params.to) {
    searchParams.set('to', params.to);
  }
  if (params.moduleId && params.moduleScope !== 'global') {
    searchParams.set('moduleId', params.moduleId);
  }
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export async function getWorkflowStats(
  token: TokenInput,
  slug: string,
  params?: WorkflowAnalyticsQuery
) {
  const query = buildAnalyticsQuery(params);
  const payload = await requestJson(token,  `/workflows/${slug}/stats${query}`, {
    schema: optionalDataSchema,
    errorMessage: 'Failed to load workflow stats',
    moduleScope: params?.moduleScope
  });
  const stats = normalizeWorkflowRunStats(payload.data);
  if (!stats) {
    throw new ApiError('Failed to parse workflow stats', 500, payload);
  }
  return stats;
}

export async function getWorkflowRunMetrics(
  token: TokenInput,
  slug: string,
  params?: WorkflowAnalyticsQuery
) {
  const query = buildAnalyticsQuery(params);
  const payload = await requestJson(token,  `/workflows/${slug}/run-metrics${query}`, {
    schema: optionalDataSchema,
    errorMessage: 'Failed to load workflow run metrics',
    moduleScope: params?.moduleScope
  });
  const metrics = normalizeWorkflowRunMetrics(payload.data);
  if (!metrics) {
    throw new ApiError('Failed to parse workflow run metrics', 500, payload);
  }
  return metrics;
}

export async function getWorkflowAutoMaterializeOps(
  token: TokenInput,
  slug: string,
  options: { limit?: number; offset?: number; moduleId?: string | null; moduleScope?: ModuleScopeOption } = {}
): Promise<WorkflowAutoMaterializeOps> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  if (options.offset !== undefined) {
    params.set('offset', String(options.offset));
  }
  if (options.moduleId && options.moduleScope !== 'global') {
    params.set('moduleId', options.moduleId);
  }
  const query = params.toString();
  const payload = await requestJson(token, 
    `/workflows/${encodeURIComponent(slug)}/auto-materialize${query ? `?${query}` : ''}`,
    {
      schema: optionalDataSchema,
      errorMessage: 'Failed to load auto-materialization activity',
      moduleScope: options.moduleScope
    }
  );
  const ops = normalizeWorkflowAutoMaterializeOps(payload);
  if (!ops) {
    throw new ApiError('Failed to parse auto-materialization response', 500, payload);
  }
  return ops;
}

export async function getWorkflowDetail(
  token: TokenInput,
  slug: string,
  options: { moduleId?: string | null; moduleScope?: ModuleScopeOption } = {}
): Promise<{ workflow: WorkflowDefinition; runs: WorkflowRun[] }> {
  const params = new URLSearchParams();
  if (options.moduleId && options.moduleScope !== 'global') {
    params.set('moduleId', options.moduleId);
  }
  const query = params.toString();
  const payload = await requestJson(token,  `/workflows/${slug}${query ? `?${query}` : ''}`, {
    schema: z.object({
      data: z
        .object({
          workflow: z.unknown().optional(),
          runs: z.array(z.unknown()).optional()
        })
        .optional()
    }),
    errorMessage: 'Failed to load workflow details',
    moduleScope: options.moduleScope
  });
  const workflow = normalizeWorkflowDefinition(payload.data?.workflow);
  if (!workflow) {
    throw new ApiError('Workflow response missing definition', 500, payload);
  }
  const runs = Array.isArray(payload.data?.runs)
    ? payload.data?.runs
        .map((entry) => normalizeWorkflowRun(entry))
        .filter((run): run is WorkflowRun => Boolean(run))
    : [];
  return { workflow, runs };
}

export async function listWorkflowRunSteps(
  token: TokenInput,
  runId: string
): Promise<{ run: WorkflowRun; steps: WorkflowRunStep[] }> {
  const payload = await requestJson(token,  `/workflow-runs/${runId}/steps`, {
    schema: z.object({
      data: z
        .object({
          run: z.unknown().optional(),
          steps: z.array(z.unknown()).optional()
        })
        .optional()
    }),
    errorMessage: 'Failed to load workflow run steps'
  });
  const run = normalizeWorkflowRun(payload.data?.run);
  if (!run) {
    throw new ApiError('Workflow run response missing run', 500, payload);
  }
  const steps = Array.isArray(payload.data?.steps)
    ? payload.data?.steps
        .map((entry) => normalizeWorkflowRunStep(entry))
        .filter((step): step is WorkflowRunStep => Boolean(step))
    : [];
  return { run, steps };
}

export async function listWorkflowEventTriggers(
  token: TokenInput,
  slug: string,
  filters: WorkflowEventTriggerFilters = {}
): Promise<WorkflowEventTriggerListResponse> {
  const params = new URLSearchParams();
  if (filters.status) {
    params.set('status', filters.status);
  }
  if (filters.eventType) {
    params.set('eventType', filters.eventType);
  }
  if (filters.eventSource) {
    params.set('eventSource', filters.eventSource);
  }
  const query = params.toString();
  const payload = await requestJson(token, 
    `/workflows/${encodeURIComponent(slug)}/triggers${query ? `?${query}` : ''}`,
    {
      schema: z.object({
        data: z
          .object({
            workflow: z
              .object({
                id: z.unknown().optional(),
                slug: z.unknown().optional(),
                name: z.unknown().optional()
              })
              .optional(),
            triggers: z.array(z.unknown()).optional()
          })
          .optional()
      }),
      errorMessage: 'Failed to load workflow event triggers'
    }
  );
  const workflowRaw = payload.data?.workflow ?? {};
  const workflowId = typeof workflowRaw.id === 'string' ? workflowRaw.id : null;
  const workflowSlug = typeof workflowRaw.slug === 'string' ? workflowRaw.slug : slug;
  const workflowName = typeof workflowRaw.name === 'string' ? workflowRaw.name : workflowSlug;
  if (!workflowId || !workflowSlug || !workflowName) {
    throw new ApiError('Invalid workflow trigger response', 500, payload);
  }
  const triggers = normalizeWorkflowEventTriggers(payload.data?.triggers);
  return {
    workflow: {
      id: workflowId,
      slug: workflowSlug,
      name: workflowName
    },
    triggers
  } satisfies WorkflowEventTriggerListResponse;
}

export async function getWorkflowEventTrigger(
  token: TokenInput,
  slug: string,
  triggerId: string
): Promise<WorkflowEventTrigger> {
  const payload = await requestJson(token, 
    `/workflows/${encodeURIComponent(slug)}/triggers/${encodeURIComponent(triggerId)}`,
    {
      schema: requiredDataSchema,
      errorMessage: 'Failed to load workflow event trigger'
    }
  );
  const trigger = normalizeWorkflowEventTrigger(payload.data);
  if (!trigger) {
    throw new ApiError('Invalid workflow trigger response', 500, payload);
  }
  return trigger;
}

export async function createWorkflowEventTrigger(
  token: TokenInput,
  slug: string,
  input: WorkflowEventTriggerCreateInput
): Promise<WorkflowEventTrigger> {
  const payload = await requestJson(token,  `/workflows/${encodeURIComponent(slug)}/triggers`, {
    method: 'POST',
    json: input,
    schema: requiredDataSchema,
    errorMessage: 'Failed to create workflow event trigger'
  });
  const trigger = normalizeWorkflowEventTrigger(payload.data);
  if (!trigger) {
    throw new ApiError('Invalid workflow trigger response', 500, payload);
  }
  return trigger;
}

export async function updateWorkflowEventTrigger(
  token: TokenInput,
  slug: string,
  triggerId: string,
  input: WorkflowEventTriggerUpdateInput
): Promise<WorkflowEventTrigger> {
  const payload = await requestJson(token, 
    `/workflows/${encodeURIComponent(slug)}/triggers/${encodeURIComponent(triggerId)}`,
    {
      method: 'PATCH',
      json: input,
      schema: requiredDataSchema,
      errorMessage: 'Failed to update workflow event trigger'
    }
  );
  const trigger = normalizeWorkflowEventTrigger(payload.data);
  if (!trigger) {
    throw new ApiError('Invalid workflow trigger response', 500, payload);
  }
  return trigger;
}

export async function deleteWorkflowEventTrigger(
  token: TokenInput,
  slug: string,
  triggerId: string
): Promise<void> {
  await requestJson(token, 
    `/workflows/${encodeURIComponent(slug)}/triggers/${encodeURIComponent(triggerId)}`,
    {
      method: 'DELETE',
      errorMessage: 'Failed to delete workflow event trigger'
    }
  );
}

export async function listWorkflowTriggerDeliveries(
  token: TokenInput,
  slug: string,
  triggerId: string,
  query: WorkflowTriggerDeliveriesQuery = {}
): Promise<WorkflowTriggerDeliveriesResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) {
    params.set('limit', String(query.limit));
  }
  if (query.status) {
    params.set('status', query.status);
  }
  if (query.eventId) {
    params.set('eventId', query.eventId);
  }
  if (query.dedupeKey) {
    params.set('dedupeKey', query.dedupeKey);
  }
  const search = params.toString();
  const payload = await requestJson<{
    data?: unknown[];
    meta?: {
      workflow?: { id?: unknown; slug?: unknown; name?: unknown };
      trigger?: { id?: unknown; name?: unknown; eventType?: unknown; status?: unknown };
      limit?: unknown;
    };
  }>(
    token,
    `/workflows/${encodeURIComponent(slug)}/triggers/${encodeURIComponent(triggerId)}/deliveries${
      search ? `?${search}` : ''
    }`,
    {
      errorMessage: 'Failed to load workflow trigger deliveries'
    }
  );
  const deliveries = normalizeWorkflowTriggerDeliveries(payload.data);
  const workflowMeta = payload.meta?.workflow ?? {};
  const triggerMeta = payload.meta?.trigger ?? {};
  const workflowId = typeof workflowMeta.id === 'string' ? workflowMeta.id : null;
  const workflowSlug = typeof workflowMeta.slug === 'string' ? workflowMeta.slug : slug;
  const workflowName = typeof workflowMeta.name === 'string' ? workflowMeta.name : workflowSlug;
  const triggerMetaId = typeof triggerMeta.id === 'string' ? triggerMeta.id : triggerId;
  const triggerName = typeof triggerMeta.name === 'string' ? triggerMeta.name : null;
  const triggerEventType = typeof triggerMeta.eventType === 'string' ? triggerMeta.eventType : 'unknown';
  const triggerStatus =
    typeof triggerMeta.status === 'string' && triggerMeta.status === 'disabled' ? 'disabled' : 'active';
  const limit = Number(payload.meta?.limit ?? query.limit ?? 50);
  if (!workflowId || !workflowSlug || !triggerMetaId) {
    throw new ApiError('Invalid trigger deliveries response', 500, payload);
  }
  return {
    deliveries,
    workflow: {
      id: workflowId,
      slug: workflowSlug,
      name: workflowName
    },
    trigger: {
      id: triggerMetaId,
      name: triggerName,
      eventType: triggerEventType,
      status: triggerStatus
    },
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50
  } satisfies WorkflowTriggerDeliveriesResponse;
}

type WorkflowEventSampleFetchOptions = {
  moduleScope?: 'inherit' | 'global';
};

export async function listWorkflowEventSamples(
  token: TokenInput,
  query: WorkflowEventSampleQuery = {},
  options: WorkflowEventSampleFetchOptions = {}
): Promise<WorkflowEventSamplesResponse> {
  const params = new URLSearchParams();
  if (query.type) {
    params.set('type', query.type);
  }
  if (query.source) {
    params.set('source', query.source);
  }
  if (query.from) {
    params.set('from', query.from);
  }
  if (query.to) {
    params.set('to', query.to);
  }
  if (query.limit !== undefined) {
    params.set('limit', String(query.limit));
  }
  if (query.correlationId) {
    params.set('correlationId', query.correlationId);
  }
  if (query.jsonPath) {
    params.set('jsonPath', query.jsonPath);
  }
  if (query.cursor) {
    params.set('cursor', query.cursor);
  }
  const search = params.toString();
  const headers =
    options.moduleScope === 'global'
      ? {
          'X-AppHub-Module-Id': ''
        }
      : undefined;
  const payload = await requestJson<{ data?: unknown; schema?: unknown }>(
    token,
    `/admin/events${search ? `?${search}` : ''}`,
    {
      errorMessage: 'Failed to load workflow events',
      headers
    }
  );
  let eventsSource: unknown = payload.data;
  let page: WorkflowEventSamplesResponse['page'] = null;
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    const record = payload.data as Record<string, unknown>;
    if ('events' in record) {
      eventsSource = record.events;
    }
    const pageValue = record.page;
    if (pageValue && typeof pageValue === 'object' && !Array.isArray(pageValue)) {
      const pageRecord = pageValue as Record<string, unknown>;
      const nextCursor = typeof pageRecord.nextCursor === 'string' ? pageRecord.nextCursor : null;
      const hasMore = Boolean(pageRecord.hasMore);
      const limitValue = Number(pageRecord.limit);
      page = {
        nextCursor,
        hasMore,
        limit: Number.isFinite(limitValue) && limitValue > 0 ? Math.floor(limitValue) : 0
      };
    }
  }
  const samples = normalizeWorkflowEventSamples(eventsSource);
  const schema = normalizeWorkflowEventSchema(payload.schema);
  return { samples, schema: schema ?? null, page };
}

export async function getWorkflowEventHealth(
  token: TokenInput
): Promise<WorkflowEventSchedulerHealth | null> {
  const payload = await requestJson<unknown>(token, '/admin/event-health', {
    errorMessage: 'Failed to load workflow event health'
  });
  return normalizeWorkflowEventHealth(payload);
}

export async function cancelEventRetry(token: TokenInput, eventId: string): Promise<void> {
  await requestJson(token, `/admin/retries/events/${encodeURIComponent(eventId)}/cancel`, {
    method: 'POST',
    errorMessage: 'Failed to cancel event retry'
  });
}

export async function forceEventRetry(token: TokenInput, eventId: string): Promise<void> {
  await requestJson(token, `/admin/retries/events/${encodeURIComponent(eventId)}/force`, {
    method: 'POST',
    errorMessage: 'Failed to run event retry'
  });
}

export async function cancelTriggerRetry(token: TokenInput, deliveryId: string): Promise<void> {
  await requestJson(token, `/admin/retries/deliveries/${encodeURIComponent(deliveryId)}/cancel`, {
    method: 'POST',
    errorMessage: 'Failed to cancel trigger delivery retry'
  });
}

export async function forceTriggerRetry(token: TokenInput, deliveryId: string): Promise<void> {
  await requestJson(token, `/admin/retries/deliveries/${encodeURIComponent(deliveryId)}/force`, {
    method: 'POST',
    errorMessage: 'Failed to run trigger delivery retry'
  });
}

export async function cancelWorkflowStepRetry(token: TokenInput, stepId: string): Promise<void> {
  await requestJson(token, `/admin/retries/workflow-steps/${encodeURIComponent(stepId)}/cancel`, {
    method: 'POST',
    errorMessage: 'Failed to cancel workflow step retry'
  });
}

export async function forceWorkflowStepRetry(token: TokenInput, stepId: string): Promise<void> {
  await requestJson(token, `/admin/retries/workflow-steps/${encodeURIComponent(stepId)}/force`, {
    method: 'POST',
    errorMessage: 'Failed to run workflow step retry'
  });
}

export async function getWorkflowTimeline(
  token: TokenInput,
  slug: string,
  query: WorkflowTimelineQuery = {}
): Promise<WorkflowTimelineResult> {
  const params = new URLSearchParams();
  if (query.from) {
    params.set('from', query.from);
  }
  if (query.to) {
    params.set('to', query.to);
  }
  if (query.range) {
    params.set('range', query.range);
  }
  if (query.limit !== undefined) {
    params.set('limit', String(query.limit));
  }
  if (Array.isArray(query.statuses)) {
    for (const status of query.statuses) {
      if (typeof status === 'string' && status.length > 0) {
        params.append('status', status);
      }
    }
  }
  if (query.moduleId && query.moduleScope !== 'global') {
    params.set('moduleId', query.moduleId);
  }
  const search = params.toString();
  const payload = await requestJson<{ data?: unknown; meta?: unknown }>(
    token,
    `/workflows/${encodeURIComponent(slug)}/timeline${search ? `?${search}` : ''}`,
    {
      errorMessage: 'Failed to load workflow timeline',
      moduleScope: query.moduleScope
    }
  );
  const snapshot = normalizeWorkflowTimeline(payload.data);
  if (!snapshot) {
    throw new ApiError('Invalid workflow timeline response', 500, payload);
  }
  const meta = normalizeWorkflowTimelineMeta(payload.meta);
  return { snapshot, meta } satisfies WorkflowTimelineResult;
}

export async function fetchWorkflowDefinitions(
  token: TokenInput,
  options: { moduleId?: string | null; moduleScope?: ModuleScopeOption } = {}
): Promise<WorkflowDefinition[]> {
  const params = new URLSearchParams();
  if (options.moduleId && options.moduleScope !== 'global') {
    params.set('moduleId', options.moduleId);
  }
  const query = params.toString();
  const payload = await requestJson<{ data?: unknown }>(
    token,
    `/workflows${query ? `?${query}` : ''}`,
    {
      errorMessage: 'Failed to load workflows',
      moduleScope: options.moduleScope
    }
  );
  if (!payload.data || !Array.isArray(payload.data)) {
    return [];
  }
  const definitions = payload.data
    .map((entry) => normalizeWorkflowDefinition(entry))
    .filter((definition): definition is WorkflowDefinition => Boolean(definition));
  return definitions;
}

export async function fetchWorkflowAssets(
  token: TokenInput,
  slug: string,
  options: { moduleId?: string | null; moduleScope?: ModuleScopeOption } = {}
): Promise<WorkflowAssetInventoryEntry[]> {
  const params = new URLSearchParams();
  if (options.moduleId && options.moduleScope !== 'global') {
    params.set('moduleId', options.moduleId);
  }
  const query = params.toString();
  const payload = await requestJson<unknown>(
    token,
    `/workflows/${encodeURIComponent(slug)}/assets${query ? `?${query}` : ''}`,
    {
      errorMessage: 'Failed to load workflow assets',
      moduleScope: options.moduleScope
    }
  );
  return normalizeWorkflowAssetInventoryResponse(payload);
}

export async function fetchWorkflowAssetHistory(
  token: TokenInput,
  slug: string,
  assetId: string,
  options: { limit?: number; moduleId?: string | null; moduleScope?: ModuleScopeOption } = {}
): Promise<WorkflowAssetDetail | null> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  if (options.moduleId && options.moduleScope !== 'global') {
    params.set('moduleId', options.moduleId);
  }
  const query = params.toString();
  try {
    const payload = await requestJson<unknown>(
      token,
      `/workflows/${encodeURIComponent(slug)}/assets/${encodeURIComponent(assetId)}/history${
        query ? `?${query}` : ''
      }`,
      {
        errorMessage: 'Failed to load workflow asset history',
        moduleScope: options.moduleScope
      }
    );
    return normalizeWorkflowAssetDetailResponse(payload);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function updateWorkflowAssetAutoMaterialize(
  token: TokenInput,
  slug: string,
  assetId: string,
  input: {
    stepId: string;
    enabled?: boolean;
    onUpstreamUpdate?: boolean;
    priority?: number | null;
    parameterDefaults?: unknown;
  }
): Promise<{
  assetId: string;
  stepId: string;
  autoMaterialize: WorkflowAssetAutoMaterialize | null;
}> {
  const payload = await requestJson(token,
    `/workflows/${encodeURIComponent(slug)}/assets/${encodeURIComponent(assetId)}/auto-materialize`,
    {
      method: 'PATCH',
      json: input,
      schema: requiredDataSchema,
      errorMessage: 'Failed to update auto-materialize policy'
    }
  );
  const data = payload.data as Record<string, unknown> | undefined;
  const responseAssetId = typeof data?.assetId === 'string' ? data.assetId : assetId;
  const responseStepId = typeof data?.stepId === 'string' ? data.stepId : input.stepId;
  const autoMaterialize = parseWorkflowAssetAutoMaterialize(data?.autoMaterialize ?? null);
  return {
    assetId: responseAssetId,
    stepId: responseStepId,
    autoMaterialize
  };
}

export async function fetchWorkflowAssetPartitions(
  token: TokenInput,
  slug: string,
  assetId: string,
  options: { lookback?: number; moduleId?: string | null; moduleScope?: ModuleScopeOption } = {}
): Promise<WorkflowAssetPartitions | null> {
  const params = new URLSearchParams();
  if (options.lookback !== undefined) {
    params.set('lookback', String(options.lookback));
  }
  if (options.moduleId && options.moduleScope !== 'global') {
    params.set('moduleId', options.moduleId);
  }
  const query = params.toString();
  try {
    const payload = await requestJson<unknown>(
      token,
      `/workflows/${encodeURIComponent(slug)}/assets/${encodeURIComponent(assetId)}/partitions${
        query ? `?${query}` : ''
      }`,
      {
        errorMessage: 'Failed to load workflow asset partitions',
        moduleScope: options.moduleScope
      }
    );
    return normalizeWorkflowAssetPartitionsResponse(payload);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function createWorkflowDefinition(
  token: TokenInput,
  input: WorkflowCreateInput
): Promise<WorkflowDefinition> {
  const payload = await requestJson<{ data?: unknown }>(token, '/workflows', {
    method: 'POST',
    json: input,
    errorMessage: 'Failed to create workflow'
  });
  const workflow = normalizeWorkflowDefinition(payload.data);
  if (!workflow) {
    throw new ApiError('Invalid workflow response', 500, payload);
  }
  return workflow;
}

export async function updateWorkflowDefinition(
  token: TokenInput,
  slug: string,
  input: WorkflowUpdateInput
): Promise<WorkflowDefinition> {
  const payload = await requestJson<{ data?: unknown }>(token, `/workflows/${slug}`, {
    method: 'PATCH',
    json: input,
    errorMessage: 'Failed to update workflow'
  });
  const workflow = normalizeWorkflowDefinition(payload.data);
  if (!workflow) {
    throw new ApiError('Invalid workflow response', 500, payload);
  }
  return workflow;
}

export async function listJobDefinitions(token: TokenInput): Promise<JobDefinitionSummary[]> {
  const payload = await requestJson<{ data?: JobDefinitionSummary[] }>(token, '/jobs', {
    errorMessage: 'Failed to load job definitions'
  });
  if (!Array.isArray(payload.data)) {
    return [];
  }
  return payload.data.map((job) => ({
    ...job,
    registryRef: job.registryRef ?? null,
    timeoutMs: job.timeoutMs ?? null
  }));
}

export async function createJobDefinition(
  token: TokenInput,
  input: JobDefinitionCreateInput
): Promise<JobDefinitionSummary> {
  const payload = await requestJson<{ data?: JobDefinitionSummary }>(token, '/jobs', {
    method: 'POST',
    json: input,
    errorMessage: 'Failed to create job definition'
  });
  if (!payload.data) {
    throw new ApiError('Invalid job response', 500, payload);
  }
  return {
    ...payload.data,
    registryRef: payload.data.registryRef ?? null,
    timeoutMs: payload.data.timeoutMs ?? null
  } satisfies JobDefinitionSummary;
}

export async function listServices(
  token: TokenInput,
  options: { signal?: AbortSignal } = {}
): Promise<ServiceSummary[]> {
  const payload = await requestJson<{ data?: ServiceSummary[] }>(token, '/services', {
    errorMessage: 'Failed to load services',
    signal: options.signal
  });
  if (!Array.isArray(payload.data)) {
    return [];
  }
  return payload.data.map((service) => ({
    ...service,
    displayName: service.displayName ?? null,
    kind: service.kind ?? null,
    baseUrl: service.baseUrl ?? null,
    status: service.status ?? null,
    statusMessage: service.statusMessage ?? null
  }));
}

export async function listJobBundleVersions(
  token: TokenInput,
  slug: string
): Promise<JobBundleVersionSummary[]> {
  const payload = await requestJson<{
    data?: { versions?: Array<Partial<JobBundleVersionSummary>> };
  }>(token, `/job-bundles/${encodeURIComponent(slug)}`, {
    errorMessage: 'Failed to load job bundle versions'
  });
  const records = Array.isArray(payload.data?.versions) ? payload.data?.versions : [];
  return records
    .filter((entry): entry is JobBundleVersionSummary => typeof entry?.version === 'string' && typeof entry?.id === 'string')
    .map((entry) => ({
      id: entry.id,
      version: entry.version,
      status: typeof entry.status === 'string' ? entry.status : null,
      immutable: Boolean(entry.immutable),
      publishedAt: typeof entry.publishedAt === 'string' ? entry.publishedAt : null,
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString(),
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date(0).toISOString()
    }));
}

export async function fetchOperatorIdentity(token: TokenInput): Promise<OperatorIdentity | null> {
  try {
    const payload = await requestJson<{ data?: { subject?: unknown; scopes?: unknown; kind?: unknown } }>(
      token,
      '/auth/identity',
      {
        errorMessage: 'Failed to load operator identity'
      }
    );
    const data = payload.data;
    if (!data) {
      return null;
    }
    const subject = typeof data.subject === 'string' && data.subject.trim().length > 0 ? data.subject : 'operator';
    const rawScopes = Array.isArray(data.scopes) ? data.scopes : [];
    const scopes = rawScopes.filter((scope): scope is string => typeof scope === 'string');
    const kind = data.kind === 'service' ? 'service' : 'user';
    return { subject, scopes, kind } satisfies OperatorIdentity;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return null;
    }
    throw error;
  }
}

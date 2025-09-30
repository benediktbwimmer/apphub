import type { WorkflowTopologyGraph } from '@apphub/shared/workflowTopology';
import { z } from 'zod';

import { API_BASE_URL } from '../config';
import {
  createApiClient,
  type AuthorizedFetch,
  type QueryValue,
  ApiError,
  ensureOk as ensureResponseOk,
  parseJson as parseResponseJson
} from '../lib/apiClient';

export { ApiError } from '../lib/apiClient';
export type { AuthorizedFetch } from '../lib/apiClient';

const ensureOk = ensureResponseOk;
const parseJson = parseResponseJson;

export { ensureOk, parseJson };
import type {
  WorkflowAssetDetail,
  WorkflowAssetInventoryEntry,
  WorkflowAssetPartitions,
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

function createClient(fetcher: AuthorizedFetch) {
  return createApiClient(fetcher, { baseUrl: API_BASE_URL });
}

type RequestJsonOptions<T> = {
  method?: string;
  headers?: HeadersInit;
  query?: Record<string, QueryValue>;
  body?: BodyInit;
  json?: unknown;
  schema?: z.ZodType<T>;
  errorMessage: string;
};

async function requestJson<T = unknown>(
  fetcher: AuthorizedFetch,
  path: string,
  options: RequestJsonOptions<T>
): Promise<T> {
  const client = createClient(fetcher);
  const { method, headers, query, body, json, schema, errorMessage } = options;
  if (schema) {
    return client.request(path, { method, headers, query, body, json, schema, errorMessage });
  }
  return client.request(path, { method, headers, query, body, json, errorMessage }) as Promise<T>;
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
  runtime?: 'node' | 'python' | 'docker';
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
  runtime: 'node' | 'python' | 'docker';
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
  fetcher: AuthorizedFetch
): Promise<WorkflowGraphFetchResult> {
  const payload = await requestJson(fetcher, '/workflows/graph', {
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

export async function listWorkflowDefinitions(fetcher: AuthorizedFetch): Promise<WorkflowDefinition[]> {
  const payload = await requestJson(fetcher, '/workflows', {
    schema: optionalDataArraySchema,
    errorMessage: 'Failed to load workflows'
  });
  if (!Array.isArray(payload.data)) {
    return [];
  }
  return payload.data
    .map((entry) => normalizeWorkflowDefinition(entry))
    .filter((entry): entry is WorkflowDefinition => Boolean(entry))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

type WorkflowAnalyticsQuery = {
  range?: '24h' | '7d' | '30d';
  bucket?: '15m' | 'hour' | 'day';
  from?: string;
  to?: string;
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
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export async function getWorkflowStats(
  fetcher: AuthorizedFetch,
  slug: string,
  params?: WorkflowAnalyticsQuery
) {
  const query = buildAnalyticsQuery(params);
  const payload = await requestJson(fetcher, `/workflows/${slug}/stats${query}`, {
    schema: optionalDataSchema,
    errorMessage: 'Failed to load workflow stats'
  });
  const stats = normalizeWorkflowRunStats(payload.data);
  if (!stats) {
    throw new ApiError('Failed to parse workflow stats', 500, payload);
  }
  return stats;
}

export async function getWorkflowRunMetrics(
  fetcher: AuthorizedFetch,
  slug: string,
  params?: WorkflowAnalyticsQuery
) {
  const query = buildAnalyticsQuery(params);
  const payload = await requestJson(fetcher, `/workflows/${slug}/run-metrics${query}`, {
    schema: optionalDataSchema,
    errorMessage: 'Failed to load workflow run metrics'
  });
  const metrics = normalizeWorkflowRunMetrics(payload.data);
  if (!metrics) {
    throw new ApiError('Failed to parse workflow run metrics', 500, payload);
  }
  return metrics;
}

export async function getWorkflowAutoMaterializeOps(
  fetcher: AuthorizedFetch,
  slug: string,
  options: { limit?: number; offset?: number } = {}
): Promise<WorkflowAutoMaterializeOps> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  if (options.offset !== undefined) {
    params.set('offset', String(options.offset));
  }
  const query = params.toString();
  const payload = await requestJson(
    fetcher,
    `/workflows/${encodeURIComponent(slug)}/auto-materialize${query ? `?${query}` : ''}`,
    {
      schema: optionalDataSchema,
      errorMessage: 'Failed to load auto-materialization activity'
    }
  );
  const ops = normalizeWorkflowAutoMaterializeOps(payload);
  if (!ops) {
    throw new ApiError('Failed to parse auto-materialization response', 500, payload);
  }
  return ops;
}

export async function getWorkflowDetail(
  fetcher: AuthorizedFetch,
  slug: string
): Promise<{ workflow: WorkflowDefinition; runs: WorkflowRun[] }> {
  const payload = await requestJson(fetcher, `/workflows/${slug}`, {
    schema: z.object({
      data: z
        .object({
          workflow: z.unknown().optional(),
          runs: z.array(z.unknown()).optional()
        })
        .optional()
    }),
    errorMessage: 'Failed to load workflow details'
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
  fetcher: AuthorizedFetch,
  runId: string
): Promise<{ run: WorkflowRun; steps: WorkflowRunStep[] }> {
  const payload = await requestJson(fetcher, `/workflow-runs/${runId}/steps`, {
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
  fetcher: AuthorizedFetch,
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
  const payload = await requestJson(
    fetcher,
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
  fetcher: AuthorizedFetch,
  slug: string,
  triggerId: string
): Promise<WorkflowEventTrigger> {
  const payload = await requestJson(
    fetcher,
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
  fetcher: AuthorizedFetch,
  slug: string,
  input: WorkflowEventTriggerCreateInput
): Promise<WorkflowEventTrigger> {
  const payload = await requestJson(fetcher, `/workflows/${encodeURIComponent(slug)}/triggers`, {
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
  fetcher: AuthorizedFetch,
  slug: string,
  triggerId: string,
  input: WorkflowEventTriggerUpdateInput
): Promise<WorkflowEventTrigger> {
  const payload = await requestJson(
    fetcher,
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
  fetcher: AuthorizedFetch,
  slug: string,
  triggerId: string
): Promise<void> {
  await requestJson(
    fetcher,
    `/workflows/${encodeURIComponent(slug)}/triggers/${encodeURIComponent(triggerId)}`,
    {
      method: 'DELETE',
      errorMessage: 'Failed to delete workflow event trigger'
    }
  );
}

export async function listWorkflowTriggerDeliveries(
  fetcher: AuthorizedFetch,
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
  const response = await fetcher(
    `${API_BASE_URL}/workflows/${encodeURIComponent(slug)}/triggers/${encodeURIComponent(triggerId)}/deliveries${
      search ? `?${search}` : ''
    }`
  );
  await ensureOk(response, 'Failed to load workflow trigger deliveries');
  const payload = await parseJson<{
    data?: unknown[];
    meta?: {
      workflow?: { id?: unknown; slug?: unknown; name?: unknown };
      trigger?: { id?: unknown; name?: unknown; eventType?: unknown; status?: unknown };
      limit?: unknown;
    };
  }>(response);
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
    throw new ApiError('Invalid trigger deliveries response', response.status, payload);
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

export async function listWorkflowEventSamples(
  fetcher: AuthorizedFetch,
  query: WorkflowEventSampleQuery = {}
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
  const response = await fetcher(`${API_BASE_URL}/admin/events${search ? `?${search}` : ''}`);
  await ensureOk(response, 'Failed to load workflow events');
  const payload = await parseJson<{ data?: unknown; schema?: unknown }>(response);
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
  fetcher: AuthorizedFetch
): Promise<WorkflowEventSchedulerHealth | null> {
  const response = await fetcher(`${API_BASE_URL}/admin/event-health`);
  await ensureOk(response, 'Failed to load workflow event health');
  const payload = await parseJson<unknown>(response);
  return normalizeWorkflowEventHealth(payload);
}

export async function cancelEventRetry(fetcher: AuthorizedFetch, eventId: string): Promise<void> {
  const response = await fetcher(
    `${API_BASE_URL}/admin/retries/events/${encodeURIComponent(eventId)}/cancel`,
    {
      method: 'POST'
    }
  );
  await ensureOk(response, 'Failed to cancel event retry');
}

export async function forceEventRetry(fetcher: AuthorizedFetch, eventId: string): Promise<void> {
  const response = await fetcher(
    `${API_BASE_URL}/admin/retries/events/${encodeURIComponent(eventId)}/force`,
    {
      method: 'POST'
    }
  );
  await ensureOk(response, 'Failed to run event retry');
}

export async function cancelTriggerRetry(fetcher: AuthorizedFetch, deliveryId: string): Promise<void> {
  const response = await fetcher(
    `${API_BASE_URL}/admin/retries/deliveries/${encodeURIComponent(deliveryId)}/cancel`,
    {
      method: 'POST'
    }
  );
  await ensureOk(response, 'Failed to cancel trigger delivery retry');
}

export async function forceTriggerRetry(fetcher: AuthorizedFetch, deliveryId: string): Promise<void> {
  const response = await fetcher(
    `${API_BASE_URL}/admin/retries/deliveries/${encodeURIComponent(deliveryId)}/force`,
    {
      method: 'POST'
    }
  );
  await ensureOk(response, 'Failed to run trigger delivery retry');
}

export async function cancelWorkflowStepRetry(fetcher: AuthorizedFetch, stepId: string): Promise<void> {
  const response = await fetcher(
    `${API_BASE_URL}/admin/retries/workflow-steps/${encodeURIComponent(stepId)}/cancel`,
    {
      method: 'POST'
    }
  );
  await ensureOk(response, 'Failed to cancel workflow step retry');
}

export async function forceWorkflowStepRetry(fetcher: AuthorizedFetch, stepId: string): Promise<void> {
  const response = await fetcher(
    `${API_BASE_URL}/admin/retries/workflow-steps/${encodeURIComponent(stepId)}/force`,
    {
      method: 'POST'
    }
  );
  await ensureOk(response, 'Failed to run workflow step retry');
}

export async function getWorkflowTimeline(
  fetcher: AuthorizedFetch,
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
  const search = params.toString();
  const response = await fetcher(
    `${API_BASE_URL}/workflows/${encodeURIComponent(slug)}/timeline${search ? `?${search}` : ''}`
  );
  await ensureOk(response, 'Failed to load workflow timeline');
  const payload = await parseJson<{ data?: unknown; meta?: unknown }>(response);
  const snapshot = normalizeWorkflowTimeline(payload.data);
  if (!snapshot) {
    throw new ApiError('Invalid workflow timeline response', response.status, payload);
  }
  const meta = normalizeWorkflowTimelineMeta(payload.meta);
  return { snapshot, meta } satisfies WorkflowTimelineResult;
}

export async function fetchWorkflowDefinitions(
  fetcher: AuthorizedFetch
): Promise<WorkflowDefinition[]> {
  const response = await fetcher(`${API_BASE_URL}/workflows`);
  await ensureOk(response, 'Failed to load workflows');
  const payload = await parseJson<{ data?: unknown }>(response);
  if (!payload.data || !Array.isArray(payload.data)) {
    return [];
  }
  const definitions = payload.data
    .map((entry) => normalizeWorkflowDefinition(entry))
    .filter((definition): definition is WorkflowDefinition => Boolean(definition));
  return definitions;
}

export async function fetchWorkflowAssets(
  fetcher: AuthorizedFetch,
  slug: string
): Promise<WorkflowAssetInventoryEntry[]> {
  const response = await fetcher(`${API_BASE_URL}/workflows/${encodeURIComponent(slug)}/assets`);
  await ensureOk(response, 'Failed to load workflow assets');
  const payload = await parseJson<unknown>(response);
  return normalizeWorkflowAssetInventoryResponse(payload);
}

export async function fetchWorkflowAssetHistory(
  fetcher: AuthorizedFetch,
  slug: string,
  assetId: string,
  options: { limit?: number } = {}
): Promise<WorkflowAssetDetail | null> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  const query = params.toString();
  const response = await fetcher(
    `${API_BASE_URL}/workflows/${encodeURIComponent(slug)}/assets/${encodeURIComponent(assetId)}/history${
      query ? `?${query}` : ''
    }`
  );
  if (response.status === 404) {
    return null;
  }
  await ensureOk(response, 'Failed to load workflow asset history');
  const payload = await parseJson<unknown>(response);
  return normalizeWorkflowAssetDetailResponse(payload);
}

export async function fetchWorkflowAssetPartitions(
  fetcher: AuthorizedFetch,
  slug: string,
  assetId: string,
  options: { lookback?: number } = {}
): Promise<WorkflowAssetPartitions | null> {
  const params = new URLSearchParams();
  if (options.lookback !== undefined) {
    params.set('lookback', String(options.lookback));
  }
  const query = params.toString();
  const response = await fetcher(
    `${API_BASE_URL}/workflows/${encodeURIComponent(slug)}/assets/${encodeURIComponent(assetId)}/partitions${
      query ? `?${query}` : ''
    }`
  );
  if (response.status === 404) {
    return null;
  }
  await ensureOk(response, 'Failed to load workflow asset partitions');
  const payload = await parseJson<unknown>(response);
  return normalizeWorkflowAssetPartitionsResponse(payload);
}

export async function createWorkflowDefinition(
  fetcher: AuthorizedFetch,
  input: WorkflowCreateInput
): Promise<WorkflowDefinition> {
  const response = await fetcher(`${API_BASE_URL}/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  await ensureOk(response, 'Failed to create workflow');
  const payload = await parseJson<{ data?: unknown }>(response);
  const workflow = normalizeWorkflowDefinition(payload.data);
  if (!workflow) {
    throw new ApiError('Invalid workflow response', response.status, payload);
  }
  return workflow;
}

export async function updateWorkflowDefinition(
  fetcher: AuthorizedFetch,
  slug: string,
  input: WorkflowUpdateInput
): Promise<WorkflowDefinition> {
  const response = await fetcher(`${API_BASE_URL}/workflows/${slug}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  await ensureOk(response, 'Failed to update workflow');
  const payload = await parseJson<{ data?: unknown }>(response);
  const workflow = normalizeWorkflowDefinition(payload.data);
  if (!workflow) {
    throw new ApiError('Invalid workflow response', response.status, payload);
  }
  return workflow;
}

export async function listJobDefinitions(fetcher: AuthorizedFetch): Promise<JobDefinitionSummary[]> {
  const response = await fetcher(`${API_BASE_URL}/jobs`);
  await ensureOk(response, 'Failed to load job definitions');
  const payload = await parseJson<{ data?: JobDefinitionSummary[] }>(response);
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
  fetcher: AuthorizedFetch,
  input: JobDefinitionCreateInput
): Promise<JobDefinitionSummary> {
  const response = await fetcher(`${API_BASE_URL}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  await ensureOk(response, 'Failed to create job definition');
  const payload = await parseJson<{ data?: JobDefinitionSummary }>(response);
  if (!payload.data) {
    throw new ApiError('Invalid job response', response.status, payload);
  }
  return {
    ...payload.data,
    registryRef: payload.data.registryRef ?? null,
    timeoutMs: payload.data.timeoutMs ?? null
  } satisfies JobDefinitionSummary;
}

export async function listServices(fetcher: AuthorizedFetch): Promise<ServiceSummary[]> {
  const response = await fetcher(`${API_BASE_URL}/services`);
  await ensureOk(response, 'Failed to load services');
  const payload = await parseJson<{ data?: ServiceSummary[] }>(response);
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
  fetcher: AuthorizedFetch,
  slug: string
): Promise<JobBundleVersionSummary[]> {
  const response = await fetcher(`${API_BASE_URL}/job-bundles/${encodeURIComponent(slug)}`);
  await ensureOk(response, 'Failed to load job bundle versions');
  const payload = await parseJson<{
    data?: { versions?: Array<Partial<JobBundleVersionSummary>> };
  }>(response);
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

export async function fetchOperatorIdentity(fetcher: AuthorizedFetch): Promise<OperatorIdentity | null> {
  const response = await fetcher(`${API_BASE_URL}/auth/identity`);
  if (!response.ok && (response.status === 401 || response.status === 403)) {
    return null;
  }
  await ensureOk(response, 'Failed to load operator identity');
  const payload = await parseJson<{ data?: { subject?: unknown; scopes?: unknown; kind?: unknown } }>(response);
  const data = payload.data;
  if (!data) {
    return null;
  }
  const subject = typeof data.subject === 'string' && data.subject.trim().length > 0 ? data.subject : 'operator';
  const rawScopes = Array.isArray(data.scopes) ? data.scopes : [];
  const scopes = rawScopes.filter((scope): scope is string => typeof scope === 'string');
  const kind = data.kind === 'service' ? 'service' : 'user';
  return { subject, scopes, kind } satisfies OperatorIdentity;
}

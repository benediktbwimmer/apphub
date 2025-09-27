import { API_BASE_URL } from '../config';
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
  WorkflowEventTriggerStatus
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
  normalizeWorkflowEventHealth
} from './normalizers';

type FetchArgs = Parameters<typeof fetch>;
type FetchInput = FetchArgs[0];
type FetchInit = FetchArgs[1];

export type AuthorizedFetch = (input: FetchInput, init?: FetchInit) => Promise<Response>;

export type ApiErrorDetails = unknown;

export class ApiError extends Error {
  status: number;
  details: ApiErrorDetails;

  constructor(message: string, status: number, details?: ApiErrorDetails) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
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
};

export type WorkflowEventSamplesResponse = {
  samples: WorkflowEventSample[];
  schema: WorkflowEventSchema | null;
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
  runtime?: 'node' | 'python';
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
  runtime: 'node' | 'python';
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

export async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError('Failed to parse server response', response.status, text);
  }
}

export async function ensureOk(response: Response, fallbackMessage: string): Promise<Response> {
  if (response.ok) {
    return response;
  }
  let details: ApiErrorDetails = null;
  let message = fallbackMessage;
  try {
    const text = await response.text();
    if (text) {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown> | null;
        const container = parsed && typeof parsed === 'object' ? parsed : null;
        const errorValue = container && 'error' in container ? (container.error as unknown) : parsed;
        details = errorValue ?? parsed;
        let candidate: unknown =
          container && typeof container.error === 'string'
            ? container.error
            : container && typeof container.message === 'string'
              ? container.message
              : null;
        if (!candidate && errorValue && typeof errorValue === 'object' && !Array.isArray(errorValue)) {
          const record = errorValue as Record<string, unknown>;
          const formErrors = record.formErrors;
          if (Array.isArray(formErrors)) {
            const first = formErrors.find(
              (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
            );
            if (first) {
              candidate = first;
            }
          }
        }
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
          message = candidate.trim();
        } else {
          const trimmed = text.trim();
          if (trimmed.length > 0) {
            message = trimmed;
          }
        }
      } catch {
        const trimmed = text.trim();
        details = trimmed || text;
        if (trimmed.length > 0) {
          message = trimmed;
        }
      }
    }
  } catch {
    // Ignore secondary parse errors.
  }
  throw new ApiError(message, response.status, details);
}

export async function listWorkflowDefinitions(fetcher: AuthorizedFetch): Promise<WorkflowDefinition[]> {
  const response = await fetcher(`${API_BASE_URL}/workflows`);
  await ensureOk(response, 'Failed to load workflows');
  const payload = await parseJson<{ data?: unknown[] }>(response);
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
  const response = await fetcher(`${API_BASE_URL}/workflows/${slug}/stats${query}`);
  await ensureOk(response, 'Failed to load workflow stats');
  const payload = await parseJson<{ data?: unknown }>(response);
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
  const response = await fetcher(`${API_BASE_URL}/workflows/${slug}/run-metrics${query}`);
  await ensureOk(response, 'Failed to load workflow run metrics');
  const payload = await parseJson<{ data?: unknown }>(response);
  const metrics = normalizeWorkflowRunMetrics(payload.data);
  if (!metrics) {
    throw new ApiError('Failed to parse workflow run metrics', 500, payload);
  }
  return metrics;
}

export async function getWorkflowDetail(
  fetcher: AuthorizedFetch,
  slug: string
): Promise<{ workflow: WorkflowDefinition; runs: WorkflowRun[] }> {
  const response = await fetcher(`${API_BASE_URL}/workflows/${slug}`);
  await ensureOk(response, 'Failed to load workflow details');
  const payload = await parseJson<{ data?: { workflow?: unknown; runs?: unknown[] } }>(response);
  const workflow = normalizeWorkflowDefinition(payload.data?.workflow);
  if (!workflow) {
    throw new ApiError('Workflow response missing definition', response.status, payload);
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
  const response = await fetcher(`${API_BASE_URL}/workflow-runs/${runId}/steps`);
  await ensureOk(response, 'Failed to load workflow run steps');
  const payload = await parseJson<{ data?: { run?: unknown; steps?: unknown[] } }>(response);
  const run = normalizeWorkflowRun(payload.data?.run);
  if (!run) {
    throw new ApiError('Workflow run response missing run', response.status, payload);
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
  const response = await fetcher(
    `${API_BASE_URL}/workflows/${encodeURIComponent(slug)}/triggers${query ? `?${query}` : ''}`
  );
  await ensureOk(response, 'Failed to load workflow event triggers');
  const payload = await parseJson<{
    data?: {
      workflow?: { id?: unknown; slug?: unknown; name?: unknown };
      triggers?: unknown[];
    };
  }>(response);
  const workflowRaw = payload.data?.workflow ?? {};
  const workflowId = typeof workflowRaw.id === 'string' ? workflowRaw.id : null;
  const workflowSlug = typeof workflowRaw.slug === 'string' ? workflowRaw.slug : slug;
  const workflowName = typeof workflowRaw.name === 'string' ? workflowRaw.name : workflowSlug;
  if (!workflowId || !workflowSlug || !workflowName) {
    throw new ApiError('Invalid workflow trigger response', response.status, payload);
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
  const response = await fetcher(
    `${API_BASE_URL}/workflows/${encodeURIComponent(slug)}/triggers/${encodeURIComponent(triggerId)}`
  );
  await ensureOk(response, 'Failed to load workflow event trigger');
  const payload = await parseJson<{ data?: unknown }>(response);
  const trigger = normalizeWorkflowEventTrigger(payload.data);
  if (!trigger) {
    throw new ApiError('Invalid workflow trigger response', response.status, payload);
  }
  return trigger;
}

export async function createWorkflowEventTrigger(
  fetcher: AuthorizedFetch,
  slug: string,
  input: WorkflowEventTriggerCreateInput
): Promise<WorkflowEventTrigger> {
  const response = await fetcher(`${API_BASE_URL}/workflows/${encodeURIComponent(slug)}/triggers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  await ensureOk(response, 'Failed to create workflow event trigger');
  const payload = await parseJson<{ data?: unknown }>(response);
  const trigger = normalizeWorkflowEventTrigger(payload.data);
  if (!trigger) {
    throw new ApiError('Invalid workflow trigger response', response.status, payload);
  }
  return trigger;
}

export async function updateWorkflowEventTrigger(
  fetcher: AuthorizedFetch,
  slug: string,
  triggerId: string,
  input: WorkflowEventTriggerUpdateInput
): Promise<WorkflowEventTrigger> {
  const response = await fetcher(
    `${API_BASE_URL}/workflows/${encodeURIComponent(slug)}/triggers/${encodeURIComponent(triggerId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    }
  );
  await ensureOk(response, 'Failed to update workflow event trigger');
  const payload = await parseJson<{ data?: unknown }>(response);
  const trigger = normalizeWorkflowEventTrigger(payload.data);
  if (!trigger) {
    throw new ApiError('Invalid workflow trigger response', response.status, payload);
  }
  return trigger;
}

export async function deleteWorkflowEventTrigger(
  fetcher: AuthorizedFetch,
  slug: string,
  triggerId: string
): Promise<void> {
  const response = await fetcher(
    `${API_BASE_URL}/workflows/${encodeURIComponent(slug)}/triggers/${encodeURIComponent(triggerId)}`,
    { method: 'DELETE' }
  );
  if (response.status === 204) {
    return;
  }
  await ensureOk(response, 'Failed to delete workflow event trigger');
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
  const search = params.toString();
  const response = await fetcher(`${API_BASE_URL}/admin/events${search ? `?${search}` : ''}`);
  await ensureOk(response, 'Failed to load workflow events');
  const payload = await parseJson<{ data?: unknown; schema?: unknown }>(response);
  const samples = normalizeWorkflowEventSamples(payload.data);
  const schema = normalizeWorkflowEventSchema(payload.schema);
  return { samples, schema: schema ?? null };
}

export async function getWorkflowEventHealth(
  fetcher: AuthorizedFetch
): Promise<WorkflowEventSchedulerHealth | null> {
  const response = await fetcher(`${API_BASE_URL}/admin/event-health`);
  await ensureOk(response, 'Failed to load workflow event health');
  const payload = await parseJson<unknown>(response);
  return normalizeWorkflowEventHealth(payload);
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

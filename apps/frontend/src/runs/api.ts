import { API_BASE_URL } from '../config';
import { ApiError } from '../lib/apiClient';
import { ensureOk, parseJson, type AuthorizedFetch } from '../workflows/api';
import { normalizeWorkflowRun } from '../workflows/normalizers';
import type { JobRunSummary } from '../jobs/api';
import type { WorkflowRun, WorkflowTriggerDelivery } from '../workflows/types';
import type {
  WorkflowRunDiffPayload,
  WorkflowRunHistoryEntry,
  WorkflowRunAssetSummary,
  WorkflowRunDiffEntry,
  WorkflowRunStatusDiffEntry,
  WorkflowRunAssetDiffEntry,
  WorkflowRunAssetDescriptor,
  WorkflowRunReplayResult,
  WorkflowRunStaleAssetWarning
} from './types';

export type RunListMeta = {
  limit: number;
  offset: number;
  nextOffset: number | null;
  hasMore: boolean;
};

export type JobRunListItem = {
  run: JobRunSummary;
  job: {
    id: string;
    slug: string;
    name: string;
    version: number;
    type: string;
    runtime: 'node' | 'python' | 'docker' | 'module';
  };
};

export type WorkflowActivityTriggerSummary = {
  id: string | null;
  name: string | null;
  eventType: string | null;
  eventSource: string | null;
  status: string | null;
};

type WorkflowActivityBase = {
  id: string;
  status: string;
  occurredAt: string;
  workflow: {
    id: string;
    slug: string;
    name: string;
    version: number;
  };
};

export type WorkflowActivityRunEntry = WorkflowActivityBase & {
  kind: 'run';
  run: WorkflowRun;
  delivery: null;
  linkedRun: null;
  trigger: null;
};

export type WorkflowActivityDeliveryEntry = WorkflowActivityBase & {
  kind: 'delivery';
  run: null;
  delivery: WorkflowTriggerDelivery;
  linkedRun: WorkflowRun | null;
  trigger: WorkflowActivityTriggerSummary | null;
};

export type WorkflowActivityEntry = WorkflowActivityRunEntry | WorkflowActivityDeliveryEntry;

type JobRunListResponse = {
  data?: unknown;
  meta?: { limit?: number; offset?: number };
};

type WorkflowActivityListResponse = {
  data?: unknown;
  meta?: { limit?: number; offset?: number };
};

export type WorkflowActivityFilters = {
  statuses?: string[];
  workflowSlugs?: string[];
  triggerTypes?: string[];
  triggerIds?: string[];
  kinds?: ('run' | 'delivery')[];
  search?: string;
  from?: string;
  to?: string;
};

export type JobRunFilters = {
  statuses?: string[];
  jobSlugs?: string[];
  runtimes?: string[];
  search?: string;
};

function appendArray(values: string[] | undefined, key: string, query: URLSearchParams): void {
  if (!values || values.length === 0) {
    return;
  }
  const unique = Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
  for (const entry of unique) {
    query.append(key, entry);
  }
}

function buildWorkflowActivityQuery(params: {
  limit?: number;
  offset?: number;
  filters?: WorkflowActivityFilters;
}): string {
  const query = new URLSearchParams();
  if (params.limit !== undefined) {
    query.set('limit', String(params.limit));
  }
  if (params.offset !== undefined) {
    query.set('offset', String(params.offset));
  }
  const filters = params.filters ?? {};
  appendArray(filters.statuses, 'status', query);
  appendArray(filters.workflowSlugs, 'workflow', query);
  appendArray(filters.triggerTypes, 'trigger', query);
  appendArray(filters.triggerIds, 'triggerId', query);
  appendArray(filters.kinds, 'kind', query);
  if (filters.search) {
    query.set('search', filters.search);
  }
  if (filters.from) {
    query.set('from', filters.from);
  }
  if (filters.to) {
    query.set('to', filters.to);
  }
  const result = query.toString();
  return result ? `?${result}` : '';
}

function buildJobRunQuery(params: { limit?: number; offset?: number; filters?: JobRunFilters }): string {
  const query = new URLSearchParams();
  if (params.limit !== undefined) {
    query.set('limit', String(params.limit));
  }
  if (params.offset !== undefined) {
    query.set('offset', String(params.offset));
  }
  const filters = params.filters ?? {};
  appendArray(filters.statuses, 'status', query);
  appendArray(filters.jobSlugs, 'job', query);
  appendArray(filters.runtimes, 'runtime', query);
  if (filters.search) {
    query.set('search', filters.search);
  }
  const result = query.toString();
  return result ? `?${result}` : '';
}

function normalizeJobRunListItem(entry: unknown): JobRunListItem | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const record = entry as { run?: unknown; job?: unknown };
  if (!record.run || typeof record.run !== 'object' || !record.job || typeof record.job !== 'object') {
    return null;
  }
  const jobData = record.job as Record<string, unknown>;
  const runData = record.run as JobRunSummary;
  const slug = typeof jobData.slug === 'string' ? jobData.slug : null;
  const id = typeof jobData.id === 'string' ? jobData.id : null;
  const name = typeof jobData.name === 'string' ? jobData.name : null;
  const version = typeof jobData.version === 'number' ? jobData.version : null;
  const type = typeof jobData.type === 'string' ? jobData.type : null;
  const runtime =
    jobData.runtime === 'python'
      ? 'python'
      : jobData.runtime === 'docker'
        ? 'docker'
        : jobData.runtime === 'module'
          ? 'module'
          : jobData.runtime === 'node'
            ? 'node'
            : null;
  if (!slug || !id || !name || version === null || !type || !runtime) {
    return null;
  }
  if (typeof runData.id !== 'string') {
    return null;
  }
  return {
    run: runData,
    job: {
      id,
      slug,
      name,
      version,
      type,
      runtime
    }
  };
}

function normalizeWorkflowActivityEntry(entry: unknown): WorkflowActivityEntry | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const kind = record.kind === 'run' || record.kind === 'delivery' ? (record.kind as 'run' | 'delivery') : null;
  if (!kind) {
    return null;
  }
  const id = typeof record.id === 'string' ? record.id : null;
  const status = typeof record.status === 'string' ? record.status : null;
  const occurredAt = typeof record.occurredAt === 'string' ? record.occurredAt : null;
  const workflowRaw = record.workflow;
  if (!workflowRaw || typeof workflowRaw !== 'object') {
    return null;
  }
  const workflowData = workflowRaw as Record<string, unknown>;
  const workflowId = typeof workflowData.id === 'string' ? workflowData.id : null;
  const workflowSlug = typeof workflowData.slug === 'string' ? workflowData.slug : null;
  const workflowName = typeof workflowData.name === 'string' ? workflowData.name : null;
  const workflowVersion = typeof workflowData.version === 'number' ? workflowData.version : null;
  if (!id || !status || !occurredAt || !workflowId || !workflowSlug || !workflowName || workflowVersion === null) {
    return null;
  }

  let trigger: WorkflowActivityTriggerSummary | null = null;
  if (record.trigger && typeof record.trigger === 'object') {
    const triggerRaw = record.trigger as Record<string, unknown>;
    trigger = {
      id: typeof triggerRaw.id === 'string' ? triggerRaw.id : null,
      name: typeof triggerRaw.name === 'string' ? triggerRaw.name : null,
      eventType: typeof triggerRaw.eventType === 'string' ? triggerRaw.eventType : null,
      eventSource: typeof triggerRaw.eventSource === 'string' ? triggerRaw.eventSource : null,
      status: typeof triggerRaw.status === 'string' ? triggerRaw.status : null
    } satisfies WorkflowActivityTriggerSummary;
  }

  const workflow = {
    id: workflowId,
    slug: workflowSlug,
    name: workflowName,
    version: workflowVersion
  };

  if (kind === 'run') {
    const run = record.run as WorkflowRun | undefined;
    if (!run || typeof run !== 'object' || typeof run.id !== 'string') {
      return null;
    }
    return {
      kind,
      id,
      status,
      occurredAt,
      workflow,
      run,
      delivery: null,
      linkedRun: null,
      trigger: null
    } satisfies WorkflowActivityRunEntry;
  }

  const delivery = record.delivery as WorkflowTriggerDelivery | undefined;
  if (!delivery || typeof delivery !== 'object' || typeof delivery.id !== 'string') {
    return null;
  }

  let linkedRun: WorkflowRun | null = null;
  if (record.linkedRun && typeof record.linkedRun === 'object') {
    const linked = record.linkedRun as WorkflowRun;
    if (typeof linked.id === 'string') {
      linkedRun = linked;
    }
  }

  return {
    kind,
    id,
    status,
    occurredAt,
    workflow,
    run: null,
    delivery,
    linkedRun,
    trigger
  } satisfies WorkflowActivityDeliveryEntry;
}

function normalizeMeta(
  meta: { limit?: number; offset?: number; nextOffset?: number | null; hasMore?: boolean } | undefined,
  fallback: RunListMeta
): RunListMeta {
  const limit = typeof meta?.limit === 'number' ? meta.limit : fallback.limit;
  const offset = typeof meta?.offset === 'number' ? meta.offset : fallback.offset;
  const nextOffset = typeof meta?.nextOffset === 'number' ? meta.nextOffset : null;
  const hasMore = typeof meta?.hasMore === 'boolean' ? meta.hasMore : Boolean(nextOffset !== null);
  return { limit, offset, nextOffset, hasMore };
}

export async function fetchJobRuns(
  fetcher: AuthorizedFetch,
  options: { limit?: number; offset?: number; filters?: JobRunFilters } = {}
): Promise<{ items: JobRunListItem[]; meta: RunListMeta }> {
  const query = buildJobRunQuery(options);
  const response = await fetcher(`${API_BASE_URL}/job-runs${query}`);
  await ensureOk(response, 'Failed to load job runs');
  const payload = await parseJson<JobRunListResponse>(response);
  const rawItems = Array.isArray(payload.data) ? payload.data : [];
  const items = rawItems
    .map((entry) => normalizeJobRunListItem(entry))
    .filter((entry): entry is JobRunListItem => entry !== null);
  const meta = normalizeMeta(payload.meta, {
    limit: options.limit ?? 25,
    offset: options.offset ?? 0,
    nextOffset: null,
    hasMore: false
  });
  return { items, meta };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNotNull<TValue>(value: TValue | null | undefined): value is TValue {
  return value !== null && value !== undefined;
}

function normalizeWorkflowRunHistoryEntry(entry: unknown): WorkflowRunHistoryEntry | null {
  if (!isRecord(entry)) {
    return null;
  }
  const id = typeof entry.id === 'string' ? entry.id : null;
  const workflowRunId = typeof entry.workflowRunId === 'string' ? entry.workflowRunId : null;
  const workflowRunStepId =
    typeof entry.workflowRunStepId === 'string' || entry.workflowRunStepId === null
      ? (entry.workflowRunStepId as string | null)
      : null;
  const stepId = typeof entry.stepId === 'string' || entry.stepId === null ? (entry.stepId as string | null) : null;
  const eventType = typeof entry.eventType === 'string' ? entry.eventType : null;
  const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : null;
  if (!id || !workflowRunId || !eventType || !createdAt) {
    return null;
  }
  return {
    id,
    workflowRunId,
    workflowRunStepId,
    stepId,
    eventType,
    eventPayload: entry.eventPayload ?? null,
    createdAt
  } satisfies WorkflowRunHistoryEntry;
}

function normalizeWorkflowRunAssetSummary(entry: unknown): WorkflowRunAssetSummary | null {
  if (!isRecord(entry)) {
    return null;
  }
  const id = typeof entry.id === 'string' ? entry.id : null;
  const workflowDefinitionId = typeof entry.workflowDefinitionId === 'string' ? entry.workflowDefinitionId : null;
  const workflowRunId = typeof entry.workflowRunId === 'string' ? entry.workflowRunId : null;
  const workflowRunStepId = typeof entry.workflowRunStepId === 'string' ? entry.workflowRunStepId : null;
  const stepId = typeof entry.stepId === 'string' ? entry.stepId : null;
  const assetId = typeof entry.assetId === 'string' ? entry.assetId : null;
  if (!id || !workflowDefinitionId || !workflowRunId || !workflowRunStepId || !stepId || !assetId) {
    return null;
  }
  const partitionKey = typeof entry.partitionKey === 'string' ? entry.partitionKey : null;
  const producedAt = typeof entry.producedAt === 'string' ? entry.producedAt : null;
  const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : null;
  const updatedAt = typeof entry.updatedAt === 'string' ? entry.updatedAt : null;
  if (!createdAt || !updatedAt) {
    return null;
  }
  return {
    id,
    workflowDefinitionId,
    workflowRunId,
    workflowRunStepId,
    stepId,
    assetId,
    partitionKey,
    producedAt,
    payload: entry.payload ?? null,
    freshness: entry.freshness ?? null,
    schema: entry.schema ?? null,
    createdAt,
    updatedAt
  } satisfies WorkflowRunAssetSummary;
}

function normalizeWorkflowRunDiffEntry(entry: unknown): WorkflowRunDiffEntry | null {
  if (!isRecord(entry)) {
    return null;
  }
  const path = typeof entry.path === 'string' ? entry.path : null;
  const change =
    entry.change === 'added' || entry.change === 'removed' || entry.change === 'changed' ? entry.change : null;
  if (!path || !change) {
    return null;
  }
  return {
    path,
    change,
    before: entry.before ?? null,
    after: entry.after ?? null
  } satisfies WorkflowRunDiffEntry;
}

function normalizeWorkflowRunAssetDescriptor(entry: unknown): WorkflowRunAssetDescriptor | null {
  if (!isRecord(entry)) {
    return null;
  }
  const assetId = typeof entry.assetId === 'string' ? entry.assetId : null;
  const stepId = typeof entry.stepId === 'string' ? entry.stepId : null;
  if (!assetId || !stepId) {
    return null;
  }
  const partitionKey = typeof entry.partitionKey === 'string' ? entry.partitionKey : null;
  const producedAt = typeof entry.producedAt === 'string' ? entry.producedAt : null;
  return {
    assetId,
    stepId,
    partitionKey,
    producedAt,
    payload: entry.payload ?? null,
    freshness: entry.freshness ?? null
  } satisfies WorkflowRunAssetDescriptor;
}

function normalizeWorkflowRunAssetDiffEntry(entry: unknown): WorkflowRunAssetDiffEntry | null {
  if (!isRecord(entry)) {
    return null;
  }
  const change =
    entry.change === 'baseOnly' || entry.change === 'compareOnly' || entry.change === 'changed' ? entry.change : null;
  const assetId = typeof entry.assetId === 'string' ? entry.assetId : null;
  const partitionKey = typeof entry.partitionKey === 'string' ? entry.partitionKey : null;
  if (!change || !assetId) {
    return null;
  }
  const base = normalizeWorkflowRunAssetDescriptor(entry.base);
  const compare = normalizeWorkflowRunAssetDescriptor(entry.compare);
  return {
    change,
    assetId,
    partitionKey: partitionKey ?? null,
    base,
    compare
  } satisfies WorkflowRunAssetDiffEntry;
}

function normalizeWorkflowRunStatusDiffEntry(entry: unknown): WorkflowRunStatusDiffEntry | null {
  if (!isRecord(entry)) {
    return null;
  }
  const index = typeof entry.index === 'number' ? entry.index : null;
  const change =
    entry.change === 'identical' ||
    entry.change === 'baseOnly' ||
    entry.change === 'compareOnly' ||
    entry.change === 'changed'
      ? entry.change
      : null;
  if (index === null || change === null) {
    return null;
  }
  return {
    index,
    change,
    base: entry.base ? normalizeWorkflowRunHistoryEntry(entry.base) : null,
    compare: entry.compare ? normalizeWorkflowRunHistoryEntry(entry.compare) : null
  } satisfies WorkflowRunStatusDiffEntry;
}

function normalizeWorkflowRunStaleAssetWarning(entry: unknown): WorkflowRunStaleAssetWarning | null {
  if (!isRecord(entry)) {
    return null;
  }
  const assetId = typeof entry.assetId === 'string' ? entry.assetId : null;
  const stepId = typeof entry.stepId === 'string' ? entry.stepId : null;
  const requestedAt = typeof entry.requestedAt === 'string' ? entry.requestedAt : null;
  if (!assetId || !stepId || !requestedAt) {
    return null;
  }
  const partitionKey = typeof entry.partitionKey === 'string' ? entry.partitionKey : null;
  const requestedBy = typeof entry.requestedBy === 'string' ? entry.requestedBy : null;
  const note = typeof entry.note === 'string' ? entry.note : null;
  return {
    assetId,
    stepId,
    partitionKey,
    requestedAt,
    requestedBy,
    note
  } satisfies WorkflowRunStaleAssetWarning;
}

export async function fetchWorkflowActivity(
  fetcher: AuthorizedFetch,
  options: { limit?: number; offset?: number; filters?: WorkflowActivityFilters } = {}
): Promise<{ items: WorkflowActivityEntry[]; meta: RunListMeta }> {
  const query = buildWorkflowActivityQuery(options);
  const response = await fetcher(`${API_BASE_URL}/workflow-activity${query}`);
  await ensureOk(response, 'Failed to load workflow activity');
  const payload = await parseJson<WorkflowActivityListResponse>(response);
  const rawItems = Array.isArray(payload.data) ? payload.data : [];
  const items = rawItems
    .map((entry) => normalizeWorkflowActivityEntry(entry))
    .filter((entry): entry is WorkflowActivityEntry => entry !== null);
  const meta = normalizeMeta(payload.meta, {
    limit: options.limit ?? 20,
    offset: options.offset ?? 0,
    nextOffset: null,
    hasMore: false
  });
  return { items, meta };
}

export async function retriggerJobRun(fetcher: AuthorizedFetch, entry: JobRunListItem): Promise<void> {
  const payload: Record<string, unknown> = {
    parameters: entry.run.parameters ?? {},
    timeoutMs: entry.run.timeoutMs ?? undefined,
    maxAttempts: entry.run.maxAttempts ?? undefined,
    context: entry.run.context ?? undefined
  };
  if (payload.timeoutMs === undefined) {
    delete payload.timeoutMs;
  }
  if (payload.maxAttempts === undefined) {
    delete payload.maxAttempts;
  }
  if (payload.context === undefined || payload.context === null) {
    delete payload.context;
  }
  const response = await fetcher(`${API_BASE_URL}/jobs/${encodeURIComponent(entry.job.slug)}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  await ensureOk(response, 'Failed to trigger job run');
}

export async function retriggerWorkflowRun(
  fetcher: AuthorizedFetch,
  entry: WorkflowActivityRunEntry
): Promise<void> {
  const payload: Record<string, unknown> = {
    parameters: entry.run.parameters ?? {},
    trigger: entry.run.trigger ?? undefined,
    partitionKey: entry.run.partitionKey ?? undefined,
    triggeredBy: entry.run.triggeredBy ?? undefined
  };
  if (payload.trigger === undefined || payload.trigger === null) {
    delete payload.trigger;
  }
  if (payload.partitionKey === undefined || payload.partitionKey === null) {
    delete payload.partitionKey;
  }
  if (payload.triggeredBy === undefined || payload.triggeredBy === null) {
    delete payload.triggeredBy;
  }
  const response = await fetcher(
    `${API_BASE_URL}/workflows/${encodeURIComponent(entry.workflow.slug)}/run`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );
  await ensureOk(response, 'Failed to trigger workflow run');
}

export class WorkflowRunReplayBlockedError extends Error {
  readonly code = 'stale_assets';
  readonly staleAssets: WorkflowRunStaleAssetWarning[];
  readonly status: number;

  constructor(message: string, staleAssets: WorkflowRunStaleAssetWarning[], status: number) {
    super(message);
    this.name = 'WorkflowRunReplayBlockedError';
    this.staleAssets = staleAssets;
    this.status = status;
  }
}

export async function fetchWorkflowRunDiff(
  fetcher: AuthorizedFetch,
  params: { runId: string; compareTo: string }
): Promise<WorkflowRunDiffPayload> {
  const url = `${API_BASE_URL}/workflow-runs/${encodeURIComponent(params.runId)}/diff?compareTo=${encodeURIComponent(params.compareTo)}`;
  const response = await fetcher(url);
  await ensureOk(response, 'Failed to load workflow run diff');
  const payload = await parseJson<{ data?: unknown }>(response);
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new ApiError('Invalid workflow run diff payload', response.status, payload);
  }

  const baseRaw = isRecord(payload.data.base) ? payload.data.base : null;
  const compareRaw = isRecord(payload.data.compare) ? payload.data.compare : null;
  const diffRaw = isRecord(payload.data.diff) ? payload.data.diff : null;
  const staleRaw = Array.isArray(payload.data.staleAssets) ? payload.data.staleAssets : [];

  const baseRun = baseRaw ? normalizeWorkflowRun(baseRaw.run) : null;
  const compareRun = compareRaw ? normalizeWorkflowRun(compareRaw.run) : null;
  if (!baseRun || !compareRun) {
    throw new ApiError('Invalid workflow run diff payload', response.status, payload);
  }

  const baseHistory = Array.isArray(baseRaw?.history)
    ? baseRaw!.history.map(normalizeWorkflowRunHistoryEntry).filter(isNotNull)
    : [];
  const compareHistory = Array.isArray(compareRaw?.history)
    ? compareRaw!.history.map(normalizeWorkflowRunHistoryEntry).filter(isNotNull)
    : [];

  const baseAssets = Array.isArray(baseRaw?.assets)
    ? baseRaw!.assets.map(normalizeWorkflowRunAssetSummary).filter(isNotNull)
    : [];
  const compareAssets = Array.isArray(compareRaw?.assets)
    ? compareRaw!.assets.map(normalizeWorkflowRunAssetSummary).filter(isNotNull)
    : [];

  const parameterDiff = Array.isArray(diffRaw?.parameters)
    ? diffRaw!.parameters.map(normalizeWorkflowRunDiffEntry).filter(isNotNull)
    : [];
  const contextDiff = Array.isArray(diffRaw?.context)
    ? diffRaw!.context.map(normalizeWorkflowRunDiffEntry).filter(isNotNull)
    : [];
  const outputDiff = Array.isArray(diffRaw?.output)
    ? diffRaw!.output.map(normalizeWorkflowRunDiffEntry).filter(isNotNull)
    : [];
  const statusDiff = Array.isArray(diffRaw?.statusTransitions)
    ? diffRaw!.statusTransitions.map(normalizeWorkflowRunStatusDiffEntry).filter(isNotNull)
    : [];
  const assetDiff = Array.isArray(diffRaw?.assets)
    ? diffRaw!.assets.map(normalizeWorkflowRunAssetDiffEntry).filter(isNotNull)
    : [];

  const staleAssets = staleRaw.map((entry) => normalizeWorkflowRunStaleAssetWarning(entry)).filter(isNotNull);

  return {
    base: {
      run: baseRun,
      history: baseHistory,
      assets: baseAssets
    },
    compare: {
      run: compareRun,
      history: compareHistory,
      assets: compareAssets
    },
    diff: {
      parameters: parameterDiff,
      context: contextDiff,
      output: outputDiff,
      statusTransitions: statusDiff,
      assets: assetDiff
    },
    staleAssets
  } satisfies WorkflowRunDiffPayload;
}

export async function replayWorkflowRun(
  fetcher: AuthorizedFetch,
  runId: string,
  options: { allowStaleAssets?: boolean } = {}
): Promise<WorkflowRunReplayResult> {
  const payload: Record<string, unknown> = {};
  if (options.allowStaleAssets) {
    payload.allowStaleAssets = true;
  }

  const response = await fetcher(`${API_BASE_URL}/workflow-runs/${encodeURIComponent(runId)}/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (response.status === 409) {
    const body = await parseJson<{ error?: string; data?: unknown }>(response);
    const staleAssetsRaw = isRecord(body?.data) && Array.isArray(body.data.staleAssets) ? body.data.staleAssets : [];
    const staleAssets = staleAssetsRaw.map((entry) => normalizeWorkflowRunStaleAssetWarning(entry)).filter(isNotNull);
    const message = typeof body?.error === 'string' ? body.error : 'Workflow replay blocked by stale assets';
    throw new WorkflowRunReplayBlockedError(message, staleAssets, response.status);
  }

  await ensureOk(response, 'Failed to enqueue workflow replay');
  const payloadJson = await parseJson<{ data?: unknown }>(response);
  if (!isRecord(payloadJson) || !isRecord(payloadJson.data)) {
    throw new ApiError('Invalid workflow run replay response', response.status, payloadJson);
  }

  const run = normalizeWorkflowRun(payloadJson.data.run);
  if (!run) {
    throw new ApiError('Invalid workflow run replay response', response.status, payloadJson);
  }

  const staleAssets = Array.isArray(payloadJson.data.staleAssets)
    ? payloadJson.data.staleAssets.map((entry) => normalizeWorkflowRunStaleAssetWarning(entry)).filter(isNotNull)
    : [];

  return {
    run,
    staleAssets
  } satisfies WorkflowRunReplayResult;
}

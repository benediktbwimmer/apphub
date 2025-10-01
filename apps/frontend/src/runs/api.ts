import { API_BASE_URL } from '../config';
import { ensureOk, parseJson, type AuthorizedFetch } from '../workflows/api';
import type { JobRunSummary } from '../jobs/api';
import type { WorkflowRun, WorkflowTriggerDelivery } from '../workflows/types';

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

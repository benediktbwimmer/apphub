import { API_BASE_URL } from '../config';
import { ensureOk, parseJson, type AuthorizedFetch } from '../workflows/api';
import type { JobRunSummary } from '../jobs/api';
import type { WorkflowRun } from '../workflows/types';

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
    runtime: 'node' | 'python';
  };
};

export type WorkflowRunListItem = {
  run: WorkflowRun;
  workflow: {
    id: string;
    slug: string;
    name: string;
    version: number;
  };
};

type JobRunListResponse = {
  data?: unknown;
  meta?: { limit?: number; offset?: number };
};

type WorkflowRunListResponse = {
  data?: unknown;
  meta?: { limit?: number; offset?: number };
};

function buildQuery(params: { limit?: number; offset?: number }): string {
  const query = new URLSearchParams();
  if (params.limit !== undefined) {
    query.set('limit', String(params.limit));
  }
  if (params.offset !== undefined) {
    query.set('offset', String(params.offset));
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
  const runtime = jobData.runtime === 'python' ? 'python' : jobData.runtime === 'node' ? 'node' : null;
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

function normalizeWorkflowRunListItem(entry: unknown): WorkflowRunListItem | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const record = entry as { run?: unknown; workflow?: unknown };
  if (!record.run || typeof record.run !== 'object' || !record.workflow || typeof record.workflow !== 'object') {
    return null;
  }
  const workflowData = record.workflow as Record<string, unknown>;
  const runData = record.run as WorkflowRun;
  const slug = typeof workflowData.slug === 'string' ? workflowData.slug : null;
  const id = typeof workflowData.id === 'string' ? workflowData.id : null;
  const name = typeof workflowData.name === 'string' ? workflowData.name : null;
  const version = typeof workflowData.version === 'number' ? workflowData.version : null;
  if (!slug || !id || !name || version === null) {
    return null;
  }
  if (typeof runData.id !== 'string') {
    return null;
  }
  return {
    run: runData,
    workflow: {
      id,
      slug,
      name,
      version
    }
  };
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
  options: { limit?: number; offset?: number } = {}
): Promise<{ items: JobRunListItem[]; meta: RunListMeta }> {
  const query = buildQuery(options);
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

export async function fetchWorkflowRuns(
  fetcher: AuthorizedFetch,
  options: { limit?: number; offset?: number } = {}
): Promise<{ items: WorkflowRunListItem[]; meta: RunListMeta }> {
  const query = buildQuery(options);
  const response = await fetcher(`${API_BASE_URL}/workflow-runs${query}`);
  await ensureOk(response, 'Failed to load workflow runs');
  const payload = await parseJson<WorkflowRunListResponse>(response);
  const rawItems = Array.isArray(payload.data) ? payload.data : [];
  const items = rawItems
    .map((entry) => normalizeWorkflowRunListItem(entry))
    .filter((entry): entry is WorkflowRunListItem => entry !== null);
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
  entry: WorkflowRunListItem
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

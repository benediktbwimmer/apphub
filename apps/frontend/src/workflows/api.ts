import { API_BASE_URL } from '../config';
import type { WorkflowDefinition, WorkflowRun, WorkflowRunStep } from './types';
import {
  normalizeWorkflowDefinition,
  normalizeWorkflowRun,
  normalizeWorkflowRunStep
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
};

export type WorkflowServiceRequestInput = {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string | { secret: { source: 'env' | 'store'; key: string; prefix?: string } }>;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
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
  metadata?: WorkflowMetadataInput;
};

export type JobDefinitionCreateInput = {
  slug: string;
  name: string;
  version?: number;
  type: 'batch' | 'service-triggered' | 'manual';
  entryPoint: string;
  timeoutMs?: number | null;
  retryPolicy?: unknown;
  parametersSchema?: Record<string, unknown>;
  defaultParameters?: Record<string, unknown>;
  metadata?: unknown;
};

export type JobDefinitionSummary = {
  id: string;
  slug: string;
  name: string;
  version: number;
  type: string;
  entryPoint: string;
  registryRef: string | null;
  parametersSchema: unknown;
  defaultParameters: unknown;
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

export type OperatorIdentity = {
  subject: string;
  scopes: string[];
  kind: 'user' | 'service';
};

async function parseJson<T>(response: Response): Promise<T> {
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

async function ensureOk(response: Response, fallbackMessage: string): Promise<Response> {
  if (response.ok) {
    return response;
  }
  let details: ApiErrorDetails = null;
  let message = fallbackMessage;
  try {
    const text = await response.text();
    details = text;
    if (text) {
      try {
        const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
        const extracted =
          typeof parsed.error === 'string'
            ? parsed.error
            : typeof parsed.message === 'string'
              ? parsed.message
              : null;
        if (extracted && extracted.trim().length > 0) {
          message = extracted.trim();
        } else if (!parsed || typeof parsed !== 'object') {
          message = text;
        }
      } catch {
        message = text;
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

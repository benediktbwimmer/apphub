import { API_BASE_URL } from '../config';
import { coreRequest, CoreApiError } from '../core/api';
import { ApiError, createApiClient, type AuthorizedFetch } from '../lib/apiClient';
import { normalizeWorkflowSchedule, toRecord } from '../workflows/normalizers';
import type { WorkflowSchedule } from '../workflows/types';

type WorkflowSummary = {
  id: string;
  slug: string;
  name: string;
};

export type WorkflowScheduleSummary = {
  schedule: WorkflowSchedule;
  workflow: WorkflowSummary;
};

export type ScheduleCreateInput = {
  workflowSlug: string;
  name?: string | null;
  description?: string | null;
  cron: string;
  timezone?: string | null;
  parameters?: Record<string, unknown> | null;
  startWindow?: string | null;
  endWindow?: string | null;
  catchUp?: boolean;
  isActive?: boolean;
};

export type ScheduleUpdateInput = {
  scheduleId: string;
  name?: string | null;
  description?: string | null;
  cron?: string;
  timezone?: string | null;
  parameters?: Record<string, unknown> | null;
  startWindow?: string | null;
  endWindow?: string | null;
  catchUp?: boolean;
  isActive?: boolean;
};

function parseWorkflowSummary(raw: unknown): WorkflowSummary | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const id = typeof record.id === 'string' ? record.id : null;
  const slug = typeof record.slug === 'string' ? record.slug : null;
  const name = typeof record.name === 'string' ? record.name : null;
  if (!id || !slug || !name) {
    return null;
  }
  return { id, slug, name } satisfies WorkflowSummary;
}

type Token = string | null | undefined;
type TokenInput = Token | AuthorizedFetch;

type CoreJsonOptions = {
  method?: string;
  url: string;
  body?: unknown;
  signal?: AbortSignal;
  errorMessage: string;
};

function ensureToken(input: TokenInput): string {
  if (typeof input === 'function') {
    const fetcher = input as AuthorizedFetch & { authToken?: string | null | undefined };
    const candidate = fetcher.authToken;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
    if (typeof candidate === 'string') {
      return candidate;
    }
  } else if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  throw new Error('Authentication required for schedule requests.');
}

function toApiError(error: CoreApiError, fallback: string): ApiError {
  const message = error.message && error.message.trim().length > 0 ? error.message : fallback;
  return new ApiError(message, error.status ?? 500, error.details ?? null);
}

async function coreJson<T>(token: TokenInput, options: CoreJsonOptions): Promise<T> {
  if (typeof token === 'function') {
    const client = createApiClient(token, { baseUrl: API_BASE_URL });
    const result = await client.request(options.url, {
      method: options.method,
      json: options.body,
      errorMessage: options.errorMessage,
      signal: options.signal
    });
    return result as T;
  }
  try {
    return (await coreRequest<T>(ensureToken(token), {
      method: options.method,
      url: options.url,
      body: options.body,
      signal: options.signal
    })) as T;
  } catch (error) {
    if (error instanceof CoreApiError) {
      throw toApiError(error, options.errorMessage);
    }
    throw error;
  }
}

export async function fetchSchedules(token: TokenInput): Promise<WorkflowScheduleSummary[]> {
  const payload = await coreJson<{ data?: unknown }>(token, {
    url: '/workflow-schedules',
    errorMessage: 'Failed to load workflow schedules'
  });
  if (!payload || !Array.isArray(payload.data)) {
    return [];
  }
  const summaries: WorkflowScheduleSummary[] = [];
  for (const entry of payload.data as unknown[]) {
    const record = toRecord(entry);
    if (!record) {
      continue;
    }
    const schedule = normalizeWorkflowSchedule(record.schedule);
    if (!schedule) {
      continue;
    }
    const workflow = parseWorkflowSummary(record.workflow);
    if (!workflow) {
      continue;
    }
    summaries.push({ schedule, workflow });
  }
  return summaries;
}

export async function createSchedule(
  token: TokenInput,
  input: ScheduleCreateInput
): Promise<WorkflowScheduleSummary> {
  const body = {
    name: input.name ?? undefined,
    description: input.description ?? undefined,
    cron: input.cron,
    timezone: input.timezone ?? undefined,
    parameters: input.parameters ?? undefined,
    startWindow: input.startWindow ?? undefined,
    endWindow: input.endWindow ?? undefined,
    catchUp: input.catchUp,
    isActive: input.isActive
  } satisfies Record<string, unknown>;

  const payload = await coreJson<{ data?: unknown }>(token, {
    method: 'POST',
    url: `/workflows/${encodeURIComponent(input.workflowSlug)}/schedules`,
    body,
    errorMessage: 'Failed to create schedule'
  });
  const dataRecord = toRecord(payload?.data);
  if (!dataRecord) {
    throw new ApiError('Malformed create schedule response', 500, payload);
  }
  const schedule = normalizeWorkflowSchedule(dataRecord.schedule);
  const workflow = parseWorkflowSummary(dataRecord.workflow);
  if (!schedule || !workflow) {
    throw new ApiError('Malformed create schedule response', 500, payload);
  }
  return { schedule, workflow };
}

export async function updateSchedule(
  token: TokenInput,
  input: ScheduleUpdateInput
): Promise<WorkflowScheduleSummary> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) {
    body.name = input.name;
  }
  if (input.description !== undefined) {
    body.description = input.description;
  }
  if (input.cron !== undefined) {
    body.cron = input.cron;
  }
  if (input.timezone !== undefined) {
    body.timezone = input.timezone;
  }
  if (input.parameters !== undefined) {
    body.parameters = input.parameters;
  }
  if (input.startWindow !== undefined) {
    body.startWindow = input.startWindow;
  }
  if (input.endWindow !== undefined) {
    body.endWindow = input.endWindow;
  }
  if (input.catchUp !== undefined) {
    body.catchUp = input.catchUp;
  }
  if (input.isActive !== undefined) {
    body.isActive = input.isActive;
  }

  const payload = await coreJson<{ data?: unknown }>(token, {
    method: 'PATCH',
    url: `/workflow-schedules/${encodeURIComponent(input.scheduleId)}`,
    body,
    errorMessage: 'Failed to update schedule'
  });
  const dataRecord = toRecord(payload?.data);
  if (!dataRecord) {
    throw new ApiError('Malformed update schedule response', 500, payload);
  }
  const schedule = normalizeWorkflowSchedule(dataRecord.schedule);
  const workflow = parseWorkflowSummary(dataRecord.workflow);
  if (!schedule || !workflow) {
    throw new ApiError('Malformed update schedule response', 500, payload);
  }
  return { schedule, workflow };
}

export async function deleteSchedule(
  token: TokenInput,
  scheduleId: string
): Promise<void> {
  await coreJson(token, {
    method: 'DELETE',
    url: `/workflow-schedules/${encodeURIComponent(scheduleId)}`,
    errorMessage: 'Failed to delete schedule'
  });
}

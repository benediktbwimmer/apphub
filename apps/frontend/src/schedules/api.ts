import { API_BASE_URL } from '../config';
import type { AuthorizedFetch } from '../workflows/api';
import { ApiError } from '../workflows/api';
import { normalizeWorkflowSchedule, toRecord } from '../workflows/normalizers';
import type { WorkflowSchedule } from '../workflows/types';

type FetchOptions = Parameters<typeof fetch>[1];

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

async function fetchJson(
  authorizedFetch: AuthorizedFetch,
  input: RequestInfo,
  init?: FetchOptions
): Promise<Response> {
  const response = await authorizedFetch(input, init);
  if (!response.ok) {
    const message = `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return response;
}

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

export async function fetchSchedules(
  authorizedFetch: AuthorizedFetch
): Promise<WorkflowScheduleSummary[]> {
  const response = await fetchJson(authorizedFetch, `${API_BASE_URL}/workflow-schedules`);
  const payload = (await response.json()) as { data?: unknown };
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
  authorizedFetch: AuthorizedFetch,
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

  const response = await fetchJson(
    authorizedFetch,
    `${API_BASE_URL}/workflows/${encodeURIComponent(input.workflowSlug)}/schedules`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );

  const payload = (await response.json()) as { data?: unknown };
  const dataRecord = toRecord(payload?.data);
  if (!dataRecord) {
    throw new ApiError('Malformed create schedule response', response.status);
  }
  const schedule = normalizeWorkflowSchedule(dataRecord.schedule);
  const workflow = parseWorkflowSummary(dataRecord.workflow);
  if (!schedule || !workflow) {
    throw new ApiError('Malformed create schedule response', response.status);
  }
  return { schedule, workflow };
}

export async function updateSchedule(
  authorizedFetch: AuthorizedFetch,
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

  const response = await fetchJson(
    authorizedFetch,
    `${API_BASE_URL}/workflow-schedules/${encodeURIComponent(input.scheduleId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );

  const payload = (await response.json()) as { data?: unknown };
  const dataRecord = toRecord(payload?.data);
  if (!dataRecord) {
    throw new ApiError('Malformed update schedule response', response.status);
  }
  const schedule = normalizeWorkflowSchedule(dataRecord.schedule);
  const workflow = parseWorkflowSummary(dataRecord.workflow);
  if (!schedule || !workflow) {
    throw new ApiError('Malformed update schedule response', response.status);
  }
  return { schedule, workflow };
}

export async function deleteSchedule(
  authorizedFetch: AuthorizedFetch,
  scheduleId: string
): Promise<void> {
  const response = await authorizedFetch(
    `${API_BASE_URL}/workflow-schedules/${encodeURIComponent(scheduleId)}`,
    {
      method: 'DELETE'
    }
  );
  if (!response.ok) {
    throw new ApiError('Failed to delete schedule', response.status);
  }
}

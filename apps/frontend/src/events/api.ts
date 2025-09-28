import type { WorkflowEventSampleQuery } from '../workflows/api';
import type {
  EventSavedViewRecord,
  EventSavedViewCreateInput,
  EventSavedViewUpdateInput
} from '@apphub/shared/eventsExplorer';
import {
  listWorkflowEventSamples,
  type AuthorizedFetch,
  type WorkflowEventSamplesResponse
} from '../workflows/api';
import { API_BASE_URL } from '../config';
import { normalizeFilters, type EventsExplorerFilters, type EventsExplorerPage } from './explorerTypes';
import { buildEventsQuery, prepareEventFilters, matchesEventFilters } from './filtering';

const SAVED_VIEWS_ROOT = `${API_BASE_URL}/events/saved-views`;

export async function fetchEventsExplorerPage(
  fetcher: AuthorizedFetch,
  filters: EventsExplorerFilters,
  cursor?: string | null
): Promise<EventsExplorerPage> {
  const normalized = normalizeFilters(filters);
  const prepared = prepareEventFilters(normalized);
  const query: WorkflowEventSampleQuery = buildEventsQuery(normalized, cursor);
  const response: WorkflowEventSamplesResponse = await listWorkflowEventSamples(fetcher, query);
  const filtered = response.samples.filter((event) => matchesEventFilters(event, prepared));
  const limit = response.page?.limit ?? query.limit ?? normalized.limit;
  return {
    events: filtered,
    schema: response.schema,
    nextCursor: response.page?.nextCursor ?? null,
    hasMore: Boolean(response.page?.hasMore ?? false),
    limit
  } satisfies EventsExplorerPage;
}

function resolveSavedViewUrl(slug?: string): string {
  if (!slug) {
    return SAVED_VIEWS_ROOT;
  }
  return `${SAVED_VIEWS_ROOT}/${encodeURIComponent(slug)}`;
}

async function parseSavedViewResponse(response: Response): Promise<EventSavedViewRecord> {
  const payload = await response.json();
  const record = payload?.data as EventSavedViewRecord | undefined;
  if (!record) {
    throw new Error('Malformed saved view response');
  }
  return record;
}

export async function listSavedEventViews(fetcher: AuthorizedFetch): Promise<EventSavedViewRecord[]> {
  const response = await fetcher(SAVED_VIEWS_ROOT);
  if (!response.ok) {
    throw new Error(`Failed to load saved views (${response.status})`);
  }
  const payload = await response.json();
  const records = Array.isArray(payload?.data) ? (payload.data as EventSavedViewRecord[]) : [];
  return records;
}

export async function createSavedEventView(
  fetcher: AuthorizedFetch,
  input: EventSavedViewCreateInput
): Promise<EventSavedViewRecord> {
  const response = await fetcher(SAVED_VIEWS_ROOT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error ?? `Failed to create saved view (${response.status})`);
  }
  return parseSavedViewResponse(response);
}

export async function updateSavedEventView(
  fetcher: AuthorizedFetch,
  slug: string,
  updates: EventSavedViewUpdateInput
): Promise<EventSavedViewRecord> {
  const response = await fetcher(resolveSavedViewUrl(slug), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error ?? `Failed to update saved view (${response.status})`);
  }
  return parseSavedViewResponse(response);
}

export async function deleteSavedEventView(fetcher: AuthorizedFetch, slug: string): Promise<boolean> {
  const response = await fetcher(resolveSavedViewUrl(slug), { method: 'DELETE' });
  if (response.status === 204) {
    return true;
  }
  if (response.status === 404) {
    return false;
  }
  const detail = await response.json().catch(() => null);
  throw new Error(detail?.error ?? `Failed to delete saved view (${response.status})`);
}

export async function applySavedEventView(
  fetcher: AuthorizedFetch,
  slug: string
): Promise<EventSavedViewRecord> {
  const response = await fetcher(`${resolveSavedViewUrl(slug)}/apply`, { method: 'POST' });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error ?? `Failed to record saved view usage (${response.status})`);
  }
  return parseSavedViewResponse(response);
}

export async function shareSavedEventView(
  fetcher: AuthorizedFetch,
  slug: string
): Promise<EventSavedViewRecord> {
  const response = await fetcher(`${resolveSavedViewUrl(slug)}/share`, { method: 'POST' });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error ?? `Failed to share saved view (${response.status})`);
  }
  return parseSavedViewResponse(response);
}

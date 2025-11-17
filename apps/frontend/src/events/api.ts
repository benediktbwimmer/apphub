import type { WorkflowEventSampleQuery } from '../workflows/api';
import type {
  EventSavedViewRecord,
  EventSavedViewCreateInput,
  EventSavedViewUpdateInput
} from '@apphub/shared/eventsExplorer';
import { coreRequest, CoreApiError } from '../core/api';
import { listWorkflowEventSamples, type WorkflowEventSamplesResponse } from '../workflows/api';
import type { AuthorizedFetch } from '../lib/apiClient';
import { normalizeFilters, type EventsExplorerFilters, type EventsExplorerPage } from './explorerTypes';
import { buildEventsQuery, prepareEventFilters, matchesEventFilters } from './filtering';

type Token = string | null | undefined;
type TokenInput = Token | AuthorizedFetch;

const SAVED_VIEWS_ROOT = '/events/saved-views';

type FetchWithMetadata = AuthorizedFetch & {
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
    // In dev/disabled-auth scenarios allow requests to proceed without a token.
    return undefined;
  } else if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
    return undefined;
  } else if (input === null || input === undefined) {
    return undefined;
  }
  throw new Error('Authentication required for event requests.');
}

export async function fetchEventsExplorerPage(
  token: TokenInput,
  filters: EventsExplorerFilters,
  cursor?: string | null
): Promise<EventsExplorerPage> {
  const normalized = normalizeFilters(filters);
  const prepared = prepareEventFilters(normalized);
  const query: WorkflowEventSampleQuery = buildEventsQuery(normalized, cursor);
  const response: WorkflowEventSamplesResponse = await listWorkflowEventSamples(token, query, {
    moduleScope: 'global'
  });
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

function parseSavedViewResponse(payload: unknown): EventSavedViewRecord {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Malformed saved view response');
  }
  const record = (payload as { data?: EventSavedViewRecord }).data;
  if (!record) {
    throw new Error('Malformed saved view response');
  }
  return record;
}

export async function listSavedEventViews(token: TokenInput): Promise<EventSavedViewRecord[]> {
  const resolvedToken = ensureToken(token);
  const payload = await coreRequest<{ data?: EventSavedViewRecord[] }>(resolvedToken, {
    url: SAVED_VIEWS_ROOT
  });
  const records = Array.isArray(payload?.data) ? payload.data : [];
  return records.map((record) => ({ ...record }));
}

export async function createSavedEventView(
  token: TokenInput,
  input: EventSavedViewCreateInput
): Promise<EventSavedViewRecord> {
  const resolvedToken = ensureToken(token);
  const payload = await coreRequest<{ data?: EventSavedViewRecord }>(resolvedToken, {
    method: 'POST',
    url: SAVED_VIEWS_ROOT,
    body: input
  });
  return parseSavedViewResponse(payload);
}

export async function updateSavedEventView(
  token: TokenInput,
  slug: string,
  updates: EventSavedViewUpdateInput
): Promise<EventSavedViewRecord> {
  const resolvedToken = ensureToken(token);
  const payload = await coreRequest<{ data?: EventSavedViewRecord }>(resolvedToken, {
    method: 'PATCH',
    url: resolveSavedViewUrl(slug),
    body: updates
  });
  return parseSavedViewResponse(payload);
}

export async function deleteSavedEventView(token: TokenInput, slug: string): Promise<boolean> {
  try {
    const resolvedToken = ensureToken(token);
    await coreRequest(resolvedToken, {
      method: 'DELETE',
      url: resolveSavedViewUrl(slug)
    });
    return true;
  } catch (error) {
    if (error instanceof CoreApiError && error.status === 404) {
      return false;
    }
    throw error;
  }
}

export async function applySavedEventView(
  token: TokenInput,
  slug: string
): Promise<EventSavedViewRecord> {
  const resolvedToken = ensureToken(token);
  const payload = await coreRequest<{ data?: EventSavedViewRecord }>(resolvedToken, {
    method: 'POST',
    url: `${resolveSavedViewUrl(slug)}/apply`
  });
  return parseSavedViewResponse(payload);
}

export async function shareSavedEventView(
  token: TokenInput,
  slug: string
): Promise<EventSavedViewRecord> {
  const resolvedToken = ensureToken(token);
  const payload = await coreRequest<{ data?: EventSavedViewRecord }>(resolvedToken, {
    method: 'POST',
    url: `${resolveSavedViewUrl(slug)}/share`
  });
  return parseSavedViewResponse(payload);
}

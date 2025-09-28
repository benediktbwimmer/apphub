import type { WorkflowEventSampleQuery } from '../workflows/api';
import {
  listWorkflowEventSamples,
  type AuthorizedFetch,
  type WorkflowEventSamplesResponse
} from '../workflows/api';
import { normalizeFilters, type EventsExplorerFilters, type EventsExplorerPage } from './explorerTypes';
import { buildEventsQuery, prepareEventFilters, matchesEventFilters } from './filtering';

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

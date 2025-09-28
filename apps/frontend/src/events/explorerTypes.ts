import type { WorkflowEventSchema, WorkflowEventSample, WorkflowEventSeverity } from '../workflows/types';

export type EventsExplorerFilters = {
  type: string;
  source: string;
  correlationId: string;
  severity: WorkflowEventSeverity[];
  from: string;
  to: string;
  jsonPath: string;
  limit: number;
};

export type EventsExplorerPreset = {
  id: string;
  label: string;
  description?: string;
  filters: Partial<EventsExplorerFilters>;
};

export type EventsExplorerPage = {
  events: WorkflowEventSample[];
  schema: WorkflowEventSchema | null;
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
};

export const DEFAULT_EVENTS_FILTERS: EventsExplorerFilters = {
  type: '',
  source: '',
  correlationId: '',
  severity: [],
  from: '',
  to: '',
  jsonPath: '',
  limit: 50
};

export const EVENTS_SEVERITIES: readonly WorkflowEventSeverity[] = [
  'critical',
  'error',
  'warning',
  'info',
  'debug'
] as const;

export const EVENTS_EXPLORER_PRESETS: readonly EventsExplorerPreset[] = [
  {
    id: 'all',
    label: 'Everything',
    description: 'Latest events across the platform',
    filters: {}
  },
  {
    id: 'alerts',
    label: 'Alerts',
    description: 'Highlight critical, error, and warning severities',
    filters: { severity: ['critical', 'error', 'warning'] }
  },
  {
    id: 'metastore',
    label: 'Metastore',
    description: 'Track catalog and metadata changes',
    filters: { source: 'metastore', type: 'metastore.' }
  },
  {
    id: 'workflows',
    label: 'Workflow Runs',
    description: 'Follow workflow triggers and asset production',
    filters: { type: 'workflow.', source: 'workflows' }
  }
] as const;

export function normalizeFilters(partial?: Partial<EventsExplorerFilters>): EventsExplorerFilters {
  const severity: WorkflowEventSeverity[] = Array.isArray(partial?.severity)
    ? partial.severity.filter((value): value is WorkflowEventSeverity =>
        EVENTS_SEVERITIES.includes(value as WorkflowEventSeverity)
      )
    : DEFAULT_EVENTS_FILTERS.severity;

  return {
    ...DEFAULT_EVENTS_FILTERS,
    ...partial,
    severity,
    limit:
      typeof partial?.limit === 'number' && Number.isFinite(partial.limit)
        ? Math.min(Math.max(Math.floor(partial.limit), 1), 200)
        : DEFAULT_EVENTS_FILTERS.limit
  } satisfies EventsExplorerFilters;
}

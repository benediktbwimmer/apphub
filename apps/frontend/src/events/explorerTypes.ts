import type { WorkflowEventSchema, WorkflowEventSample, WorkflowEventSeverity } from '../workflows/types';
import type { EventSavedViewFilters } from '@apphub/shared/eventsExplorer';

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
    description: 'Track core and metadata changes',
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

function sanitizeFilterValue(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '';
}

export function toSavedViewFilters(filters: EventsExplorerFilters): EventSavedViewFilters {
  const payload: EventSavedViewFilters = {};
  if (filters.type.trim()) {
    payload.type = filters.type.trim();
  }
  if (filters.source.trim()) {
    payload.source = filters.source.trim();
  }
  if (filters.correlationId.trim()) {
    payload.correlationId = filters.correlationId.trim();
  }
  if (filters.from.trim()) {
    payload.from = filters.from.trim();
  }
  if (filters.to.trim()) {
    payload.to = filters.to.trim();
  }
  if (filters.jsonPath.trim()) {
    payload.jsonPath = filters.jsonPath.trim();
  }
  if (filters.severity.length > 0) {
    payload.severity = [...filters.severity];
  }
  if (filters.limit !== DEFAULT_EVENTS_FILTERS.limit) {
    payload.limit = filters.limit;
  }
  return payload;
}

export function fromSavedViewFilters(saved: EventSavedViewFilters | null | undefined): EventsExplorerFilters {
  const base = { ...DEFAULT_EVENTS_FILTERS };
  if (!saved) {
    return base;
  }
  if (typeof saved.type === 'string') {
    base.type = sanitizeFilterValue(saved.type);
  }
  if (typeof saved.source === 'string') {
    base.source = sanitizeFilterValue(saved.source);
  }
  if (typeof saved.correlationId === 'string') {
    base.correlationId = sanitizeFilterValue(saved.correlationId);
  }
  if (typeof saved.from === 'string') {
    base.from = sanitizeFilterValue(saved.from);
  }
  if (typeof saved.to === 'string') {
    base.to = sanitizeFilterValue(saved.to);
  }
  if (typeof saved.jsonPath === 'string') {
    base.jsonPath = sanitizeFilterValue(saved.jsonPath);
  }
  if (Array.isArray(saved.severity)) {
    const severities = saved.severity.filter((value): value is WorkflowEventSeverity =>
      EVENTS_SEVERITIES.includes(value as WorkflowEventSeverity)
    );
    base.severity = severities.length > 0 ? severities : DEFAULT_EVENTS_FILTERS.severity;
  }
  if (typeof saved.limit === 'number' && Number.isFinite(saved.limit)) {
    const clamped = Math.min(Math.max(Math.floor(saved.limit), 1), 200);
    base.limit = clamped;
  }
  return base;
}

export function filtersMatchSavedView(
  filters: EventsExplorerFilters,
  saved: EventSavedViewFilters | null | undefined
): boolean {
  if (!saved) {
    return false;
  }
  const normalizedSaved = toSavedViewFilters(fromSavedViewFilters(saved));
  const normalizedCurrent = toSavedViewFilters(filters);

  if (sanitizeFilterValue(normalizedSaved.type ?? '') !== sanitizeFilterValue(normalizedCurrent.type ?? '')) {
    return false;
  }
  if (sanitizeFilterValue(normalizedSaved.source ?? '') !== sanitizeFilterValue(normalizedCurrent.source ?? '')) {
    return false;
  }
  if (
    sanitizeFilterValue(normalizedSaved.correlationId ?? '') !==
    sanitizeFilterValue(normalizedCurrent.correlationId ?? '')
  ) {
    return false;
  }
  if (sanitizeFilterValue(normalizedSaved.from ?? '') !== sanitizeFilterValue(normalizedCurrent.from ?? '')) {
    return false;
  }
  if (sanitizeFilterValue(normalizedSaved.to ?? '') !== sanitizeFilterValue(normalizedCurrent.to ?? '')) {
    return false;
  }
  if (sanitizeFilterValue(normalizedSaved.jsonPath ?? '') !== sanitizeFilterValue(normalizedCurrent.jsonPath ?? '')) {
    return false;
  }

  const savedSeverities = new Set(normalizedSaved.severity ?? []);
  const currentSeverities = new Set(normalizedCurrent.severity ?? []);
  if (savedSeverities.size !== currentSeverities.size) {
    return false;
  }
  for (const value of savedSeverities) {
    if (!currentSeverities.has(value)) {
      return false;
    }
  }

  const savedLimit = normalizedSaved.limit ?? DEFAULT_EVENTS_FILTERS.limit;
  const currentLimit = normalizedCurrent.limit ?? DEFAULT_EVENTS_FILTERS.limit;
  return savedLimit === currentLimit;
}

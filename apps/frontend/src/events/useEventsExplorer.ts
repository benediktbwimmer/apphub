import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowEventRecordView } from '@apphub/shared/coreEvents';
import type { WorkflowEventSample, WorkflowEventSchema } from '../workflows/types';
import type { AuthorizedFetch } from '../lib/apiClient';
import {
  DEFAULT_EVENTS_FILTERS,
  EVENTS_EXPLORER_PRESETS,
  normalizeFilters,
  type EventsExplorerFilters,
  type EventsExplorerPreset
} from './explorerTypes';
import { fetchEventsExplorerPage } from './api';
import { matchesEventFilters, prepareEventFilters, sortEventsByOccurredAt } from './filtering';
import {
  useAppHubEventsClient,
  useAppHubEvent,
  type AppHubConnectionStatus
} from './context';

const HIGHLIGHT_DURATION_MS = 6_000;

function areSeverityListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function areFiltersEqual(left: EventsExplorerFilters, right: EventsExplorerFilters): boolean {
  return (
    left.type === right.type &&
    left.source === right.source &&
    left.correlationId === right.correlationId &&
    left.from === right.from &&
    left.to === right.to &&
    left.jsonPath === right.jsonPath &&
    left.limit === right.limit &&
    areSeverityListsEqual(left.severity, right.severity)
  );
}

function resolvePresetId(filters: EventsExplorerFilters): string {
  for (const preset of EVENTS_EXPLORER_PRESETS) {
    const presetFilters = normalizeFilters({ ...DEFAULT_EVENTS_FILTERS, ...preset.filters });
    if (areFiltersEqual(filters, presetFilters)) {
      return preset.id;
    }
  }
  return 'custom';
}

function dedupeAndSort(events: WorkflowEventSample[]): WorkflowEventSample[] {
  const seen = new Set<string>();
  const unique: WorkflowEventSample[] = [];
  for (const event of events) {
    if (seen.has(event.id)) {
      continue;
    }
    seen.add(event.id);
    unique.push(event);
  }
  return sortEventsByOccurredAt(unique);
}

function toSample(event: WorkflowEventRecordView): WorkflowEventSample {
  return {
    id: event.id,
    type: event.type,
    source: event.source,
    occurredAt: event.occurredAt,
    receivedAt: event.receivedAt,
    payload: event.payload,
    correlationId: event.correlationId ?? null,
    ttlMs: 'ttlMs' in event ? (event as { ttlMs?: number | null }).ttlMs ?? null : null,
    metadata: event.metadata ?? null,
    severity: event.severity ?? null,
    links: event.links ?? null,
    derived: event.derived ?? null
  } satisfies WorkflowEventSample;
}

type LoadMode = 'replace' | 'append' | 'merge';

type LoadOptions = {
  cursor?: string | null;
  mode?: LoadMode;
  background?: boolean;
};

export type EventsExplorerState = {
  filters: EventsExplorerFilters;
  presets: readonly EventsExplorerPreset[];
  activePresetId: string;
  events: WorkflowEventSample[];
  schema: WorkflowEventSchema | null;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  connectionStatus: AppHubConnectionStatus;
  highlightedIds: Set<string>;
  applyFilters: (filters: EventsExplorerFilters) => Promise<void>;
  applyPreset: (presetId: string) => Promise<void>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
};

export function useEventsExplorer(authorizedFetch: AuthorizedFetch): EventsExplorerState {
  const eventsClient = useAppHubEventsClient();
  const [filters, setFilters] = useState<EventsExplorerFilters>(DEFAULT_EVENTS_FILTERS);
  const [events, setEvents] = useState<WorkflowEventSample[]>([]);
  const [schema, setSchema] = useState<WorkflowEventSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<AppHubConnectionStatus>('connecting');
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [activePresetId, setActivePresetId] = useState<string>('all');
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());

  const requestIdRef = useRef(0);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const pollingTimerRef = useRef<number | null>(null);
  const highlightTimersRef = useRef<Map<string, number>>(new Map());

  const preparedFilters = useMemo(() => prepareEventFilters(filters), [filters]);

  const markHighlighted = useCallback((eventId: string) => {
    if (typeof window === 'undefined') {
      return;
    }
    setHighlightedIds((current) => {
      if (current.has(eventId)) {
        return current;
      }
      const next = new Set(current);
      next.add(eventId);
      return next;
    });
    const existingTimer = highlightTimersRef.current.get(eventId);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }
    const timer = window.setTimeout(() => {
      highlightTimersRef.current.delete(eventId);
      setHighlightedIds((current) => {
        if (!current.has(eventId)) {
          return current;
        }
        const next = new Set(current);
        next.delete(eventId);
        return next;
      });
    }, HIGHLIGHT_DURATION_MS);
    highlightTimersRef.current.set(eventId, timer);
  }, []);

  const updateEvents = useCallback(
    (incoming: WorkflowEventSample[], mode: LoadMode) => {
      setEvents((current) => {
        let combined: WorkflowEventSample[];
        switch (mode) {
          case 'append':
            combined = [...current, ...incoming];
            break;
          case 'merge':
            combined = [...incoming, ...current];
            break;
          default:
            combined = [...incoming];
            break;
        }
        const deduped = dedupeAndSort(combined);
        seenIdsRef.current = new Set(deduped.map((item) => item.id));
        return deduped;
      });
    },
    []
  );

  const fetchAndUpdate = useCallback(
    async (targetFilters: EventsExplorerFilters, options: LoadOptions = {}) => {
      const { cursor = null, mode = 'replace', background = false } = options;
      const requestId = ++requestIdRef.current;
      if (mode === 'append') {
        setLoadingMore(true);
      } else if (background) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      try {
        const page = await fetchEventsExplorerPage(authorizedFetch, targetFilters, cursor);
        if (requestId !== requestIdRef.current) {
          return;
        }
        if (page.schema) {
          setSchema(page.schema);
        } else if (mode === 'replace') {
          setSchema(null);
        }
        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
        updateEvents(page.events, mode);
        setError(null);
      } catch (err) {
        if (requestId !== requestIdRef.current) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to load events';
        setError(message);
        if (mode === 'replace') {
          setEvents([]);
          seenIdsRef.current.clear();
          setHasMore(false);
          setNextCursor(null);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          if (mode === 'append') {
            setLoadingMore(false);
          } else if (background) {
            setRefreshing(false);
          } else {
            setLoading(false);
          }
        }
      }
    },
    [authorizedFetch, updateEvents]
  );

  const applyFilters = useCallback(
    async (nextFilters: EventsExplorerFilters) => {
      const normalized = normalizeFilters(nextFilters);
      setFilters(normalized);
      setActivePresetId(resolvePresetId(normalized));
      seenIdsRef.current.clear();
      await fetchAndUpdate(normalized, { mode: 'replace', background: false });
    },
    [fetchAndUpdate]
  );

  const applyPreset = useCallback(
    async (presetId: string) => {
      const preset = EVENTS_EXPLORER_PRESETS.find((entry) => entry.id === presetId);
      if (!preset) {
        return;
      }
      const normalized = normalizeFilters({ ...DEFAULT_EVENTS_FILTERS, ...preset.filters });
      await applyFilters(normalized);
    },
    [applyFilters]
  );

  const refresh = useCallback(async () => {
    await fetchAndUpdate(filters, { mode: 'merge', background: true });
  }, [fetchAndUpdate, filters]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !nextCursor) {
      return;
    }
    await fetchAndUpdate(filters, { cursor: nextCursor, mode: 'append', background: false });
  }, [fetchAndUpdate, filters, hasMore, loadingMore, nextCursor]);

  useEffect(() => {
    void fetchAndUpdate(DEFAULT_EVENTS_FILTERS, { mode: 'replace', background: false });
  }, [fetchAndUpdate]);

  useEffect(() => {
    const unsubscribe = eventsClient.subscribeConnection((status) => {
      setConnectionStatus(status);
      if (typeof window === 'undefined') {
        return;
      }
      if (status === 'connected') {
        if (pollingTimerRef.current !== null) {
          window.clearInterval(pollingTimerRef.current);
          pollingTimerRef.current = null;
        }
      } else if (pollingTimerRef.current === null) {
        pollingTimerRef.current = window.setInterval(() => {
          void fetchAndUpdate(filters, { mode: 'merge', background: true });
        }, 15_000);
      }
    });
    return () => {
      unsubscribe();
      if (pollingTimerRef.current !== null) {
        window.clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };
  }, [eventsClient, fetchAndUpdate, filters]);

  useAppHubEvent('connection.state', (event) => {
    setConnectionStatus(event.data.status);
  });

  useAppHubEvent('workflow.event.received', (event) => {
    const sample = toSample(event.data.event);
    if (seenIdsRef.current.has(sample.id)) {
      return;
    }
    if (!matchesEventFilters(sample, preparedFilters)) {
      return;
    }
    updateEvents([sample], 'merge');
    markHighlighted(sample.id);
  });

  useEffect(() => {
    const { current: highlightTimers } = highlightTimersRef;
    return () => {
      if (typeof window !== 'undefined') {
        highlightTimers.forEach((timer) => {
          window.clearTimeout(timer);
        });
      }
      highlightTimers.clear();
    };
  }, []);

  return {
    filters,
    presets: EVENTS_EXPLORER_PRESETS,
    activePresetId,
    events,
    schema,
    loading,
    refreshing,
    loadingMore,
    error,
    hasMore,
    connectionStatus,
    highlightedIds,
    applyFilters,
    applyPreset,
    refresh,
    loadMore
  } satisfies EventsExplorerState;
}

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
import { useModuleScope } from '../modules/ModuleScopeContext';

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
  const moduleScope = useModuleScope();
  const { kind: moduleScopeKind, moduleId: activeModuleId, getResourceIds, getResourceSlugs, isResourceInScope } = moduleScope;
  const isModuleScoped = moduleScopeKind === 'module';
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
  const normalizeId = useCallback((value: string | null | undefined) => (typeof value === 'string' ? value.trim().toLowerCase() : ''), []);
  const normalizeIdentifier = useCallback((value: string | null | undefined) => (typeof value === 'string' ? value.trim() : ''), []);

  const scopeKey = isModuleScoped ? `module:${normalizeIdentifier(activeModuleId) || 'active'}` : 'all';
  const scopeKeyRef = useRef(scopeKey);

  const moduleEventIds = useMemo(() => {
    if (!isModuleScoped) {
      return null;
    }
    const ids = new Set<string>();
    for (const id of getResourceIds('event')) {
      const normalized = normalizeId(id);
      if (normalized) {
        ids.add(normalized);
      }
    }
    return ids;
  }, [getResourceIds, isModuleScoped, normalizeId]);

  const moduleWorkflowDefinitionIds = useMemo(() => {
    if (!isModuleScoped) {
      return null;
    }
    const ids = new Set<string>();
    for (const id of getResourceIds('workflow-definition')) {
      const normalized = normalizeIdentifier(id);
      if (normalized) {
        ids.add(normalized);
      }
    }
    return ids;
  }, [getResourceIds, isModuleScoped, normalizeIdentifier]);

  const moduleWorkflowSlugs = useMemo(() => {
    if (!isModuleScoped) {
      return null;
    }
    const slugs = new Set<string>();
    for (const slug of getResourceSlugs('workflow-definition')) {
      const normalized = normalizeId(slug);
      if (normalized) {
        slugs.add(normalized);
      }
    }
    return slugs;
  }, [getResourceSlugs, isModuleScoped, normalizeId]);

  const moduleWorkflowRunCount = useMemo(() => {
    if (!isModuleScoped) {
      return 0;
    }
    return getResourceIds('workflow-run').length;
  }, [getResourceIds, isModuleScoped]);

  const hasScopeFilters = useMemo(() => {
    if (!isModuleScoped) {
      return false;
    }
    if (moduleEventIds && moduleEventIds.size > 0) {
      return true;
    }
    if (moduleWorkflowDefinitionIds && moduleWorkflowDefinitionIds.size > 0) {
      return true;
    }
    if (moduleWorkflowSlugs && moduleWorkflowSlugs.size > 0) {
      return true;
    }
    return moduleWorkflowRunCount > 0;
  }, [
    isModuleScoped,
    moduleEventIds,
    moduleWorkflowDefinitionIds,
    moduleWorkflowSlugs,
    moduleWorkflowRunCount
  ]);

  const isEventInScope = useCallback(
    (event: WorkflowEventSample) => {
      if (!isModuleScoped || !hasScopeFilters) {
        return true;
      }

      let matched = false;
      let attempted = false;

      if (moduleEventIds && moduleEventIds.size > 0) {
        attempted = true;
        const normalizedEventId = normalizeId(event.id);
        if (moduleEventIds.has(normalizedEventId)) {
          matched = true;
        }
      }

      if (!matched && moduleWorkflowDefinitionIds && moduleWorkflowDefinitionIds.size > 0) {
        const definitionIds = event.links?.workflowDefinitionIds ?? [];
        if (definitionIds.length > 0) {
          attempted = true;
          if (definitionIds.some((id) => moduleWorkflowDefinitionIds.has(normalizeIdentifier(id)))) {
            matched = true;
          }
        }
      }

      if (!matched) {
        const workflowRunIds = event.links?.workflowRunIds ?? [];
        if (workflowRunIds.length > 0) {
          attempted = true;
          if (workflowRunIds.some((id) => isResourceInScope('workflow-run', id))) {
            matched = true;
          }
        }
      }

      if (!matched && moduleWorkflowSlugs && moduleWorkflowSlugs.size > 0) {
        const slugMatches = event.links?.workflowIds ?? [];
        if (slugMatches.length > 0) {
          attempted = true;
          if (slugMatches.some((slug) => moduleWorkflowSlugs.has(normalizeId(slug)))) {
            matched = true;
          }
        }
      }

      if (matched) {
        return true;
      }

      if (!attempted) {
        return true;
      }

      return false;
    },
    [
      hasScopeFilters,
      isModuleScoped,
      isResourceInScope,
      moduleEventIds,
      moduleWorkflowDefinitionIds,
      moduleWorkflowSlugs,
      normalizeId,
      normalizeIdentifier
    ]
  );

  const filterEventsForScope = useCallback(
    (incoming: WorkflowEventSample[]) => {
      if (!isModuleScoped) {
        return incoming;
      }
      return incoming.filter((event) => isEventInScope(event));
    },
    [isEventInScope, isModuleScoped]
  );

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
      const scoped = filterEventsForScope(incoming);
      if (scoped.length === 0) {
        if (mode === 'replace' && incoming.length === 0) {
          setEvents([]);
          seenIdsRef.current.clear();
        }
        return;
      }
      setEvents((current) => {
        let combined: WorkflowEventSample[];
        switch (mode) {
          case 'append':
            combined = [...current, ...scoped];
            break;
          case 'merge':
            combined = [...scoped, ...current];
            break;
          default:
            combined = [...scoped];
            break;
        }
        const deduped = dedupeAndSort(combined);
        seenIdsRef.current = new Set(deduped.map((item) => item.id));
        return deduped;
      });
    },
    [filterEventsForScope]
  );

  const fetcherMetadata = authorizedFetch as AuthorizedFetch & {
    authToken?: string | null | undefined;
    authOptional?: boolean | null | undefined;
  };
  const authReady = useMemo(() => {
    const token = typeof fetcherMetadata.authToken === 'string' ? fetcherMetadata.authToken.trim() : '';
    return (fetcherMetadata.authOptional ?? false) || token.length > 0;
  }, [fetcherMetadata.authOptional, fetcherMetadata.authToken]);

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
      if (!authReady) {
        if (requestId === requestIdRef.current) {
          if (mode === 'append') {
            setLoadingMore(false);
          } else if (background) {
            setRefreshing(false);
          } else {
            setLoading(false);
          }
        }
        return;
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
    [authReady, authorizedFetch, updateEvents]
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
    if (!authReady) {
      return;
    }
    void fetchAndUpdate(DEFAULT_EVENTS_FILTERS, { mode: 'replace', background: false });
  }, [authReady, fetchAndUpdate]);

  useEffect(() => {
    if (scopeKeyRef.current === scopeKey) {
      return;
    }
    scopeKeyRef.current = scopeKey;
    seenIdsRef.current.clear();
    setEvents([]);
    setHighlightedIds(new Set<string>());
    setHasMore(false);
    setNextCursor(null);
    void fetchAndUpdate(filters, { mode: 'replace', background: false });
  }, [fetchAndUpdate, filters, scopeKey]);

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
    if (!isEventInScope(sample)) {
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

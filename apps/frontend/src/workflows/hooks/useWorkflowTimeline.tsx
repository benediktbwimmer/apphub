import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { useWorkflowAccess } from './useWorkflowAccess';
import { useWorkflowDefinitions } from './useWorkflowDefinitions';
import { getWorkflowTimeline, type WorkflowTimelineQuery } from '../api';
import {
  WORKFLOW_TIMELINE_RANGE_KEYS,
  WORKFLOW_TIMELINE_TRIGGER_STATUSES,
  type WorkflowTimelineMeta,
  type WorkflowTimelineRangeKey,
  type WorkflowTimelineSnapshot,
  type WorkflowTimelineTriggerStatus
} from '../types';
import { useModuleScope } from '../../modules/ModuleScopeContext';

const STATUS_SET = new Set<WorkflowTimelineTriggerStatus>(WORKFLOW_TIMELINE_TRIGGER_STATUSES);

const TIMELINE_PAGE_SIZE = 50;

const DEFAULT_QUERY: WorkflowTimelineQuery = {
  range: '24h',
  limit: TIMELINE_PAGE_SIZE
};

type TimelineStateEntry = {
  snapshot: WorkflowTimelineSnapshot | null;
  meta: WorkflowTimelineMeta | null;
  loading: boolean;
  error: string | null;
  query: WorkflowTimelineQuery;
  lastFetchedAt?: string;
};

const createDefaultTimelineState = (): TimelineStateEntry => ({
  snapshot: null,
  meta: null,
  loading: false,
  error: null,
  query: { ...DEFAULT_QUERY }
});

type WorkflowTimelineContextValue = {
  timeline: WorkflowTimelineSnapshot | null;
  timelineMeta: WorkflowTimelineMeta | null;
  timelineLoading: boolean;
  timelineError: string | null;
  timelineRange: WorkflowTimelineRangeKey;
  timelineStatuses: WorkflowTimelineTriggerStatus[];
  setTimelineRange: (range: WorkflowTimelineRangeKey) => void;
  toggleTimelineStatus: (status: WorkflowTimelineTriggerStatus) => void;
  setTimelineStatuses: (statuses: WorkflowTimelineTriggerStatus[]) => void;
  clearTimelineStatuses: () => void;
  refreshTimeline: () => void;
  loadMoreTimeline: () => Promise<void> | void;
  timelineHasMore: boolean;
};

const WorkflowTimelineContext = createContext<WorkflowTimelineContextValue | undefined>(undefined);

function sanitizeLimit(limit: unknown, fallback: number): number {
  const parsed = typeof limit === 'number' ? limit : Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function buildQuery(
  slug: string,
  overrides: Partial<WorkflowTimelineQuery>,
  state: Record<string, TimelineStateEntry>
): WorkflowTimelineQuery {
  const existing = state[slug];
  const base = existing?.query ?? DEFAULT_QUERY;
  const next: WorkflowTimelineQuery = {
    ...base,
    ...overrides
  };
  const range = next.range && WORKFLOW_TIMELINE_RANGE_KEYS.includes(next.range) ? next.range : base.range ?? '24h';
  next.range = range;
  const statuses = Array.isArray(next.statuses) ? next.statuses : existing?.query.statuses ?? [];
  const sanitizedStatuses = statuses.filter((status): status is WorkflowTimelineTriggerStatus =>
    STATUS_SET.has(status)
  );
  next.statuses = Array.from(new Set(sanitizedStatuses));
  const fallbackLimit = existing?.query.limit ?? DEFAULT_QUERY.limit ?? TIMELINE_PAGE_SIZE;
  next.limit = sanitizeLimit(next.limit, fallbackLimit);
  return next;
}

export function WorkflowTimelineProvider({ children }: { children: ReactNode }) {
  const { authorizedFetch } = useWorkflowAccess();
  const { selectedSlug } = useWorkflowDefinitions();
  const moduleScope = useModuleScope();
  const { kind: moduleScopeKind, isResourceInScope, getResourceIds, getResourceSlugs } = moduleScope;
  const isModuleScoped = moduleScopeKind === 'module';
  const hasWorkflowScopeFilters = useMemo(() => {
    if (!isModuleScoped) {
      return false;
    }
    const ids = getResourceIds('workflow-definition');
    const slugs = getResourceSlugs('workflow-definition');
    return ids.length > 0 || slugs.length > 0;
  }, [getResourceIds, getResourceSlugs, isModuleScoped]);

  const [timelineState, setTimelineState] = useState<Record<string, TimelineStateEntry>>({});
  const timelineStateRef = useRef<Record<string, TimelineStateEntry>>({});
  const selectedSlugRef = useRef<string | null>(null);

  useEffect(() => {
    timelineStateRef.current = timelineState;
  }, [timelineState]);

  useEffect(() => {
    selectedSlugRef.current = selectedSlug ?? null;
  }, [selectedSlug]);

  const loadTimeline = useCallback(
    async (slug: string, overrides: Partial<WorkflowTimelineQuery> = {}) => {
      if (!slug) {
        return;
      }
      if (isModuleScoped && hasWorkflowScopeFilters && !isResourceInScope('workflow-definition', slug)) {
        return;
      }
      const nextQuery = buildQuery(slug, overrides, timelineStateRef.current);
      if (isModuleScoped) {
        nextQuery.moduleId = moduleScope.moduleId ?? undefined;
        nextQuery.moduleScope = 'global';
      } else {
        delete nextQuery.moduleId;
        nextQuery.moduleScope = 'global';
      }
      setTimelineState((current) => {
        const existing = current[slug] ?? createDefaultTimelineState();
        return {
          ...current,
          [slug]: {
            ...existing,
            loading: true,
            error: null,
            query: nextQuery
          }
        } satisfies Record<string, TimelineStateEntry>;
      });
      try {
        const result = await getWorkflowTimeline(authorizedFetch, slug, nextQuery);
        setTimelineState((current) => ({
          ...current,
          [slug]: {
            snapshot: result.snapshot,
            meta: result.meta,
            loading: false,
            error: null,
            query: nextQuery,
            lastFetchedAt: new Date().toISOString()
          }
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load workflow timeline';
        setTimelineState((current) => {
          const existing = current[slug] ?? createDefaultTimelineState();
          return {
            ...current,
            [slug]: {
              ...existing,
              loading: false,
              error: message,
              query: nextQuery
            }
          } satisfies Record<string, TimelineStateEntry>;
        });
      }
    },
    [authorizedFetch, hasWorkflowScopeFilters, isModuleScoped, isResourceInScope, moduleScope.moduleId]
  );

  useEffect(() => {
    if (!selectedSlug) {
      return;
    }
    if (isModuleScoped && hasWorkflowScopeFilters && !isResourceInScope('workflow-definition', selectedSlug)) {
      return;
    }
    const entry = timelineStateRef.current[selectedSlug];
    if (entry?.loading) {
      return;
    }
    if (!entry || !entry.snapshot) {
      void loadTimeline(selectedSlug, {});
    }
  }, [hasWorkflowScopeFilters, isModuleScoped, isResourceInScope, loadTimeline, selectedSlug]);

  const timelineEntry = selectedSlug ? timelineState[selectedSlug] : undefined;

  const timelineRange: WorkflowTimelineRangeKey = useMemo(() => {
    const range = timelineEntry?.query.range;
    return range && WORKFLOW_TIMELINE_RANGE_KEYS.includes(range) ? range : '24h';
  }, [timelineEntry]);

  const timelineStatuses = useMemo(
    () => timelineEntry?.query.statuses ?? [],
    [timelineEntry]
  );

  const setTimelineRange = useCallback(
    (range: WorkflowTimelineRangeKey) => {
      const slug = selectedSlugRef.current;
      if (!slug) {
        return;
      }
      if (isModuleScoped && hasWorkflowScopeFilters && !isResourceInScope('workflow-definition', slug)) {
        return;
      }
      if (!WORKFLOW_TIMELINE_RANGE_KEYS.includes(range)) {
        return;
      }
      void loadTimeline(slug, { range });
    },
    [hasWorkflowScopeFilters, isModuleScoped, isResourceInScope, loadTimeline]
  );

  const setTimelineStatuses = useCallback(
    (statuses: WorkflowTimelineTriggerStatus[]) => {
      const slug = selectedSlugRef.current;
      if (!slug) {
        return;
      }
      if (isModuleScoped && hasWorkflowScopeFilters && !isResourceInScope('workflow-definition', slug)) {
        return;
      }
      const sanitized = statuses.filter((status) => STATUS_SET.has(status));
      void loadTimeline(slug, { statuses: sanitized });
    },
    [hasWorkflowScopeFilters, isModuleScoped, isResourceInScope, loadTimeline]
  );

  const toggleTimelineStatus = useCallback(
    (status: WorkflowTimelineTriggerStatus) => {
      const slug = selectedSlugRef.current;
      if (!slug) {
        return;
      }
      if (isModuleScoped && hasWorkflowScopeFilters && !isResourceInScope('workflow-definition', slug)) {
        return;
      }
      const currentStatuses = timelineStateRef.current[slug]?.query.statuses ?? [];
      const hasStatus = currentStatuses.includes(status);
      const next = hasStatus
        ? currentStatuses.filter((value) => value !== status)
        : [...currentStatuses, status];
      void loadTimeline(slug, { statuses: next });
    },
    [hasWorkflowScopeFilters, isModuleScoped, isResourceInScope, loadTimeline]
  );

  const clearTimelineStatuses = useCallback(() => {
    const slug = selectedSlugRef.current;
    if (!slug) {
      return;
    }
    if (isModuleScoped && hasWorkflowScopeFilters && !isResourceInScope('workflow-definition', slug)) {
      return;
    }
    void loadTimeline(slug, { statuses: [] });
  }, [hasWorkflowScopeFilters, isModuleScoped, isResourceInScope, loadTimeline]);

  const refreshTimeline = useCallback(() => {
    const slug = selectedSlugRef.current;
    if (!slug) {
      return;
    }
    if (isModuleScoped && hasWorkflowScopeFilters && !isResourceInScope('workflow-definition', slug)) {
      return;
    }
    void loadTimeline(slug, {});
  }, [hasWorkflowScopeFilters, isModuleScoped, isResourceInScope, loadTimeline]);

  const timelineHasMore = useMemo(() => {
    if (!timelineEntry?.snapshot) {
      return false;
    }
    const limit = timelineEntry.meta?.limit ?? timelineEntry.query.limit ?? TIMELINE_PAGE_SIZE;
    if (!limit) {
      return false;
    }
    return timelineEntry.snapshot.entries.length >= limit;
  }, [timelineEntry]);

  const loadMoreTimeline = useCallback(() => {
    const slug = selectedSlugRef.current;
    if (!slug) {
      return;
    }
    if (isModuleScoped && hasWorkflowScopeFilters && !isResourceInScope('workflow-definition', slug)) {
      return;
    }
    const currentLimit = timelineStateRef.current[slug]?.query.limit ?? TIMELINE_PAGE_SIZE;
    const nextLimit = currentLimit + TIMELINE_PAGE_SIZE;
    return loadTimeline(slug, { limit: nextLimit });
  }, [hasWorkflowScopeFilters, isModuleScoped, isResourceInScope, loadTimeline]);

  const value = useMemo<WorkflowTimelineContextValue>(() => ({
    timeline: timelineEntry?.snapshot ?? null,
    timelineMeta: timelineEntry?.meta ?? null,
    timelineLoading: timelineEntry?.loading ?? false,
    timelineError: timelineEntry?.error ?? null,
    timelineRange,
    timelineStatuses,
    setTimelineRange,
    toggleTimelineStatus,
    setTimelineStatuses,
    clearTimelineStatuses,
    refreshTimeline,
    loadMoreTimeline,
    timelineHasMore
  }), [
    clearTimelineStatuses,
    loadMoreTimeline,
    refreshTimeline,
    setTimelineRange,
    setTimelineStatuses,
    timelineEntry,
    timelineHasMore,
    timelineRange,
    timelineStatuses,
    toggleTimelineStatus
  ]);

  return <WorkflowTimelineContext.Provider value={value}>{children}</WorkflowTimelineContext.Provider>;
}

export function useWorkflowTimeline(): WorkflowTimelineContextValue {
  const context = useContext(WorkflowTimelineContext);
  if (!context) {
    throw new Error('useWorkflowTimeline must be used within a WorkflowTimelineProvider');
  }
  return context;
}

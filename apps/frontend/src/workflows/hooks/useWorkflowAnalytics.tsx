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
import {
  getWorkflowRunMetrics,
  getWorkflowStats,
  type WorkflowAnalyticsQuery
} from '../api';
import {
  normalizeWorkflowRunMetrics,
  normalizeWorkflowRunStats
} from '../normalizers';
import type {
  WorkflowAnalyticsRangeKey,
  WorkflowRunMetricsSummary,
  WorkflowRunStatsSummary
} from '../types';
import { useAppHubEvent, type AppHubSocketEvent } from '../../events/context';
import { useModuleScope } from '../../modules/ModuleScopeContext';

export type WorkflowAnalyticsState = {
  stats: WorkflowRunStatsSummary | null;
  metrics: WorkflowRunMetricsSummary | null;
  history: WorkflowRunMetricsSummary[];
  rangeKey: WorkflowAnalyticsRangeKey;
  bucketKey: string | null;
  outcomes: string[];
  lastUpdated?: string;
};

type WorkflowAnalyticsContextValue = {
  workflowAnalytics: Record<string, WorkflowAnalyticsState>;
  loadWorkflowAnalytics: (slug: string, range?: WorkflowAnalyticsRangeKey) => Promise<void>;
  setWorkflowAnalyticsRange: (slug: string, range: WorkflowAnalyticsRangeKey) => void;
  setWorkflowAnalyticsOutcomes: (slug: string, outcomes: string[]) => void;
};

const WorkflowAnalyticsContext = createContext<WorkflowAnalyticsContextValue | undefined>(undefined);

const ANALYTICS_DEFAULT_RANGE: WorkflowAnalyticsRangeKey = '7d';
const ANALYTICS_HISTORY_LIMIT = 24;
const WORKFLOW_ANALYTICS_EVENT = 'workflow.analytics.snapshot';

function createDefaultAnalyticsState(): WorkflowAnalyticsState {
  return {
    stats: null,
    metrics: null,
    history: [],
    rangeKey: ANALYTICS_DEFAULT_RANGE,
    bucketKey: null,
    outcomes: []
  };
}

export function WorkflowAnalyticsProvider({ children }: { children: ReactNode }) {
  const { authorizedFetch } = useWorkflowAccess();
  const { selectedSlug } = useWorkflowDefinitions();
  const moduleScope = useModuleScope();
  const { kind: moduleScopeKind, isResourceInScope } = moduleScope;
  const isModuleScoped = moduleScopeKind === 'module';

  const [workflowAnalytics, setWorkflowAnalytics] = useState<Record<string, WorkflowAnalyticsState>>({});
  const workflowAnalyticsRef = useRef<Record<string, WorkflowAnalyticsState>>({});

  const loadWorkflowAnalytics = useCallback(
    async (slug: string, range?: WorkflowAnalyticsRangeKey) => {
      if (!slug) {
        return;
      }
      if (isModuleScoped && !isResourceInScope('workflow-definition', slug)) {
        return;
      }
      const existing = workflowAnalyticsRef.current[slug];
      const targetRange = range ?? existing?.rangeKey ?? ANALYTICS_DEFAULT_RANGE;
      const moduleId = isModuleScoped ? moduleScope.moduleId : null;
      const query: WorkflowAnalyticsQuery = {};
      if (targetRange !== 'custom') {
        query.range = targetRange;
      }
      if (moduleId) {
        query.moduleId = moduleId;
      }
      try {
        const [stats, metrics] = await Promise.all([
          getWorkflowStats(authorizedFetch, slug, query),
          getWorkflowRunMetrics(authorizedFetch, slug, query)
        ]);
        setWorkflowAnalytics((current) => {
          const entry = current[slug] ?? createDefaultAnalyticsState();
          const historyBase = entry.history ?? [];
          const updatedHistory = metrics ? [...historyBase, metrics].slice(-ANALYTICS_HISTORY_LIMIT) : historyBase;
          const nextRangeKey = (stats?.range.key as WorkflowAnalyticsRangeKey | undefined) ?? targetRange;
          const defaultOutcomes = entry.outcomes.length
            ? entry.outcomes
            : stats
              ? Object.keys(stats.statusCounts)
              : [];
          return {
            ...current,
            [slug]: {
              stats,
              metrics,
              history: updatedHistory,
              rangeKey: nextRangeKey,
              bucketKey: metrics?.bucket?.key ?? entry.bucketKey ?? null,
              outcomes: defaultOutcomes,
              lastUpdated: new Date().toISOString()
            }
          } satisfies Record<string, WorkflowAnalyticsState>;
        });
      } catch (error) {
        console.error('workflow.analytics.fetch_failed', { slug, error });
      }
    },
    [authorizedFetch, isModuleScoped, isResourceInScope, moduleScope.moduleId]
  );

  const setWorkflowAnalyticsRange = useCallback((slug: string, range: WorkflowAnalyticsRangeKey) => {
    setWorkflowAnalytics((current) => {
      const entry = current[slug] ?? createDefaultAnalyticsState();
      return {
        ...current,
        [slug]: {
          ...entry,
          rangeKey: range
        }
      };
    });
    void loadWorkflowAnalytics(slug, range);
  }, [loadWorkflowAnalytics]);

  const setWorkflowAnalyticsOutcomes = useCallback((slug: string, outcomes: string[]) => {
    setWorkflowAnalytics((current) => {
      const entry = current[slug] ?? createDefaultAnalyticsState();
      return {
        ...current,
        [slug]: {
          ...entry,
          outcomes
        }
      };
    });
  }, []);

  const handleAnalyticsSnapshot = useCallback((snapshot: unknown) => {
    if (!snapshot || typeof snapshot !== 'object') {
      return;
    }
    const record = snapshot as { slug?: unknown; stats?: unknown; metrics?: unknown };
    const slug = typeof record.slug === 'string' ? record.slug : null;
    if (!slug) {
      return;
    }
    if (isModuleScoped && !isResourceInScope('workflow-definition', slug)) {
      return;
    }
    const stats = record.stats ? normalizeWorkflowRunStats(record.stats) : null;
    const metrics = record.metrics ? normalizeWorkflowRunMetrics(record.metrics) : null;
    if (!stats && !metrics) {
      return;
    }
    setWorkflowAnalytics((current) => {
      const existing = current[slug] ?? createDefaultAnalyticsState();
      const history = metrics
        ? [...existing.history, metrics].slice(-ANALYTICS_HISTORY_LIMIT)
        : existing.history;
      const outcomes = existing.outcomes.length
        ? existing.outcomes
        : stats
          ? Object.keys(stats.statusCounts)
          : [];
      return {
        ...current,
        [slug]: {
          stats: stats ?? existing.stats,
          metrics: metrics ?? existing.metrics,
          history,
          rangeKey:
            (stats?.range.key as WorkflowAnalyticsRangeKey | undefined) ?? existing.rangeKey ?? ANALYTICS_DEFAULT_RANGE,
          bucketKey: metrics?.bucket?.key ?? existing.bucketKey ?? null,
          outcomes,
          lastUpdated: new Date().toISOString()
        }
      };
    });
  }, [isModuleScoped, isResourceInScope]);

  const handleAnalyticsEvent = useCallback(
    (event: Extract<AppHubSocketEvent, { type: typeof WORKFLOW_ANALYTICS_EVENT }>) => {
      const payload = event.data;
      if (!payload || typeof payload !== 'object') {
        return;
      }
      const record = payload as { slug?: unknown };
      const slug = typeof record.slug === 'string' ? record.slug : null;
      if (!slug) {
        return;
      }
      if (!isModuleScoped || isResourceInScope('workflow-definition', slug)) {
        handleAnalyticsSnapshot(payload);
      }
    },
    [handleAnalyticsSnapshot, isModuleScoped, isResourceInScope]
  );

  useAppHubEvent(WORKFLOW_ANALYTICS_EVENT, handleAnalyticsEvent);

  useEffect(() => {
    workflowAnalyticsRef.current = workflowAnalytics;
  }, [workflowAnalytics]);

  useEffect(() => {
    if (selectedSlug) {
      if (isModuleScoped && !isResourceInScope('workflow-definition', selectedSlug)) {
        return;
      }
      void loadWorkflowAnalytics(selectedSlug);
    }
  }, [isModuleScoped, isResourceInScope, selectedSlug, loadWorkflowAnalytics]);

  const value = useMemo<WorkflowAnalyticsContextValue>(
    () => ({
      workflowAnalytics,
      loadWorkflowAnalytics,
      setWorkflowAnalyticsRange,
      setWorkflowAnalyticsOutcomes
    }),
    [workflowAnalytics, loadWorkflowAnalytics, setWorkflowAnalyticsRange, setWorkflowAnalyticsOutcomes]
  );

  return <WorkflowAnalyticsContext.Provider value={value}>{children}</WorkflowAnalyticsContext.Provider>;
}

export function useWorkflowAnalytics() {
  const context = useContext(WorkflowAnalyticsContext);
  if (!context) {
    throw new Error('useWorkflowAnalytics must be used within WorkflowAnalyticsProvider');
  }
  return context;
}

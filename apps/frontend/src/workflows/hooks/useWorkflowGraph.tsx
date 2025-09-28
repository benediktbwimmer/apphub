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
import { fetchWorkflowTopologyGraph, ApiError } from '../api';
import { normalizeWorkflowGraph, WORKFLOW_GRAPH_EVENT_TYPES } from '../graph';
import type {
  LoadWorkflowGraphOptions,
  WorkflowGraphContextValue,
  WorkflowGraphEventEntry,
  WorkflowGraphFetchMeta,
  WorkflowGraphNormalized,
  WorkflowGraphSocketEvent
} from '../graph';
import { useWorkflowAccess } from './useWorkflowAccess';
import { useAppHubEvent } from '../../events/context';

const WorkflowGraphContext = createContext<WorkflowGraphContextValue | undefined>(undefined);

const MAX_PENDING_EVENTS = 500;
const REFRESH_DEBOUNCE_MS = 750;

export function WorkflowGraphProvider({ children }: { children: ReactNode }) {
  const { authorizedFetch, pushToast } = useWorkflowAccess();

  const [graph, setGraph] = useState<WorkflowGraphNormalized | null>(null);
  const [graphLoading, setGraphLoading] = useState(true);
  const [graphRefreshing, setGraphRefreshing] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphStale, setGraphStale] = useState(false);
  const [graphMeta, setGraphMeta] = useState<WorkflowGraphFetchMeta | null>(null);
  const [pendingEvents, setPendingEvents] = useState<WorkflowGraphEventEntry[]>([]);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const fetchGenerationRef = useRef(0);
  const activeRequestRef = useRef<Promise<void> | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const eventCounterRef = useRef(0);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (typeof window !== 'undefined' && refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  const loadWorkflowGraph = useCallback(
    async (options: LoadWorkflowGraphOptions = {}) => {
      const { background = false } = options;

      if (background) {
        if (activeRequestRef.current) {
          return activeRequestRef.current;
        }
        setGraphRefreshing(true);
      } else {
        setGraphLoading(true);
        setGraphError(null);
      }

      const fetchId = ++fetchGenerationRef.current;

      const request = (async () => {
        try {
          const { graph: graphPayload, meta } = await fetchWorkflowTopologyGraph(authorizedFetch);
          if (!isMountedRef.current || fetchGenerationRef.current !== fetchId) {
            return;
          }
          const normalized = normalizeWorkflowGraph(graphPayload);
          setGraph(normalized);
          setGraphError(null);
          setGraphStale(false);
          setGraphMeta(meta);
          setLastLoadedAt(normalized.generatedAt);
        } catch (err) {
          if (!isMountedRef.current || fetchGenerationRef.current !== fetchId) {
            return;
          }
          const message = err instanceof Error ? err.message : 'Failed to load workflow graph';
          setGraphError(message);
          if (!background) {
            pushToast({
              title: 'Workflow graph',
              description: message,
              tone: 'error'
            });
          }
          if (err instanceof ApiError && err.status === 401) {
            setGraph(null);
            setGraphMeta(null);
          }
        } finally {
          if (activeRequestRef.current === request) {
            activeRequestRef.current = null;
          }
          if (!isMountedRef.current || fetchGenerationRef.current !== fetchId) {
            return;
          }
          if (background) {
            setGraphRefreshing(false);
          } else {
            setGraphLoading(false);
          }
        }
      })();

      activeRequestRef.current = request;
      await request;
    },
    [authorizedFetch, pushToast]
  );

  useEffect(() => {
    void loadWorkflowGraph();
  }, [loadWorkflowGraph]);

  const enqueueEvent = useCallback((event: WorkflowGraphSocketEvent) => {
    setPendingEvents((current) => {
      const next: WorkflowGraphEventEntry[] = [
        ...current,
        {
          id: `graph-event-${eventCounterRef.current += 1}`,
          receivedAt: Date.now(),
          event
        }
      ];
      if (next.length > MAX_PENDING_EVENTS) {
        next.splice(0, next.length - MAX_PENDING_EVENTS);
      }
      return next;
    });
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (typeof window === 'undefined') {
      void loadWorkflowGraph({ background: true });
      return;
    }
    if (refreshTimerRef.current !== null) {
      return;
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void loadWorkflowGraph({ background: true });
    }, REFRESH_DEBOUNCE_MS);
  }, [loadWorkflowGraph]);

  useAppHubEvent(WORKFLOW_GRAPH_EVENT_TYPES, (event) => {
    const typed = event as WorkflowGraphSocketEvent;
    enqueueEvent(typed);
    if (typed.type === 'workflow.definition.updated') {
      setGraphStale((current) => current || true);
      scheduleRefresh();
    }
  });

  const dequeuePendingEvents = useCallback((limit?: number) => {
    let removed: WorkflowGraphEventEntry[] = [];
    setPendingEvents((current) => {
      if (current.length === 0) {
        removed = [];
        return current;
      }
      const count = limit && limit > 0 ? Math.min(limit, current.length) : current.length;
      removed = current.slice(0, count);
      return current.slice(count);
    });
    return removed;
  }, []);

  const clearPendingEvents = useCallback(() => {
    setPendingEvents([]);
  }, []);

  const value = useMemo<WorkflowGraphContextValue>(
    () => ({
      graph,
      graphLoading,
      graphRefreshing,
      graphError,
      graphStale,
      lastLoadedAt,
      graphMeta,
      pendingEvents,
      loadWorkflowGraph,
      dequeuePendingEvents,
      clearPendingEvents
    }),
    [
      graph,
      graphLoading,
      graphRefreshing,
      graphError,
      graphStale,
      lastLoadedAt,
      graphMeta,
      pendingEvents,
      loadWorkflowGraph,
      dequeuePendingEvents,
      clearPendingEvents
    ]
  );

  return <WorkflowGraphContext.Provider value={value}>{children}</WorkflowGraphContext.Provider>;
}

export function useWorkflowGraph(): WorkflowGraphContextValue {
  const context = useContext(WorkflowGraphContext);
  if (!context) {
    throw new Error('useWorkflowGraph must be used within WorkflowGraphProvider');
  }
  return context;
}

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
import { fetchWorkflowTopologyGraph, getWorkflowEventHealth, ApiError } from '../api';
import { normalizeWorkflowGraph, WORKFLOW_GRAPH_EVENT_TYPES } from '../graph';
import {
  createInitialOverlay,
  applyWorkflowRunOverlay,
  applyAssetProducedOverlay,
  applyAssetExpiredOverlay,
  applyTriggerHealthOverlay
} from '../graph/liveStatus';
import type {
  LoadWorkflowGraphOptions,
  WorkflowGraphContextValue,
  WorkflowGraphEventEntry,
  WorkflowGraphFetchMeta,
  WorkflowGraphNormalized,
  WorkflowGraphSocketEvent,
  WorkflowGraphLiveOverlay,
  WorkflowGraphOverlayMeta
} from '../graph';
import { useWorkflowAccess } from './useWorkflowAccess';
import { useAppHubEvent } from '../../events/context';
import { normalizeWorkflowRun } from '../normalizers';

const WorkflowGraphContext = createContext<WorkflowGraphContextValue | undefined>(undefined);

const MAX_PENDING_EVENTS = 500;
const REFRESH_DEBOUNCE_MS = 750;
const EVENT_PROCESS_BATCH_SIZE = 40;
const EVENT_PROCESS_MAX_DURATION_MS = 24;
const EVENT_PROCESS_INTERVAL_MS = 120;
const EVENT_HEALTH_REFRESH_INTERVAL_MS = 60_000;
const INITIAL_OVERLAY_META: WorkflowGraphOverlayMeta = {
  lastEventAt: null,
  lastProcessedAt: null,
  droppedEvents: 0,
  queueSize: 0
};

function scheduleTimer(callback: () => void, delayMs: number): number | NodeJS.Timeout {
  if (typeof window !== 'undefined') {
    return window.setTimeout(callback, delayMs);
  }
  return setTimeout(callback, delayMs);
}

function scheduleInterval(callback: () => void, delayMs: number): number | NodeJS.Timeout {
  if (typeof window !== 'undefined') {
    return window.setInterval(callback, delayMs);
  }
  return setInterval(callback, delayMs);
}

function clearIntervalCompat(handle: number | NodeJS.Timeout | null): void {
  if (handle === null) {
    return;
  }
  if (typeof window !== 'undefined') {
    window.clearInterval(handle as number);
  } else {
    clearInterval(handle as NodeJS.Timeout);
  }
}

export function WorkflowGraphProvider({ children }: { children: ReactNode }) {
  const { authorizedFetch, pushToast } = useWorkflowAccess();

  const [graph, setGraph] = useState<WorkflowGraphNormalized | null>(null);
  const graphRef = useRef<WorkflowGraphNormalized | null>(null);
  const [graphLoading, setGraphLoading] = useState(true);
  const [graphRefreshing, setGraphRefreshing] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphStale, setGraphStale] = useState(false);
  const [graphMeta, setGraphMeta] = useState<WorkflowGraphFetchMeta | null>(null);
  const [pendingEvents, setPendingEvents] = useState<WorkflowGraphEventEntry[]>([]);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<WorkflowGraphLiveOverlay>(createInitialOverlay());
  const [overlayMeta, setOverlayMeta] = useState<WorkflowGraphOverlayMeta>(INITIAL_OVERLAY_META);

  const isMountedRef = useRef(true);
  const fetchGenerationRef = useRef(0);
  const activeRequestRef = useRef<Promise<void> | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const eventCounterRef = useRef(0);
  const overlayMetaRef = useRef<WorkflowGraphOverlayMeta>(INITIAL_OVERLAY_META);
  const pendingEventsRef = useRef<WorkflowGraphEventEntry[]>([]);
  const droppedEventsRef = useRef(0);
  const processingTimerRef = useRef<number | NodeJS.Timeout | null>(null);
  const processingActiveRef = useRef(false);

  const updateOverlayMeta = useCallback(
    (
      patch:
        | Partial<WorkflowGraphOverlayMeta>
        | ((current: WorkflowGraphOverlayMeta) => Partial<WorkflowGraphOverlayMeta>)
    ) => {
      setOverlayMeta((current) => {
        const partial = typeof patch === 'function' ? patch(current) : patch;
        const next = { ...current, ...partial } satisfies WorkflowGraphOverlayMeta;
        overlayMetaRef.current = next;
        return next;
      });
    },
    []
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (typeof window !== 'undefined' && refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  useEffect(() => {
    pendingEventsRef.current = pendingEvents;
  }, [pendingEvents]);

  useEffect(() => {
    let cancelled = false;
    let intervalHandle: number | NodeJS.Timeout | null = null;

    const fetchHealth = async () => {
      try {
        const health = await getWorkflowEventHealth(authorizedFetch);
        if (cancelled || !health) {
          return;
        }
        setOverlay((current) => applyTriggerHealthOverlay(current, health));
      } catch (err) {
        console.warn('workflow.graph.event_health_fetch_failed', err);
      }
    };

    void fetchHealth();
    intervalHandle = scheduleInterval(() => {
      void fetchHealth();
    }, EVENT_HEALTH_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearIntervalCompat(intervalHandle);
    };
  }, [authorizedFetch]);

  const loadWorkflowGraph = useCallback(
    async (options: LoadWorkflowGraphOptions = {}) => {
      const { background = false } = options;

      if (activeRequestRef.current) {
        if (background) {
          return activeRequestRef.current;
        }
        await activeRequestRef.current;
        return;
      }

      if (background) {
        setGraphRefreshing(true);
      } else {
        setGraphLoading(true);
        setGraphError(null);
      }

      const fetchId = ++fetchGenerationRef.current;
      const isLatestFetch = () => fetchGenerationRef.current === fetchId;

      const fetchPromise = (async () => {
        try {
          const { graph: graphPayload, meta } = await fetchWorkflowTopologyGraph(authorizedFetch);
          if (!isMountedRef.current || !isLatestFetch()) {
            return;
          }
          const normalized = normalizeWorkflowGraph(graphPayload);
          setGraph(normalized);
          graphRef.current = normalized;
          setGraphError(null);
          setGraphStale(false);
          setGraphMeta(meta);
          setLastLoadedAt(normalized.generatedAt);
        } catch (err) {
          if (!isMountedRef.current || !isLatestFetch()) {
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
            graphRef.current = null;
            setGraphMeta(null);
          }
        } finally {
          if (!isMountedRef.current || !isLatestFetch()) {
            return;
          }
          if (background) {
            setGraphRefreshing(false);
          } else {
            setGraphLoading(false);
          }
        }
      })();

      activeRequestRef.current = fetchPromise;
      try {
        await fetchPromise;
      } finally {
        if (activeRequestRef.current === fetchPromise) {
          activeRequestRef.current = null;
        }
      }
    },
    [authorizedFetch, pushToast]
  );

  useEffect(() => {
    void loadWorkflowGraph();
  }, [loadWorkflowGraph]);

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

  const applyOverlayEvent = useCallback(
    (currentOverlay: WorkflowGraphLiveOverlay, entry: WorkflowGraphEventEntry): WorkflowGraphLiveOverlay => {
      const { event, receivedAt } = entry;
      switch (event.type) {
        case 'workflow.run.updated':
        case 'workflow.run.pending':
        case 'workflow.run.running':
        case 'workflow.run.succeeded':
        case 'workflow.run.failed':
        case 'workflow.run.canceled': {
          const payload = event.data?.run;
          if (!payload) {
            return currentOverlay;
          }
          const normalized = normalizeWorkflowRun(payload);
          if (!normalized) {
            return currentOverlay;
          }
          return applyWorkflowRunOverlay(currentOverlay, normalized, receivedAt);
        }
        case 'asset.produced':
          return event.data
            ? applyAssetProducedOverlay(currentOverlay, event.data, receivedAt)
            : currentOverlay;
        case 'asset.expired':
          return event.data
            ? applyAssetExpiredOverlay(currentOverlay, event.data, receivedAt)
            : currentOverlay;
        default:
          return currentOverlay;
      }
    },
    []
  );

  const dequeuePendingEvents = useCallback((limit?: number) => {
    const current = pendingEventsRef.current;
    if (current.length === 0) {
      return [];
    }
    const count = limit && limit > 0 ? Math.min(limit, current.length) : current.length;
    const removed = current.slice(0, count);
    const next = current.slice(count);
    pendingEventsRef.current = next;
    setPendingEvents(next);
    return removed;
  }, []);

  const clearPendingEvents = useCallback(() => {
    pendingEventsRef.current = [];
    setPendingEvents([]);
    updateOverlayMeta(() => ({
      queueSize: 0,
      droppedEvents: droppedEventsRef.current
    }));
  }, [updateOverlayMeta]);

  const processBatch = useCallback(() => {
    processingTimerRef.current = null;
    const start = Date.now();
    const entries: WorkflowGraphEventEntry[] = [];
    while (entries.length < EVENT_PROCESS_BATCH_SIZE) {
      const remaining = EVENT_PROCESS_BATCH_SIZE - entries.length;
      const batch = dequeuePendingEvents(remaining);
      if (batch.length === 0) {
        break;
      }
      entries.push(...batch);
      if (Date.now() - start >= EVENT_PROCESS_MAX_DURATION_MS) {
        break;
      }
    }

    if (entries.length > 0) {
      setOverlay((current) => {
        let nextOverlay: WorkflowGraphLiveOverlay = current;
        for (const entry of entries) {
          nextOverlay = applyOverlayEvent(nextOverlay, entry);
        }
        return nextOverlay;
      });

      const latestReceived = entries.reduce<number>(
        (max, entry) => (entry.receivedAt > max ? entry.receivedAt : max),
        overlayMetaRef.current.lastEventAt ?? 0
      );

      updateOverlayMeta(() => ({
        lastProcessedAt: Date.now(),
        lastEventAt: latestReceived,
        queueSize: pendingEventsRef.current.length,
        droppedEvents: droppedEventsRef.current
      }));
    }

    if (pendingEventsRef.current.length > 0) {
      processingTimerRef.current = scheduleTimer(processBatch, EVENT_PROCESS_INTERVAL_MS);
    } else {
      processingActiveRef.current = false;
    }
  }, [applyOverlayEvent, dequeuePendingEvents, updateOverlayMeta]);

  const scheduleProcessing = useCallback(() => {
    if (processingActiveRef.current || processingTimerRef.current !== null) {
      return;
    }
    if (pendingEventsRef.current.length === 0) {
      return;
    }
    processingActiveRef.current = true;
    processingTimerRef.current = scheduleTimer(processBatch, 0);
  }, [processBatch]);

  const enqueueEvent = useCallback(
    (event: WorkflowGraphSocketEvent) => {
      const receivedAt = Date.now();
      const entry: WorkflowGraphEventEntry = {
        id: `graph-event-${(eventCounterRef.current += 1)}`,
        receivedAt,
        event
      };
      const next = [...pendingEventsRef.current, entry];
      if (next.length > MAX_PENDING_EVENTS) {
        const overflow = next.length - MAX_PENDING_EVENTS;
        next.splice(0, overflow);
        droppedEventsRef.current += overflow;
        console.warn('workflow.graph.events_dropped', {
          overflow,
          max: MAX_PENDING_EVENTS
        });
      }
      pendingEventsRef.current = next;
      setPendingEvents(next);
      updateOverlayMeta((current) => ({
        lastEventAt: Math.max(current.lastEventAt ?? 0, receivedAt),
        droppedEvents: droppedEventsRef.current,
        queueSize: next.length
      }));
      scheduleProcessing();
    },
    [scheduleProcessing, updateOverlayMeta]
  );

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
      overlay,
      overlayMeta,
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
      overlay,
      overlayMeta,
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { fetchDatasetAccessAudit, type DatasetAccessAuditListParams } from '../api';
import type { DatasetAccessAuditEvent } from '../types';

type AuthorizedFetch = ReturnType<typeof useAuthorizedFetch>;

type Fetcher = typeof fetchDatasetAccessAudit;

export type UseDatasetHistoryOptions = {
  datasetId: string | null;
  authorizedFetch: AuthorizedFetch;
  enabled: boolean;
  pageSize?: number;
  actions?: DatasetAccessAuditListParams['actions'];
  success?: DatasetAccessAuditListParams['success'];
  historyFetcher?: Fetcher;
};

export type UseDatasetHistoryResult = {
  events: DatasetAccessAuditEvent[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  lastFetchedAt: string | null;
  refresh: () => void;
  loadMore: () => void;
};

const DEFAULT_PAGE_SIZE = 25;

function normalizeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Failed to load dataset history';
}

export function useDatasetHistory({
  datasetId,
  authorizedFetch,
  enabled,
  pageSize = DEFAULT_PAGE_SIZE,
  actions,
  success,
  historyFetcher = fetchDatasetAccessAudit
}: UseDatasetHistoryOptions): UseDatasetHistoryResult {
  const [events, setEvents] = useState<DatasetAccessAuditEvent[]>([]);
  const eventsRef = useRef<DatasetAccessAuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const nextCursorRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const loadingRef = useRef(false);
  const loadingMoreRef = useRef(false);

  const resetState = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    requestIdRef.current += 1;
    eventsRef.current = [];
    setEvents([]);
    setError(null);
    setHasMore(false);
    setLoading(false);
    setLoadingMore(false);
    loadingRef.current = false;
    loadingMoreRef.current = false;
    setLastFetchedAt(null);
    nextCursorRef.current = null;
  }, []);

  const runFetch = useCallback(
    async ({ cursor, append }: { cursor: string | null; append: boolean }) => {
      if (!datasetId || !enabled) {
        resetState();
        return;
      }

      if (append && (!nextCursorRef.current || loadingRef.current || loadingMoreRef.current)) {
        return;
      }

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      if (append) {
        setLoadingMore(true);
        loadingMoreRef.current = true;
      } else {
        setLoading(true);
        loadingRef.current = true;
        setError(null);
      }

      try {
        const response = await historyFetcher(
          authorizedFetch,
          datasetId,
          {
            limit: pageSize,
            cursor,
            actions,
            success
          },
          { signal: controller.signal }
        );

        if (requestIdRef.current !== requestId) {
          return;
        }

        const nextEvents = append
          ? [...eventsRef.current, ...response.events]
          : response.events;
        eventsRef.current = nextEvents;
        setEvents(nextEvents);
        nextCursorRef.current = response.nextCursor ?? null;
        setHasMore(Boolean(response.nextCursor));
        if (!append) {
          setLastFetchedAt(new Date().toISOString());
        }
      } catch (fetchError) {
        if (controller.signal.aborted || requestIdRef.current !== requestId) {
          return;
        }
        const message = normalizeMessage(fetchError);
        setError(message);
        if (!append) {
          eventsRef.current = [];
          setEvents([]);
          nextCursorRef.current = null;
          setHasMore(false);
          setLastFetchedAt(null);
        }
      } finally {
        if (requestIdRef.current === requestId) {
          if (append) {
            setLoadingMore(false);
            loadingMoreRef.current = false;
          } else {
            setLoading(false);
            loadingRef.current = false;
          }
        }
      }
    },
    [actions, authorizedFetch, datasetId, enabled, historyFetcher, pageSize, resetState, success]
  );

  useEffect(() => {
    resetState();
    if (!datasetId || !enabled) {
      return () => {
        controllerRef.current?.abort();
        controllerRef.current = null;
      };
    }
    void runFetch({ cursor: null, append: false });
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
      requestIdRef.current += 1;
    };
  }, [datasetId, enabled, resetState, runFetch]);

  const refresh = useCallback(() => {
    if (!datasetId || !enabled) {
      return;
    }
    void runFetch({ cursor: null, append: false });
  }, [datasetId, enabled, runFetch]);

  const loadMore = useCallback(() => {
    if (!datasetId || !enabled || !nextCursorRef.current || loading || loadingMore) {
      return;
    }
    void runFetch({ cursor: nextCursorRef.current, append: true });
  }, [datasetId, enabled, loading, loadingMore, runFetch]);

  return useMemo(
    () => ({
      events,
      loading,
      loadingMore,
      error,
      hasMore,
      lastFetchedAt,
      refresh,
      loadMore
    }),
    [error, events, hasMore, lastFetchedAt, loadMore, loading, loadingMore, refresh]
  );
}

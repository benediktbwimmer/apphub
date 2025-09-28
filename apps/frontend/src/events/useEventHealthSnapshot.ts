import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowEventSchedulerHealth } from '../workflows/types';
import { getWorkflowEventHealth } from '../workflows/api';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';

const REFRESH_INTERVAL_MS = 30_000;

export type EventHealthSnapshotState = {
  health: WorkflowEventSchedulerHealth | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastUpdatedAt: string | null;
  refresh: () => Promise<void>;
};

export function useEventHealthSnapshot(): EventHealthSnapshotState {
  const authorizedFetch = useAuthorizedFetch();
  const [health, setHealth] = useState<WorkflowEventSchedulerHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const fetchSnapshot = useCallback(
    async (background: boolean) => {
      if (background) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const snapshot = await getWorkflowEventHealth(authorizedFetch);
        setHealth(snapshot);
        setLastUpdatedAt(new Date().toISOString());
      } catch (err) {
        setError((err as Error).message);
      } finally {
        if (background) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [authorizedFetch]
  );

  useEffect(() => {
    void fetchSnapshot(false);
  }, [fetchSnapshot]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    timerRef.current = window.setInterval(() => {
      void fetchSnapshot(true);
    }, REFRESH_INTERVAL_MS);
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [fetchSnapshot]);

  const refresh = useCallback(async () => {
    await fetchSnapshot(false);
  }, [fetchSnapshot]);

  return {
    health,
    loading,
    refreshing,
    error,
    lastUpdatedAt,
    refresh
  } satisfies EventHealthSnapshotState;
}

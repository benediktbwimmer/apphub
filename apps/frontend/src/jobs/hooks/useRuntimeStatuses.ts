import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { fetchJobRuntimeStatuses, type JobRuntimeStatus } from '../api';

type UseRuntimeStatusesOptions = {
  autoRefreshMs?: number | null;
};

export type UseRuntimeStatusesResult = {
  statuses: JobRuntimeStatus[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function useRuntimeStatuses(
  options: UseRuntimeStatusesOptions = {}
): UseRuntimeStatusesResult {
  const { activeToken } = useAuth();
  const autoRefreshMs = options.autoRefreshMs ?? null;
  const [statuses, setStatuses] = useState<JobRuntimeStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let canceled = false;
    if (!activeToken) {
      setLoading(false);
      setError('Authentication required to load runtime readiness');
      setStatuses([]);
      return () => {
        canceled = true;
      };
    }
    const controller = new AbortController();
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJobRuntimeStatuses(activeToken, { signal: controller.signal });
        if (!canceled) {
          setStatuses(data);
        }
      } catch (err) {
        if (!canceled) {
          const message =
            err instanceof Error ? err.message : 'Failed to load runtime readiness';
          setError(message);
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      canceled = true;
      controller.abort();
    };
  }, [activeToken, refreshToken]);

  useEffect(() => {
    if (!autoRefreshMs || autoRefreshMs <= 0) {
      return undefined;
    }
    const timer = setInterval(() => {
      setRefreshToken((token) => token + 1);
    }, autoRefreshMs);
    return () => {
      clearInterval(timer);
    };
  }, [autoRefreshMs]);

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  return {
    statuses,
    loading,
    error,
    refresh
  };
}

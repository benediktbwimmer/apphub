import { useCallback, useEffect, useState } from 'react';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import type { AuthorizedFetch } from '../../workflows/api';
import { fetchJobRuntimeStatuses, type JobRuntimeStatus } from '../api';

type UseRuntimeStatusesOptions = {
  fetcher?: AuthorizedFetch;
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
  const authorizedFetch = useAuthorizedFetch();
  const fetcher = options.fetcher ?? authorizedFetch;
  const autoRefreshMs = options.autoRefreshMs ?? null;
  const [statuses, setStatuses] = useState<JobRuntimeStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJobRuntimeStatuses(fetcher);
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
    };
  }, [fetcher, refreshToken]);

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

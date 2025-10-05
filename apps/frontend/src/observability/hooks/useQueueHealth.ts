import { useCallback, useMemo } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/useAuth';
import { usePollingResource } from '../../hooks/usePollingResource';
import { formatFetchError } from '../../core/utils';
import type { QueueHealthSnapshot } from '../types';
import { fetchQueueHealth } from '../../core/api';

type AuthorizedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type UseQueueHealthOptions = {
  intervalMs?: number;
  enabled?: boolean;
};

const DEFAULT_OPTIONS: Required<UseQueueHealthOptions> = {
  intervalMs: 20_000,
  enabled: true
};

export function useQueueHealth(options: UseQueueHealthOptions = {}) {
  const { intervalMs, enabled } = { ...DEFAULT_OPTIONS, ...options };
  const { activeToken } = useAuth();

  const fetcher = useCallback(
    async ({ signal }: { authorizedFetch: AuthorizedFetch; signal: AbortSignal }) => {
      if (!activeToken) {
        throw new Error('Authentication required to load queue health');
      }
      const snapshot = await fetchQueueHealth(activeToken, { signal });
      const data = (snapshot as { data?: QueueHealthSnapshot } | QueueHealthSnapshot | null) ?? null;
      if (data && 'queues' in (data as QueueHealthSnapshot)) {
        return data as QueueHealthSnapshot;
      }
      if (data && typeof data === 'object' && data && 'data' in data) {
        const envelope = data as { data?: QueueHealthSnapshot };
        if (envelope.data) {
          return envelope.data;
        }
      }
      throw new Error('Malformed queue health payload');
    },
    [activeToken]
  );

  const { data, error, loading, lastUpdatedAt, refetch } = usePollingResource<QueueHealthSnapshot>({
    fetcher,
    intervalMs,
    enabled,
    immediate: true
  });

  const normalizedError = useMemo(() => {
    if (!error) {
      return null;
    }
    return formatFetchError(error, 'Failed to load queue health', API_BASE_URL);
  }, [error]);

  return {
    snapshot: data,
    loading,
    error: normalizedError,
    lastUpdatedAt,
    refresh: refetch
  } as const;
}

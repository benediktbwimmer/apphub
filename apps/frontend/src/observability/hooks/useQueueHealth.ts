import { useCallback, useMemo } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { usePollingResource } from '../../hooks/usePollingResource';
import { formatFetchError } from '../../core/utils';
import type { QueueHealthSnapshot } from '../types';

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
  const authorizedFetch = useAuthorizedFetch();

  const fetcher = useCallback(
    async ({ signal }: { authorizedFetch: ReturnType<typeof useAuthorizedFetch>; signal: AbortSignal }) => {
      const response = await authorizedFetch(`${API_BASE_URL}/admin/queue-health`, { signal });
      if (!response.ok) {
        const detail = await response.text().catch(() => null);
        throw new Error(detail || `Failed to load queue health (status ${response.status})`);
      }
      const payload = (await response.json().catch(() => null)) as { data?: QueueHealthSnapshot } | null;
      if (!payload?.data) {
        throw new Error('Malformed queue health payload');
      }
      return payload.data;
    },
    [authorizedFetch]
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

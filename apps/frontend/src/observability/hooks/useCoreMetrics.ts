import { useCallback, useMemo } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { usePollingResource } from '../../hooks/usePollingResource';
import { formatFetchError } from '../../core/utils';
import type { CoreRunMetrics } from '../types';

export type UseCoreMetricsOptions = {
  intervalMs?: number;
  enabled?: boolean;
};

const DEFAULT_OPTIONS: Required<UseCoreMetricsOptions> = {
  intervalMs: 30_000,
  enabled: true
};

export function useCoreMetrics(options: UseCoreMetricsOptions = {}) {
  const { intervalMs, enabled } = { ...DEFAULT_OPTIONS, ...options };
  const authorizedFetch = useAuthorizedFetch();

  const fetcher = useCallback(
    async ({ signal }: { authorizedFetch: ReturnType<typeof useAuthorizedFetch>; signal: AbortSignal }) => {
      const response = await authorizedFetch(`${API_BASE_URL}/metrics`, { signal });
      if (!response.ok) {
        const detail = await response.text().catch(() => null);
        throw new Error(detail || `Failed to load core metrics (status ${response.status})`);
      }
      const payload = (await response.json().catch(() => null)) as { data?: CoreRunMetrics } | null;
      if (!payload?.data) {
        throw new Error('Malformed core metrics payload');
      }
      return payload.data;
    },
    [authorizedFetch]
  );

  const { data, error, loading, refetch, lastUpdatedAt } = usePollingResource<CoreRunMetrics>({
    fetcher,
    intervalMs,
    enabled,
    immediate: true
  });

  const normalizedError = useMemo(() => {
    if (!error) {
      return null;
    }
    return formatFetchError(error, 'Failed to load core metrics', API_BASE_URL);
  }, [error]);

  return {
    metrics: data,
    loading,
    error: normalizedError,
    lastUpdatedAt,
    refresh: refetch
  } as const;
}

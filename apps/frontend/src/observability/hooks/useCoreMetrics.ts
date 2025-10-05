import { useCallback, useMemo } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../auth/useAuth';
import { usePollingResource } from '../../hooks/usePollingResource';
import { formatFetchError } from '../../core/utils';
import { fetchCoreMetrics } from '../../core/api';
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
  const { activeToken } = useAuth();

  const fetcher = useCallback(
    async ({ signal }: { authorizedFetch: unknown; signal: AbortSignal }) => {
      if (!activeToken) {
        throw new Error('Authentication required to load core metrics');
      }
      const payload = await fetchCoreMetrics(activeToken, { signal });
      if (payload && typeof payload === 'object' && 'data' in (payload as { data?: unknown })) {
        const envelope = payload as { data?: CoreRunMetrics };
        if (envelope.data) {
          return envelope.data;
        }
      }
      return payload as CoreRunMetrics;
    },
    [activeToken]
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

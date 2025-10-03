import { useCallback, useMemo } from 'react';
import { TIMESTORE_BASE_URL, METASTORE_BASE_URL, FILESTORE_BASE_URL } from '../../config';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { usePollingResource } from '../../hooks/usePollingResource';
import { parsePrometheusMetrics } from '../../timestore/utils';
import type { ServiceMetricSource, ServiceMetricsSnapshot } from '../types';

export type UseServiceMetricsOptions = {
  intervalMs?: number;
  enabled?: boolean;
};

const DEFAULT_OPTIONS: Required<UseServiceMetricsOptions> = {
  intervalMs: 45_000,
  enabled: true
};

const SERVICE_ENDPOINTS: ReadonlyArray<{ service: ServiceMetricSource; baseUrl: string }> = [
  { service: 'timestore', baseUrl: TIMESTORE_BASE_URL },
  { service: 'metastore', baseUrl: METASTORE_BASE_URL },
  { service: 'filestore', baseUrl: FILESTORE_BASE_URL }
];

function buildMetricsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  return `${trimmed}/metrics`;
}

export function useServiceMetrics(options: UseServiceMetricsOptions = {}) {
  const { intervalMs, enabled } = { ...DEFAULT_OPTIONS, ...options };
  const authorizedFetch = useAuthorizedFetch();

  const fetcher = useCallback(
    async ({ signal }: { authorizedFetch: ReturnType<typeof useAuthorizedFetch>; signal: AbortSignal }) => {
      const now = new Date().toISOString();
      const results = await Promise.all(
        SERVICE_ENDPOINTS.map(async ({ service, baseUrl }) => {
          const url = buildMetricsUrl(baseUrl);
          try {
            const response = await authorizedFetch(url, {
              signal,
              headers: { Accept: 'text/plain' }
            });
            if (!response.ok) {
              const detail = await response.text().catch(() => null);
              return {
                service,
                metrics: [],
                fetchedAt: null,
                error: detail || `Failed to load metrics (status ${response.status})`
              } satisfies ServiceMetricsSnapshot;
            }
            const text = await response.text();
            const metrics = parsePrometheusMetrics(text);
            return {
              service,
              metrics,
              fetchedAt: now,
              error: null
            } satisfies ServiceMetricsSnapshot;
          } catch (err) {
            return {
              service,
              metrics: [],
              fetchedAt: null,
              error: err instanceof Error ? err.message : 'Failed to fetch metrics'
            } satisfies ServiceMetricsSnapshot;
          }
        })
      );
      return results;
    },
    [authorizedFetch]
  );

  const { data, error, loading, lastUpdatedAt, refetch } = usePollingResource<ServiceMetricsSnapshot[]>({
    fetcher,
    intervalMs,
    enabled,
    immediate: true
  });

  const aggregatedError = useMemo(() => {
    if (error) {
      return error instanceof Error ? error.message : String(error);
    }
    if (!data) {
      return null;
    }
    const allFailed = data.every((snapshot) => snapshot.error);
    if (allFailed) {
      return 'Failed to load service metrics';
    }
    return null;
  }, [data, error]);

  return {
    snapshots: data ?? null,
    loading,
    error: aggregatedError,
    lastUpdatedAt,
    refresh: refetch
  } as const;
}

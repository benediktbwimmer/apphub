import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';

type AuthorizedFetch = ReturnType<typeof useAuthorizedFetch>;

type PollingFetcher<T> = (context: { authorizedFetch: AuthorizedFetch; signal: AbortSignal }) => Promise<T>;

export interface UsePollingResourceOptions<T> {
  fetcher: PollingFetcher<T>;
  intervalMs?: number;
  enabled?: boolean;
  immediate?: boolean;
}

export interface UsePollingResourceResult<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  lastUpdatedAt: number | null;
  refetch: () => Promise<void>;
  stop: () => void;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === 'AbortError' : (error as { name?: string })?.name === 'AbortError';
}

export function usePollingResource<T>(options: UsePollingResourceOptions<T>): UsePollingResourceResult<T> {
  const { fetcher, intervalMs = 0, enabled = true, immediate = true } = options;
  const authorizedFetch = useAuthorizedFetch();

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(immediate && enabled);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const fetcherRef = useRef<PollingFetcher<T>>(fetcher);
  const [fetcherVersion, setFetcherVersion] = useState(0);
  const lastHandledFetcherVersionRef = useRef(0);

  useEffect(() => {
    // Expect callers to memoize the fetcher with useCallback so we only react when inputs change.
    if (fetcherRef.current === fetcher) {
      return;
    }
    fetcherRef.current = fetcher;
    setFetcherVersion((previous) => previous + 1);
  }, [fetcher]);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const abortOngoingRequest = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
  }, []);

  const runFetch = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!enabled) {
        setLoading(false);
        return;
      }

      abortOngoingRequest();
      clearTimer();

      const controller = new AbortController();
      controllerRef.current = controller;

      if (!silent) {
        setLoading(true);
      }

      try {
        const result = await fetcherRef.current({
          authorizedFetch,
          signal: controller.signal
        });
        if (!mountedRef.current || controller.signal.aborted) {
          return;
        }
        setData(result);
        setError(null);
        setLastUpdatedAt(Date.now());
      } catch (err) {
        if (!mountedRef.current || isAbortError(err)) {
          return;
        }
        setError(err);
      } finally {
        if (mountedRef.current) {
          controllerRef.current = null;
          if (!silent) {
            setLoading(false);
          }
          if (intervalMs > 0 && enabled) {
            clearTimer();
            timeoutRef.current = setTimeout(() => {
              void runFetch({ silent: true });
            }, intervalMs);
          }
        }
      }
    },
    [abortOngoingRequest, authorizedFetch, clearTimer, enabled, intervalMs]
  );

  useEffect(() => {
    mountedRef.current = true;
    if (enabled && immediate) {
      void runFetch();
    } else if (enabled && intervalMs > 0) {
      clearTimer();
      timeoutRef.current = setTimeout(() => {
        void runFetch();
      }, intervalMs);
    } else {
      setLoading(false);
    }

    return () => {
      mountedRef.current = false;
      abortOngoingRequest();
      clearTimer();
    };
  }, [abortOngoingRequest, clearTimer, enabled, immediate, intervalMs, runFetch]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (fetcherVersion === 0) {
      lastHandledFetcherVersionRef.current = 0;
      return;
    }

    if (lastHandledFetcherVersionRef.current === fetcherVersion) {
      return;
    }

    lastHandledFetcherVersionRef.current = fetcherVersion;
    void runFetch();
  }, [enabled, fetcherVersion, runFetch]);

  const stop = useCallback(() => {
    abortOngoingRequest();
    clearTimer();
  }, [abortOngoingRequest, clearTimer]);

  const refetch = useCallback(async () => {
    await runFetch({ silent: false });
  }, [runFetch]);

  return {
    data,
    error,
    loading,
    lastUpdatedAt,
    refetch,
    stop
  };
}

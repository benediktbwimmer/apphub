import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { fetchJobs } from '../api';
import type { AuthorizedFetch, JobDefinitionSummary } from '../../workflows/api';

type UseJobsListOptions = {
  fetcher?: AuthorizedFetch;
};

export type UseJobsListResult = {
  jobs: JobDefinitionSummary[];
  sortedJobs: JobDefinitionSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function useJobsList(options: UseJobsListOptions = {}): UseJobsListResult {
  const authorizedFetch = useAuthorizedFetch();
  const fetcher = options.fetcher ?? authorizedFetch;
  const [jobs, setJobs] = useState<JobDefinitionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJobs(fetcher);
        if (!canceled) {
          setJobs(data);
        }
      } catch (err) {
        if (!canceled) {
          const message = err instanceof Error ? err.message : 'Failed to load jobs';
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

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  const sortedJobs = useMemo(
    () => jobs.slice().sort((a, b) => a.slug.localeCompare(b.slug)),
    [jobs]
  );

  return {
    jobs,
    sortedJobs,
    loading,
    error,
    refresh
  };
}

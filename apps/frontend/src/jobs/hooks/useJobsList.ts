import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { fetchJobs } from '../api';
import type { JobDefinitionSummary } from '../../workflows/api';

export type UseJobsListResult = {
  jobs: JobDefinitionSummary[];
  sortedJobs: JobDefinitionSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function useJobsList(): UseJobsListResult {
  const { activeToken } = useAuth();
  const [jobs, setJobs] = useState<JobDefinitionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let canceled = false;
    if (!activeToken) {
      setLoading(false);
      setError('Authentication required to load jobs');
      setJobs([]);
      return () => {
        canceled = true;
      };
    }

    const controller = new AbortController();
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJobs(activeToken, { signal: controller.signal });
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
      controller.abort();
    };
  }, [activeToken, refreshToken]);

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

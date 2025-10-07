import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { fetchJobs } from '../api';
import type { JobDefinitionSummary } from '../../workflows/api';
import { useModuleScope } from '../../modules/ModuleScopeContext';

export type UseJobsListResult = {
  jobs: JobDefinitionSummary[];
  sortedJobs: JobDefinitionSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function useJobsList(): UseJobsListResult {
  const { activeToken } = useAuth();
  const moduleScope = useModuleScope();
  const {
    kind: moduleScopeKind,
    moduleId,
    loadingResources: moduleLoadingResources,
    isResourceInScope
  } = moduleScope;
  const isModuleScoped = moduleScopeKind === 'module';
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

    if (isModuleScoped) {
      if (!moduleId) {
        setJobs([]);
        setLoading(false);
        setError(null);
        return () => {
          canceled = true;
        };
      }
      if (moduleLoadingResources) {
        setLoading(true);
        setError(null);
        return () => {
          canceled = true;
        };
      }
    }

    const controller = new AbortController();
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJobs(activeToken, { signal: controller.signal });
        if (!canceled) {
          const filtered = data.filter((job) => {
            if (job.runtime !== 'module') {
              return !isModuleScoped;
            }
            if (!isModuleScoped) {
              return true;
            }
            if (isResourceInScope('job-definition', job.id)) {
              return true;
            }
            return isResourceInScope('job-definition', job.slug);
          });
          setJobs(filtered);
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
  }, [
    activeToken,
    isModuleScoped,
    isResourceInScope,
    moduleId,
    moduleLoadingResources,
    refreshToken
  ]);

  useEffect(() => {
    if (!isModuleScoped) {
      return;
    }
    setJobs((current) =>
      current.filter(
        (job) =>
          job.runtime === 'module' &&
          (isResourceInScope('job-definition', job.id) || isResourceInScope('job-definition', job.slug))
      )
    );
  }, [isModuleScoped, isResourceInScope]);

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

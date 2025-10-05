import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '../config';
import { useAuth } from '../auth/useAuth';
import type { AppRecord, StatusFacet } from '../core/types';
import { formatFetchError } from '../core/utils';
import type { ServiceSummary } from '../services/types';
import {
  fetchJobRuns,
  fetchWorkflowActivity,
  type JobRunListItem,
  type WorkflowActivityRunEntry
} from '../runs/api';
import { listServices, searchRepositories } from '../core/api';
import { INGEST_STATUSES } from '../core/constants';

export type OverviewData = {
  apps: AppRecord[];
  statusFacets: StatusFacet[];
  services: ServiceSummary[];
  workflowRuns: WorkflowActivityRunEntry[];
  jobRuns: JobRunListItem[];
};

type LoadState = {
  data: OverviewData;
  loading: boolean;
  error: string | null;
};

const EMPTY_DATA: OverviewData = {
  apps: [],
  statusFacets: [],
  services: [],
  workflowRuns: [],
  jobRuns: []
};

export function useOverviewData(): LoadState {
  const { activeToken: authToken } = useAuth();
  const [data, setData] = useState<OverviewData>(EMPTY_DATA);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!authToken) {
        setData(EMPTY_DATA);
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);

      const results = await Promise.allSettled([
        (async () => {
          const result = await searchRepositories(authToken, { sort: 'updated' });
          const apps = result.repositories.slice(0, 8);
          const counts = new Map(result.facets.statuses.map((item) => [item.status, item.count]));
          const statusFacets = INGEST_STATUSES.map((status) => ({
            status,
            count: counts.get(status) ?? 0
          }));
          return { apps, statusFacets };
        })(),
        (async () => {
          const services = await listServices(authToken);
          return services;
        })(),
        (async () => {
          const { items } = await fetchWorkflowActivity(authToken, {
            limit: 12,
            filters: { kinds: ['run'] }
          });
          return items.filter((entry): entry is WorkflowActivityRunEntry => entry.kind === 'run');
        })(),
        (async () => {
          const { items } = await fetchJobRuns(authToken, { limit: 5 });
          return items;
        })()
      ]);

      if (!active) {
        return;
      }

      const next: OverviewData = { ...EMPTY_DATA };
      const errors: string[] = [];

      const [appsResult, servicesResult, workflowRunsResult, jobRunsResult] = results as [
        PromiseSettledResult<{ apps: AppRecord[]; statusFacets: StatusFacet[] }>,
        PromiseSettledResult<ServiceSummary[]>,
        PromiseSettledResult<WorkflowActivityRunEntry[]>,
        PromiseSettledResult<JobRunListItem[]>
      ];

      if (appsResult.status === 'fulfilled') {
        next.apps = appsResult.value.apps;
        next.statusFacets = appsResult.value.statusFacets;
      } else {
        errors.push(formatFetchError(appsResult.reason, 'Failed to load apps overview', API_BASE_URL));
      }

      if (servicesResult.status === 'fulfilled') {
        next.services = servicesResult.value;
      } else {
        errors.push(formatFetchError(servicesResult.reason, 'Failed to load services overview', API_BASE_URL));
      }

      if (workflowRunsResult.status === 'fulfilled') {
        next.workflowRuns = workflowRunsResult.value;
      } else {
        errors.push(formatFetchError(workflowRunsResult.reason, 'Failed to load workflow runs', API_BASE_URL));
      }

      if (jobRunsResult.status === 'fulfilled') {
        next.jobRuns = jobRunsResult.value;
      } else {
        errors.push(formatFetchError(jobRunsResult.reason, 'Failed to load job runs', API_BASE_URL));
      }

      setData(next);
      setError(errors.length > 0 ? errors.join('\n') : null);
      setLoading(false);
    };

    void load();

    return () => {
      active = false;
    };
  }, [authToken]);

  return useMemo(() => ({ data, loading, error }), [data, loading, error]);
}

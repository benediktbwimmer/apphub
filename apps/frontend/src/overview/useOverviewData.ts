import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '../config';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import type { AppRecord, StatusFacet } from '../core/types';
import { formatFetchError } from '../core/utils';
import type { ServiceSummary } from '../services/types';
import {
  fetchJobRuns,
  fetchWorkflowActivity,
  type JobRunListItem,
  type WorkflowActivityRunEntry
} from '../runs/api';

export type OverviewData = {
  apps: AppRecord[];
  statusFacets: StatusFacet[];
  services: ServiceSummary[];
  workflowRuns: WorkflowActivityRunEntry[];
  jobRuns: JobRunListItem[];
};

type AppsResponse = {
  data?: unknown;
  facets?: {
    statuses?: unknown;
  };
};

type AppsResult = {
  apps: AppRecord[];
  statusFacets: StatusFacet[];
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

function normalizeAppsPayload(payload: AppsResponse): AppsResult {
  const data = Array.isArray(payload.data) ? (payload.data as AppRecord[]) : [];
  const rawStatuses = Array.isArray(payload.facets?.statuses)
    ? (payload.facets?.statuses as StatusFacet[])
    : [];
  return {
    apps: data,
    statusFacets: rawStatuses
  };
}

function normalizeServicesPayload(payload: unknown): ServiceSummary[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const record = payload as { data?: unknown };
  const data = Array.isArray(record.data) ? (record.data as ServiceSummary[]) : [];
  return data;
}

export function useOverviewData(): LoadState {
  const authorizedFetch = useAuthorizedFetch();
  const [data, setData] = useState<OverviewData>(EMPTY_DATA);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      const results = await Promise.allSettled([
        (async () => {
          const response = await authorizedFetch(`${API_BASE_URL}/apps?sort=updated&limit=8`);
          if (!response.ok) {
            throw new Error(`Failed to load apps (status ${response.status})`);
          }
          const payload = (await response.json()) as AppsResponse;
          return normalizeAppsPayload(payload);
        })(),
        (async () => {
          const response = await authorizedFetch(`${API_BASE_URL}/services`);
          if (!response.ok) {
            throw new Error(`Failed to load services (status ${response.status})`);
          }
          const payload = await response.json();
          return normalizeServicesPayload(payload);
        })(),
        (async () => {
          const { items } = await fetchWorkflowActivity(authorizedFetch, {
            limit: 12,
            filters: { kinds: ['run'] }
          });
          return items.filter((entry): entry is WorkflowActivityRunEntry => entry.kind === 'run');
        })(),
        (async () => {
          const { items } = await fetchJobRuns(authorizedFetch, { limit: 5 });
          return items;
        })()
      ]);

      if (!active) {
        return;
      }

      const next: OverviewData = { ...EMPTY_DATA };
      const errors: string[] = [];

      const [appsResult, servicesResult, workflowRunsResult, jobRunsResult] = results as [
        PromiseSettledResult<AppsResult>,
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
  }, [authorizedFetch]);

  return useMemo(() => ({ data, loading, error }), [data, loading, error]);
}

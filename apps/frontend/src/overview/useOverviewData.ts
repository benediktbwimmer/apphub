import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '../config';
import { useAuth } from '../auth/useAuth';
import { formatFetchError } from '../core/utils';
import type { ServiceSummary } from '../services/types';
import {
  fetchJobRuns,
  fetchWorkflowActivity,
  type JobRunListItem,
  type WorkflowActivityRunEntry
} from '../runs/api';
import { listServices } from '../core/api';
import { getWorkflowEventHealth } from '../workflows/api';
import type { WorkflowEventSchedulerHealth } from '../workflows/types';

export type OverviewData = {
  eventHealth: WorkflowEventSchedulerHealth | null;
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
  eventHealth: null,
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
          const health = await getWorkflowEventHealth(authToken);
          return health;
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

      const [eventHealthResult, servicesResult, workflowRunsResult, jobRunsResult] = results as [
        PromiseSettledResult<WorkflowEventSchedulerHealth | null>,
        PromiseSettledResult<ServiceSummary[]>,
        PromiseSettledResult<WorkflowActivityRunEntry[]>,
        PromiseSettledResult<JobRunListItem[]>
      ];

      if (eventHealthResult.status === 'fulfilled') {
        next.eventHealth = eventHealthResult.value;
      } else {
        errors.push(formatFetchError(eventHealthResult.reason, 'Failed to load event scheduler snapshot', API_BASE_URL));
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

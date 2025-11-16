import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '../config';
import { useAuth } from '../auth/useAuth';
import { formatFetchError } from '../core/utils';
import type { ServiceSummary } from '../services/types';
import {
  fetchJobRuns,
  fetchWorkflowActivity,
  type JobRunListItem,
  type WorkflowActivityFilters,
  type WorkflowActivityRunEntry
} from '../runs/api';
import { listServices } from '../core/api';
import { getWorkflowEventHealth } from '../workflows/api';
import type { WorkflowEventSchedulerHealth } from '../workflows/types';
import { useModuleScope } from '../modules/ModuleScopeContext';

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
  const { activeToken: authToken, identity, identityLoading } = useAuth();
  const moduleScope = useModuleScope();
  const {
    kind: moduleScopeKind,
    loadingResources: moduleLoadingResources,
    getResourceSlugs,
    getResourceIds,
    isResourceInScope
  } = moduleScope;
  const isModuleScoped = moduleScopeKind === 'module';
  const [data, setData] = useState<OverviewData>(EMPTY_DATA);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (isModuleScoped && moduleLoadingResources) {
        setLoading(true);
        return;
      }
      if (identityLoading) {
        return;
      }
      const canAccess = identity?.authDisabled || Boolean(authToken);
      if (!canAccess) {
        setData(EMPTY_DATA);
        setError('Authentication required');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);

      const scopedWorkflowSlugs = isModuleScoped ? getResourceSlugs('workflow-definition') : [];
      const scopedWorkflowIds = isModuleScoped ? getResourceIds('workflow-definition') : [];
      const scopedJobSlugs = isModuleScoped ? getResourceSlugs('job-definition') : [];
      const scopedJobIds = isModuleScoped ? getResourceIds('job-definition') : [];
      const scopedServiceIds = isModuleScoped ? getResourceIds('service') : [];
      const workflowScopeAvailable = isModuleScoped && (scopedWorkflowSlugs.length > 0 || scopedWorkflowIds.length > 0);
      const jobScopeAvailable = isModuleScoped && (scopedJobSlugs.length > 0 || scopedJobIds.length > 0);
      const serviceScopeAvailable = isModuleScoped && scopedServiceIds.length > 0;

      const results = await Promise.allSettled([
        (async () => {
          const health = await getWorkflowEventHealth(canAccess ? authToken : null);
          return health;
        })(),
        (async () => {
          const services = await listServices(canAccess ? authToken : null);
          if (!isModuleScoped || !serviceScopeAvailable) {
            return services;
          }
          const idSet = new Set(scopedServiceIds);
          return services.filter((service) => idSet.has(service.id));
        })(),
        (async () => {
          const workflowFilters: WorkflowActivityFilters = {
            kinds: ['run'],
            workflowSlugs: isModuleScoped && scopedWorkflowSlugs.length > 0 ? scopedWorkflowSlugs : undefined,
            moduleId: isModuleScoped ? moduleScope.moduleId : undefined
          };
          const { items } = await fetchWorkflowActivity(canAccess ? authToken : null, {
            limit: 12,
            filters: workflowFilters
          });
          const runs = items.filter((entry): entry is WorkflowActivityRunEntry => entry.kind === 'run');
          if (!workflowScopeAvailable) {
            return runs;
          }
          return runs.filter((entry) => {
            const slug = entry.workflow.slug;
            const id = entry.workflow.id;
            return (
              isResourceInScope('workflow-definition', slug) ||
              isResourceInScope('workflow-definition', id)
            );
          });
        })(),
        (async () => {
          const jobFilters = isModuleScoped
            ? {
                jobSlugs: scopedJobSlugs.length > 0 ? scopedJobSlugs : undefined,
                moduleId: moduleScope.moduleId ?? undefined
              }
            : undefined;
          const { items } = await fetchJobRuns(canAccess ? authToken : null, {
            limit: 5,
            filters: jobFilters
          });
          if (!jobScopeAvailable) {
            return items;
          }
          return items.filter((item) => {
            const slug = item.job.slug;
            const id = item.job.id;
            return (
              isResourceInScope('job-definition', slug) || isResourceInScope('job-definition', id)
            );
          });
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
  }, [
    authToken,
    getResourceIds,
    getResourceSlugs,
    identity?.authDisabled,
    identityLoading,
    isModuleScoped,
    isResourceInScope,
    moduleLoadingResources,
    moduleScope.moduleId
  ]);

  return useMemo(() => ({ data, loading, error }), [data, loading, error]);
}

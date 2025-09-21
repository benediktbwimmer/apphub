import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from 'react';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import {
  listJobDefinitions,
  listServices,
  type JobDefinitionSummary,
  type ServiceSummary
} from './api';

export type WorkflowResourcesContextValue = {
  jobs: JobDefinitionSummary[];
  jobBySlug: Record<string, JobDefinitionSummary>;
  services: ServiceSummary[];
  serviceBySlug: Record<string, ServiceSummary>;
  serviceStatuses: Record<string, string>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

const WorkflowResourcesContext = createContext<WorkflowResourcesContextValue | null>(null);

function normalizeJobs(jobs: JobDefinitionSummary[]): Record<string, JobDefinitionSummary> {
  const map: Record<string, JobDefinitionSummary> = {};
  for (const job of jobs) {
    const slug = job.slug?.trim().toLowerCase();
    if (!slug) {
      continue;
    }
    if (!map[slug]) {
      map[slug] = job;
    }
  }
  return map;
}

function normalizeServices(services: ServiceSummary[]): {
  bySlug: Record<string, ServiceSummary>;
  statuses: Record<string, string>;
} {
  const bySlug: Record<string, ServiceSummary> = {};
  const statuses: Record<string, string> = {};
  for (const service of services) {
    const slug = service.slug?.trim().toLowerCase();
    if (!slug) {
      continue;
    }
    if (!bySlug[slug]) {
      bySlug[slug] = service;
    }
    const status = typeof service.status === 'string' ? service.status.toLowerCase() : 'unknown';
    statuses[slug] = status;
  }
  return { bySlug, statuses };
}

export function WorkflowResourcesProvider({ children }: PropsWithChildren<unknown>) {
  const authorizedFetch = useAuthorizedFetch();
  const [jobs, setJobs] = useState<JobDefinitionSummary[]>([]);
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  const refresh = useCallback(() => {
    setRefreshIndex((index) => index + 1);
  }, []);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);

    const run = async () => {
      try {
        const [jobsData, servicesData] = await Promise.all([
          listJobDefinitions(authorizedFetch),
          listServices(authorizedFetch)
        ]);
        if (canceled) {
          return;
        }
        setJobs(jobsData);
        setServices(servicesData);
      } catch (err) {
        if (canceled) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to load workflow resources';
        setError(message);
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
  }, [authorizedFetch, refreshIndex]);

  const value = useMemo<WorkflowResourcesContextValue>(() => {
    const jobBySlug = normalizeJobs(jobs);
    const { bySlug: serviceBySlug, statuses: serviceStatuses } = normalizeServices(services);
    return {
      jobs,
      jobBySlug,
      services,
      serviceBySlug,
      serviceStatuses,
      loading,
      error,
      refresh
    } satisfies WorkflowResourcesContextValue;
  }, [jobs, services, loading, error, refresh]);

  return <WorkflowResourcesContext.Provider value={value}>{children}</WorkflowResourcesContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkflowResources(): WorkflowResourcesContextValue {
  const context = useContext(WorkflowResourcesContext);
  if (!context) {
    throw new Error('useWorkflowResources must be used within a WorkflowResourcesProvider');
  }
  return context;
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from 'react';
import {
  buildFilterOptions,
  buildStatusOptions,
  filterSummaries,
  summarizeWorkflowMetadata,
  normalizeWorkflowDefinition,
  type WorkflowSummary
} from '../normalizers';
import { listServices, listWorkflowDefinitions } from '../api';
import { useAppHubEvent } from '../../events/context';
import type {
  WorkflowDefinition,
  WorkflowFiltersState,
  WorkflowRun,
  WorkflowRuntimeSummary
} from '../types';
import { useWorkflowAccess } from './useWorkflowAccess';

export const INITIAL_FILTERS: WorkflowFiltersState = {
  statuses: [],
  repos: [],
  services: [],
  tags: []
};

type WorkflowDefinitionsContextValue = {
  workflows: WorkflowDefinition[];
  workflowsLoading: boolean;
  workflowsError: string | null;
  filters: WorkflowFiltersState;
  setFilters: Dispatch<SetStateAction<WorkflowFiltersState>>;
  searchTerm: string;
  setSearchTerm: Dispatch<SetStateAction<string>>;
  workflowSummaries: WorkflowSummary[];
  filteredSummaries: WorkflowSummary[];
  filteredWorkflows: WorkflowDefinition[];
  statusOptions: Array<{ value: string; label: string; count: number }>;
  repoOptions: Array<{ value: string; label: string; count: number }>;
  serviceOptions: Array<{ value: string; label: string; count: number }>;
  tagOptions: Array<{ value: string; label: string; count: number }>;
  selectedSlug: string | null;
  setSelectedSlug: Dispatch<SetStateAction<string | null>>;
  workflowRuntimeSummaries: Record<string, WorkflowRuntimeSummary>;
  updateRuntimeSummary: (workflow: WorkflowDefinition, run: WorkflowRun) => void;
  seedRuntimeSummaryFromMetadata: (workflow: WorkflowDefinition) => void;
  loadWorkflows: () => Promise<void>;
  loadServices: () => Promise<void>;
  serviceStatuses: Record<string, string>;
  getWorkflowById: (id: string) => WorkflowDefinition | undefined;
  getWorkflowBySlug: (slug: string) => WorkflowDefinition | undefined;
};

const WorkflowDefinitionsContext = createContext<WorkflowDefinitionsContextValue | undefined>(undefined);

export function WorkflowDefinitionsProvider({ children }: { children: ReactNode }) {
  const { authorizedFetch } = useWorkflowAccess();

  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(true);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);
  const [filters, setFilters] = useState<WorkflowFiltersState>(INITIAL_FILTERS);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [workflowRuntimeSummaries, setWorkflowRuntimeSummaries] = useState<
    Record<string, WorkflowRuntimeSummary>
  >({});
  const [serviceStatuses, setServiceStatuses] = useState<Record<string, string>>({});

  const workflowsRef = useRef<WorkflowDefinition[]>([]);
  const selectedSlugRef = useRef<string | null>(null);

  const updateRuntimeSummary = useCallback((workflow: WorkflowDefinition, run: WorkflowRun) => {
    setWorkflowRuntimeSummaries((current) => ({
      ...current,
      [workflow.slug]: {
        runId: run.id,
        runKey: run.runKey ?? null,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        durationMs: run.durationMs,
        triggeredBy: run.triggeredBy
      }
    }));
  }, []);

  const seedRuntimeSummaryFromMetadata = useCallback((workflow: WorkflowDefinition) => {
    const metadataSummary = summarizeWorkflowMetadata(workflow);
    setWorkflowRuntimeSummaries((current) => ({
      ...current,
      [workflow.slug]: {
        ...current[workflow.slug],
        status: metadataSummary.status ?? current[workflow.slug]?.status ?? 'unknown'
      }
    }));
  }, []);

  const applyWorkflowDefinitionUpdate = useCallback((payload: unknown) => {
    const definition = normalizeWorkflowDefinition(payload);
    if (!definition) {
      return;
    }
    setWorkflows((current) => {
      const index = current.findIndex((entry) => entry.id === definition.id);
      const next =
        index === -1
          ? [...current, definition]
          : current.map((entry, entryIndex) => (entryIndex === index ? definition : entry));
      const sorted = next.slice().sort((a, b) => a.slug.localeCompare(b.slug));
      workflowsRef.current = sorted;
      return sorted;
    });
    seedRuntimeSummaryFromMetadata(definition);
    if (!selectedSlugRef.current) {
      selectedSlugRef.current = definition.slug;
      setSelectedSlug(definition.slug);
    }
  }, [seedRuntimeSummaryFromMetadata, setSelectedSlug]);

  const loadWorkflows = useCallback(async () => {
    setWorkflowsLoading(true);
    setWorkflowsError(null);
    try {
      const normalized = await listWorkflowDefinitions(authorizedFetch);
      setWorkflows(normalized);
      workflowsRef.current = normalized;
      normalized.forEach(seedRuntimeSummaryFromMetadata);
      if (normalized.length > 0) {
        setSelectedSlug((current) => {
          if (current) {
            selectedSlugRef.current = current;
            return current;
          }
          const nextSlug = normalized[0]?.slug;
          selectedSlugRef.current = nextSlug ?? null;
          return nextSlug ?? null;
        });
      } else {
        selectedSlugRef.current = null;
        setSelectedSlug(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load workflows';
      setWorkflowsError(message);
    } finally {
      setWorkflowsLoading(false);
    }
  }, [authorizedFetch, seedRuntimeSummaryFromMetadata]);

  const loadServices = useCallback(async () => {
    try {
      const services = await listServices(authorizedFetch);
      const nextStatuses: Record<string, string> = {};
      for (const entry of services) {
        if (!entry || typeof entry.slug !== 'string') {
          continue;
        }
        const slug = entry.slug.trim().toLowerCase();
        if (!slug) {
          continue;
        }
        const status = typeof entry.status === 'string' ? entry.status.toLowerCase() : 'unknown';
        nextStatuses[slug] = status;
      }
      setServiceStatuses(nextStatuses);
    } catch {
      // Ignore failures; consumers surface workflow data regardless of service reachability.
    }
  }, [authorizedFetch]);

  const workflowSummaries = useMemo<WorkflowSummary[]>(() => {
    return workflows.map((workflow) => {
      const metadataSummary = summarizeWorkflowMetadata(workflow);
      const runtime = workflowRuntimeSummaries[workflow.slug];
      const status = (runtime?.status ?? metadataSummary.status ?? 'unknown').toLowerCase();
      return {
        workflow,
        status,
        repos: metadataSummary.repos,
        services: metadataSummary.services,
        tags: metadataSummary.tags,
        runtime
      } satisfies WorkflowSummary;
    });
  }, [workflows, workflowRuntimeSummaries]);

  const filteredSummaries = useMemo(
    () => filterSummaries(workflowSummaries, filters, searchTerm),
    [workflowSummaries, filters, searchTerm]
  );

  const filteredWorkflows = useMemo(
    () => filteredSummaries.map((summary) => summary.workflow),
    [filteredSummaries]
  );

  const statusOptions = useMemo(() => buildStatusOptions(workflowSummaries), [workflowSummaries]);
  const repoOptions = useMemo(
    () => buildFilterOptions(workflowSummaries.flatMap((summary) => summary.repos)),
    [workflowSummaries]
  );
  const serviceOptions = useMemo(
    () => buildFilterOptions(workflowSummaries.flatMap((summary) => summary.services)),
    [workflowSummaries]
  );
  const tagOptions = useMemo(
    () => buildFilterOptions(workflowSummaries.flatMap((summary) => summary.tags)),
    [workflowSummaries]
  );

  useAppHubEvent('workflow.definition.updated', (event) => {
    if (event.data?.workflow) {
      applyWorkflowDefinitionUpdate(event.data.workflow);
    }
  });

  useEffect(() => {
    workflowsRef.current = workflows;
  }, [workflows]);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  useEffect(() => {
    selectedSlugRef.current = selectedSlug;
  }, [selectedSlug]);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  const getWorkflowById = useCallback((id: string) => workflowsRef.current.find((entry) => entry.id === id), []);
  const getWorkflowBySlug = useCallback(
    (slug: string) => workflowsRef.current.find((entry) => entry.slug === slug),
    []
  );

  const value = useMemo<WorkflowDefinitionsContextValue>(
    () => ({
      workflows,
      workflowsLoading,
      workflowsError,
      filters,
      setFilters,
      searchTerm,
      setSearchTerm,
      workflowSummaries,
      filteredSummaries,
      filteredWorkflows,
      statusOptions,
      repoOptions,
      serviceOptions,
      tagOptions,
      selectedSlug,
      setSelectedSlug,
      workflowRuntimeSummaries,
      updateRuntimeSummary,
      seedRuntimeSummaryFromMetadata,
      loadWorkflows,
      loadServices,
      serviceStatuses,
      getWorkflowById,
      getWorkflowBySlug
    }),
    [
      workflows,
      workflowsLoading,
      workflowsError,
      filters,
      searchTerm,
      workflowSummaries,
      filteredSummaries,
      filteredWorkflows,
      statusOptions,
      repoOptions,
      serviceOptions,
      tagOptions,
      selectedSlug,
      workflowRuntimeSummaries,
      updateRuntimeSummary,
      seedRuntimeSummaryFromMetadata,
      loadWorkflows,
      loadServices,
      serviceStatuses,
      getWorkflowById,
      getWorkflowBySlug
    ]
  );

  return <WorkflowDefinitionsContext.Provider value={value}>{children}</WorkflowDefinitionsContext.Provider>;
}

export function useWorkflowDefinitions() {
  const context = useContext(WorkflowDefinitionsContext);
  if (!context) {
    throw new Error('useWorkflowDefinitions must be used within WorkflowDefinitionsProvider');
  }
  return context;
}

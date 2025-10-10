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
import { listServices, listWorkflowDefinitions, listWorkflowRunsForSlug } from '../api';
import { useAppHubEvent } from '../../events/context';
import type {
  WorkflowDefinition,
  WorkflowFiltersState,
  WorkflowRun,
  WorkflowRuntimeSummary
} from '../types';
import { useWorkflowAccess } from './useWorkflowAccess';
import { useModuleScope } from '../../modules/ModuleScopeContext';

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
  const moduleScope = useModuleScope();
  const {
    kind: moduleScopeKind,
    isResourceInScope
  } = moduleScope;
  const isModuleScoped = moduleScopeKind === 'module';

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
  const hydrationGenerationRef = useRef(0);

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

  const isWorkflowInScope = useCallback(
    (definition: WorkflowDefinition | null | undefined) => {
      if (!definition) {
        return false;
      }
      if (!isModuleScoped) {
        return true;
      }
      if (isResourceInScope('workflow-definition', definition.id)) {
        return true;
      }
      return isResourceInScope('workflow-definition', definition.slug);
    },
    [isModuleScoped, isResourceInScope]
  );

  const filterWorkflowsForScope = useCallback(
    (definitions: WorkflowDefinition[]) => {
      if (!isModuleScoped) {
        return definitions;
      }
      return definitions.filter((definition) => isWorkflowInScope(definition));
    },
    [isModuleScoped, isWorkflowInScope]
  );

  const isServiceInScope = useCallback(
    (serviceId: string | null | undefined, slug?: string | null) => {
      if (!isModuleScoped) {
        return true;
      }
      if (serviceId && isResourceInScope('service', serviceId)) {
        return true;
      }
      if (slug) {
        return isResourceInScope('service', slug);
      }
      return false;
    },
    [isModuleScoped, isResourceInScope]
  );

  const hydrateRuntimeSummaries = useCallback(
    (definitions: WorkflowDefinition[]) => {
      if (definitions.length === 0) {
        return;
      }
      const generation = ++hydrationGenerationRef.current;
      let nextIndex = 0;
      const workers = Math.min(4, definitions.length);

      const getNextDefinition = () => {
        if (hydrationGenerationRef.current !== generation) {
          return null;
        }
        if (nextIndex >= definitions.length) {
          return null;
        }
        const current = definitions[nextIndex];
        nextIndex += 1;
        return current;
      };

      const tasks = Array.from({ length: workers }, () =>
        (async () => {
          while (true) {
            const definition = getNextDefinition();
            if (!definition) {
              break;
            }
            try {
              const runParams: { limit?: number; offset?: number; moduleId?: string | null } = { limit: 1 };
              if (isModuleScoped) {
                runParams.moduleId = moduleScope.moduleId ?? undefined;
              }
              const { runs } = await listWorkflowRunsForSlug(authorizedFetch, definition.slug, runParams);
              if (hydrationGenerationRef.current !== generation) {
                break;
              }
              const latestRun = runs[0];
              if (latestRun) {
                updateRuntimeSummary(definition, latestRun);
              }
            } catch (error) {
              if (hydrationGenerationRef.current !== generation) {
                break;
              }
              console.warn('workflow.runtime_summaries.fetch_failed', {
                slug: definition.slug,
                error
              });
            }
          }
        })()
      );

      void Promise.allSettled(tasks);
    },
    [authorizedFetch, isModuleScoped, moduleScope.moduleId, updateRuntimeSummary]
  );

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

  const applyWorkflowDefinitionUpdate = useCallback(
    (payload: unknown) => {
      const definition = normalizeWorkflowDefinition(payload);
      if (!definition) {
        return;
      }

      if (!isWorkflowInScope(definition)) {
        const filtered = workflowsRef.current.filter((entry) => entry.id !== definition.id);
        workflowsRef.current = filtered;
        setWorkflows(filtered);
        setSelectedSlug((current) => {
          if (current && filtered.some((workflow) => workflow.slug === current)) {
            return current;
          }
          const nextSlug = filtered[0]?.slug ?? null;
          selectedSlugRef.current = nextSlug;
          return nextSlug;
        });
        return;
      }

      setWorkflows((current) => {
        const index = current.findIndex((entry) => entry.id === definition.id);
        const next =
          index === -1
            ? [...current, definition]
            : current.map((entry, entryIndex) => (entryIndex === index ? definition : entry));
        const scoped = filterWorkflowsForScope(next);
        const sorted = scoped.slice().sort((a, b) => a.slug.localeCompare(b.slug));
        workflowsRef.current = sorted;
        return sorted;
      });
      seedRuntimeSummaryFromMetadata(definition);
      setSelectedSlug((current) => {
        if (current && workflowsRef.current.some((workflow) => workflow.slug === current)) {
          selectedSlugRef.current = current;
          return current;
        }
        const nextSlug = workflowsRef.current[0]?.slug ?? null;
        selectedSlugRef.current = nextSlug;
        return nextSlug;
      });
    },
    [filterWorkflowsForScope, isWorkflowInScope, seedRuntimeSummaryFromMetadata]
  );

  const loadWorkflows = useCallback(async () => {
    setWorkflowsLoading(true);
    setWorkflowsError(null);
    try {
      const normalized = isModuleScoped
        ? await listWorkflowDefinitions(authorizedFetch, {
            moduleId: moduleScope.moduleId ?? undefined
          })
        : await listWorkflowDefinitions(authorizedFetch);
      const scoped = filterWorkflowsForScope(normalized);
      setWorkflows(scoped);
      workflowsRef.current = scoped;
      scoped.forEach(seedRuntimeSummaryFromMetadata);
      hydrateRuntimeSummaries(scoped);
      if (scoped.length > 0) {
        setSelectedSlug((current) => {
          if (current && scoped.some((workflow) => workflow.slug === current)) {
            selectedSlugRef.current = current;
            return current;
          }
          const nextSlug = scoped[0]?.slug ?? null;
          selectedSlugRef.current = nextSlug;
          return nextSlug;
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
  }, [
    authorizedFetch,
    filterWorkflowsForScope,
    hydrateRuntimeSummaries,
    isModuleScoped,
    moduleScope.moduleId,
    seedRuntimeSummaryFromMetadata
  ]);

  useEffect(() => {
    if (!isModuleScoped) {
      return;
    }
    const filtered = filterWorkflowsForScope(workflowsRef.current);
    if (filtered.length === workflowsRef.current.length) {
      return;
    }
    workflowsRef.current = filtered;
    setWorkflows(filtered);
    setSelectedSlug((current) => {
      if (current && filtered.some((workflow) => workflow.slug === current)) {
        selectedSlugRef.current = current;
        return current;
      }
      const nextSlug = filtered[0]?.slug ?? null;
      selectedSlugRef.current = nextSlug;
      return nextSlug;
    });
  }, [filterWorkflowsForScope, isModuleScoped]);

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
        if (!isServiceInScope(entry.id, slug)) {
          continue;
        }
        const status = typeof entry.status === 'string' ? entry.status.toLowerCase() : 'unknown';
        nextStatuses[slug] = status;
      }
      setServiceStatuses(nextStatuses);
    } catch {
      // Ignore failures; consumers surface workflow data regardless of service reachability.
    }
  }, [authorizedFetch, isServiceInScope]);

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

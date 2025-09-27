import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { API_BASE_URL } from '../../config';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { useAuth } from '../../auth/useAuth';
import { useToasts } from '../../components/toast';
import { useAppHubEvent, type AppHubSocketEvent } from '../../events/context';
import {
  buildFilterOptions,
  buildStatusOptions,
  filterSummaries,
  normalizeWorkflowDefinition,
  normalizeWorkflowRun,
  normalizeWorkflowRunMetrics,
  normalizeWorkflowRunStats,
  sortRuns,
  summarizeWorkflowMetadata,
  type WorkflowSummary
} from '../normalizers';
import {
  createWorkflowDefinition,
  createWorkflowEventTrigger,
  deleteWorkflowEventTrigger,
  fetchWorkflowAssets,
  fetchWorkflowAssetHistory,
  fetchWorkflowAssetPartitions,
  getWorkflowDetail,
  getWorkflowEventHealth,
  getWorkflowRunMetrics,
  getWorkflowStats,
  getWorkflowAutoMaterializeOps,
  listServices,
  listWorkflowDefinitions,
  listWorkflowEventSamples,
  listWorkflowEventTriggers,
  listWorkflowRunSteps,
  listWorkflowTriggerDeliveries,
  updateWorkflowDefinition,
  updateWorkflowEventTrigger,
  ApiError,
  type WorkflowCreateInput,
  type WorkflowEventTriggerCreateInput,
  type WorkflowEventTriggerFilters,
  type WorkflowEventTriggerUpdateInput,
  type WorkflowEventSampleQuery,
  type WorkflowTriggerDeliveriesQuery
} from '../api';
import type {
  WorkflowAssetDetail,
  WorkflowAssetInventoryEntry,
  WorkflowAssetPartitions,
  WorkflowDefinition,
  WorkflowEventSample,
  WorkflowEventSchema,
  WorkflowEventSchedulerHealth,
  WorkflowEventTrigger,
  WorkflowFiltersState,
  WorkflowAutoMaterializeOps,
  WorkflowRunMetricsSummary,
  WorkflowRun,
  WorkflowRunStep,
  WorkflowRuntimeSummary,
  WorkflowRunStatsSummary,
  WorkflowTriggerDelivery,
  WorkflowAnalyticsRangeKey
} from '../types';
import type { WorkflowBuilderSubmitArgs } from '../builder/WorkflowBuilderDialog';

const WORKFLOW_RUN_EVENT_TYPES = [
  'workflow.run.updated',
  'workflow.run.pending',
  'workflow.run.running',
  'workflow.run.succeeded',
  'workflow.run.failed',
  'workflow.run.canceled'
] as const;

type ManualRunResponse = {
  data: WorkflowRun;
};

type WorkflowAnalyticsState = {
  stats: WorkflowRunStatsSummary | null;
  metrics: WorkflowRunMetricsSummary | null;
  history: WorkflowRunMetricsSummary[];
  rangeKey: WorkflowAnalyticsRangeKey;
  bucketKey: string | null;
  outcomes: string[];
  lastUpdated?: string;
};

type EventTriggerListState = {
  items: WorkflowEventTrigger[];
  loading: boolean;
  error: string | null;
  filters?: WorkflowEventTriggerFilters;
  lastFetchedAt?: string;
};

type TriggerDeliveryState = {
  items: WorkflowTriggerDelivery[];
  loading: boolean;
  error: string | null;
  limit: number;
  query?: WorkflowTriggerDeliveriesQuery;
  lastFetchedAt?: string;
};

type EventSamplesState = {
  items: WorkflowEventSample[];
  schema: WorkflowEventSchema | null;
  loading: boolean;
  error: string | null;
  query: WorkflowEventSampleQuery | null;
  lastFetchedAt?: string;
};

const ANALYTICS_DEFAULT_RANGE: WorkflowAnalyticsRangeKey = '7d';
const ANALYTICS_HISTORY_LIMIT = 24;
const WORKFLOW_ANALYTICS_EVENT = 'workflow.analytics.snapshot';

function createDefaultAnalyticsState(): WorkflowAnalyticsState {
  return {
    stats: null,
    metrics: null,
    history: [],
    rangeKey: ANALYTICS_DEFAULT_RANGE,
    bucketKey: null,
    outcomes: []
  };
}

export const INITIAL_FILTERS: WorkflowFiltersState = {
  statuses: [],
  repos: [],
  services: [],
  tags: []
};

export type WorkflowsController = ReturnType<typeof useWorkflowsController>;

export function useWorkflowsController() {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(true);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [workflowDetail, setWorkflowDetail] = useState<WorkflowDefinition | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runSteps, setRunSteps] = useState<WorkflowRunStep[]>([]);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [stepsError, setStepsError] = useState<string | null>(null);

  const [assetInventories, setAssetInventories] = useState<Record<string, WorkflowAssetInventoryEntry[]>>({});
  const [assetInventoryLoading, setAssetInventoryLoading] = useState(false);
  const [assetInventoryError, setAssetInventoryError] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [assetDetails, setAssetDetails] = useState<Record<string, WorkflowAssetDetail | null>>({});
  const [assetDetailLoading, setAssetDetailLoading] = useState(false);
  const [assetDetailError, setAssetDetailError] = useState<string | null>(null);
  const [assetPartitionsMap, setAssetPartitionsMap] = useState<Record<string, WorkflowAssetPartitions | null>>({});
  const [assetPartitionsLoading, setAssetPartitionsLoading] = useState(false);
  const [assetPartitionsError, setAssetPartitionsError] = useState<string | null>(null);

  const [autoMaterializeState, setAutoMaterializeState] = useState<
    Record<string, { data: WorkflowAutoMaterializeOps | null; loading: boolean; error: string | null }>
  >({});

  const [eventTriggerState, setEventTriggerState] = useState<Record<string, EventTriggerListState>>({});
  const [selectedTriggerId, setSelectedTriggerId] = useState<string | null>(null);
  const [triggerDeliveryState, setTriggerDeliveryState] = useState<Record<string, TriggerDeliveryState>>({});
  const [eventSamplesState, setEventSamplesState] = useState<EventSamplesState>({
    items: [],
    schema: null,
    loading: false,
    error: null,
    query: null
  });
  const [eventHealth, setEventHealth] = useState<WorkflowEventSchedulerHealth | null>(null);
  const [eventHealthLoading, setEventHealthLoading] = useState(false);
  const [eventHealthError, setEventHealthError] = useState<string | null>(null);

  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderMode, setBuilderMode] = useState<'create' | 'edit'>('create');
  const [builderWorkflow, setBuilderWorkflow] = useState<WorkflowDefinition | null>(null);
  const [builderSubmitting, setBuilderSubmitting] = useState(false);
  const [canEditWorkflows, setCanEditWorkflows] = useState(false);
  const [canUseAiBuilder, setCanUseAiBuilder] = useState(false);
  const [canCreateAiJobs, setCanCreateAiJobs] = useState(false);
  const [aiBuilderOpen, setAiBuilderOpen] = useState(false);
  const [aiPrefillWorkflow, setAiPrefillWorkflow] = useState<WorkflowCreateInput | null>(null);

  const [filters, setFilters] = useState<WorkflowFiltersState>(INITIAL_FILTERS);
  const [searchTerm, setSearchTerm] = useState('');

  const [workflowRuntimeSummaries, setWorkflowRuntimeSummaries] = useState<Record<string, WorkflowRuntimeSummary>>({});
  const [workflowAnalytics, setWorkflowAnalytics] = useState<Record<string, WorkflowAnalyticsState>>({});
  const [manualRunPending, setManualRunPending] = useState(false);
  const [manualRunError, setManualRunError] = useState<string | null>(null);
  const [lastTriggeredRun, setLastTriggeredRun] = useState<WorkflowRun | null>(null);
  const [serviceStatuses, setServiceStatuses] = useState<Record<string, string>>({});

  const workflowsRef = useRef<WorkflowDefinition[]>([]);
  const workflowDetailRef = useRef<WorkflowDefinition | null>(null);
  const runsRef = useRef<WorkflowRun[]>([]);
  const selectedSlugRef = useRef<string | null>(null);
  const selectedRunIdRef = useRef<string | null>(null);
  const selectedTriggerIdRef = useRef<string | null>(null);
  const workflowAnalyticsRef = useRef<Record<string, WorkflowAnalyticsState>>({});
  const eventTriggerStateRef = useRef<Record<string, EventTriggerListState>>({});
  const autoMaterializeStateRef = useRef(
    autoMaterializeState as Record<string, { data: WorkflowAutoMaterializeOps | null; loading: boolean; error: string | null }>
  );

  const authorizedFetch = useAuthorizedFetch();
  const { identity } = useAuth();
  const identityScopes = useMemo(() => new Set(identity?.scopes ?? []), [identity]);
  const isAuthenticated = Boolean(identity);
  const canRunWorkflowsScope = identityScopes.has('workflows:run');
  const { pushToast } = useToasts();

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId]
  );

  const assetInventory = useMemo(
    () => (selectedSlug ? assetInventories[selectedSlug] ?? [] : []),
    [assetInventories, selectedSlug]
  );

  const assetDetail = useMemo(() => {
    if (!selectedSlug || !selectedAssetId) {
      return null;
    }
    return assetDetails[`${selectedSlug}:${selectedAssetId}`] ?? null;
  }, [assetDetails, selectedAssetId, selectedSlug]);

  const assetPartitions = useMemo(() => {
    if (!selectedSlug || !selectedAssetId) {
      return null;
    }
    return assetPartitionsMap[`${selectedSlug}:${selectedAssetId}`] ?? null;
  }, [assetPartitionsMap, selectedAssetId, selectedSlug]);

  const eventTriggersEntry = selectedSlug ? eventTriggerState[selectedSlug] : undefined;
  const eventTriggers = useMemo(
    () => (eventTriggersEntry ? eventTriggersEntry.items : []),
    [eventTriggersEntry]
  );
  const eventTriggersLoading = eventTriggersEntry?.loading ?? false;
  const eventTriggersError = eventTriggersEntry?.error ?? null;

  const autoMaterializeEntry = selectedSlug ? autoMaterializeState[selectedSlug] : undefined;
  const autoMaterializeOps = autoMaterializeEntry?.data ?? null;
  const autoMaterializeLoading = autoMaterializeEntry?.loading ?? false;
  const autoMaterializeError = autoMaterializeEntry?.error ?? null;

  const selectedEventTrigger = useMemo(() => {
    if (!eventTriggers.length) {
      return null;
    }
    if (!selectedTriggerId) {
      return eventTriggers[0];
    }
    const match = eventTriggers.find((trigger) => trigger.id === selectedTriggerId);
    return match ?? eventTriggers[0];
  }, [eventTriggers, selectedTriggerId]);

  const triggerDeliveriesEntry = selectedEventTrigger ? triggerDeliveryState[selectedEventTrigger.id] : undefined;
  const triggerDeliveries = triggerDeliveriesEntry?.items ?? [];
  const triggerDeliveriesLoading = triggerDeliveriesEntry?.loading ?? false;
  const triggerDeliveriesError = triggerDeliveriesEntry?.error ?? null;
  const triggerDeliveriesLimit = triggerDeliveriesEntry?.limit ?? 50;
  const triggerDeliveriesQuery = triggerDeliveriesEntry?.query ?? {};

  const eventSamples = eventSamplesState.items;
  const eventSchema = eventSamplesState.schema;
  const eventSamplesLoading = eventSamplesState.loading;
  const eventSamplesError = eventSamplesState.error;

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

  const filteredWorkflows = filteredSummaries.map((summary) => summary.workflow);

  const updateRuntimeSummary = useCallback((workflow: WorkflowDefinition, run: WorkflowRun) => {
    setWorkflowRuntimeSummaries((current) => ({
      ...current,
      [workflow.slug]: {
        runId: run.id,
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

  const loadWorkflowAnalytics = useCallback(
    async (slug: string, range?: WorkflowAnalyticsRangeKey) => {
      if (!slug) {
        return;
      }
      const existing = workflowAnalyticsRef.current[slug];
      const targetRange = range ?? existing?.rangeKey ?? ANALYTICS_DEFAULT_RANGE;
      const query = targetRange === 'custom' ? undefined : { range: targetRange };
      try {
        const [stats, metrics] = await Promise.all([
          getWorkflowStats(authorizedFetch, slug, query),
          getWorkflowRunMetrics(authorizedFetch, slug, query)
        ]);
        setWorkflowAnalytics((current) => {
          const entry = current[slug] ?? createDefaultAnalyticsState();
          const historyBase = entry.history ?? [];
          const updatedHistory = metrics
            ? [...historyBase, metrics].slice(-ANALYTICS_HISTORY_LIMIT)
            : historyBase;
          const nextRangeKey = (stats?.range.key as WorkflowAnalyticsRangeKey | undefined) ?? targetRange;
          const defaultOutcomes = entry.outcomes.length
            ? entry.outcomes
            : stats
              ? Object.keys(stats.statusCounts)
              : [];
          return {
            ...current,
            [slug]: {
              stats,
              metrics,
              history: updatedHistory,
              rangeKey: nextRangeKey,
              bucketKey: metrics?.bucket?.key ?? entry.bucketKey ?? null,
              outcomes: defaultOutcomes,
              lastUpdated: new Date().toISOString()
            }
          } satisfies Record<string, WorkflowAnalyticsState>;
        });
      } catch (err) {
        console.error('workflow.analytics.fetch_failed', { slug, err });
      }
    },
    [authorizedFetch]
  );

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
      // Ignore service load errors to avoid masking workflow data.
    }
  }, [authorizedFetch]);

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
          const nextSlug = normalized[0].slug;
          selectedSlugRef.current = nextSlug;
          return nextSlug;
        });
      } else {
        selectedSlugRef.current = null;
        setSelectedSlug(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load workflows';
      setWorkflowsError(message);
    } finally {
      setWorkflowsLoading(false);
    }
  }, [authorizedFetch, seedRuntimeSummaryFromMetadata]);

  const loadWorkflowDetail = useCallback(
    async (slug: string) => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const { workflow: detail, runs: detailRuns } = await getWorkflowDetail(authorizedFetch, slug);
        setWorkflowDetail(detail);
        workflowDetailRef.current = detail;

        const normalizedRuns = sortRuns(detailRuns);
        setRuns(normalizedRuns);
        runsRef.current = normalizedRuns;

        if (normalizedRuns.length > 0) {
          const latestRun = normalizedRuns[0];
          selectedRunIdRef.current = latestRun.id;
          setSelectedRunId(latestRun.id);
          updateRuntimeSummary(detail, latestRun);
        } else {
          selectedRunIdRef.current = null;
          setSelectedRunId(null);
          setRunSteps([]);
        }

        void loadWorkflowAnalytics(slug);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load workflow details';
        setDetailError(message);
        setWorkflowDetail(null);
        workflowDetailRef.current = null;
        setRuns([]);
        runsRef.current = [];
        selectedRunIdRef.current = null;
        setSelectedRunId(null);
        setRunSteps([]);
      } finally {
        setDetailLoading(false);
      }
    },
    [authorizedFetch, updateRuntimeSummary, loadWorkflowAnalytics]
  );

  const loadRunSteps = useCallback(async (runId: string) => {
    setStepsLoading(true);
    setStepsError(null);
    try {
      const { run: normalizedRun, steps: normalizedSteps } = await listWorkflowRunSteps(
        authorizedFetch,
        runId
      );
      setRunSteps(normalizedSteps);
      setRuns((current) => {
        const existingIndex = current.findIndex((existing) => existing.id === normalizedRun.id);
        const next =
          existingIndex === -1
            ? [normalizedRun, ...current]
            : current.map((existing, index) => (index === existingIndex ? normalizedRun : existing));
        const sorted = sortRuns(next);
        runsRef.current = sorted;
        return sorted;
      });

      const workflow =
        workflowDetailRef.current ??
        workflowsRef.current.find((entry) => entry.id === normalizedRun.workflowDefinitionId);
      if (workflow) {
        updateRuntimeSummary(workflow, normalizedRun);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load workflow run steps';
      setStepsError(message);
      setRunSteps([]);
    } finally {
      setStepsLoading(false);
    }
  }, [authorizedFetch, updateRuntimeSummary]);

  const loadAssetHistory = useCallback(
    async (assetId: string, options: { limit?: number } = {}) => {
      if (!selectedSlug) {
        return;
      }
      setAssetDetailLoading(true);
      setAssetDetailError(null);
      try {
        const detail = await fetchWorkflowAssetHistory(authorizedFetch, selectedSlug, assetId, options);
        setAssetDetails((previous) => ({
          ...previous,
          [`${selectedSlug}:${assetId}`]: detail
        }));
        setSelectedAssetId(assetId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load asset history';
        setAssetDetailError(message);
        pushToast({
          title: 'Workflow asset history',
          description: message,
          tone: 'error'
        });
      } finally {
        setAssetDetailLoading(false);
      }
    },
    [authorizedFetch, pushToast, selectedSlug]
  );

  const loadAssetPartitions = useCallback(
    async (assetId: string, options: { lookback?: number; force?: boolean } = {}) => {
      if (!selectedSlug) {
        return;
      }
      const cacheKey = `${selectedSlug}:${assetId}`;
      if (!options.force && cacheKey in assetPartitionsMap) {
        return;
      }
      setAssetPartitionsLoading(true);
      setAssetPartitionsError(null);
      try {
        const partitions = await fetchWorkflowAssetPartitions(authorizedFetch, selectedSlug, assetId, {
          lookback: options.lookback
        });
        setAssetPartitionsMap((previous) => ({
          ...previous,
          [cacheKey]: partitions
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load asset partitions';
        setAssetPartitionsError(message);
        pushToast({
          title: 'Workflow asset partitions',
          description: message,
          tone: 'error'
        });
      } finally {
        setAssetPartitionsLoading(false);
      }
    },
    [authorizedFetch, pushToast, selectedSlug, assetPartitionsMap]
  );

  const selectAsset = useCallback(
    (assetId: string) => {
      if (!selectedSlug) {
        return;
      }
      const cacheKey = `${selectedSlug}:${assetId}`;
      setSelectedAssetId(assetId);
      if (!(cacheKey in assetDetails)) {
        void loadAssetHistory(assetId);
      }
      if (!(cacheKey in assetPartitionsMap)) {
        void loadAssetPartitions(assetId);
      }
    },
    [assetDetails, assetPartitionsMap, loadAssetHistory, loadAssetPartitions, selectedSlug]
  );

  const clearSelectedAsset = useCallback(() => {
    setSelectedAssetId(null);
    setAssetDetailError(null);
    setAssetPartitionsError(null);
  }, []);

  const refreshAsset = useCallback(
    (assetId: string) => {
      void loadAssetHistory(assetId);
      void loadAssetPartitions(assetId, { force: true });
    },
    [loadAssetHistory, loadAssetPartitions]
  );

  const loadAutoMaterializeOps = useCallback(
    async (slug: string, options: { force?: boolean } = {}) => {
      if (!slug) {
        return;
      }
      const currentEntry = autoMaterializeStateRef.current[slug];
      if (!options.force && currentEntry?.loading) {
        return;
      }
      if (!options.force && currentEntry && currentEntry.data) {
        return;
      }
      setAutoMaterializeState((current) => ({
        ...current,
        [slug]: {
          data: current[slug]?.data ?? null,
          loading: true,
          error: null
        }
      }));
      try {
        const ops = await getWorkflowAutoMaterializeOps(authorizedFetch, slug, { limit: 20 });
        setAutoMaterializeState((current) => ({
          ...current,
          [slug]: {
            data: ops,
            loading: false,
            error: null
          }
        }));
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to load auto-materialization activity';
        setAutoMaterializeState((current) => ({
          ...current,
          [slug]: {
            data: current[slug]?.data ?? null,
            loading: false,
            error: message
          }
        }));
        pushToast({
          tone: 'error',
          title: 'Auto-materialization activity',
          description: message
        });
      }
    },
    [authorizedFetch, pushToast]
  );

  const loadEventTriggers = useCallback(
    async (slug: string, options: { filters?: WorkflowEventTriggerFilters; force?: boolean } = {}) => {
      if (!slug) {
        return;
      }
      const currentState = eventTriggerStateRef.current;
      const filters: WorkflowEventTriggerFilters = {
        ...(currentState[slug]?.filters ?? {}),
        ...(options.filters ?? {})
      };
      const nextFilters = Object.keys(filters).length > 0 ? filters : undefined;
      if (!options.force && currentState[slug]?.loading) {
        return;
      }
      setEventTriggerState((current) => ({
        ...current,
        [slug]: {
          items: current[slug]?.items ?? [],
          loading: true,
          error: null,
          filters: nextFilters,
          lastFetchedAt: current[slug]?.lastFetchedAt
        }
      }));
      try {
        const response = await listWorkflowEventTriggers(authorizedFetch, slug, filters);
        setEventTriggerState((current) => ({
          ...current,
          [slug]: {
            items: response.triggers,
            loading: false,
            error: null,
            filters: nextFilters,
            lastFetchedAt: new Date().toISOString()
          }
        }));
        if (selectedSlugRef.current === slug) {
          setSelectedTriggerId((current) => {
            if (current && response.triggers.some((trigger) => trigger.id === current)) {
              return current;
            }
            return response.triggers.length > 0 ? response.triggers[0].id : null;
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load workflow event triggers';
        setEventTriggerState((current) => ({
          ...current,
          [slug]: {
            items: current[slug]?.items ?? [],
            loading: false,
            error: message,
            filters: nextFilters,
            lastFetchedAt: current[slug]?.lastFetchedAt
          }
        }));
        if (!(err instanceof ApiError && (err.status === 401 || err.status === 403))) {
          pushToast({
            tone: 'error',
            title: 'Workflow event triggers',
            description: message
          });
        }
      }
    },
    [authorizedFetch, pushToast]
  );

  const refreshAutoMaterializeOps = useCallback(
    (slug: string) => {
      void loadAutoMaterializeOps(slug, { force: true });
    },
    [loadAutoMaterializeOps]
  );

  const handleEventTriggerCreated = useCallback(
    (slug: string, trigger: WorkflowEventTrigger) => {
      setEventTriggerState((current) => {
        const entry = current[slug] ?? {
          items: [],
          loading: false,
          error: null
        };
        const nextItems = [trigger, ...entry.items.filter((existing) => existing.id !== trigger.id)];
        return {
          ...current,
          [slug]: {
            ...entry,
            items: nextItems,
            loading: false,
            error: null,
            lastFetchedAt: new Date().toISOString()
          }
        } satisfies Record<string, EventTriggerListState>;
      });
      if (selectedSlugRef.current === slug) {
        setSelectedTriggerId(trigger.id);
      }
    },
    []
  );

  const handleEventTriggerUpdated = useCallback(
    (slug: string, trigger: WorkflowEventTrigger) => {
      setEventTriggerState((current) => {
        const entry = current[slug] ?? {
          items: [],
          loading: false,
          error: null
        };
        const exists = entry.items.some((existing) => existing.id === trigger.id);
        const nextItems = exists
          ? entry.items.map((existing) => (existing.id === trigger.id ? trigger : existing))
          : [trigger, ...entry.items];
        return {
          ...current,
          [slug]: {
            ...entry,
            items: nextItems,
            loading: false,
            error: null,
            lastFetchedAt: new Date().toISOString()
          }
        } satisfies Record<string, EventTriggerListState>;
      });
      if (selectedSlugRef.current === slug) {
        setSelectedTriggerId((current) => current ?? trigger.id);
      }
    },
    []
  );

  const handleEventTriggerDeleted = useCallback((slug: string, triggerId: string) => {
    let remaining: WorkflowEventTrigger[] = [];
    setEventTriggerState((current) => {
      const entry = current[slug];
      if (!entry) {
        remaining = [];
        return current;
      }
      remaining = entry.items.filter((trigger) => trigger.id !== triggerId);
      return {
        ...current,
        [slug]: {
          ...entry,
          items: remaining,
          loading: false,
          error: null,
          lastFetchedAt: new Date().toISOString()
        }
      } satisfies Record<string, EventTriggerListState>;
    });
    if (selectedSlugRef.current === slug) {
      setSelectedTriggerId((current) => {
        if (current && current !== triggerId) {
          return current;
        }
        return remaining.length > 0 ? remaining[0].id : null;
      });
    }
  }, []);

  const createEventTrigger = useCallback(
    async (slug: string, input: WorkflowEventTriggerCreateInput) => {
      if (!slug) {
        throw new Error('Workflow slug is required');
      }
      setEventTriggerState((current) => ({
        ...current,
        [slug]: {
          items: current[slug]?.items ?? [],
          loading: true,
          error: null,
          filters: current[slug]?.filters,
          lastFetchedAt: current[slug]?.lastFetchedAt
        }
      }));
      try {
        const created = await createWorkflowEventTrigger(authorizedFetch, slug, input);
        handleEventTriggerCreated(slug, created);
        pushToast({
          tone: 'success',
          title: 'Event trigger created',
          description: `${created.eventType} trigger ready for matches.`
        });
        return created;
      } catch (err) {
        setEventTriggerState((current) => ({
          ...current,
          [slug]: {
            items: current[slug]?.items ?? [],
            loading: false,
            error: current[slug]?.error ?? null,
            filters: current[slug]?.filters,
            lastFetchedAt: current[slug]?.lastFetchedAt
          }
        }));
        if (!(err instanceof ApiError && err.status === 400)) {
          const message = err instanceof Error ? err.message : 'Failed to create event trigger';
          pushToast({
            tone: 'error',
            title: 'Event trigger creation failed',
            description: message
          });
        }
        throw err;
      }
    },
    [authorizedFetch, handleEventTriggerCreated, pushToast]
  );

  const updateEventTrigger = useCallback(
    async (slug: string, triggerId: string, input: WorkflowEventTriggerUpdateInput) => {
      if (!slug) {
        throw new Error('Workflow slug is required');
      }
      if (!triggerId) {
        throw new Error('Trigger id is required');
      }
      setEventTriggerState((current) => ({
        ...current,
        [slug]: {
          items: current[slug]?.items ?? [],
          loading: true,
          error: null,
          filters: current[slug]?.filters,
          lastFetchedAt: current[slug]?.lastFetchedAt
        }
      }));
      try {
        const updated = await updateWorkflowEventTrigger(authorizedFetch, slug, triggerId, input);
        handleEventTriggerUpdated(slug, updated);
        pushToast({
          tone: 'success',
          title: 'Event trigger updated',
          description: `${updated.eventType} trigger saved.`
        });
        return updated;
      } catch (err) {
        setEventTriggerState((current) => ({
          ...current,
          [slug]: {
            items: current[slug]?.items ?? [],
            loading: false,
            error: current[slug]?.error ?? null,
            filters: current[slug]?.filters,
            lastFetchedAt: current[slug]?.lastFetchedAt
          }
        }));
        if (!(err instanceof ApiError && err.status === 400)) {
          const message = err instanceof Error ? err.message : 'Failed to update event trigger';
          pushToast({
            tone: 'error',
            title: 'Event trigger update failed',
            description: message
          });
        }
        throw err;
      }
    },
    [authorizedFetch, handleEventTriggerUpdated, pushToast]
  );

  const deleteEventTrigger = useCallback(
    async (slug: string, triggerId: string) => {
      if (!slug) {
        throw new Error('Workflow slug is required');
      }
      if (!triggerId) {
        throw new Error('Trigger id is required');
      }
      setEventTriggerState((current) => ({
        ...current,
        [slug]: {
          items: current[slug]?.items ?? [],
          loading: true,
          error: null,
          filters: current[slug]?.filters,
          lastFetchedAt: current[slug]?.lastFetchedAt
        }
      }));
      try {
        await deleteWorkflowEventTrigger(authorizedFetch, slug, triggerId);
        handleEventTriggerDeleted(slug, triggerId);
        pushToast({
          tone: 'success',
          title: 'Event trigger deleted',
          description: 'Trigger removed from workflow.'
        });
      } catch (err) {
        setEventTriggerState((current) => ({
          ...current,
          [slug]: {
            items: current[slug]?.items ?? [],
            loading: false,
            error: current[slug]?.error ?? null,
            filters: current[slug]?.filters,
            lastFetchedAt: current[slug]?.lastFetchedAt
          }
        }));
        const message = err instanceof Error ? err.message : 'Failed to delete event trigger';
        pushToast({
          tone: 'error',
          title: 'Event trigger delete failed',
          description: message
        });
        throw err;
      }
    },
    [authorizedFetch, handleEventTriggerDeleted, pushToast]
  );

  const loadTriggerDeliveries = useCallback(
    async (slug: string, triggerId: string, query: WorkflowTriggerDeliveriesQuery = {}) => {
      if (!slug || !triggerId) {
        return;
      }
      setTriggerDeliveryState((current) => {
        const entry = current[triggerId] ?? {
          items: [],
          loading: false,
          error: null,
          limit: query.limit ?? 50
        };
        return {
          ...current,
          [triggerId]: {
            ...entry,
            loading: true,
            error: null,
            limit: query.limit ?? entry.limit,
            query,
            lastFetchedAt: entry.lastFetchedAt
          }
        } satisfies Record<string, TriggerDeliveryState>;
      });
      try {
        const response = await listWorkflowTriggerDeliveries(authorizedFetch, slug, triggerId, query);
        setTriggerDeliveryState((current) => ({
          ...current,
          [triggerId]: {
            items: response.deliveries,
            loading: false,
            error: null,
            limit: response.limit,
            query,
            lastFetchedAt: new Date().toISOString()
          }
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load trigger deliveries';
        setTriggerDeliveryState((current) => ({
          ...current,
          [triggerId]: {
            items: current[triggerId]?.items ?? [],
            loading: false,
            error: message,
            limit: current[triggerId]?.limit ?? query.limit ?? 50,
            query,
            lastFetchedAt: current[triggerId]?.lastFetchedAt
          }
        }));
        pushToast({
          tone: 'error',
          title: 'Delivery history refresh failed',
          description: message
        });
      }
    },
    [authorizedFetch, pushToast]
  );

  const loadEventSamples = useCallback(
    async (query: WorkflowEventSampleQuery = {}) => {
      setEventSamplesState((current) => ({
        ...current,
        loading: true,
        error: null,
        query
      }));
      try {
        const { samples, schema } = await listWorkflowEventSamples(authorizedFetch, query);
        setEventSamplesState({
          items: samples,
          schema: schema ?? null,
          loading: false,
          error: null,
          query,
          lastFetchedAt: new Date().toISOString()
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load event samples';
        setEventSamplesState((current) => ({
          ...current,
          loading: false,
          error: message
        }));
        if (!(err instanceof ApiError && (err.status === 401 || err.status === 403))) {
          pushToast({
            tone: 'error',
            title: 'Event samples unavailable',
            description: message
          });
        }
      }
    },
    [authorizedFetch, pushToast]
  );

  const refreshEventSamples = useCallback(() => {
    if (eventSamplesState.query) {
      void loadEventSamples(eventSamplesState.query);
    } else {
      void loadEventSamples({});
    }
  }, [eventSamplesState.query, loadEventSamples]);

  const loadEventSchedulerHealth = useCallback(async () => {
    setEventHealthLoading(true);
    setEventHealthError(null);
    try {
      const health = await getWorkflowEventHealth(authorizedFetch);
      setEventHealth(health);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load event health';
      setEventHealthError(message);
      if (!(err instanceof ApiError && (err.status === 401 || err.status === 403))) {
        pushToast({
          tone: 'error',
          title: 'Event health unavailable',
          description: message
        });
      }
    } finally {
      setEventHealthLoading(false);
    }
  }, [authorizedFetch, pushToast]);

  const handleAnalyticsSnapshot = useCallback((snapshot: unknown) => {
    if (!snapshot || typeof snapshot !== 'object') {
      return;
    }
    const record = snapshot as { slug?: unknown; stats?: unknown; metrics?: unknown };
    const slug = typeof record.slug === 'string' ? record.slug : null;
    if (!slug) {
      return;
    }
    const stats = record.stats ? normalizeWorkflowRunStats(record.stats) : null;
    const metrics = record.metrics ? normalizeWorkflowRunMetrics(record.metrics) : null;
    if (!stats && !metrics) {
      return;
    }
    setWorkflowAnalytics((current) => {
      const existing = current[slug] ?? createDefaultAnalyticsState();
      const history = metrics
        ? [...existing.history, metrics].slice(-ANALYTICS_HISTORY_LIMIT)
        : existing.history;
      const outcomes = existing.outcomes.length
        ? existing.outcomes
        : stats
          ? Object.keys(stats.statusCounts)
          : [];
      return {
        ...current,
        [slug]: {
          stats: stats ?? existing.stats,
          metrics: metrics ?? existing.metrics,
          history,
          rangeKey:
            (stats?.range.key as WorkflowAnalyticsRangeKey | undefined) ?? existing.rangeKey ?? ANALYTICS_DEFAULT_RANGE,
          bucketKey: metrics?.bucket?.key ?? existing.bucketKey ?? null,
          outcomes,
          lastUpdated: new Date().toISOString()
        }
      };
    });
  }, []);

  useEffect(() => {
    workflowsRef.current = workflows;
  }, [workflows]);

  useEffect(() => {
    workflowDetailRef.current = workflowDetail;
  }, [workflowDetail]);

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  useEffect(() => {
    workflowAnalyticsRef.current = workflowAnalytics;
  }, [workflowAnalytics]);

  useEffect(() => {
    eventTriggerStateRef.current = eventTriggerState;
  }, [eventTriggerState]);

  useEffect(() => {
    autoMaterializeStateRef.current = autoMaterializeState;
  }, [autoMaterializeState]);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  useEffect(() => {
    selectedSlugRef.current = selectedSlug;
  }, [selectedSlug]);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    selectedTriggerIdRef.current = selectedTriggerId;
  }, [selectedTriggerId]);

  useEffect(() => {
    if (!identity) {
      setCanEditWorkflows(false);
      setCanUseAiBuilder(false);
      setCanCreateAiJobs(false);
      return;
    }
    setCanEditWorkflows(identityScopes.has('workflows:write'));
    setCanUseAiBuilder(identityScopes.has('workflows:write') || identityScopes.has('jobs:write'));
    setCanCreateAiJobs(identityScopes.has('jobs:write') && identityScopes.has('job-bundles:write'));
  }, [identity, identityScopes]);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  useEffect(() => {
    if (!selectedSlug) {
      setSelectedTriggerId(null);
      return;
    }
    void loadWorkflowDetail(selectedSlug);
    void loadWorkflowAnalytics(selectedSlug);
    void loadEventTriggers(selectedSlug, { force: true });
    void loadEventSchedulerHealth();
    void loadAutoMaterializeOps(selectedSlug, { force: true });
  }, [
    selectedSlug,
    loadWorkflowDetail,
    loadWorkflowAnalytics,
    loadEventTriggers,
    loadEventSchedulerHealth,
    loadAutoMaterializeOps
  ]);

  useEffect(() => {
    setSelectedAssetId(null);
    setAssetDetailError(null);
    setAssetDetailLoading(false);
    setAssetPartitionsError(null);
    setAssetPartitionsLoading(false);

    if (!selectedSlug) {
      return;
    }

    let cancelled = false;
    setAssetInventoryLoading(true);
    setAssetInventoryError(null);

    const loadAssets = async () => {
      try {
        const assets = await fetchWorkflowAssets(authorizedFetch, selectedSlug);
        if (cancelled) {
          return;
        }
        setAssetInventories((previous) => ({ ...previous, [selectedSlug]: assets }));
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof ApiError ? error.message : 'Failed to load workflow assets';
        setAssetInventoryError(message);
        pushToast({
          title: 'Workflow assets',
          description: message,
          tone: 'error'
        });
      } finally {
        if (!cancelled) {
          setAssetInventoryLoading(false);
        }
      }
    };

    void loadAssets();

    return () => {
      cancelled = true;
    };
  }, [authorizedFetch, pushToast, selectedSlug]);

  useEffect(() => {
    if (!selectedRunId) {
      setRunSteps([]);
      return;
    }
    void loadRunSteps(selectedRunId);
  }, [selectedRunId, loadRunSteps]);

  useEffect(() => {
    if (!selectedSlug) {
      setSelectedTriggerId(null);
      return;
    }
    const entry = eventTriggerState[selectedSlug];
    if (!entry || entry.items.length === 0) {
      setSelectedTriggerId(null);
      return;
    }
    setSelectedTriggerId((current) => {
      if (current && entry.items.some((trigger) => trigger.id === current)) {
        return current;
      }
      return entry.items[0].id;
    });
  }, [eventTriggerState, selectedSlug]);

  useEffect(() => {
    if (!selectedSlug || !selectedEventTrigger) {
      return;
    }
    void loadTriggerDeliveries(selectedSlug, selectedEventTrigger.id);
  }, [selectedSlug, selectedEventTrigger, loadTriggerDeliveries]);

  const applyWorkflowDefinitionUpdate = useCallback(
    (payload: unknown) => {
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
        seedRuntimeSummaryFromMetadata(definition);
        return sorted;
      });

      const shouldUpdateDetail =
        (workflowDetailRef.current && workflowDetailRef.current.id === definition.id) ||
        (!workflowDetailRef.current && selectedSlugRef.current === definition.slug);
      if (shouldUpdateDetail) {
        workflowDetailRef.current = definition;
        setWorkflowDetail(definition);
      }

      if (!selectedSlugRef.current) {
        selectedSlugRef.current = definition.slug;
        setSelectedSlug(definition.slug);
      }
    },
    [seedRuntimeSummaryFromMetadata, setWorkflowDetail, setWorkflows, setSelectedSlug]
  );

  const applyWorkflowRunUpdate = useCallback(
    (payload: unknown) => {
      const run = normalizeWorkflowRun(payload);
      if (!run) {
        return;
      }

      const workflow = workflowsRef.current.find((entry) => entry.id === run.workflowDefinitionId);
      if (workflow) {
        updateRuntimeSummary(workflow, run);
      }

      const detail = workflowDetailRef.current;
      if (!detail || run.workflowDefinitionId !== detail.id) {
        return;
      }

      setRuns((current) => {
        const index = current.findIndex((existing) => existing.id === run.id);
        const next =
          index === -1
            ? [run, ...current]
            : current.map((existing, existingIndex) => (existingIndex === index ? run : existing));
        const sorted = sortRuns(next);
        runsRef.current = sorted;
        return sorted;
      });

      if (!selectedRunIdRef.current) {
        selectedRunIdRef.current = run.id;
        setSelectedRunId(run.id);
      }

      const effectiveSelectedRunId = selectedRunIdRef.current ?? run.id;
      if (
        effectiveSelectedRunId === run.id &&
        (run.status === 'succeeded' || run.status === 'failed' || run.status === 'running' || run.status === 'pending')
      ) {
        void loadRunSteps(run.id);
      }

      if (workflow) {
        const triggerCandidate = run.trigger;
        if (triggerCandidate && typeof triggerCandidate === 'object' && !Array.isArray(triggerCandidate)) {
          const triggerType = (triggerCandidate as { type?: unknown }).type;
          if (typeof triggerType === 'string' && triggerType === 'auto-materialize') {
            void loadAutoMaterializeOps(workflow.slug, { force: true });
          }
        }
      }
    },
    [loadRunSteps, loadAutoMaterializeOps, setRuns, setSelectedRunId, updateRuntimeSummary]
  );

  const handleWorkflowDefinitionEvent = useCallback(
    (event: Extract<AppHubSocketEvent, { type: 'workflow.definition.updated' }>) => {
      if (event.data?.workflow) {
        applyWorkflowDefinitionUpdate(event.data.workflow);
      }
    },
    [applyWorkflowDefinitionUpdate]
  );

  const handleWorkflowRunEvent = useCallback(
    (event: Extract<AppHubSocketEvent, { type: typeof WORKFLOW_RUN_EVENT_TYPES[number] }>) => {
      if (event.data?.run) {
        applyWorkflowRunUpdate(event.data.run);
      }
    },
    [applyWorkflowRunUpdate]
  );

  const handleAnalyticsEvent = useCallback(
    (event: Extract<AppHubSocketEvent, { type: typeof WORKFLOW_ANALYTICS_EVENT }>) => {
      if (event.data) {
        handleAnalyticsSnapshot(event.data);
      }
    },
    [handleAnalyticsSnapshot]
  );

  useAppHubEvent('workflow.definition.updated', handleWorkflowDefinitionEvent);
  useAppHubEvent(WORKFLOW_RUN_EVENT_TYPES, handleWorkflowRunEvent);
  useAppHubEvent(WORKFLOW_ANALYTICS_EVENT, handleAnalyticsEvent);

  const handleManualRun = useCallback(
    async (input: { parameters: unknown; triggeredBy?: string | null }) => {
      if (!workflowDetailRef.current) {
        setManualRunError('Select a workflow before launching a run.');
        return;
      }
      if (!isAuthenticated) {
        setManualRunError('Sign in to launch workflows.');
        return;
      }
      if (!canRunWorkflowsScope) {
        setManualRunError('You do not have permission to launch workflows.');
        return;
      }
      setManualRunPending(true);
      setManualRunError(null);
      try {
        const slug = workflowDetailRef.current.slug;
        const response = await authorizedFetch(`${API_BASE_URL}/workflows/${slug}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parameters: input.parameters,
            triggeredBy: input.triggeredBy ?? undefined
          })
        });
        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || 'Failed to enqueue workflow run');
        }
        const body = (await response.json()) as ManualRunResponse;
        const run = normalizeWorkflowRun(body.data) ?? body.data;
        setLastTriggeredRun(run);
        setRuns((current) => {
          const next = sortRuns([run, ...current.filter((existing) => existing.id !== run.id)]);
          runsRef.current = next;
          return next;
        });
        selectedRunIdRef.current = run.id;
        setSelectedRunId(run.id);
        setRunSteps([]);
        const workflow = workflowDetailRef.current;
        if (workflow) {
          updateRuntimeSummary(workflow, run);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to enqueue workflow run';
        setManualRunError(message);
      } finally {
        setManualRunPending(false);
      }
    },
    [authorizedFetch, canRunWorkflowsScope, isAuthenticated, updateRuntimeSummary]
  );

  const handleRefresh = useCallback(() => {
    void loadWorkflows();
    void loadServices();
    void loadEventSchedulerHealth();
    if (selectedSlugRef.current) {
      void loadWorkflowDetail(selectedSlugRef.current);
      void loadWorkflowAnalytics(selectedSlugRef.current);
      void loadEventTriggers(selectedSlugRef.current, { force: true });
      if (selectedTriggerIdRef.current) {
        void loadTriggerDeliveries(selectedSlugRef.current, selectedTriggerIdRef.current);
      }
      void loadAutoMaterializeOps(selectedSlugRef.current, { force: true });
    }
    if (selectedRunIdRef.current) {
      void loadRunSteps(selectedRunIdRef.current);
    }
  }, [
    loadEventSchedulerHealth,
    loadEventTriggers,
    loadServices,
    loadWorkflowDetail,
    loadWorkflowAnalytics,
    loadAutoMaterializeOps,
    loadRunSteps,
    loadWorkflows,
    loadTriggerDeliveries
  ]);

  const handleOpenAiBuilder = useCallback(() => {
    if (!canUseAiBuilder) {
      return;
    }
    setAiBuilderOpen(true);
    console.info('ai-builder.usage', { event: 'opened', source: 'workflows-page' });
  }, [canUseAiBuilder]);

  const handleAiWorkflowPrefill = useCallback((spec: WorkflowCreateInput) => {
    setAiPrefillWorkflow(spec);
    setBuilderMode('create');
    setBuilderWorkflow(null);
    setBuilderOpen(true);
  }, []);

  const setWorkflowAnalyticsRange = useCallback(
    (slug: string, range: WorkflowAnalyticsRangeKey) => {
      if (!slug) {
        return;
      }
      setWorkflowAnalytics((current) => {
        const entry = current[slug] ?? createDefaultAnalyticsState();
        return {
          ...current,
          [slug]: {
            ...entry,
            rangeKey: range
          }
        };
      });
      void loadWorkflowAnalytics(slug, range);
    },
    [loadWorkflowAnalytics]
  );

  const setWorkflowAnalyticsOutcomes = useCallback((slug: string, outcomes: string[]) => {
    if (!slug) {
      return;
    }
    setWorkflowAnalytics((current) => {
      const entry = current[slug] ?? createDefaultAnalyticsState();
      return {
        ...current,
        [slug]: {
          ...entry,
          outcomes
        }
      };
    });
  }, []);

  const handleAiWorkflowSubmitted = useCallback(
    async (workflowCreated: WorkflowDefinition) => {
      await loadWorkflows();
      selectedSlugRef.current = workflowCreated.slug;
      setSelectedSlug(workflowCreated.slug);
      await loadWorkflowDetail(workflowCreated.slug);
    },
    [loadWorkflows, loadWorkflowDetail]
  );

  const handleBuilderClose = useCallback(() => {
    setBuilderOpen(false);
    setAiPrefillWorkflow(null);
  }, []);

  const handleOpenCreateBuilder = useCallback(() => {
    if (!canEditWorkflows) {
      return;
    }
    setBuilderMode('create');
    setBuilderWorkflow(null);
    setBuilderOpen(true);
  }, [canEditWorkflows]);

  const handleOpenEditBuilder = useCallback(() => {
    if (!canEditWorkflows) {
      return;
    }
    const detail = workflowDetailRef.current ?? workflowDetail;
    if (!detail) {
      return;
    }
    setBuilderMode('edit');
    setBuilderWorkflow(detail);
    setBuilderOpen(true);
  }, [canEditWorkflows, workflowDetail]);

  const handleBuilderSubmit = useCallback(
    async (input: WorkflowBuilderSubmitArgs) => {
      setBuilderSubmitting(true);
      try {
        if (builderMode === 'create') {
          const created = await createWorkflowDefinition(authorizedFetch, input.createPayload);
          pushToast({
            tone: 'success',
            title: 'Workflow created',
            description: `${created.name} is ready for runs.`
          });
          setBuilderOpen(false);
          setBuilderWorkflow(null);
          setAiPrefillWorkflow(null);
          await loadWorkflows();
          selectedSlugRef.current = created.slug;
          setSelectedSlug(created.slug);
          await loadWorkflowDetail(created.slug);
        } else if (builderMode === 'edit' && builderWorkflow) {
          const updates = input.updatePayload ?? {};
          const updated = await updateWorkflowDefinition(authorizedFetch, builderWorkflow.slug, updates);
          pushToast({
            tone: 'success',
            title: 'Workflow updated',
            description: `${updated.name} changes saved.`
          });
          setBuilderOpen(false);
          setBuilderWorkflow(updated);
          setAiPrefillWorkflow(null);
          await loadWorkflows();
          await loadWorkflowDetail(updated.slug);
        }
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed to save workflow.';
        pushToast({ tone: 'error', title: 'Workflow save failed', description: message });
        throw err;
      } finally {
        setBuilderSubmitting(false);
      }
    },
    [
      authorizedFetch,
      builderMode,
      builderWorkflow,
      loadWorkflowDetail,
      loadWorkflows,
      pushToast
    ]
  );

  const unreachableServiceSlugs = useMemo(() => {
    if (!workflowDetail) {
      return [];
    }
    const unique = new Set<string>();
    const unreachable: string[] = [];
    for (const step of workflowDetail.steps) {
      if (!step.serviceSlug) {
        continue;
      }
      const normalized = step.serviceSlug.trim().toLowerCase();
      if (!normalized || unique.has(normalized)) {
        continue;
      }
      unique.add(normalized);
      if (serviceStatuses[normalized] === 'unreachable') {
        unreachable.push(step.serviceSlug);
      }
    }
    return unreachable;
  }, [workflowDetail, serviceStatuses]);

  return {
    workflows,
    workflowsLoading,
    workflowsError,
    workflowSummaries,
    filteredSummaries,
    filteredWorkflows,
    filters,
    setFilters,
    searchTerm,
    setSearchTerm,
    statusOptions,
    repoOptions,
    serviceOptions,
    tagOptions,
    selectedSlug,
    setSelectedSlug,
    workflowDetail,
    detailLoading,
    detailError,
    runs,
    selectedRunId,
    setSelectedRunId,
    runSteps,
    stepsLoading,
    stepsError,
    selectedRun,
    assetInventory,
    assetInventoryLoading,
    assetInventoryError,
    selectedAssetId,
    assetDetail,
    assetDetailLoading,
    assetDetailError,
    assetPartitions,
    assetPartitionsLoading,
    assetPartitionsError,
    selectAsset,
    clearSelectedAsset,
    loadAssetHistory,
    loadAssetPartitions,
    refreshAsset,
    autoMaterializeOps,
    autoMaterializeLoading,
    autoMaterializeError,
    loadAutoMaterializeOps,
    refreshAutoMaterializeOps,
    eventTriggers,
    eventTriggersLoading,
    eventTriggersError,
    selectedEventTrigger,
    selectedEventTriggerId: selectedTriggerId,
    setSelectedEventTriggerId: setSelectedTriggerId,
    loadEventTriggers,
    createEventTrigger,
    updateEventTrigger,
    deleteEventTrigger,
    triggerDeliveries,
    triggerDeliveriesLoading,
    triggerDeliveriesError,
    triggerDeliveriesLimit,
    triggerDeliveriesQuery,
    loadTriggerDeliveries,
    eventSamples,
    eventSchema,
    eventSamplesLoading,
    eventSamplesError,
    eventSamplesQuery: eventSamplesState.query,
    loadEventSamples,
    refreshEventSamples,
    eventHealth,
    eventHealthLoading,
    eventHealthError,
    loadEventSchedulerHealth,
    workflowRuntimeSummaries,
    workflowAnalytics,
    setWorkflowAnalyticsRange,
    setWorkflowAnalyticsOutcomes,
    loadWorkflowAnalytics,
    manualRunPending,
    manualRunError,
    lastTriggeredRun,
    handleManualRun,
    handleRefresh,
    unreachableServiceSlugs,
    builderOpen,
    builderMode,
    builderWorkflow,
    builderSubmitting,
    canEditWorkflows,
    canUseAiBuilder,
    canCreateAiJobs,
    aiBuilderOpen,
    aiPrefillWorkflow,
    handleOpenAiBuilder,
    handleOpenCreateBuilder,
    handleOpenEditBuilder,
    handleBuilderClose,
    handleBuilderSubmit,
    handleAiWorkflowPrefill,
    handleAiWorkflowSubmitted,
    loadWorkflowDetail,
    loadWorkflows,
    isAuthenticated,
    canRunWorkflowsScope,
    setAiBuilderOpen,
    authorizedFetch,
    pushToast
  };
}

export type WorkflowsControllerState = ReturnType<typeof useWorkflowsController>;

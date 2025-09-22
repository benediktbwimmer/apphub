import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { API_BASE_URL } from '../../config';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { useApiTokens } from '../../auth/useApiTokens';
import { useToasts } from '../../components/toast';
import {
  buildFilterOptions,
  buildStatusOptions,
  filterSummaries,
  normalizeWorkflowDefinition,
  normalizeWorkflowRun,
  sortRuns,
  summarizeWorkflowMetadata,
  type WorkflowSummary
} from '../normalizers';
import {
  createWorkflowDefinition,
  getWorkflowDetail,
  listServices,
  listWorkflowDefinitions,
  listWorkflowRunSteps,
  updateWorkflowDefinition,
  fetchOperatorIdentity,
  ApiError,
  type WorkflowCreateInput
} from '../api';
import type {
  WorkflowDefinition,
  WorkflowFiltersState,
  WorkflowRun,
  WorkflowRunStep,
  WorkflowRuntimeSummary
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

type WorkflowRunEventType = (typeof WORKFLOW_RUN_EVENT_TYPES)[number];

type ManualRunResponse = {
  data: WorkflowRun;
};

export const INITIAL_FILTERS: WorkflowFiltersState = {
  statuses: [],
  repos: [],
  services: [],
  tags: []
};

export type UseWorkflowsControllerOptions = {
  createWebSocket?: (url: string) => WebSocket;
};

export type WorkflowsController = ReturnType<typeof useWorkflowsController>;

function resolveWorkflowWebsocketUrl(): string {
  try {
    const apiUrl = new URL(API_BASE_URL);
    const wsUrl = new URL(apiUrl.toString());
    wsUrl.protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl.hash = '';
    wsUrl.search = '';
    wsUrl.pathname = `${apiUrl.pathname.replace(/\/$/, '')}/ws`;
    return wsUrl.toString();
  } catch {
    const sanitized = API_BASE_URL.replace(/^https?:\/\//, '');
    const protocol = API_BASE_URL.startsWith('https') ? 'wss://' : 'ws://';
    return `${protocol}${sanitized.replace(/\/$/, '')}/ws`;
  }
}

export function useWorkflowsController(options?: UseWorkflowsControllerOptions) {
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
  const [manualRunPending, setManualRunPending] = useState(false);
  const [manualRunError, setManualRunError] = useState<string | null>(null);
  const [lastTriggeredRun, setLastTriggeredRun] = useState<WorkflowRun | null>(null);
  const [serviceStatuses, setServiceStatuses] = useState<Record<string, string>>({});

  const workflowsRef = useRef<WorkflowDefinition[]>([]);
  const workflowDetailRef = useRef<WorkflowDefinition | null>(null);
  const runsRef = useRef<WorkflowRun[]>([]);
  const selectedSlugRef = useRef<string | null>(null);
  const selectedRunIdRef = useRef<string | null>(null);

  const authorizedFetch = useAuthorizedFetch();
  const { activeToken } = useApiTokens();
  const hasActiveToken = Boolean(activeToken);
  const { pushToast } = useToasts();

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId]
  );

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
    [authorizedFetch, updateRuntimeSummary]
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
    void loadServices();
  }, [loadServices]);

  useEffect(() => {
    selectedSlugRef.current = selectedSlug;
  }, [selectedSlug]);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    let cancelled = false;
    if (!hasActiveToken) {
      setCanEditWorkflows(false);
      setCanCreateAiJobs(false);
      return;
    }
    const loadIdentity = async () => {
      try {
        const identity = await fetchOperatorIdentity(authorizedFetch);
        if (cancelled) {
          return;
        }
        if (identity && Array.isArray(identity.scopes)) {
          const scopes = new Set(identity.scopes);
          setCanEditWorkflows(scopes.has('workflows:write'));
          setCanUseAiBuilder(scopes.has('workflows:write') || scopes.has('jobs:write'));
          setCanCreateAiJobs(scopes.has('jobs:write') && scopes.has('job-bundles:write'));
        } else {
          setCanEditWorkflows(false);
          setCanUseAiBuilder(false);
          setCanCreateAiJobs(false);
        }
      } catch {
        if (!cancelled) {
          setCanEditWorkflows(false);
          setCanUseAiBuilder(false);
          setCanCreateAiJobs(false);
        }
      }
    };
    void loadIdentity();
    return () => {
      cancelled = true;
    };
  }, [authorizedFetch, hasActiveToken, activeToken?.id]);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  useEffect(() => {
    if (!selectedSlug) {
      return;
    }
    void loadWorkflowDetail(selectedSlug);
  }, [selectedSlug, loadWorkflowDetail]);

  useEffect(() => {
    if (!selectedRunId) {
      setRunSteps([]);
      return;
    }
    void loadRunSteps(selectedRunId);
  }, [selectedRunId, loadRunSteps]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let pongTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let attempt = 0;

    const handleDefinitionEvent = (payload: unknown) => {
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
    };

    const handleRunEvent = (payload: unknown) => {
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
    };

    const clearHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (pongTimer) {
        clearTimeout(pongTimer);
        pongTimer = null;
      }
    };

    const startHeartbeat = () => {
      clearHeartbeat();
      heartbeatTimer = setInterval(() => {
        if (closed || !socket || socket.readyState !== WebSocket.OPEN) {
          return;
        }
        try {
          socket.send('ping');
        } catch {
          // Ignore send errors and defer to the reconnect logic.
        }
        if (pongTimer) {
          clearTimeout(pongTimer);
        }
        pongTimer = setTimeout(() => {
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.close();
          }
        }, 10_000);
      }, 30_000);
    };

    const handlePong = () => {
      if (pongTimer) {
        clearTimeout(pongTimer);
        pongTimer = null;
      }
    };

    const connect = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      socket = options?.createWebSocket?.(resolveWorkflowWebsocketUrl()) ??
        new WebSocket(resolveWorkflowWebsocketUrl());

      socket.onopen = () => {
        attempt = 0;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        startHeartbeat();
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') {
          return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!payload || typeof payload !== 'object') {
          return;
        }
        const type = (payload as { type?: unknown }).type;
        if (type === 'connection.ack') {
          startHeartbeat();
          return;
        }
        if (type === 'pong') {
          handlePong();
          return;
        }
        if (type === 'workflow.definition.updated') {
          const workflowPayload = (payload as { data?: { workflow?: unknown } }).data?.workflow;
          handleDefinitionEvent(workflowPayload);
          return;
        }
        if (typeof type === 'string' && WORKFLOW_RUN_EVENT_TYPES.includes(type as WorkflowRunEventType)) {
          const runPayload = (payload as { data?: { run?: unknown } }).data?.run;
          handleRunEvent(runPayload);
        }
      };

      socket.onclose = () => {
        if (closed) {
          return;
        }
        clearHeartbeat();
        attempt += 1;
        const delay = Math.min(10_000, 500 * 2 ** attempt);
        reconnectTimer = setTimeout(connect, delay);
        socket = null;
      };

      socket.onerror = () => {
        clearHeartbeat();
        socket?.close();
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      clearHeartbeat();
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, [loadRunSteps, seedRuntimeSummaryFromMetadata, updateRuntimeSummary, options]);

  const handleManualRun = useCallback(
    async (input: { parameters: unknown; triggeredBy?: string | null }) => {
      if (!workflowDetailRef.current) {
        setManualRunError('Select a workflow before launching a run.');
        return;
      }
      if (!hasActiveToken) {
        setManualRunError('Add an operator token in the API Access tab before launching workflows.');
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
    [authorizedFetch, hasActiveToken, updateRuntimeSummary]
  );

  const handleRefresh = useCallback(() => {
    void loadWorkflows();
    void loadServices();
    if (selectedSlugRef.current) {
      void loadWorkflowDetail(selectedSlugRef.current);
    }
    if (selectedRunIdRef.current) {
      void loadRunSteps(selectedRunIdRef.current);
    }
  }, [loadServices, loadWorkflowDetail, loadRunSteps, loadWorkflows]);

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
    workflowRuntimeSummaries,
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
    hasActiveToken,
    setAiBuilderOpen,
    authorizedFetch,
    pushToast
  };
}

export type WorkflowsControllerState = ReturnType<typeof useWorkflowsController>;


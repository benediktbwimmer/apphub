import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { API_BASE_URL } from '../config';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { useApiTokens } from '../auth/useApiTokens';
import { useToasts } from '../components/toast';
import ManualRunPanel from './components/ManualRunPanel';
import StatusBadge from './components/StatusBadge';
import WorkflowFilters from './components/WorkflowFilters';
import WorkflowGraph from './components/WorkflowGraph';
import {
  buildFilterOptions,
  buildStatusOptions,
  filterSummaries,
  normalizeWorkflowDefinition,
  normalizeWorkflowRun,
  sortRuns,
  summarizeWorkflowMetadata,
  toRecord,
  type WorkflowSummary
} from './normalizers';
import {
  createWorkflowDefinition,
  getWorkflowDetail,
  listServices,
  listWorkflowDefinitions,
  listWorkflowRunSteps,
  updateWorkflowDefinition,
  fetchOperatorIdentity,
  ApiError
} from './api';
import WorkflowBuilderDialog, { type WorkflowBuilderSubmitArgs } from './builder/WorkflowBuilderDialog';
import AiBuilderDialog from './ai/AiBuilderDialog';
import { WorkflowResourcesProvider } from './WorkflowResourcesContext';
import { formatDuration, formatTimestamp } from './formatters';
import type {
  WorkflowDefinition,
  WorkflowFiltersState,
  WorkflowRun,
  WorkflowRunStep,
  WorkflowRuntimeSummary
} from './types';
import type { WorkflowCreateInput } from './api';

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

const INITIAL_FILTERS: WorkflowFiltersState = {
  statuses: [],
  repos: [],
  services: [],
  tags: []
};

function formatJson(value: unknown): string {
  try {
    const text = JSON.stringify(value, null, 2);
    if (typeof text === 'string') {
      return text;
    }
  } catch {
    // Fall through to string coercion when serialization fails.
  }
  return String(value);
}

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

export default function WorkflowsPage() {
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
        const next = index === -1
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
        const next = index === -1
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

      socket = new WebSocket(resolveWorkflowWebsocketUrl());

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
  }, [loadRunSteps, seedRuntimeSummaryFromMetadata, updateRuntimeSummary]);

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

  const handleRefresh = () => {
    void loadWorkflows();
    void loadServices();
    if (selectedSlugRef.current) {
      void loadWorkflowDetail(selectedSlugRef.current);
    }
    if (selectedRunIdRef.current) {
      void loadRunSteps(selectedRunIdRef.current);
    }
  };

  const handleOpenAiBuilder = useCallback(() => {
    if (!canUseAiBuilder) {
      return;
    }
    setAiBuilderOpen(true);
    console.info('ai-builder.usage', { event: 'opened', source: 'workflows-page' });
  }, [canUseAiBuilder]);

  const handleAiWorkflowPrefill = useCallback(
    (spec: WorkflowCreateInput) => {
      setAiPrefillWorkflow(spec);
      setBuilderMode('create');
      setBuilderWorkflow(null);
      setBuilderOpen(true);
    },
    []
  );

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
        const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed to save workflow.';
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Workflows</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Discover workflow definitions, launch runs with validated parameters, and monitor execution in realtime.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/80 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            onClick={handleOpenAiBuilder}
            disabled={!canUseAiBuilder}
            title={
              canUseAiBuilder
                ? 'Draft jobs or workflows with Codex assistance.'
                : 'Add an operator token with workflows:write or jobs:write scope to use the AI builder.'
            }
          >
            AI builder
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-violet-500/60 bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-violet-500"
            onClick={handleOpenCreateBuilder}
            disabled={!canEditWorkflows}
            title={
              canEditWorkflows
                ? undefined
                : 'Add an operator token with workflows:write scope to create workflows.'
            }
          >
            Create workflow
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200/60 bg-white/70 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            onClick={handleRefresh}
          >
            Refresh
          </button>
        </div>
      </div>

      {!hasActiveToken && (
        <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 px-4 py-3 text-xs font-semibold text-amber-700 shadow-sm dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200">
          Save an operator token in the API Access tab to enable workflow mutations and manual runs.
        </div>
      )}

      <WorkflowFilters
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        activeFilters={filters}
        onChange={setFilters}
        statusOptions={statusOptions}
        repoOptions={repoOptions}
        serviceOptions={serviceOptions}
        tagOptions={tagOptions}
        onReset={() => setFilters(INITIAL_FILTERS)}
      />

      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Workflow Definitions</h2>
          <div className="mt-4 flex flex-col gap-2">
            {workflowsLoading && (
              <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-3 text-sm font-medium text-slate-600 dark:border-slate-700/70 dark:bg-slate-800/70 dark:text-slate-300">
                Loading workflows…
              </div>
            )}
            {workflowsError && !workflowsLoading && (
              <div className="rounded-2xl border border-rose-300/70 bg-rose-50/70 px-4 py-3 text-sm font-semibold text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
                {workflowsError}
              </div>
            )}
            {!workflowsLoading && !workflowsError && filteredWorkflows.length === 0 && workflows.length > 0 && (
              <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 px-4 py-3 text-sm font-medium text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                No workflows match your filters yet.
              </div>
            )}
            {!workflowsLoading && !workflowsError && workflows.length === 0 && (
              <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-3 text-sm font-medium text-slate-600 dark:border-slate-700/70 dark:bg-slate-800/70 dark:text-slate-300">
                No workflows registered yet.
              </div>
            )}
            <div className="flex max-h-[640px] flex-col gap-2 overflow-y-auto pr-1">
              {filteredSummaries.map((summary) => {
                const workflow = summary.workflow;
                const isActive = workflow.slug === selectedSlug;
                return (
                  <button
                    key={workflow.id}
                    type="button"
                    onClick={() => setSelectedSlug(workflow.slug)}
                    className={`flex flex-col gap-1 rounded-2xl border px-4 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
                      isActive
                        ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:border-slate-300 dark:bg-slate-800/70 dark:text-slate-100'
                        : 'border-slate-200/60 bg-white/70 text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{workflow.name}</span>
                      <StatusBadge status={summary.status} />
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{workflow.slug}</span>
                    {summary.repos.length > 0 && (
                      <span className="text-[11px] text-slate-400">{summary.repos.join(', ')}</span>
                    )}
                    {summary.tags.length > 0 && (
                      <span className="text-[10px] uppercase tracking-widest text-slate-400">
                        {summary.tags.join(' · ')}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <div className="flex flex-col gap-6">
          <ManualRunPanel
            workflow={workflowDetail}
            onSubmit={handleManualRun}
            pending={manualRunPending}
            error={manualRunError}
            authorized={hasActiveToken}
            lastRun={lastTriggeredRun}
            unreachableServices={unreachableServiceSlugs}
          />

          {workflowDetail && (
            <WorkflowGraph
              workflow={workflowDetail}
              run={selectedRun}
              steps={runSteps}
              runtimeSummary={workflowRuntimeSummaries[workflowDetail.slug]}
            />
          )}

          <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Workflow Details</h2>
              {workflowDetail && (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-violet-500/60 bg-violet-600/10 px-3 py-1 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-violet-400/60 dark:text-violet-200"
                  onClick={handleOpenEditBuilder}
                  disabled={!canEditWorkflows}
                  title={
                    canEditWorkflows
                      ? undefined
                      : 'Insufficient scope: workflows:write required to edit workflows.'
                  }
                >
                  Edit workflow
                </button>
              )}
            </div>
            {detailLoading && (
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Loading workflow details…</p>
            )}
            {detailError && !detailLoading && (
              <p className="mt-3 text-sm font-semibold text-rose-600 dark:text-rose-300">{detailError}</p>
            )}
            {!detailLoading && !detailError && workflowDetail && (
              <div className="mt-4 flex flex-col gap-4">
                <div>
                  {workflowDetail.description && (
                    <p className="text-sm text-slate-600 dark:text-slate-300">{workflowDetail.description}</p>
                  )}
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {workflowDetail.triggers.length > 0
                      ? `Triggers: ${workflowDetail.triggers.map((trigger) => trigger.type).join(', ')}`
                      : 'Triggers: manual'}
                  </p>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Steps</h3>
                  <ol className="mt-2 flex flex-col gap-2">
                    {workflowDetail.steps.map((step, index) => (
                      <li
                        key={step.id}
                        className="rounded-2xl border border-slate-200/60 bg-slate-50/70 px-4 py-3 text-sm text-slate-700 dark:border-slate-700/60 dark:bg-slate-800/70 dark:text-slate-200"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">
                            {index + 1}. {step.name}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {step.serviceSlug ?? step.jobSlug ?? 'step'}
                          </span>
                        </div>
                        {step.description && (
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{step.description}</p>
                        )}
                        {step.dependsOn && step.dependsOn.length > 0 && (
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Depends on: {step.dependsOn.join(', ')}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Run History</h2>
                {workflowDetail && workflowRuntimeSummaries[workflowDetail.slug] && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Latest run started {formatTimestamp(workflowRuntimeSummaries[workflowDetail.slug]?.startedAt ?? null)}
                  </p>
                )}
              </div>
              {selectedSlug && (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200/60 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                  onClick={() => void loadWorkflowDetail(selectedSlug)}
                >
                  Refresh runs
                </button>
              )}
            </div>
            {detailLoading && (
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Loading runs…</p>
            )}
            {!detailLoading && runs.length === 0 && (
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">No runs yet.</p>
            )}
            {!detailLoading && runs.length > 0 && (
              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
                <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                  <thead className="bg-slate-50/80 dark:bg-slate-800/80">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Started
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Completed
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Duration
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Current Step
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Triggered By
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {runs.map((run) => {
                      const isActive = run.id === selectedRunId;
                      return (
                        <tr
                          key={run.id}
                          className={`cursor-pointer transition-colors ${
                            isActive
                              ? 'bg-violet-500/5 dark:bg-violet-500/10'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                          }`}
                          onClick={() => setSelectedRunId(run.id)}
                        >
                          <td className="px-4 py-3 text-sm">
                            <StatusBadge status={run.status} />
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                            {formatTimestamp(run.startedAt)}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                            {formatTimestamp(run.completedAt)}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                            {formatDuration(run.durationMs)}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                            {run.currentStepId ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                            {run.triggeredBy ?? '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

      {selectedRun && (
        <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Run Details</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Run ID: {selectedRun.id}</p>
                </div>
                {selectedRun.errorMessage && (
                  <p className="max-w-sm text-right text-sm font-semibold text-rose-600 dark:text-rose-300">
                    {selectedRun.errorMessage}
                  </p>
                )}
              </div>
              <dl className="mt-4 grid gap-3 text-xs text-slate-600 dark:text-slate-300 md:grid-cols-4">
                <div>
                  <dt className="font-semibold uppercase tracking-widest text-slate-400">Status</dt>
                  <dd className="mt-1"><StatusBadge status={selectedRun.status} /></dd>
                </div>
                <div>
                  <dt className="font-semibold uppercase tracking-widest text-slate-400">Started</dt>
                  <dd className="mt-1">{formatTimestamp(selectedRun.startedAt)}</dd>
                </div>
                <div>
                  <dt className="font-semibold uppercase tracking-widest text-slate-400">Duration</dt>
                  <dd className="mt-1">{formatDuration(selectedRun.durationMs)}</dd>
                </div>
                <div>
                  <dt className="font-semibold uppercase tracking-widest text-slate-400">Triggered By</dt>
                  <dd className="mt-1">{selectedRun.triggeredBy ?? '—'}</dd>
                </div>
              </dl>
              {selectedRun.metrics && (
                <div className="mt-4 rounded-2xl border border-slate-200/60 bg-slate-50/70 px-4 py-3 text-xs text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/70 dark:text-slate-300">
                  <p className="font-semibold">Metrics</p>
                  <p className="mt-1">Completed steps: {selectedRun.metrics.completedSteps ?? '—'} / {selectedRun.metrics.totalSteps ?? '—'}</p>
                </div>
              )}
              {selectedRun.output !== null && selectedRun.output !== undefined ? (
                <div className="mt-4 rounded-2xl border border-slate-200/60 bg-slate-50/80 px-4 py-3 text-xs text-slate-600 shadow-inner dark:border-slate-700/60 dark:bg-slate-800/80 dark:text-slate-300">
                  <p className="font-semibold">Workflow Output</p>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-slate-900/80 px-3 py-2 text-[11px] leading-relaxed text-slate-200">
                    {formatJson(selectedRun.output)}
                  </pre>
                </div>
              ) : selectedRun.status === 'succeeded' ? (
                <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">No output captured for this run.</p>
              ) : null}
              {stepsLoading && (
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Loading step details…</p>
              )}
              {stepsError && !stepsLoading && (
                <p className="mt-3 text-sm font-semibold text-rose-600 dark:text-rose-300">{stepsError}</p>
              )}
              {!stepsLoading && !stepsError && runSteps.length > 0 && (
                <ol className="mt-4 flex flex-col gap-3">
                  {runSteps.map((step) => {
                    const metrics = toRecord(step.metrics);
                    return (
                      <li
                        key={step.id}
                        className="rounded-2xl border border-slate-200/60 bg-slate-50/70 px-4 py-3 text-sm dark:border-slate-700/60 dark:bg-slate-800/70"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div>
                            <p className="font-semibold text-slate-700 dark:text-slate-200">{step.stepId}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Attempt {step.attempt} · Job run {step.jobRunId ?? 'n/a'}
                            </p>
                          </div>
                          <StatusBadge status={step.status} />
                        </div>
                        <div className="mt-2 grid gap-2 text-xs text-slate-500 dark:text-slate-400 md:grid-cols-3">
                          <span>Started: {formatTimestamp(step.startedAt)}</span>
                          <span>Completed: {formatTimestamp(step.completedAt)}</span>
                          <span>
                            Logs:{' '}
                            {step.logsUrl ? (
                              <a
                                href={step.logsUrl}
                                className="text-violet-600 underline-offset-2 hover:underline dark:text-violet-300"
                                target="_blank"
                                rel="noreferrer"
                              >
                                View
                              </a>
                            ) : (
                              '—'
                            )}
                          </span>
                        </div>
                        {metrics && (
                          <pre className="mt-2 max-h-40 overflow-auto rounded-xl bg-slate-900/80 px-3 py-2 text-xs text-slate-200">
                            {JSON.stringify(metrics, null, 2)}
                          </pre>
                        )}
                        {step.errorMessage && (
                          <p className="mt-2 text-xs font-semibold text-rose-600 dark:text-rose-300">
                            {step.errorMessage}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
              {!stepsLoading && !stepsError && runSteps.length === 0 && (
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">No steps recorded for this run.</p>
              )}
            </section>
          )}
        </div>
      </div>
      {builderOpen && (
        <WorkflowResourcesProvider>
          <WorkflowBuilderDialog
            open={builderOpen}
            mode={builderMode}
            workflow={builderWorkflow}
            onClose={handleBuilderClose}
            onSubmit={handleBuilderSubmit}
            submitting={builderSubmitting}
            prefillCreatePayload={aiPrefillWorkflow}
          />
        </WorkflowResourcesProvider>
      )}
      {aiBuilderOpen && (
        <WorkflowResourcesProvider>
          <AiBuilderDialog
            open={aiBuilderOpen}
            onClose={() => setAiBuilderOpen(false)}
            authorizedFetch={authorizedFetch}
            pushToast={pushToast}
            onWorkflowSubmitted={handleAiWorkflowSubmitted}
            onWorkflowPrefill={handleAiWorkflowPrefill}
            canCreateJob={canCreateAiJobs}
          />
        </WorkflowResourcesProvider>
      )}
    </div>
  );
}

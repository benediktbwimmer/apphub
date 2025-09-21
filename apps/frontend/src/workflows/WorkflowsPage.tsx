import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE_URL } from '../config';

export type WorkflowDefinition = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  version: number;
  steps: Array<{
    id: string;
    name: string;
    jobSlug: string;
    description?: string | null;
    dependsOn?: string[];
    parameters?: unknown;
    timeoutMs?: number | null;
    retryPolicy?: unknown;
  }>;
  triggers: Array<{ type: string; options?: unknown }>;
  parametersSchema: unknown;
  defaultParameters: unknown;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowRun = {
  id: string;
  workflowDefinitionId: string;
  status: string;
  currentStepId: string | null;
  currentStepIndex: number | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  triggeredBy: string | null;
  metrics: { totalSteps?: number; completedSteps?: number } | null;
  parameters: unknown;
  context: unknown;
  trigger: unknown;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowRunStep = {
  id: string;
  workflowRunId: string;
  stepId: string;
  status: string;
  attempt: number;
  jobRunId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  logsUrl: string | null;
};

type WorkflowListResponse = {
  data: WorkflowDefinition[];
};

type WorkflowDetailResponse = {
  data: {
    workflow: WorkflowDefinition;
    runs: WorkflowRun[];
  };
};

type WorkflowRunStepsResponse = {
  data: {
    run: WorkflowRun;
    steps: WorkflowRunStep[];
  };
};

function formatTimestamp(value: string | null): string {
  if (!value) {
    return '—';
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString();
}

function formatDuration(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) {
    return '—';
  }
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}m ${remaining}s`;
}

function getStatusBadgeClasses(status: string): string {
  switch (status) {
    case 'succeeded':
      return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/40 dark:border-emerald-400/40 dark:text-emerald-300';
    case 'running':
      return 'bg-sky-500/10 text-sky-600 border-sky-500/40 dark:border-sky-400/40 dark:text-sky-300';
    case 'failed':
      return 'bg-rose-500/10 text-rose-600 border-rose-500/40 dark:border-rose-400/40 dark:text-rose-300';
    case 'canceled':
    case 'skipped':
      return 'bg-amber-500/10 text-amber-600 border-amber-500/40 dark:border-amber-400/40 dark:text-amber-300';
    default:
      return 'bg-slate-500/10 text-slate-600 border-slate-500/40 dark:border-slate-400/40 dark:text-slate-300';
  }
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold capitalize ${getStatusBadgeClasses(status)}`}
    >
      {status}
    </span>
  );
}

type WorkflowRunEventType =
  | 'workflow.run.updated'
  | 'workflow.run.pending'
  | 'workflow.run.running'
  | 'workflow.run.succeeded'
  | 'workflow.run.failed'
  | 'workflow.run.canceled';

const WORKFLOW_RUN_EVENT_TYPES: WorkflowRunEventType[] = [
  'workflow.run.updated',
  'workflow.run.pending',
  'workflow.run.running',
  'workflow.run.succeeded',
  'workflow.run.failed',
  'workflow.run.canceled'
];

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

function normalizeWorkflowDefinition(payload: unknown): WorkflowDefinition | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : null;
  const slug = typeof raw.slug === 'string' ? raw.slug : null;
  const name = typeof raw.name === 'string' ? raw.name : null;
  if (!id || !slug || !name) {
    return null;
  }

  const steps: WorkflowDefinition['steps'][number][] = [];
  if (Array.isArray(raw.steps)) {
    for (const entry of raw.steps) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const step = entry as Record<string, unknown>;
      const stepId = typeof step.id === 'string' ? step.id : null;
      const stepName = typeof step.name === 'string' ? step.name : null;
      const jobSlug = typeof step.jobSlug === 'string' ? step.jobSlug : null;
      if (!stepId || !stepName || !jobSlug) {
        continue;
      }
      const normalizedStep: WorkflowDefinition['steps'][number] = {
        id: stepId,
        name: stepName,
        jobSlug
      };
      if (typeof step.description === 'string') {
        normalizedStep.description = step.description;
      } else if (step.description === null) {
        normalizedStep.description = null;
      }
      if (Array.isArray(step.dependsOn)) {
        const dependsOn = step.dependsOn.filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0
        );
        if (dependsOn.length > 0) {
          normalizedStep.dependsOn = dependsOn;
        }
      }
      if ('parameters' in step) {
        normalizedStep.parameters = step.parameters ?? undefined;
      }
      if (typeof step.timeoutMs === 'number') {
        normalizedStep.timeoutMs = step.timeoutMs;
      } else if (step.timeoutMs === null) {
        normalizedStep.timeoutMs = null;
      }
      if ('retryPolicy' in step) {
        normalizedStep.retryPolicy = step.retryPolicy ?? undefined;
      }
      steps.push(normalizedStep);
    }
  }

  const triggers: WorkflowDefinition['triggers'][number][] = [];
  if (Array.isArray(raw.triggers)) {
    for (const entry of raw.triggers) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const trigger = entry as Record<string, unknown>;
      const type = typeof trigger.type === 'string' ? trigger.type : null;
      if (!type) {
        continue;
      }
      const normalizedTrigger: { type: string; options?: unknown } = { type };
      if ('options' in trigger) {
        normalizedTrigger.options = trigger.options;
      }
      triggers.push(normalizedTrigger);
    }
  }

  return {
    id,
    slug,
    name,
    description: typeof raw.description === 'string' ? raw.description : null,
    version: typeof raw.version === 'number' ? raw.version : 1,
    steps,
    triggers,
    parametersSchema: raw.parametersSchema ?? null,
    defaultParameters: raw.defaultParameters ?? null,
    metadata: raw.metadata ?? null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : ''
  };
}

function normalizeWorkflowRun(payload: unknown): WorkflowRun | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : null;
  const workflowDefinitionId =
    typeof raw.workflowDefinitionId === 'string' ? raw.workflowDefinitionId : null;
  const status = typeof raw.status === 'string' ? raw.status : null;
  if (!id || !workflowDefinitionId || !status) {
    return null;
  }

  const metrics =
    raw.metrics && typeof raw.metrics === 'object' && !Array.isArray(raw.metrics)
      ? (raw.metrics as { totalSteps?: number; completedSteps?: number })
      : null;

  return {
    id,
    workflowDefinitionId,
    status,
    currentStepId: typeof raw.currentStepId === 'string' ? raw.currentStepId : null,
    currentStepIndex: typeof raw.currentStepIndex === 'number' ? raw.currentStepIndex : null,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
    durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : null,
    errorMessage:
      typeof raw.errorMessage === 'string'
        ? raw.errorMessage
        : raw.errorMessage === null
          ? null
          : null,
    triggeredBy:
      typeof raw.triggeredBy === 'string'
        ? raw.triggeredBy
        : raw.triggeredBy === null
          ? null
          : null,
    metrics,
    parameters: raw.parameters ?? null,
    context: raw.context ?? null,
    trigger: raw.trigger ?? null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : ''
  };
}

function getTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortRuns(runs: WorkflowRun[]): WorkflowRun[] {
  return runs
    .slice()
    .sort((a, b) => {
      const createdDiff = getTimestamp(b.createdAt) - getTimestamp(a.createdAt);
      if (createdDiff !== 0) {
        return createdDiff;
      }
      const startedDiff = getTimestamp(b.startedAt) - getTimestamp(a.startedAt);
      if (startedDiff !== 0) {
        return startedDiff;
      }
      return getTimestamp(b.updatedAt) - getTimestamp(a.updatedAt);
    });
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

  const workflowsRef = useRef<WorkflowDefinition[]>([]);
  const workflowDetailRef = useRef<WorkflowDefinition | null>(null);
  const runsRef = useRef<WorkflowRun[]>([]);
  const selectedSlugRef = useRef<string | null>(null);
  const selectedRunIdRef = useRef<string | null>(null);

  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId) ?? null, [runs, selectedRunId]);

  const loadWorkflows = useCallback(async () => {
    setWorkflowsLoading(true);
    setWorkflowsError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/workflows`);
      if (!response.ok) {
        throw new Error('Failed to load workflows');
      }
      const body = (await response.json()) as WorkflowListResponse;
      setWorkflows(body.data);
      workflowsRef.current = body.data;
      if (body.data.length > 0) {
        setSelectedSlug((current) => {
          if (current) {
            selectedSlugRef.current = current;
            return current;
          }
          const nextSlug = body.data[0].slug;
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
  }, []);

  const loadWorkflowDetail = useCallback(
    async (slug: string) => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const response = await fetch(`${API_BASE_URL}/workflows/${slug}`);
        if (!response.ok) {
          throw new Error('Failed to load workflow details');
        }
        const body = (await response.json()) as WorkflowDetailResponse;
        setWorkflowDetail(body.data.workflow);
        const sortedRuns = sortRuns(body.data.runs);
        setRuns(sortedRuns);
        runsRef.current = sortedRuns;
        if (sortedRuns.length > 0) {
          selectedRunIdRef.current = sortedRuns[0].id;
          setSelectedRunId(sortedRuns[0].id);
        } else {
          selectedRunIdRef.current = null;
          setSelectedRunId(null);
          setRunSteps([]);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load workflow details';
        setDetailError(message);
        setWorkflowDetail(null);
        setRuns([]);
        runsRef.current = [];
        selectedRunIdRef.current = null;
        setSelectedRunId(null);
        setRunSteps([]);
      } finally {
        setDetailLoading(false);
      }
    },
    []
  );

  const loadRunSteps = useCallback(async (runId: string) => {
    setStepsLoading(true);
    setStepsError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/workflow-runs/${runId}/steps`);
      if (!response.ok) {
        throw new Error('Failed to load workflow run steps');
      }
      const body = (await response.json()) as WorkflowRunStepsResponse;
      setRunSteps(body.data.steps);
      setRuns((current) => {
        const existingIndex = current.findIndex((existing) => existing.id === body.data.run.id);
        const next = existingIndex === -1
          ? [body.data.run, ...current]
          : current.map((existing, index) => (index === existingIndex ? body.data.run : existing));
        return sortRuns(next);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load workflow run steps';
      setStepsError(message);
      setRunSteps([]);
    } finally {
      setStepsLoading(false);
    }
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
    selectedSlugRef.current = selectedSlug;
  }, [selectedSlug]);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

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
        (run.status === 'succeeded' || run.status === 'failed' || run.status === 'running')
      ) {
        void loadRunSteps(run.id);
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
        attempt += 1;
        const delay = Math.min(10_000, 500 * 2 ** attempt);
        reconnectTimer = setTimeout(connect, delay);
        socket = null;
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, [loadRunSteps]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Workflows</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Manage workflow definitions and inspect recent runs.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full border border-slate-200/60 bg-white/70 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
          onClick={() => {
            void loadWorkflows();
            if (selectedSlug) {
              void loadWorkflowDetail(selectedSlug);
            }
          }}
        >
          Refresh
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
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
            {!workflowsLoading && !workflowsError && workflows.length === 0 && (
              <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-3 text-sm font-medium text-slate-600 dark:border-slate-700/70 dark:bg-slate-800/70 dark:text-slate-300">
                No workflows registered yet.
              </div>
            )}
            <div className="flex flex-col gap-2">
              {workflows.map((workflow) => {
                const isActive = workflow.slug === selectedSlug;
                return (
                  <button
                    key={workflow.id}
                    type="button"
                    onClick={() => setSelectedSlug(workflow.slug)}
                    className={`flex flex-col gap-1 rounded-2xl border px-4 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                      isActive
                        ? 'border-blue-500/60 bg-blue-500/10 text-blue-700 dark:border-blue-400/60 dark:bg-blue-400/10 dark:text-blue-200'
                        : 'border-slate-200/70 bg-white/70 text-slate-700 hover:border-blue-400/50 hover:bg-blue-400/5 dark:border-slate-700/70 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:border-blue-400/40 dark:hover:bg-blue-400/10'
                    }`}
                  >
                    <span className="text-sm font-semibold">{workflow.name}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{workflow.slug}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <div className="flex flex-col gap-6">
          <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Workflow Details</h2>
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
                          <span className="text-xs text-slate-500 dark:text-slate-400">{step.jobSlug}</span>
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
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Run History</h2>
              {selectedSlug && (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200/60 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
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
                              ? 'bg-blue-500/5 dark:bg-blue-500/10'
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
              <div className="flex items-center justify-between">
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
              {stepsLoading && (
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Loading step details…</p>
              )}
              {stepsError && !stepsLoading && (
                <p className="mt-3 text-sm font-semibold text-rose-600 dark:text-rose-300">{stepsError}</p>
              )}
              {!stepsLoading && !stepsError && runSteps.length > 0 && (
                <ol className="mt-4 flex flex-col gap-3">
                  {runSteps.map((step) => (
                    <li
                      key={step.id}
                      className="rounded-2xl border border-slate-200/60 bg-slate-50/70 px-4 py-3 text-sm dark:border-slate-700/60 dark:bg-slate-800/70"
                    >
                      <div className="flex items-center justify-between gap-4">
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
                              className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-300"
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
                      {step.errorMessage && (
                        <p className="mt-2 text-xs font-semibold text-rose-600 dark:text-rose-300">
                          {step.errorMessage}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {!stepsLoading && !stepsError && runSteps.length === 0 && (
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">No steps recorded for this run.</p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

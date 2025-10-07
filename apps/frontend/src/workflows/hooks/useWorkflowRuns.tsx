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
import { API_BASE_URL } from '../../config';
import { useWorkflowAccess } from './useWorkflowAccess';
import { useWorkflowDefinitions } from './useWorkflowDefinitions';
import {
  getWorkflowDetail,
  listWorkflowRunSteps
} from '../api';
import {
  normalizeWorkflowDefinition,
  normalizeWorkflowRun,
  sortRuns
} from '../normalizers';
import type {
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRunStep
} from '../types';
import { useAppHubEvent, type AppHubSocketEvent } from '../../events/context';


export type WorkflowRunsContextValue = {
  workflowDetail: WorkflowDefinition | null;
  detailLoading: boolean;
  detailError: string | null;
  runs: WorkflowRun[];
  selectedRunId: string | null;
  setSelectedRunId: Dispatch<SetStateAction<string | null>>;
  selectedRun: WorkflowRun | null;
  runSteps: WorkflowRunStep[];
  stepsLoading: boolean;
  stepsError: string | null;
  manualRunPending: boolean;
  manualRunError: string | null;
  lastTriggeredRun: WorkflowRun | null;
  unreachableServiceSlugs: string[];
  loadWorkflowDetail: (slug: string) => Promise<void>;
  loadRunSteps: (runId: string) => Promise<void>;
  handleManualRun: (input: { parameters: unknown; triggeredBy?: string | null }) => Promise<void>;
};

const WorkflowRunsContext = createContext<WorkflowRunsContextValue | undefined>(undefined);

export function WorkflowRunsProvider({ children }: { children: ReactNode }) {
  const {
    authorizedFetch,
    isAuthenticated,
    canRunWorkflowsScope
  } = useWorkflowAccess();
  const {
    selectedSlug,
    updateRuntimeSummary,
    getWorkflowById,
    serviceStatuses
  } = useWorkflowDefinitions();

  const [workflowDetail, setWorkflowDetail] = useState<WorkflowDefinition | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runSteps, setRunSteps] = useState<WorkflowRunStep[]>([]);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [stepsError, setStepsError] = useState<string | null>(null);
  const [manualRunPending, setManualRunPending] = useState(false);
  const [manualRunError, setManualRunError] = useState<string | null>(null);
  const [lastTriggeredRun, setLastTriggeredRun] = useState<WorkflowRun | null>(null);

  const workflowDetailRef = useRef<WorkflowDefinition | null>(null);
  const runsRef = useRef<WorkflowRun[]>([]);
  const selectedRunIdRef = useRef<string | null>(null);

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
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load workflow details';
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

  const loadRunSteps = useCallback(
    async (runId: string) => {
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

        const workflow = workflowDetailRef.current ?? getWorkflowById(normalizedRun.workflowDefinitionId);
        if (workflow) {
          updateRuntimeSummary(workflow, normalizedRun);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load workflow run steps';
        setStepsError(message);
        setRunSteps([]);
      } finally {
        setStepsLoading(false);
      }
    },
    [authorizedFetch, getWorkflowById, updateRuntimeSummary]
  );

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId]
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
        const body = (await response.json()) as { data: unknown };
        const run = normalizeWorkflowRun(body.data);
        if (!run) {
          throw new Error('Unexpected run payload received from API');
        }
        setLastTriggeredRun(run);
        setRuns((current) => {
          const next = sortRuns([run, ...current.filter((existing) => existing.id !== run.id)]);
          runsRef.current = next;
          return next;
        });
        selectedRunIdRef.current = run.id;
        setSelectedRunId(run.id);
        setRunSteps([]);
        const detail = workflowDetailRef.current;
        if (detail) {
          updateRuntimeSummary(detail, run);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to enqueue workflow run';
        setManualRunError(message);
      } finally {
        setManualRunPending(false);
      }
    },
    [authorizedFetch, canRunWorkflowsScope, isAuthenticated, updateRuntimeSummary]
  );

  const applyWorkflowDefinitionUpdate = useCallback(
    (payload: unknown) => {
      const definition = normalizeWorkflowDefinition(payload);
      if (!definition) {
        return;
      }
      const currentDetail = workflowDetailRef.current;
      if (currentDetail && currentDetail.id === definition.id) {
        workflowDetailRef.current = definition;
        setWorkflowDetail(definition);
      }
    },
    []
  );

  const applyWorkflowRunUpdate = useCallback(
    (payload: unknown) => {
      const run = normalizeWorkflowRun(payload);
      if (!run) {
        return;
      }
      const workflow = getWorkflowById(run.workflowDefinitionId);
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
            : current.map((existing, idx) => (idx === index ? run : existing));
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
    },
    [getWorkflowById, loadRunSteps, updateRuntimeSummary]
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

  useAppHubEvent('workflow.definition.updated', handleWorkflowDefinitionEvent);
  useAppHubEvent(WORKFLOW_RUN_EVENT_TYPES, handleWorkflowRunEvent);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    if (!selectedRunId) {
      setRunSteps([]);
      setStepsError(null);
      return;
    }
    void loadRunSteps(selectedRunId);
  }, [selectedRunId, loadRunSteps]);

  useEffect(() => {
    workflowDetailRef.current = workflowDetail;
  }, [workflowDetail]);

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  useEffect(() => {
    if (!selectedSlug) {
      setWorkflowDetail(null);
      workflowDetailRef.current = null;
      setRuns([]);
      runsRef.current = [];
      setSelectedRunId(null);
      selectedRunIdRef.current = null;
      setRunSteps([]);
      return;
    }
    void loadWorkflowDetail(selectedSlug);
  }, [selectedSlug, loadWorkflowDetail]);

  const value: WorkflowRunsContextValue = useMemo(
    () => ({
      workflowDetail,
      detailLoading,
      detailError,
      runs,
      selectedRunId,
      setSelectedRunId,
      selectedRun,
      runSteps,
      stepsLoading,
      stepsError,
      manualRunPending,
      manualRunError,
      lastTriggeredRun,
      unreachableServiceSlugs,
      loadWorkflowDetail,
      loadRunSteps,
      handleManualRun
    }),
    [
      workflowDetail,
      detailLoading,
      detailError,
      runs,
      selectedRunId,
      selectedRun,
      runSteps,
      stepsLoading,
      stepsError,
      manualRunPending,
      manualRunError,
      lastTriggeredRun,
      unreachableServiceSlugs,
      loadWorkflowDetail,
      loadRunSteps,
      handleManualRun
    ]
  );

  return <WorkflowRunsContext.Provider value={value}>{children}</WorkflowRunsContext.Provider>;
}

export function useWorkflowRuns() {
  const context = useContext(WorkflowRunsContext);
  if (!context) {
    throw new Error('useWorkflowRuns must be used within WorkflowRunsProvider');
  }
  return context;
}

const WORKFLOW_RUN_EVENT_TYPES = [
  'workflow.run.updated',
  'workflow.run.pending',
  'workflow.run.running',
  'workflow.run.succeeded',
  'workflow.run.failed',
  'workflow.run.canceled'
] as const;

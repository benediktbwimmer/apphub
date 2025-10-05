import classNames from 'classnames';
import {
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
  type FormEvent
} from 'react';
import { ReactFlowProvider } from 'reactflow';
import { Modal, Spinner } from '../../components';
import { getStatusToneClasses } from '../../theme/statusTokens';
import { useWorkflowAccess } from '../hooks/useWorkflowAccess';
import { useWorkflowGraph } from '../hooks/useWorkflowGraph';
import {
  ApiError,
  getWorkflowRun,
  listWorkflowRunSteps,
  searchWorkflowRuns
} from '../api';
import {
  buildWorkflowRunOverlayFromSnapshot
} from '../graph/liveStatus';
import type {
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRunStep
} from '../types';
import type { WorkflowGraphLiveOverlay } from '../graph';
import WorkflowGraphCanvas, {
  type WorkflowGraphCanvasNodeData
} from './WorkflowGraphCanvas';
import WorkflowRunDetails from './WorkflowRunDetails';
import StatusBadge from './StatusBadge';
import { formatTimestamp } from '../formatters';

type WorkflowTopologyPreviewProps = {
  workflow: WorkflowDefinition | null;
};

const CONTAINER_CLASSES =
  'rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-xl backdrop-blur-md transition-colors';
const HEADER_TITLE_CLASSES = 'text-scale-lg font-weight-semibold text-primary';
const HEADER_SUBTEXT_CLASSES = 'text-scale-xs text-secondary';
const INFO_TEXT_CLASSES = 'mt-4 text-scale-sm text-secondary';
const ERROR_TEXT_CLASSES = `mt-4 text-scale-sm font-weight-semibold ${getStatusToneClasses('danger')}`;
const RUN_FORM_CLASSES = 'mt-4 flex flex-col gap-3 sm:flex-row sm:items-end';
const RUN_FIELD_CONTAINER_CLASSES = 'flex flex-1 flex-col gap-1';
const RUN_FIELD_LABEL_CLASSES = 'text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-muted';
const RUN_FIELD_INPUT_CLASSES =
  'h-10 rounded-2xl border border-subtle bg-surface-glass px-4 font-mono text-scale-sm text-primary shadow-inner transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const RUN_FORM_BUTTON_ROW_CLASSES = 'flex items-center gap-2';
const RUN_PRIMARY_BUTTON_CLASSES =
  'inline-flex h-10 items-center justify-center rounded-full border border-accent bg-accent px-4 text-scale-xs font-weight-semibold text-inverse shadow-elevation-md transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';
const RUN_SECONDARY_BUTTON_CLASSES =
  'inline-flex h-10 items-center justify-center rounded-full border border-subtle bg-surface-glass px-4 text-scale-xs font-weight-semibold text-secondary shadow-elevation-sm transition-colors hover:border-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';
const RUN_HELP_TEXT_CLASSES = 'text-scale-xs text-muted';
const RUN_STATUS_SUMMARY_CLASSES = 'mt-3 flex flex-wrap items-center gap-2 text-scale-xs text-secondary';
const RUN_ERROR_TEXT_CLASSES = 'text-scale-xs font-weight-semibold text-status-danger';
const MODAL_CONTENT_CLASSES = 'max-w-4xl';
const MODAL_BODY_CLASSES = 'p-6 sm:p-8';
const MODAL_CLOSE_BUTTON_CLASSES =
  'inline-flex items-center rounded-full border border-subtle bg-surface-glass px-3 py-1 text-[11px] font-weight-semibold uppercase tracking-[0.18em] text-secondary shadow-elevation-sm transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export default function WorkflowTopologyPreview({ workflow }: WorkflowTopologyPreviewProps) {
  const graphContext = useWorkflowGraph();
  const { graph, graphLoading, graphError, overlay } = graphContext;
  const { authorizedFetch, pushToast } = useWorkflowAccess();
  const workflowId = workflow?.id ?? null;
  const filters = useMemo(
    () => (workflowId ? { workflowIds: [workflowId] } : { workflowIds: [] }),
    [workflowId]
  );
  const [runQuery, setRunQuery] = useState('');
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runOverlay, setRunOverlay] = useState<WorkflowGraphLiveOverlay | null>(null);
  const [currentRun, setCurrentRun] = useState<WorkflowRun | null>(null);
  const [currentRunSteps, setCurrentRunSteps] = useState<WorkflowRunStep[]>([]);
  const [selectedNode, setSelectedNode] = useState<WorkflowGraphCanvasNodeData | null>(null);
  const [runDetailsOpen, setRunDetailsOpen] = useState(false);
  const graphContainerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(true);

  useEffect(() => {
    if (typeof document === 'undefined') {
      setFullscreenSupported(false);
      return;
    }
    setFullscreenSupported(document.fullscreenEnabled ?? true);
    const handleFullscreenChange = () => {
      const element = graphContainerRef.current;
      setIsFullscreen(document.fullscreenElement === element);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const element = graphContainerRef.current;
    if (!element) {
      return;
    }
    if (document.fullscreenElement === element) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      element.requestFullscreen?.().catch(() => {});
    }
  }, []);

  const workflowNode = workflowId ? graph?.workflowsIndex.byId[workflowId] ?? null : null;

  const overlayToRender = runOverlay ?? overlay ?? null;

  const clearRunSelection = useCallback((options?: { preserveError?: boolean }) => {
    setRunOverlay(null);
    setCurrentRun(null);
    setCurrentRunSteps([]);
    if (!options?.preserveError) {
      setRunError(null);
    }
    setSelectedNode(null);
    setRunDetailsOpen(false);
  }, []);

  const lookupRun = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!authorizedFetch) {
        setRunError('Missing authentication context');
        return;
      }
      if (trimmed.length === 0) {
        clearRunSelection();
        return;
      }
      setRunLoading(true);
      setRunError(null);
      try {
        let run: WorkflowRun | null = null;
        try {
          run = await getWorkflowRun(authorizedFetch, trimmed);
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) {
            throw error;
          }
        }

        if (!run) {
          const results = await searchWorkflowRuns(authorizedFetch, { search: trimmed, limit: 10 });
          const normalizedQuery = trimmed.toLowerCase();
          const exactMatch = results.find((entry) => entry.run.runKey?.toLowerCase() === normalizedQuery);
          const idMatch = results.find((entry) => entry.run.id === trimmed);
          run = exactMatch?.run ?? idMatch?.run ?? results[0]?.run ?? null;
        }

        if (!run) {
          setRunError('Workflow run not found. Confirm the ID or run key and try again.');
          clearRunSelection({ preserveError: true });
          return;
        }

        const { run: detailedRun, steps } = await listWorkflowRunSteps(authorizedFetch, run.id);
        const snapshotOverlay = buildWorkflowRunOverlayFromSnapshot(detailedRun, steps);
        setRunOverlay(snapshotOverlay);
        setCurrentRun(detailedRun);
        setCurrentRunSteps(steps);
        setSelectedNode(null);
        setRunDetailsOpen(false);
      } catch (error) {
        const message =
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Failed to load workflow run';
        setRunError(message);
        clearRunSelection({ preserveError: true });
        pushToast?.({
          tone: 'danger',
          title: 'Run lookup failed',
          description: message
        });
      } finally {
        setRunLoading(false);
      }
    },
    [authorizedFetch, clearRunSelection, pushToast]
  );

  const handleRunSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void lookupRun(runQuery);
    },
    [lookupRun, runQuery]
  );

  const handleNodeSelect = useCallback((_: string, data: WorkflowGraphCanvasNodeData) => {
    if (
      data.kind === 'workflow' ||
      data.kind === 'step-job' ||
      data.kind === 'step-service' ||
      data.kind === 'step-fanout'
    ) {
      setSelectedNode(data);
      setRunDetailsOpen(true);
    }
  }, []);

  const handleCanvasClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const highlightedStepId = selectedNode && selectedNode.kind.startsWith('step') ? selectedNode.refId : null;

  const orderedSteps = useMemo(() => {
    if (!highlightedStepId) {
      return currentRunSteps;
    }
    const target = currentRunSteps.find((step) => step.stepId === highlightedStepId);
    if (!target) {
      return currentRunSteps;
    }
    return [target, ...currentRunSteps.filter((step) => step.stepId !== highlightedStepId)];
  }, [currentRunSteps, highlightedStepId]);

  useEffect(() => {
    if (!runDetailsOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRunDetailsOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [runDetailsOpen]);

  if (!workflow) {
    return null;
  }

  return (
    <section className={CONTAINER_CLASSES}>
      <div className="flex flex-col gap-1">
        <h3 className={HEADER_TITLE_CLASSES}>Workflow topology</h3>
        <p className={HEADER_SUBTEXT_CLASSES}>
          Visualize the triggers, steps, assets, and schedules associated with this workflow.
        </p>
      </div>

      <form className={RUN_FORM_CLASSES} onSubmit={handleRunSubmit}>
        <div className={RUN_FIELD_CONTAINER_CLASSES}>
          <label htmlFor="workflow-run-lookup" className={RUN_FIELD_LABEL_CLASSES}>
            Inspect Run Overlay
          </label>
          <input
            id="workflow-run-lookup"
            type="text"
            value={runQuery}
            onChange={(event) => setRunQuery(event.target.value)}
            placeholder="Paste a workflow run ID or run key"
            className={RUN_FIELD_INPUT_CLASSES}
            autoComplete="off"
            spellCheck={false}
          />
          <p className={RUN_HELP_TEXT_CLASSES}>
            Loads run status details onto the graph so you can trace what happened.
          </p>
        </div>
        <div className={RUN_FORM_BUTTON_ROW_CLASSES}>
          <button
            type="submit"
            className={RUN_PRIMARY_BUTTON_CLASSES}
            disabled={runLoading}
          >
            {runLoading ? 'Loading…' : 'Load run'}
          </button>
          <button
            type="button"
            onClick={() => clearRunSelection()}
            className={RUN_SECONDARY_BUTTON_CLASSES}
            disabled={runLoading && !runOverlay}
          >
            Clear
          </button>
        </div>
      </form>

      {runError && <p className={RUN_ERROR_TEXT_CLASSES}>{runError}</p>}

      {currentRun && (
        <div className={RUN_STATUS_SUMMARY_CLASSES}>
          <StatusBadge status={currentRun.status} />
          <span>{currentRun.runKey ? `Run key ${currentRun.runKey}` : 'No run key'}</span>
          <span>Updated {formatTimestamp(currentRun.updatedAt)}</span>
          <span>Triggered by {currentRun.triggeredBy ?? 'manual'}</span>
        </div>
      )}

      {graphLoading && (
        <p className={INFO_TEXT_CLASSES}>
          <Spinner label="Loading workflow topology…" size="xs" />
        </p>
      )}

      {!graphLoading && graphError && <p className={ERROR_TEXT_CLASSES}>{graphError}</p>}

      {!graphLoading && !graphError && !workflowNode && (
        <p className={INFO_TEXT_CLASSES}>
          This workflow has not been indexed in the topology graph yet. Refresh to fetch the latest snapshot.
        </p>
      )}

      {!graphLoading && !graphError && workflowNode && (
        <div
          ref={graphContainerRef}
          className={classNames(
            'relative mt-4 h-[560px]',
            isFullscreen && 'mt-0 h-full w-full'
          )}
        >
          <ReactFlowProvider>
            <WorkflowGraphCanvas
              graph={graph}
              loading={graphLoading}
              error={graphError}
              filters={filters}
              overlay={overlayToRender}
              interactionMode="interactive"
              fitViewPadding={0.12}
              autoFit
              height={isFullscreen ? '100vh' : '100%'}
              onNodeSelect={handleNodeSelect}
              onCanvasClick={handleCanvasClick}
              fullscreen={{
                isActive: isFullscreen,
                onToggle: handleToggleFullscreen,
                supported: fullscreenSupported
              }}
            />
          </ReactFlowProvider>
        </div>
      )}

      <Modal
        open={runDetailsOpen}
        onClose={() => setRunDetailsOpen(false)}
        contentClassName={`${MODAL_CONTENT_CLASSES} w-full max-h-screen overflow-hidden`}
      >
        <div className={`${MODAL_BODY_CLASSES} h-full max-h-[90vh] overflow-y-auto`}
          role="presentation"
        >
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={() => setRunDetailsOpen(false)}
              className={MODAL_CLOSE_BUTTON_CLASSES}
            >
              Close
            </button>
          </div>
          {currentRun ? (
            <WorkflowRunDetails
              run={currentRun}
              steps={orderedSteps}
              stepsLoading={false}
              stepsError={null}
            />
          ) : (
            <p className="text-scale-sm text-secondary">
              Load a workflow run overlay to inspect execution details for selected nodes.
            </p>
          )}
        </div>
      </Modal>
    </section>
  );
}

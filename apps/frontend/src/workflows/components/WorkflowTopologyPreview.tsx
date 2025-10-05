import { useMemo } from 'react';
import { ReactFlowProvider } from 'reactflow';
import { Spinner } from '../../components';
import { getStatusToneClasses } from '../../theme/statusTokens';
import { useWorkflowGraph } from '../hooks/useWorkflowGraph';
import type { WorkflowDefinition } from '../types';
import WorkflowGraphCanvas from './WorkflowGraphCanvas';

type WorkflowTopologyPreviewProps = {
  workflow: WorkflowDefinition | null;
};

const CONTAINER_CLASSES =
  'rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-xl backdrop-blur-md transition-colors';
const HEADER_TITLE_CLASSES = 'text-scale-lg font-weight-semibold text-primary';
const HEADER_SUBTEXT_CLASSES = 'text-scale-xs text-secondary';
const INFO_TEXT_CLASSES = 'mt-4 text-scale-sm text-secondary';
const ERROR_TEXT_CLASSES = `mt-4 text-scale-sm font-weight-semibold ${getStatusToneClasses('danger')}`;

export default function WorkflowTopologyPreview({ workflow }: WorkflowTopologyPreviewProps) {
  const { graph, graphLoading, graphError, overlay } = useWorkflowGraph();
  const workflowId = workflow?.id ?? null;
  const filters = useMemo(
    () => (workflowId ? { workflowIds: [workflowId] } : { workflowIds: [] }),
    [workflowId]
  );

  if (!workflow) {
    return null;
  }

  const workflowNode = workflowId ? graph?.workflowsIndex.byId[workflowId] ?? null : null;

  return (
    <section className={CONTAINER_CLASSES}>
      <div className="flex flex-col gap-1">
        <h3 className={HEADER_TITLE_CLASSES}>Workflow topology</h3>
        <p className={HEADER_SUBTEXT_CLASSES}>
          Visualize the triggers, steps, assets, and schedules associated with this workflow.
        </p>
      </div>

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
        <div className="mt-4 h-[560px]">
          <ReactFlowProvider>
            <WorkflowGraphCanvas
              graph={graph}
              loading={graphLoading}
              error={graphError}
              filters={filters}
              overlay={overlay ?? null}
              interactionMode="interactive"
              fitViewPadding={0.12}
              autoFit
            />
          </ReactFlowProvider>
        </div>
      )}
    </section>
  );
}

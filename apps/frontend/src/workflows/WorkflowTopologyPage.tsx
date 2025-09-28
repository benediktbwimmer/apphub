import { useCallback } from 'react';
import { WorkflowTopologyPanel } from './components/WorkflowTopologyPanel';
import { useWorkflowGraph } from './hooks/useWorkflowGraph';

export default function WorkflowTopologyPage() {
  const {
    graph,
    graphLoading,
    graphRefreshing,
    graphError,
    graphStale,
    lastLoadedAt,
    graphMeta,
    overlay,
    overlayMeta,
    loadWorkflowGraph
  } = useWorkflowGraph();

  const handleRefresh = useCallback(() => {
    void loadWorkflowGraph({ force: true });
  }, [loadWorkflowGraph]);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Workflow topology</h1>
        <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-300">
          Explore live relationships between workflows, triggers, assets, and event sources to trace how
          orchestration propagates across AppHub.
        </p>
      </header>

      <WorkflowTopologyPanel
        graph={graph}
        graphLoading={graphLoading}
        graphRefreshing={graphRefreshing}
        graphError={graphError}
        graphStale={graphStale}
        lastLoadedAt={lastLoadedAt}
        meta={graphMeta}
        overlay={overlay}
        overlayMeta={overlayMeta}
        onRefresh={handleRefresh}
      />
    </section>
  );
}

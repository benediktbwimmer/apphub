import { useCallback, type ReactNode } from 'react';
import { WorkflowAccessProvider, useWorkflowAccess } from './useWorkflowAccess';
import { WorkflowGraphProvider, useWorkflowGraph } from './useWorkflowGraph';
import {
  INITIAL_FILTERS,
  WorkflowDefinitionsProvider,
  useWorkflowDefinitions
} from './useWorkflowDefinitions';
import { WorkflowRunsProvider, useWorkflowRuns } from './useWorkflowRuns';
import { WorkflowAnalyticsProvider, useWorkflowAnalytics } from './useWorkflowAnalytics';
import { WorkflowAssetsProvider, useWorkflowAssets } from './useWorkflowAssets';
import {
  WorkflowEventTriggersProvider,
  useWorkflowEventTriggers
} from './useWorkflowEventTriggers';
import { WorkflowBuilderProvider, useWorkflowBuilder } from './useWorkflowBuilderState';
import { WorkflowTimelineProvider, useWorkflowTimeline } from './useWorkflowTimeline';

export { INITIAL_FILTERS };

export function WorkflowsProviders({ children }: { children: ReactNode }) {
  return (
    <WorkflowAccessProvider>
      <WorkflowGraphProvider>
        <WorkflowDefinitionsProvider>
          <WorkflowRunsProvider>
            <WorkflowAnalyticsProvider>
              <WorkflowAssetsProvider>
                <WorkflowEventTriggersProvider>
                  <WorkflowTimelineProvider>
                    <WorkflowBuilderProvider>{children}</WorkflowBuilderProvider>
                  </WorkflowTimelineProvider>
                </WorkflowEventTriggersProvider>
              </WorkflowAssetsProvider>
            </WorkflowAnalyticsProvider>
          </WorkflowRunsProvider>
        </WorkflowDefinitionsProvider>
      </WorkflowGraphProvider>
    </WorkflowAccessProvider>
  );
}

export function useWorkflowsController() {
  const access = useWorkflowAccess();
  const definitions = useWorkflowDefinitions();
  const graph = useWorkflowGraph();
  const runs = useWorkflowRuns();
  const analytics = useWorkflowAnalytics();
  const assets = useWorkflowAssets();
  const triggers = useWorkflowEventTriggers();
  const builder = useWorkflowBuilder();
  const timeline = useWorkflowTimeline();

  const handleRefresh = useCallback(() => {
    void definitions.loadWorkflows();
    void graph.loadWorkflowGraph({ background: true });
    void definitions.loadServices();
    void triggers.loadEventSchedulerHealth();

    if (definitions.selectedSlug) {
      void runs.loadWorkflowDetail(definitions.selectedSlug);
      void analytics.loadWorkflowAnalytics(definitions.selectedSlug);
      void triggers.loadEventTriggers(definitions.selectedSlug, { force: true });
      assets.refreshAutoMaterializeOps(definitions.selectedSlug);
      timeline.refreshTimeline();
      if (triggers.selectedEventTrigger) {
        void triggers.loadTriggerDeliveries(
          definitions.selectedSlug,
          triggers.selectedEventTrigger.id,
          triggers.triggerDeliveriesQuery ?? {}
        );
      }
    }

    if (runs.selectedRunId) {
      void runs.loadRunSteps(runs.selectedRunId);
    }
  }, [
    analytics,
    assets,
    definitions,
    runs,
    timeline,
    triggers
  ]);

  return {
    ...access,
    ...definitions,
    ...runs,
    ...analytics,
    ...assets,
    ...triggers,
    ...timeline,
    ...graph,
    ...builder,
    handleRefresh
  };
}

export type WorkflowsController = ReturnType<typeof useWorkflowsController>;

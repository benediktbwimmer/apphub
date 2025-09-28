import WorkflowTopologyPage from '../workflows/WorkflowTopologyPage';
import { WorkflowAccessProvider } from '../workflows/hooks/useWorkflowAccess';
import { WorkflowGraphProvider } from '../workflows/hooks/useWorkflowGraph';

export default function TopologyRoute() {
  return (
    <WorkflowAccessProvider>
      <WorkflowGraphProvider>
        <WorkflowTopologyPage />
      </WorkflowGraphProvider>
    </WorkflowAccessProvider>
  );
}

import type { ComponentProps } from 'react';
import { ReactFlowProvider } from 'reactflow';
import WorkflowGraphCanvas from '../WorkflowGraphCanvas';
import {
  createLargeWorkflowGraphNormalized,
  createMediumWorkflowGraphNormalized,
  createSmallWorkflowGraphNormalized
} from '../../graph/mocks';

const meta = {
  title: 'Workflows/WorkflowGraphCanvas',
  component: WorkflowGraphCanvas
};

export default meta;

function StoryContainer(props: ComponentProps<typeof WorkflowGraphCanvas>) {
  return (
    <ReactFlowProvider>
      <div style={{ height: props.height ?? 600 }}>
        <WorkflowGraphCanvas {...props} />
      </div>
    </ReactFlowProvider>
  );
}

const Template = (args: ComponentProps<typeof WorkflowGraphCanvas>) => <StoryContainer {...args} />;

export const SmallGraph = Template.bind({});
SmallGraph.args = {
  graph: createSmallWorkflowGraphNormalized(),
  height: 520
};

export const MediumGraph = Template.bind({});
MediumGraph.args = {
  graph: createMediumWorkflowGraphNormalized(),
  height: 620
};

export const LargeGraph = Template.bind({});
LargeGraph.args = {
  graph: createLargeWorkflowGraphNormalized({ workflowCount: 16, stepsPerWorkflow: 12 }),
  height: 720
};

export const FilteredByWorkflow = Template.bind({});
FilteredByWorkflow.args = {
  graph: createSmallWorkflowGraphNormalized(),
  height: 520,
  filters: { workflowIds: ['wf-orders'] }
};

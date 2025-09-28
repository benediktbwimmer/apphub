import type { ComponentProps, ReactElement } from 'react';
import { ReactFlowProvider } from 'reactflow';
import WorkflowGraphCanvas from '../WorkflowGraphCanvas';
import {
  createLargeWorkflowGraphNormalized,
  createMediumWorkflowGraphNormalized,
  createSmallWorkflowGraphNormalized
} from '../../graph/mocks';

type StoryMetadata<Component> = {
  title: string;
  component: Component;
};

type StoryDefinition<Props> = {
  args: Props;
  render?: (args: Props) => ReactElement;
};

const meta: StoryMetadata<typeof WorkflowGraphCanvas> = {
  title: 'Workflows/WorkflowGraphCanvas',
  component: WorkflowGraphCanvas
};

export default meta;

type Story = StoryDefinition<ComponentProps<typeof WorkflowGraphCanvas>>;

function renderCanvas(args: ComponentProps<typeof WorkflowGraphCanvas>): ReactElement {
  return (
    <ReactFlowProvider>
      <div style={{ height: args.height ?? 600 }}>
        <WorkflowGraphCanvas {...args} />
      </div>
    </ReactFlowProvider>
  );
}

export const SmallGraph: Story = {
  args: {
    graph: createSmallWorkflowGraphNormalized(),
    height: 520
  },
  render: renderCanvas
};

export const MediumGraph: Story = {
  args: {
    graph: createMediumWorkflowGraphNormalized(),
    height: 620
  },
  render: renderCanvas
};

export const LargeGraph: Story = {
  args: {
    graph: createLargeWorkflowGraphNormalized({ workflowCount: 16, stepsPerWorkflow: 12 }),
    height: 720
  },
  render: renderCanvas
};

export const FilteredByWorkflow: Story = {
  args: {
    graph: createSmallWorkflowGraphNormalized(),
    height: 520,
    filters: { workflowIds: ['wf-orders'] }
  },
  render: renderCanvas
};

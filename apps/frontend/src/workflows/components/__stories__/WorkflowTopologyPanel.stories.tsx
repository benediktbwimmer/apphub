import type { ComponentProps } from 'react';
import { ReactFlowProvider } from 'reactflow';
import WorkflowTopologyPanel from '../WorkflowTopologyPanel';
import { createSmallWorkflowGraphNormalized } from '../../graph/mocks';
import type { WorkflowGraphFetchMeta } from '../../graph';

const SAMPLE_META: WorkflowGraphFetchMeta = {
  cache: {
    hit: true,
    cachedAt: new Date().toISOString(),
    ageMs: 1_200,
    expiresAt: null,
    stats: {
      hits: 42,
      misses: 3,
      invalidations: 1
    },
    lastInvalidatedAt: null,
    lastInvalidationReason: null
  }
};

const SAMPLE_GRAPH = createSmallWorkflowGraphNormalized();

const meta = {
  title: 'Workflows/WorkflowTopologyPanel',
  component: WorkflowTopologyPanel,
  decorators: [
    (Story) => (
      <ReactFlowProvider>
        <div style={{ maxWidth: 1200 }}>
          <Story />
        </div>
      </ReactFlowProvider>
    )
  ]
};

export default meta;

type StoryProps = ComponentProps<typeof WorkflowTopologyPanel>;

const Template = (args: StoryProps) => (
  <ReactFlowProvider>
    <WorkflowTopologyPanel {...args} />
  </ReactFlowProvider>
);

export const Default = Template.bind({});
Default.args = {
  graph: SAMPLE_GRAPH,
  graphLoading: false,
  graphRefreshing: false,
  graphError: null,
  graphStale: false,
  lastLoadedAt: new Date().toISOString(),
  meta: SAMPLE_META,
  onRefresh: () => undefined,
  selection: {}
};

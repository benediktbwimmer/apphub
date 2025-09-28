import type { ComponentProps, ReactElement } from 'react';
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

type StoryMetadata<Component> = {
  title: string;
  component: Component;
  decorators?: Array<(Story: () => ReactElement) => ReactElement>;
};

type StoryDefinition<Props> = {
  args: Props;
};

const meta: StoryMetadata<typeof WorkflowTopologyPanel> = {
  title: 'Workflows/WorkflowTopologyPanel',
  component: WorkflowTopologyPanel,
  decorators: [
    (Story: () => ReactElement) => (
      <ReactFlowProvider>
        <div style={{ maxWidth: 1200 }}>
          <Story />
        </div>
      </ReactFlowProvider>
    )
  ]
};

export default meta;

type Story = StoryDefinition<ComponentProps<typeof WorkflowTopologyPanel>>;

export const Default: Story = {
  args: {
    graph: SAMPLE_GRAPH,
    graphLoading: false,
    graphRefreshing: false,
    graphError: null,
    graphStale: false,
    lastLoadedAt: new Date().toISOString(),
    meta: SAMPLE_META,
    onRefresh: () => undefined,
    selection: {}
  }
};

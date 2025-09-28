import type {
  WorkflowTopologyAssetNode,
  WorkflowTopologyAssetWorkflowEdge,
  WorkflowTopologyEventSourceNode,
  WorkflowTopologyEventSourceTriggerEdge,
  WorkflowTopologyGraph,
  WorkflowTopologyGraphVersion,
  WorkflowTopologyScheduleNode,
  WorkflowTopologyStepAssetEdge,
  WorkflowTopologyStepNode,
  WorkflowTopologyTriggerNode,
  WorkflowTopologyTriggerWorkflowEdge,
  WorkflowTopologyWorkflowNode,
  WorkflowTopologyWorkflowStepEdge
} from '@apphub/shared/workflowTopology';
import type { AppHubSocketEvent } from '../../events/context';
import type { WorkflowGraphFetchMeta } from '../api';
export type { WorkflowGraphFetchMeta } from '../api';

export type WorkflowGraphNodeMap<Node extends { id: string }> = Record<string, Node>;

export type WorkflowGraphAssetMap = {
  byId: WorkflowGraphNodeMap<WorkflowTopologyAssetNode>;
  byNormalizedId: WorkflowGraphNodeMap<WorkflowTopologyAssetNode>;
};

export type WorkflowGraphWorkflowMap = {
  byId: WorkflowGraphNodeMap<WorkflowTopologyWorkflowNode>;
  bySlug: WorkflowGraphNodeMap<WorkflowTopologyWorkflowNode>;
};

export type WorkflowGraphStepIndex = {
  byId: WorkflowGraphNodeMap<WorkflowTopologyStepNode>;
  byWorkflowId: Record<string, WorkflowTopologyStepNode[]>;
};

export type WorkflowGraphTriggerIndex = {
  byId: WorkflowGraphNodeMap<WorkflowTopologyTriggerNode>;
  byWorkflowId: Record<string, WorkflowTopologyTriggerNode[]>;
};

export type WorkflowGraphScheduleIndex = {
  byId: WorkflowGraphNodeMap<WorkflowTopologyScheduleNode>;
  byWorkflowId: Record<string, WorkflowTopologyScheduleNode[]>;
};

export type WorkflowGraphEventSourceIndex = {
  byId: WorkflowGraphNodeMap<WorkflowTopologyEventSourceNode>;
  byKey: Record<string, WorkflowTopologyEventSourceNode>;
};

export type WorkflowGraphAdjacency = {
  workflowStepEdges: Record<string, WorkflowTopologyWorkflowStepEdge[]>;
  workflowEntryStepIds: Record<string, string[]>;
  workflowTerminalStepIds: Record<string, string[]>;
  stepParents: Record<string, string[]>;
  stepChildren: Record<string, string[]>;
  stepProduces: Record<string, WorkflowTopologyStepAssetEdge[]>;
  stepConsumes: Record<string, WorkflowTopologyStepAssetEdge[]>;
  assetProducers: Record<string, WorkflowTopologyStepAssetEdge[]>;
  assetConsumers: Record<string, WorkflowTopologyStepAssetEdge[]>;
  assetAutoMaterializeTargets: Record<string, WorkflowTopologyAssetWorkflowEdge[]>;
  workflowAutoMaterializeSources: Record<string, WorkflowTopologyAssetWorkflowEdge[]>;
  workflowTriggerEdges: Record<string, WorkflowTopologyTriggerWorkflowEdge[]>;
  triggerWorkflowEdges: Record<string, WorkflowTopologyTriggerWorkflowEdge[]>;
  eventSourceTriggerEdges: Record<string, WorkflowTopologyEventSourceTriggerEdge[]>;
  triggerEventSourceEdges: Record<string, WorkflowTopologyEventSourceTriggerEdge[]>;
};

export type WorkflowGraphStats = {
  totalWorkflows: number;
  totalSteps: number;
  totalTriggers: number;
  totalSchedules: number;
  totalAssets: number;
  totalEventSources: number;
};

export type WorkflowGraphWorkflowStatusState =
  | 'idle'
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'degraded'
  | 'unknown';

export type WorkflowGraphWorkflowStatus = {
  state: WorkflowGraphWorkflowStatusState;
  runId: string | null;
  updatedAt: string;
  triggeredBy?: string | null;
  errorMessage?: string | null;
};

export type WorkflowGraphStepStatusState = 'pending' | 'running' | 'failed' | 'succeeded' | 'unknown';

export type WorkflowGraphStepStatus = {
  state: WorkflowGraphStepStatusState;
  runId: string;
  updatedAt: string;
  attempt?: number | null;
};

export type WorkflowGraphAssetStatusState = 'fresh' | 'stale' | 'unknown';

export type WorkflowGraphAssetStatus = {
  state: WorkflowGraphAssetStatusState;
  producedAt?: string | null;
  expiresAt?: string | null;
  partitionKey?: string | null;
  workflowDefinitionId?: string | null;
  workflowRunId?: string | null;
  reason?: string | null;
};

export type WorkflowGraphTriggerStatusState =
  | 'active'
  | 'paused'
  | 'failing'
  | 'throttled'
  | 'disabled'
  | 'unknown';

export type WorkflowGraphTriggerStatus = {
  state: WorkflowGraphTriggerStatusState;
  updatedAt?: string | null;
  lastError?: string | null;
  reason?: string | null;
};

export type WorkflowGraphLiveOverlay = {
  workflows: Record<string, WorkflowGraphWorkflowStatus>;
  steps: Record<string, WorkflowGraphStepStatus>;
  assets: Record<string, WorkflowGraphAssetStatus>;
  triggers: Record<string, WorkflowGraphTriggerStatus>;
};

export type WorkflowGraphOverlayMeta = {
  lastEventAt: number | null;
  lastProcessedAt: number | null;
  droppedEvents: number;
  queueSize: number;
};

export type WorkflowGraphNormalized = {
  version: WorkflowTopologyGraphVersion;
  generatedAt: string;
  raw: WorkflowTopologyGraph;
  workflows: WorkflowTopologyWorkflowNode[];
  steps: WorkflowTopologyStepNode[];
  triggers: WorkflowTopologyTriggerNode[];
  schedules: WorkflowTopologyScheduleNode[];
  assets: WorkflowTopologyAssetNode[];
  eventSources: WorkflowTopologyEventSourceNode[];
  workflowsIndex: WorkflowGraphWorkflowMap;
  stepsIndex: WorkflowGraphStepIndex;
  triggersIndex: WorkflowGraphTriggerIndex;
  schedulesIndex: WorkflowGraphScheduleIndex;
  assetsIndex: WorkflowGraphAssetMap;
  eventSourcesIndex: WorkflowGraphEventSourceIndex;
  edges: WorkflowTopologyGraph['edges'];
  adjacency: WorkflowGraphAdjacency;
  stats: WorkflowGraphStats;
};

export const WORKFLOW_GRAPH_EVENT_TYPES = [
  'workflow.definition.updated',
  'workflow.run.updated',
  'workflow.run.pending',
  'workflow.run.running',
  'workflow.run.succeeded',
  'workflow.run.failed',
  'workflow.run.canceled',
  'asset.produced',
  'asset.expired'
] as const;

export type WorkflowGraphEventType = (typeof WORKFLOW_GRAPH_EVENT_TYPES)[number];

export type WorkflowGraphSocketEvent = Extract<AppHubSocketEvent, { type: WorkflowGraphEventType }>;

export type WorkflowGraphEventEntry = {
  id: string;
  receivedAt: number;
  event: WorkflowGraphSocketEvent;
};

export type LoadWorkflowGraphOptions = {
  background?: boolean;
  force?: boolean;
};

export type WorkflowGraphContextValue = {
  graph: WorkflowGraphNormalized | null;
  graphLoading: boolean;
  graphRefreshing: boolean;
  graphError: string | null;
  graphStale: boolean;
  lastLoadedAt: string | null;
  graphMeta: WorkflowGraphFetchMeta | null;
  pendingEvents: WorkflowGraphEventEntry[];
  overlay: WorkflowGraphLiveOverlay;
  overlayMeta: WorkflowGraphOverlayMeta;
  loadWorkflowGraph: (options?: LoadWorkflowGraphOptions) => Promise<void>;
  dequeuePendingEvents: (limit?: number) => WorkflowGraphEventEntry[];
  clearPendingEvents: () => void;
};

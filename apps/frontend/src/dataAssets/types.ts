export type AssetGraphProducer = {
  workflowId: string;
  workflowSlug: string;
  workflowName: string;
  stepId: string;
  stepName: string;
  stepType: 'job' | 'service' | 'fanout';
  partitioning: unknown;
  autoMaterialize: unknown;
  freshness: unknown;
};

export type AssetGraphConsumer = {
  workflowId: string;
  workflowSlug: string;
  workflowName: string;
  stepId: string;
  stepName: string;
  stepType: 'job' | 'service' | 'fanout';
};

export type AssetGraphMaterialization = {
  workflowId: string;
  workflowSlug: string;
  workflowName: string;
  runId: string;
  stepId: string;
  stepName: string;
  stepType: 'job' | 'service' | 'fanout';
  runStatus: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';
  stepStatus: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  producedAt: string;
  partitionKey: string | null;
  freshness: unknown;
  runStartedAt: string | null;
  runCompletedAt: string | null;
};

export type AssetGraphStalePartition = {
  workflowId: string;
  workflowSlug: string;
  workflowName: string;
  partitionKey: string | null;
  requestedAt: string;
  requestedBy: string | null;
  note: string | null;
};

export type AssetGraphNode = {
  assetId: string;
  normalizedAssetId: string;
  producers: AssetGraphProducer[];
  consumers: AssetGraphConsumer[];
  latestMaterializations: AssetGraphMaterialization[];
  stalePartitions: AssetGraphStalePartition[];
  hasStalePartitions: boolean;
  hasOutdatedUpstreams: boolean;
  outdatedUpstreamAssetIds: string[];
};

export type AssetGraphEdge = {
  fromAssetId: string;
  fromAssetNormalizedId: string;
  toAssetId: string;
  toAssetNormalizedId: string;
  workflowId: string;
  workflowSlug: string;
  workflowName: string;
  stepId: string;
  stepName: string;
  stepType: 'job' | 'service' | 'fanout';
};

export type AssetGraphData = {
  assets: AssetGraphNode[];
  edges: AssetGraphEdge[];
};

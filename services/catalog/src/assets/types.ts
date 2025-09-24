import type { WorkflowAssetFreshness } from '../db/types';

export type AssetExpiryReason = 'ttl' | 'cadence' | 'manual';

export type AssetAutoMaterializePolicy = {
  onUpstreamUpdate?: boolean;
  priority?: number | null;
};

export type AutoMaterializeTriggerReason = 'upstream-update' | 'expiry';

export type AssetProducedEventData = {
  assetId: string;
  workflowDefinitionId: string;
  workflowSlug: string;
  workflowRunId: string;
  workflowRunStepId: string;
  stepId: string;
  producedAt: string;
  freshness: WorkflowAssetFreshness | null;
  partitionKey: string | null;
};

export type AssetExpiredEventData = {
  assetId: string;
  workflowDefinitionId: string;
  workflowSlug: string;
  workflowRunId: string;
  workflowRunStepId: string;
  stepId: string;
  producedAt: string;
  expiresAt: string;
  requestedAt: string;
  reason: AssetExpiryReason;
  freshness: WorkflowAssetFreshness | null;
  partitionKey: string | null;
};

export type AssetExpiryJobData = {
  assetKey: string;
  reason: AssetExpiryReason;
  requestedAt: string;
  expiresAt: string;
  asset: AssetProducedEventData;
};

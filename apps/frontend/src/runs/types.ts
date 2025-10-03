import type { WorkflowRun } from '../workflows/types';

export type WorkflowRunHistoryEntry = {
  id: string;
  workflowRunId: string;
  workflowRunStepId: string | null;
  stepId: string | null;
  eventType: string;
  eventPayload: unknown;
  createdAt: string;
};

export type WorkflowRunAssetSummary = {
  id: string;
  workflowDefinitionId: string;
  workflowRunId: string;
  workflowRunStepId: string;
  stepId: string;
  assetId: string;
  partitionKey: string | null;
  producedAt: string | null;
  payload: unknown;
  freshness: unknown;
  schema: unknown;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowRunDiffChange = 'added' | 'removed' | 'changed';
export type WorkflowRunStatusDiffChange = 'identical' | 'baseOnly' | 'compareOnly' | 'changed';
export type WorkflowRunAssetDiffChange = 'baseOnly' | 'compareOnly' | 'changed';

export type WorkflowRunDiffEntry = {
  path: string;
  change: WorkflowRunDiffChange;
  before: unknown;
  after: unknown;
};

export type WorkflowRunStatusDiffEntry = {
  index: number;
  change: WorkflowRunStatusDiffChange;
  base: WorkflowRunHistoryEntry | null;
  compare: WorkflowRunHistoryEntry | null;
};

export type WorkflowRunAssetDescriptor = {
  assetId: string;
  partitionKey: string | null;
  stepId: string;
  producedAt: string | null;
  payload: unknown;
  freshness: unknown;
};

export type WorkflowRunAssetDiffEntry = {
  change: WorkflowRunAssetDiffChange;
  assetId: string;
  partitionKey: string | null;
  base: WorkflowRunAssetDescriptor | null;
  compare: WorkflowRunAssetDescriptor | null;
};

export type WorkflowRunStaleAssetWarning = {
  assetId: string;
  partitionKey: string | null;
  stepId: string;
  requestedAt: string;
  requestedBy: string | null;
  note: string | null;
};

export type WorkflowRunDiffPayload = {
  base: {
    run: WorkflowRun;
    history: WorkflowRunHistoryEntry[];
    assets: WorkflowRunAssetSummary[];
  };
  compare: {
    run: WorkflowRun;
    history: WorkflowRunHistoryEntry[];
    assets: WorkflowRunAssetSummary[];
  };
  diff: {
    parameters: WorkflowRunDiffEntry[];
    context: WorkflowRunDiffEntry[];
    output: WorkflowRunDiffEntry[];
    statusTransitions: WorkflowRunStatusDiffEntry[];
    assets: WorkflowRunAssetDiffEntry[];
  };
  staleAssets: WorkflowRunStaleAssetWarning[];
};

export type WorkflowRunReplayResult = {
  run: WorkflowRun;
  staleAssets: WorkflowRunStaleAssetWarning[];
};

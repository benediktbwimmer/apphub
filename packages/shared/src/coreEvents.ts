import type { FilestoreEvent } from './filestoreEvents';

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };

export type WorkflowEventSeverity = 'critical' | 'error' | 'warning' | 'info' | 'debug';

export type WorkflowEventCursorPayload = {
  ingressSequence: string;
  id?: string;
};

export type WorkflowEventLinkHints = {
  workflowDefinitionIds?: string[];
  workflowIds?: string[];
  workflowRunIds?: string[];
  repositoryIds?: string[];
  datasetIds?: string[];
  datasetSlugs?: string[];
  assetIds?: string[];
  timestoreDatasetIds?: string[];
  metastoreRecords?: Array<{ namespace: string; key: string }>;
  filestoreNodes?: Array<{ backendMountId: number; nodeId: number | null; path: string | null }>;
};

export type WorkflowAssetFreshness = {
  maxAgeMs?: number | null;
  ttlMs?: number | null;
  cadenceMs?: number | null;
};

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
  payload: JsonValue | null;
  parameters: JsonObject | null;
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
  reason: 'ttl' | 'cadence' | 'manual';
  freshness: WorkflowAssetFreshness | null;
  partitionKey: string | null;
  payload: JsonValue | null;
  parameters: JsonObject | null;
};

export type MetastoreRecordPayload = {
  namespace: string;
  key: string;
  metadata: Record<string, unknown>;
  tags: string[];
  owner: string | null;
  schemaHash: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
};

export type MetastoreRecordEventData = {
  namespace: string;
  key: string;
  actor: string | null;
  mode?: 'soft' | 'hard';
  record: MetastoreRecordPayload;
};

export type TimestorePartitionCreatedEventData = {
  datasetId: string;
  datasetSlug: string;
  manifestId: string;
  partitionId: string;
  partitionKey: string | null;
  partitionKeyFields: Record<string, string> | null;
  storageTargetId: string;
  filePath: string;
  rowCount: number;
  fileSizeBytes: number;
  checksum: string | null;
  receivedAt: string;
  attributes: Record<string, string> | null;
};

export type TimestorePartitionDeletedEntry = {
  id: string;
  storageTargetId: string;
  partitionKey: string | null;
  startTime: string | null;
  endTime: string | null;
  filePath: string;
  fileSizeBytes: number | null;
  reason: string | null;
};

export type TimestorePartitionDeletedEventData = {
  datasetId: string;
  datasetSlug: string;
  manifestId: string;
  partitions: TimestorePartitionDeletedEntry[];
};

export type TimestoreDatasetExportCompletedEventData = {
  datasetId: string;
  datasetSlug: string;
  manifestId: string;
  exportId: string;
  storageTargetId: string;
  filePath: string;
  rowCount: number;
  fileSizeBytes: number;
  exportedAt: string;
};

export type WorkflowEventDerived =
  | { type: 'asset.produced'; payload: AssetProducedEventData }
  | { type: 'asset.expired'; payload: AssetExpiredEventData }
  | { type: 'metastore.record.created'; payload: MetastoreRecordEventData }
  | { type: 'metastore.record.updated'; payload: MetastoreRecordEventData }
  | { type: 'metastore.record.deleted'; payload: MetastoreRecordEventData }
  | { type: FilestoreEvent['type']; payload: FilestoreEvent['data'] }
  | { type: 'timestore.partition.created'; payload: TimestorePartitionCreatedEventData }
  | { type: 'timestore.partition.deleted'; payload: TimestorePartitionDeletedEventData }
  | { type: 'timestore.dataset.export.completed'; payload: TimestoreDatasetExportCompletedEventData };

export type WorkflowEventRecordView = {
  id: string;
  type: string;
  source: string;
  occurredAt: string;
  receivedAt: string;
  ingressSequence: string;
  payload: unknown;
  correlationId: string | null;
  ttlMs: number | null;
  metadata: unknown;
  severity: WorkflowEventSeverity;
  links: WorkflowEventLinkHints;
  derived: WorkflowEventDerived | null;
};

export type WorkflowEventListPage = {
  events: WorkflowEventRecordView[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
};

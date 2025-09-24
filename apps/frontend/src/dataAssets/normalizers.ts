import type {
  AssetGraphConsumer,
  AssetGraphData,
  AssetGraphEdge,
  AssetGraphMaterialization,
  AssetGraphNode,
  AssetGraphProducer,
  AssetGraphStalePartition
} from './types';

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== 'string') {
    return null;
  }
  return allowed.includes(value as T) ? (value as T) : null;
}

function asBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return defaultValue;
}

function normalizeProducer(raw: unknown): AssetGraphProducer | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const workflowId = asString(record.workflowId);
  const workflowSlug = asString(record.workflowSlug);
  const workflowName = asString(record.workflowName);
  const stepId = asString(record.stepId);
  const stepName = asString(record.stepName);
  const stepType = asEnum(record.stepType, ['job', 'service', 'fanout']);
  if (!workflowId || !workflowSlug || !workflowName || !stepId || !stepName || !stepType) {
    return null;
  }
  return {
    workflowId,
    workflowSlug,
    workflowName,
    stepId,
    stepName,
    stepType,
    partitioning: record.partitioning ?? null,
    autoMaterialize: record.autoMaterialize ?? null,
    freshness: record.freshness ?? null
  };
}

function normalizeConsumer(raw: unknown): AssetGraphConsumer | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const workflowId = asString(record.workflowId);
  const workflowSlug = asString(record.workflowSlug);
  const workflowName = asString(record.workflowName);
  const stepId = asString(record.stepId);
  const stepName = asString(record.stepName);
  const stepType = asEnum(record.stepType, ['job', 'service', 'fanout']);
  if (!workflowId || !workflowSlug || !workflowName || !stepId || !stepName || !stepType) {
    return null;
  }
  return {
    workflowId,
    workflowSlug,
    workflowName,
    stepId,
    stepName,
    stepType
  };
}

function normalizeMaterialization(raw: unknown): AssetGraphMaterialization | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const workflowId = asString(record.workflowId);
  const workflowSlug = asString(record.workflowSlug);
  const workflowName = asString(record.workflowName);
  const runId = asString(record.runId);
  const stepId = asString(record.stepId);
  const stepName = asString(record.stepName);
  const stepType = asEnum(record.stepType, ['job', 'service', 'fanout']);
  const runStatus = asEnum(record.runStatus, ['pending', 'running', 'succeeded', 'failed', 'canceled']);
  const stepStatus = asEnum(record.stepStatus, ['pending', 'running', 'succeeded', 'failed', 'skipped']);
  const producedAt = asString(record.producedAt);
  if (
    !workflowId ||
    !workflowSlug ||
    !workflowName ||
    !runId ||
    !stepId ||
    !stepName ||
    !stepType ||
    !runStatus ||
    !stepStatus ||
    !producedAt
  ) {
    return null;
  }
  return {
    workflowId,
    workflowSlug,
    workflowName,
    runId,
    stepId,
    stepName,
    stepType,
    runStatus,
    stepStatus,
    producedAt,
    partitionKey: asStringOrNull(record.partitionKey),
    freshness: record.freshness ?? null,
    runStartedAt: asStringOrNull(record.runStartedAt),
    runCompletedAt: asStringOrNull(record.runCompletedAt)
  };
}

function normalizeStalePartition(raw: unknown): AssetGraphStalePartition | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const workflowId = asString(record.workflowId);
  const workflowSlug = asString(record.workflowSlug);
  const workflowName = asString(record.workflowName);
  const requestedAt = asString(record.requestedAt);
  if (!workflowId || !workflowSlug || !workflowName || !requestedAt) {
    return null;
  }
  return {
    workflowId,
    workflowSlug,
    workflowName,
    partitionKey: asStringOrNull(record.partitionKey),
    requestedAt,
    requestedBy: asStringOrNull(record.requestedBy),
    note: asStringOrNull(record.note)
  };
}

function normalizeNode(raw: unknown): AssetGraphNode | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const assetId = asString(record.assetId);
  const normalizedAssetId = asString(record.normalizedAssetId);
  if (!assetId || !normalizedAssetId) {
    return null;
  }
  const producersRaw = Array.isArray(record.producers) ? record.producers : [];
  const consumersRaw = Array.isArray(record.consumers) ? record.consumers : [];
  const latestRaw = Array.isArray(record.latestMaterializations) ? record.latestMaterializations : [];
  const staleRaw = Array.isArray(record.stalePartitions) ? record.stalePartitions : [];

  const producers = producersRaw
    .map((entry) => normalizeProducer(entry))
    .filter((entry): entry is AssetGraphProducer => Boolean(entry));
  const consumers = consumersRaw
    .map((entry) => normalizeConsumer(entry))
    .filter((entry): entry is AssetGraphConsumer => Boolean(entry));
  const latestMaterializations = latestRaw
    .map((entry) => normalizeMaterialization(entry))
    .filter((entry): entry is AssetGraphMaterialization => Boolean(entry));
  const stalePartitions = staleRaw
    .map((entry) => normalizeStalePartition(entry))
    .filter((entry): entry is AssetGraphStalePartition => Boolean(entry));
  const outdatedRaw = Array.isArray(record.outdatedUpstreamAssetIds) ? record.outdatedUpstreamAssetIds : [];
  const outdatedUpstreamAssetIds = outdatedRaw
    .map((value) => (typeof value === 'string' && value.length > 0 ? value : null))
    .filter((value): value is string => Boolean(value));

  return {
    assetId,
    normalizedAssetId,
    producers,
    consumers,
    latestMaterializations,
    stalePartitions,
    hasStalePartitions: asBoolean(record.hasStalePartitions, stalePartitions.length > 0),
    hasOutdatedUpstreams: asBoolean(record.hasOutdatedUpstreams, outdatedUpstreamAssetIds.length > 0),
    outdatedUpstreamAssetIds
  };
}

function normalizeEdge(raw: unknown): AssetGraphEdge | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const fromAssetId = asString(record.fromAssetId);
  const fromAssetNormalizedId = asString(record.fromAssetNormalizedId);
  const toAssetId = asString(record.toAssetId);
  const toAssetNormalizedId = asString(record.toAssetNormalizedId);
  const workflowId = asString(record.workflowId);
  const workflowSlug = asString(record.workflowSlug);
  const workflowName = asString(record.workflowName);
  const stepId = asString(record.stepId);
  const stepName = asString(record.stepName);
  const stepType = asEnum(record.stepType, ['job', 'service', 'fanout']);

  if (
    !fromAssetId ||
    !fromAssetNormalizedId ||
    !toAssetId ||
    !toAssetNormalizedId ||
    !workflowId ||
    !workflowSlug ||
    !workflowName ||
    !stepId ||
    !stepName ||
    !stepType
  ) {
    return null;
  }

  return {
    fromAssetId,
    fromAssetNormalizedId,
    toAssetId,
    toAssetNormalizedId,
    workflowId,
    workflowSlug,
    workflowName,
    stepId,
    stepName,
    stepType
  };
}

export function normalizeAssetGraphResponse(payload: unknown): AssetGraphData | null {
  const root = toRecord(payload);
  if (!root) {
    return null;
  }
  const data = toRecord(root.data);
  if (!data) {
    return null;
  }
  const assetsRaw = Array.isArray(data.assets) ? data.assets : [];
  const edgesRaw = Array.isArray(data.edges) ? data.edges : [];

  const assets = assetsRaw
    .map((entry) => normalizeNode(entry))
    .filter((node): node is AssetGraphNode => Boolean(node));
  const edges = edgesRaw
    .map((entry) => normalizeEdge(entry))
    .filter((edge): edge is AssetGraphEdge => Boolean(edge));

  return { assets, edges };
}

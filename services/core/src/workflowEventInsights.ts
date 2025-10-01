import type {
  AssetExpiredEventData,
  AssetProducedEventData,
  MetastoreRecordEventData,
  TimestoreDatasetExportCompletedEventData,
  TimestorePartitionCreatedEventData,
  TimestorePartitionDeletedEventData,
  WorkflowEventDerived,
  WorkflowEventLinkHints,
  WorkflowEventRecordView,
  WorkflowEventSeverity
} from '@apphub/shared/coreEvents';
import {
  parseFilestoreEventEnvelope,
  type FilestoreEvent
} from '@apphub/shared/filestoreEvents';
import type { WorkflowEventRecord } from './db/types';

const SEVERITY_RANK: Record<WorkflowEventSeverity, number> = {
  critical: 4,
  error: 3,
  warning: 2,
  info: 1,
  debug: 0
};

const SEVERITY_ALIASES: Record<string, WorkflowEventSeverity> = {
  critical: 'critical',
  fatal: 'critical',
  emergency: 'critical',
  alert: 'critical',
  panic: 'critical',
  severe: 'critical',
  catastrophe: 'critical',
  catastrophic: 'critical',
  error: 'error',
  err: 'error',
  failure: 'error',
  failed: 'error',
  exception: 'error',
  warning: 'warning',
  warn: 'warning',
  caution: 'warning',
  throttled: 'warning',
  paused: 'warning',
  degraded: 'warning',
  notice: 'info',
  info: 'info',
  informational: 'info',
  success: 'info',
  succeeded: 'info',
  ready: 'info',
  started: 'info',
  created: 'info',
  debug: 'debug',
  trace: 'debug',
  verbose: 'debug'
};

const SEVERITY_KEY_CANDIDATES = new Set([
  'severity',
  'severitytext',
  'severitylevel',
  'level',
  'loglevel',
  'status',
  'state',
  'result',
  'outcome',
  'priority'
]);

type LinkAccumulator = {
  workflowDefinitionIds: Set<string>;
  workflowIds: Set<string>;
  workflowRunIds: Set<string>;
  repositoryIds: Set<string>;
  datasetIds: Set<string>;
  datasetSlugs: Set<string>;
  assetIds: Set<string>;
  timestoreDatasetIds: Set<string>;
  metastoreRecords: Map<string, { namespace: string; key: string }>;
  filestoreNodes: Map<string, { backendMountId: number; nodeId: number | null; path: string | null }>;
};

const SEVERITY_DEFAULT: WorkflowEventSeverity = 'info';

function normalizeKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function ensureArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return [value];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => toStringOrNull(entry))
      .filter((entry): entry is string => Boolean(entry));
  }
  const single = toStringOrNull(value);
  return single ? [single] : [];
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toStringRecordOrNull(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) {
    return null;
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof key !== 'string' || key.trim().length === 0) {
      continue;
    }
    const normalizedValue = toStringOrNull(entry);
    if (!normalizedValue) {
      continue;
    }
    result[key] = normalizedValue;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function preferHigherSeverity(current: WorkflowEventSeverity, candidate: WorkflowEventSeverity): WorkflowEventSeverity {
  return SEVERITY_RANK[candidate] > SEVERITY_RANK[current] ? candidate : current;
}

function normalizeSeverityCandidate(value: unknown): WorkflowEventSeverity | null {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (SEVERITY_ALIASES[normalized]) {
      return SEVERITY_ALIASES[normalized];
    }
    if (/^-?\d+$/.test(normalized)) {
      const numeric = Number.parseInt(normalized, 10);
      return normalizeSeverityNumeric(numeric);
    }
    if (normalized.includes('fail') || normalized.includes('error') || normalized.includes('deadletter')) {
      return 'error';
    }
    if (normalized.includes('warn')) {
      return 'warning';
    }
    if (normalized.includes('debug') || normalized.includes('trace')) {
      return 'debug';
    }
    if (normalized.includes('success') || normalized.includes('ready')) {
      return 'info';
    }
    if (normalized.includes('critical') || normalized.includes('fatal')) {
      return 'critical';
    }
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return normalizeSeverityNumeric(value);
  }
  return null;
}

function normalizeSeverityNumeric(value: number): WorkflowEventSeverity {
  if (value >= 50) {
    return 'critical';
  }
  if (value >= 40) {
    return 'error';
  }
  if (value >= 30) {
    return 'warning';
  }
  if (value >= 20) {
    return 'info';
  }
  return 'debug';
}

function deriveSeverityFromType(type: string): WorkflowEventSeverity {
  const normalized = type.toLowerCase();
  if (
    normalized.includes('.failed') ||
    normalized.includes('.error') ||
    normalized.includes('.deadletter') ||
    normalized.includes('.cancelled') ||
    normalized.includes('.aborted')
  ) {
    return 'error';
  }
  if (
    normalized.includes('.warning') ||
    normalized.includes('.throttled') ||
    normalized.includes('.paused') ||
    normalized.includes('.retry')
  ) {
    return 'warning';
  }
  if (normalized.includes('.debug') || normalized.includes('.trace')) {
    return 'debug';
  }
  return 'info';
}

function collectSeverityCandidates(value: unknown, path: string[], candidates: WorkflowEventSeverity[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectSeverityCandidates(entry, path, candidates);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    const nextPath = [...path, key];
    if (SEVERITY_KEY_CANDIDATES.has(normalizedKey)) {
      const possible = normalizeSeverityCandidate(entry);
      if (possible) {
        candidates.push(possible);
      }
    }
    collectSeverityCandidates(entry, nextPath, candidates);
  }
}

function deriveSeverity(event: WorkflowEventRecord): WorkflowEventSeverity {
  const candidates: WorkflowEventSeverity[] = [];
  collectSeverityCandidates(event.metadata, ['metadata'], candidates);
  collectSeverityCandidates(event.payload, ['payload'], candidates);

  if (candidates.length > 0) {
    return candidates.reduce((acc, candidate) => preferHigherSeverity(acc, candidate), 'debug');
  }
  return deriveSeverityFromType(event.type);
}

function initLinkAccumulator(): LinkAccumulator {
  return {
    workflowDefinitionIds: new Set(),
    workflowIds: new Set(),
    workflowRunIds: new Set(),
    repositoryIds: new Set(),
    datasetIds: new Set(),
    datasetSlugs: new Set(),
    assetIds: new Set(),
    timestoreDatasetIds: new Set(),
    metastoreRecords: new Map(),
    filestoreNodes: new Map()
  };
}

function pathIncludes(path: string[], fragment: string): boolean {
  const normalized = fragment.toLowerCase();
  return path.some((segment) => segment.toLowerCase().includes(normalized));
}

function registerStringValues(
  values: string[],
  key: string,
  path: string[],
  acc: LinkAccumulator
): void {
  if (values.length === 0) {
    return;
  }
  const normalizedKey = normalizeKey(key);
  const parent = path.length > 1 ? normalizeKey(path[path.length - 2] ?? '') : '';

  const emit = (target: Set<string>) => {
    for (const value of values) {
      target.add(value);
    }
  };

  switch (normalizedKey) {
    case 'workflowdefinitionid':
      emit(acc.workflowDefinitionIds);
      return;
    case 'workflowrunid':
      emit(acc.workflowRunIds);
      return;
    case 'workflowid':
      emit(acc.workflowIds);
      return;
    case 'repositoryid':
    case 'repoid':
      emit(acc.repositoryIds);
      return;
    case 'datasetid':
    case 'datasetsid':
      emit(acc.datasetIds);
      return;
    case 'datasetslug':
      emit(acc.datasetSlugs);
      return;
    case 'assetid':
      emit(acc.assetIds);
      return;
    case 'timestoredatasetid':
      emit(acc.timestoreDatasetIds);
      return;
    case 'timestoredatasetslug':
      emit(acc.timestoreDatasetIds);
      emit(acc.datasetSlugs);
      return;
    case 'slug':
      if (pathIncludes(path, 'dataset') || parent === 'dataset') {
        emit(acc.datasetSlugs);
      }
      if (pathIncludes(path, 'timestore')) {
        emit(acc.timestoreDatasetIds);
      }
      return;
    case 'id': {
      if (parent.includes('workflowdefinition')) {
        emit(acc.workflowDefinitionIds);
        return;
      }
      if (parent.includes('workflowrun')) {
        emit(acc.workflowRunIds);
        return;
      }
      if (parent === 'workflow') {
        emit(acc.workflowIds);
        return;
      }
      if (parent.includes('repository')) {
        emit(acc.repositoryIds);
        return;
      }
      if (parent.includes('dataset')) {
        emit(acc.datasetIds);
        return;
      }
      if (parent.includes('asset')) {
        emit(acc.assetIds);
        return;
      }
      if (parent.includes('timestore')) {
        emit(acc.timestoreDatasetIds);
        return;
      }
      return;
    }
    default:
      if (normalizedKey.endsWith('workflowdefinition')) {
        emit(acc.workflowDefinitionIds);
        return;
      }
      if (normalizedKey.endsWith('workflowrun')) {
        emit(acc.workflowRunIds);
        return;
      }
      if (normalizedKey.endsWith('workflow')) {
        emit(acc.workflowIds);
        return;
      }
      if (normalizedKey.endsWith('repository')) {
        emit(acc.repositoryIds);
        return;
      }
      if (normalizedKey.endsWith('dataset')) {
        emit(acc.datasetIds);
        return;
      }
      if (normalizedKey.endsWith('asset')) {
        emit(acc.assetIds);
      }
  }
}

function registerMetastoreRecord(value: unknown, acc: LinkAccumulator): void {
  if (!isRecord(value)) {
    return;
  }
  const namespace = toStringOrNull(value.namespace);
  const recordKey = toStringOrNull(value.key);
  if (!namespace || !recordKey) {
    return;
  }
  const composite = `${namespace}::${recordKey}`;
  if (!acc.metastoreRecords.has(composite)) {
    acc.metastoreRecords.set(composite, { namespace, key: recordKey });
  }
}

function registerFilestoreNode(value: unknown, acc: LinkAccumulator): void {
  if (!isRecord(value)) {
    return;
  }
  const backendMountId = toNumberOrNull(value.backendMountId);
  if (backendMountId === null) {
    return;
  }
  const nodeIdRaw = value.nodeId;
  const nodeId = typeof nodeIdRaw === 'number' && Number.isFinite(nodeIdRaw) ? nodeIdRaw : null;
  const path = toStringOrNull(value.path) ?? null;
  const key = `${backendMountId}:${nodeId ?? 'null'}:${path ?? ''}`;
  if (!acc.filestoreNodes.has(key)) {
    acc.filestoreNodes.set(key, {
      backendMountId,
      nodeId,
      path
    });
  }
}

function collectLinkHints(value: unknown, path: string[], acc: LinkAccumulator): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectLinkHints(entry, path, acc);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  registerMetastoreRecord(value, acc);
  registerFilestoreNode(value, acc);

  for (const [key, entry] of Object.entries(value)) {
    const nextPath = [...path, key];
    const strings = toStringArray(entry);
    if (strings.length > 0) {
      registerStringValues(strings, key, nextPath, acc);
    }
    collectLinkHints(entry, nextPath, acc);
  }
}

function finalizeLinkHints(acc: LinkAccumulator): WorkflowEventLinkHints {
  const result: WorkflowEventLinkHints = {};
  if (acc.workflowDefinitionIds.size > 0) {
    result.workflowDefinitionIds = Array.from(acc.workflowDefinitionIds);
  }
  if (acc.workflowIds.size > 0) {
    result.workflowIds = Array.from(acc.workflowIds);
  }
  if (acc.workflowRunIds.size > 0) {
    result.workflowRunIds = Array.from(acc.workflowRunIds);
  }
  if (acc.repositoryIds.size > 0) {
    result.repositoryIds = Array.from(acc.repositoryIds);
  }
  if (acc.datasetIds.size > 0) {
    result.datasetIds = Array.from(acc.datasetIds);
  }
  if (acc.datasetSlugs.size > 0) {
    result.datasetSlugs = Array.from(acc.datasetSlugs);
  }
  if (acc.assetIds.size > 0) {
    result.assetIds = Array.from(acc.assetIds);
  }
  if (acc.timestoreDatasetIds.size > 0) {
    result.timestoreDatasetIds = Array.from(acc.timestoreDatasetIds);
  }
  if (acc.metastoreRecords.size > 0) {
    result.metastoreRecords = Array.from(acc.metastoreRecords.values());
  }
  if (acc.filestoreNodes.size > 0) {
    result.filestoreNodes = Array.from(acc.filestoreNodes.values());
  }
  return result;
}

function buildLinkHints(event: WorkflowEventRecord): WorkflowEventLinkHints {
  const acc = initLinkAccumulator();
  collectLinkHints(event.metadata, ['metadata'], acc);
  collectLinkHints(event.payload, ['payload'], acc);
  return finalizeLinkHints(acc);
}

function toAssetProduced(payload: unknown): AssetProducedEventData | null {
  if (!isRecord(payload)) {
    return null;
  }
  const assetId = toStringOrNull(payload.assetId);
  const workflowDefinitionId = toStringOrNull(payload.workflowDefinitionId);
  const workflowSlug = toStringOrNull(payload.workflowSlug);
  const workflowRunId = toStringOrNull(payload.workflowRunId);
  const workflowRunStepId = toStringOrNull(payload.workflowRunStepId);
  const stepId = toStringOrNull(payload.stepId);
  const producedAt = toStringOrNull(payload.producedAt);
  if (!assetId || !workflowDefinitionId || !workflowSlug || !workflowRunId || !workflowRunStepId || !stepId || !producedAt) {
    return null;
  }
  const freshness = isRecord(payload.freshness)
    ? {
        maxAgeMs: toNumberOrNull(payload.freshness.maxAgeMs),
        ttlMs: toNumberOrNull(payload.freshness.ttlMs),
        cadenceMs: toNumberOrNull(payload.freshness.cadenceMs)
      }
    : null;
  const partitionKey = toStringOrNull(payload.partitionKey);
  return {
    assetId,
    workflowDefinitionId,
    workflowSlug,
    workflowRunId,
    workflowRunStepId,
    stepId,
    producedAt,
    freshness,
    partitionKey
  } satisfies AssetProducedEventData;
}

function toAssetExpired(payload: unknown): AssetExpiredEventData | null {
  if (!isRecord(payload)) {
    return null;
  }
  const base = toAssetProduced(payload);
  if (!base) {
    return null;
  }
  const expiresAt = toStringOrNull(payload.expiresAt);
  const requestedAt = toStringOrNull(payload.requestedAt);
  const reasonValue = toStringOrNull(payload.reason);
  if (!expiresAt || !requestedAt || !reasonValue) {
    return null;
  }
  if (reasonValue !== 'ttl' && reasonValue !== 'cadence' && reasonValue !== 'manual') {
    return null;
  }
  return {
    ...base,
    expiresAt,
    requestedAt,
    reason: reasonValue
  } satisfies AssetExpiredEventData;
}

function toMetastoreRecordEvent(payload: unknown): MetastoreRecordEventData | null {
  if (!isRecord(payload)) {
    return null;
  }
  const namespace = toStringOrNull(payload.namespace);
  const key = toStringOrNull(payload.key);
  const actor = payload.actor == null ? null : toStringOrNull(payload.actor) ?? null;
  if (!namespace || !key) {
    return null;
  }
  const record = isRecord(payload.record) ? payload.record : null;
  if (!record) {
    return null;
  }
  const serialized: MetastoreRecordEventData['record'] = {
    namespace: toStringOrNull(record.namespace) ?? namespace,
    key: toStringOrNull(record.key) ?? key,
    metadata: isRecord(record.metadata) ? record.metadata : (record.metadata as Record<string, unknown> | undefined) ?? {},
    tags: Array.isArray(record.tags)
      ? record.tags
          .map((tag) => toStringOrNull(tag))
          .filter((tag): tag is string => Boolean(tag))
      : [],
    owner: record.owner == null ? null : toStringOrNull(record.owner),
    schemaHash: record.schemaHash == null ? null : toStringOrNull(record.schemaHash),
    version: toNumberOrNull(record.version) ?? 0,
    createdAt: toStringOrNull(record.createdAt) ?? new Date().toISOString(),
    updatedAt: toStringOrNull(record.updatedAt) ?? new Date().toISOString(),
    deletedAt: record.deletedAt == null ? null : toStringOrNull(record.deletedAt),
    createdBy: record.createdBy == null ? null : toStringOrNull(record.createdBy),
    updatedBy: record.updatedBy == null ? null : toStringOrNull(record.updatedBy)
  };
  const mode = payload.mode == null ? undefined : (toStringOrNull(payload.mode) as 'soft' | 'hard' | undefined);
  return {
    namespace,
    key,
    actor,
    mode,
    record: serialized
  } satisfies MetastoreRecordEventData;
}

function toFilestoreEvent(record: WorkflowEventRecord): WorkflowEventDerived | null {
  if (!record.type.startsWith('filestore.')) {
    return null;
  }
  try {
    const envelope = JSON.stringify({ event: { type: record.type, data: record.payload } });
    const parsed = parseFilestoreEventEnvelope(envelope);
    if (!parsed) {
      return null;
    }
    return {
      type: parsed.event.type,
      payload: parsed.event.data
    } satisfies WorkflowEventDerived;
  } catch {
    return null;
  }
}

function toTimestorePartitionCreated(payload: unknown): TimestorePartitionCreatedEventData | null {
  if (!isRecord(payload)) {
    return null;
  }
  const datasetId = toStringOrNull(payload.datasetId);
  const datasetSlug = toStringOrNull(payload.datasetSlug);
  const manifestId = toStringOrNull(payload.manifestId);
  const partitionId = toStringOrNull(payload.partitionId);
  const storageTargetId = toStringOrNull(payload.storageTargetId);
  const filePath = toStringOrNull(payload.filePath);
  const rowCount = toNumberOrNull(payload.rowCount);
  const fileSizeBytes = toNumberOrNull(payload.fileSizeBytes);
  const receivedAt = toStringOrNull(payload.receivedAt);
  const partitionKey = payload.partitionKey == null ? null : toStringOrNull(payload.partitionKey);
  const partitionKeyFields =
    toStringRecordOrNull(payload.partitionKeyFields ?? (payload as Record<string, unknown>).partition_key_fields) ?? null;
  const attributes =
    toStringRecordOrNull(payload.attributes ?? (payload as Record<string, unknown>).dimensions) ?? null;
  const checksum = payload.checksum == null ? null : toStringOrNull(payload.checksum);
  if (
    !datasetId ||
    !datasetSlug ||
    !manifestId ||
    !partitionId ||
    !storageTargetId ||
    !filePath ||
    rowCount === null ||
    fileSizeBytes === null ||
    !receivedAt
  ) {
    return null;
  }
  return {
    datasetId,
    datasetSlug,
    manifestId,
    partitionId,
    partitionKey,
    partitionKeyFields,
    storageTargetId,
    filePath,
    rowCount,
    fileSizeBytes,
    checksum,
    receivedAt,
    attributes
  } satisfies TimestorePartitionCreatedEventData;
}

function toTimestorePartitionDeleted(payload: unknown): TimestorePartitionDeletedEventData | null {
  if (!isRecord(payload)) {
    return null;
  }
  const datasetId = toStringOrNull(payload.datasetId);
  const datasetSlug = toStringOrNull(payload.datasetSlug);
  const manifestId = toStringOrNull(payload.manifestId);
  const partitionsRaw = Array.isArray(payload.partitions) ? payload.partitions : [];
  if (!datasetId || !datasetSlug || !manifestId) {
    return null;
  }
  const partitions = partitionsRaw
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      const id = toStringOrNull(entry.id);
      const storageTargetId = toStringOrNull(entry.storageTargetId);
      const partitionKey = entry.partitionKey == null ? null : toStringOrNull(entry.partitionKey);
      if (!id || !storageTargetId) {
        return null;
      }
      return {
        id,
        storageTargetId,
        partitionKey,
        startTime: entry.startTime == null ? null : toStringOrNull(entry.startTime),
        endTime: entry.endTime == null ? null : toStringOrNull(entry.endTime),
        filePath: toStringOrNull(entry.filePath) ?? '',
        fileSizeBytes: entry.fileSizeBytes == null ? null : toNumberOrNull(entry.fileSizeBytes),
        reason: entry.reason == null ? null : toStringOrNull(entry.reason)
      };
    })
    .filter((entry): entry is TimestorePartitionDeletedEventData['partitions'][number] => Boolean(entry));
  return {
    datasetId,
    datasetSlug,
    manifestId,
    partitions
  } satisfies TimestorePartitionDeletedEventData;
}

function toTimestoreDatasetExportCompleted(payload: unknown): TimestoreDatasetExportCompletedEventData | null {
  if (!isRecord(payload)) {
    return null;
  }
  const datasetId = toStringOrNull(payload.datasetId);
  const datasetSlug = toStringOrNull(payload.datasetSlug);
  const manifestId = toStringOrNull(payload.manifestId);
  const exportId = toStringOrNull(payload.exportId);
  const storageTargetId = toStringOrNull(payload.storageTargetId);
  const filePath = toStringOrNull(payload.filePath);
  const rowCount = toNumberOrNull(payload.rowCount);
  const fileSizeBytes = toNumberOrNull(payload.fileSizeBytes);
  const exportedAt = toStringOrNull(payload.exportedAt);
  if (!datasetId || !datasetSlug || !manifestId || !exportId || !storageTargetId || !filePath || rowCount === null || fileSizeBytes === null || !exportedAt) {
    return null;
  }
  return {
    datasetId,
    datasetSlug,
    manifestId,
    exportId,
    storageTargetId,
    filePath,
    rowCount,
    fileSizeBytes,
    exportedAt
  } satisfies TimestoreDatasetExportCompletedEventData;
}

function toDerivedEvent(event: WorkflowEventRecord): WorkflowEventDerived | null {
  switch (event.type) {
    case 'asset.produced': {
      const payload = toAssetProduced(event.payload);
      if (!payload) {
        return null;
      }
      return {
        type: event.type,
        payload
      } satisfies WorkflowEventDerived;
    }
    case 'asset.expired': {
      const payload = toAssetExpired(event.payload);
      if (!payload) {
        return null;
      }
      return {
        type: event.type,
        payload
      } satisfies WorkflowEventDerived;
    }
    case 'metastore.record.created':
    case 'metastore.record.updated':
    case 'metastore.record.deleted': {
      const payload = toMetastoreRecordEvent(event.payload);
      if (!payload) {
        return null;
      }
      return {
        type: event.type,
        payload
      } satisfies WorkflowEventDerived;
    }
    case 'timestore.partition.created': {
      const payload = toTimestorePartitionCreated(event.payload);
      if (!payload) {
        return null;
      }
      return {
        type: event.type,
        payload
      } satisfies WorkflowEventDerived;
    }
    case 'timestore.partition.deleted': {
      const payload = toTimestorePartitionDeleted(event.payload);
      if (!payload) {
        return null;
      }
      return {
        type: event.type,
        payload
      } satisfies WorkflowEventDerived;
    }
    case 'timestore.dataset.export.completed': {
      const payload = toTimestoreDatasetExportCompleted(event.payload);
      if (!payload) {
        return null;
      }
      return {
        type: event.type,
        payload
      } satisfies WorkflowEventDerived;
    }
    default:
      return toFilestoreEvent(event);
  }
}

export function buildWorkflowEventView(event: WorkflowEventRecord): WorkflowEventRecordView {
  const severity = deriveSeverity(event) ?? SEVERITY_DEFAULT;
  const links = buildLinkHints(event);
  const derived = toDerivedEvent(event);

  return {
    id: event.id,
    type: event.type,
    source: event.source,
    occurredAt: event.occurredAt,
    receivedAt: event.receivedAt,
    payload: event.payload,
    correlationId: event.correlationId ?? null,
    ttlMs: event.ttlMs ?? null,
    metadata: event.metadata ?? null,
    severity,
    links,
    derived: derived ?? null
  } satisfies WorkflowEventRecordView;
}

export function deriveWorkflowEventSubtype(event: WorkflowEventRecord): WorkflowEventDerived | null {
  return toDerivedEvent(event);
}

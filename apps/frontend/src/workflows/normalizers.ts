import {
  WORKFLOW_TIMELINE_TRIGGER_STATUSES,
  type WorkflowAssetAutoMaterialize,
  type WorkflowAssetDetail,
  type WorkflowAssetInventoryEntry,
  type WorkflowAssetPartitioning,
  type WorkflowAssetPartitions,
  type WorkflowAssetRoleDescriptor,
  type WorkflowAssetSnapshot,
  type WorkflowEventTrigger,
  type WorkflowEventTriggerPredicate,
  type WorkflowEventTriggerStatus,
  type WorkflowTriggerDelivery,
  type WorkflowEventSample,
  type WorkflowEventSchema,
  type WorkflowEventSchemaField,
  type WorkflowEventSchemaFieldKind,
  type WorkflowEventSchemaValueType,
  type WorkflowEventTriggerMetrics,
  type WorkflowEventSchedulerHealth,
  type WorkflowDefinition,
  type WorkflowSchedule,
  type WorkflowFanOutTemplateStep,
  type WorkflowFiltersState,
  type WorkflowAutoMaterializeOps,
  type WorkflowAutoMaterializeClaim,
  type WorkflowAutoMaterializeCooldown,
  type WorkflowRun,
  type WorkflowRunMetricsSummary,
  type WorkflowRunStatsSummary,
  type WorkflowRunStep,
  type WorkflowRuntimeSummary,
  type WorkflowTimelineEntry,
  type WorkflowTimelineSnapshot,
  type WorkflowTimelineMeta,
  type WorkflowTimelineTriggerSummary,
  type WorkflowTimelineEvent,
  type WorkflowTimelineRunEntry,
  type WorkflowTimelineTriggerEntry,
  type WorkflowTimelineSchedulerEntry,
  type RetryBacklog,
  type RetryBacklogSummary,
  type EventRetryBacklogEntry,
  type TriggerRetryBacklogEntry,
  type WorkflowStepRetryBacklogEntry,
  type WorkflowTimelineTriggerStatus
} from './types';
import type {
  WorkflowEventDerived,
  WorkflowEventLinkHints,
  WorkflowEventSeverity
} from '@apphub/shared/catalogEvents';

export type WorkflowSummary = {
  workflow: WorkflowDefinition;
  status: string;
  repos: string[];
  services: string[];
  tags: string[];
  runtime: WorkflowRuntimeSummary | undefined;
};

export function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry): entry is string => entry.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

const EVENT_SEVERITY_VALUES: WorkflowEventSeverity[] = ['critical', 'error', 'warning', 'info', 'debug'];
const EVENT_SEVERITY_SET = new Set<WorkflowEventSeverity>(EVENT_SEVERITY_VALUES);

function normalizeWorkflowEventSeverity(value: unknown): WorkflowEventSeverity | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase() as WorkflowEventSeverity;
  if (!EVENT_SEVERITY_SET.has(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeWorkflowEventLinkHints(raw: unknown): WorkflowEventLinkHints | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }

  const result: WorkflowEventLinkHints = {};
  const assign = (key: keyof WorkflowEventLinkHints) => {
    const value = record[key as string];
    const normalized = normalizeStringArray(value);
    if (normalized && normalized.length > 0) {
      (result as Record<string, unknown>)[key] = normalized;
    }
  };

  assign('workflowDefinitionIds');
  assign('workflowIds');
  assign('workflowRunIds');
  assign('repositoryIds');
  assign('datasetIds');
  assign('datasetSlugs');
  assign('assetIds');
  assign('timestoreDatasetIds');

  const metastoreRaw = record.metastoreRecords;
  if (Array.isArray(metastoreRaw)) {
    const entries = metastoreRaw
      .map((entry) => {
        const candidate = toRecord(entry);
        if (!candidate) {
          return null;
        }
        const namespace = typeof candidate.namespace === 'string' ? candidate.namespace : null;
        const key = typeof candidate.key === 'string' ? candidate.key : null;
        if (!namespace || !key) {
          return null;
        }
        return { namespace, key };
      })
      .filter((entry): entry is { namespace: string; key: string } => Boolean(entry));
    if (entries.length > 0) {
      result.metastoreRecords = entries;
    }
  }

  const filestoreRaw = record.filestoreNodes;
  if (Array.isArray(filestoreRaw)) {
    const entries = filestoreRaw
      .map((entry) => {
        const candidate = toRecord(entry);
        if (!candidate) {
          return null;
        }
        const backendMountIdRaw = candidate.backendMountId;
        const nodeIdRaw = candidate.nodeId;
        const backendMountId = typeof backendMountIdRaw === 'number' && Number.isFinite(backendMountIdRaw)
          ? backendMountIdRaw
          : Number.isFinite(Number(backendMountIdRaw))
            ? Number(backendMountIdRaw)
            : null;
        if (backendMountId === null) {
          return null;
        }
        const nodeId = typeof nodeIdRaw === 'number' && Number.isFinite(nodeIdRaw)
          ? nodeIdRaw
          : null;
        const path = typeof candidate.path === 'string' ? candidate.path : null;
        return {
          backendMountId,
          nodeId,
          path
        };
      })
      .filter((entry): entry is { backendMountId: number; nodeId: number | null; path: string | null } => Boolean(entry));
    if (entries.length > 0) {
      result.filestoreNodes = entries;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

function normalizeWorkflowEventDerived(raw: unknown): WorkflowEventDerived | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : null;
  if (!type) {
    return null;
  }
  return {
    type,
    payload: record.payload
  } as WorkflowEventDerived;
}

const TIMELINE_STATUS_SET = new Set<string>(WORKFLOW_TIMELINE_TRIGGER_STATUSES);

export function normalizeWorkflowSchedule(raw: unknown): WorkflowSchedule | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : null;
  const workflowDefinitionId = typeof record.workflowDefinitionId === 'string' ? record.workflowDefinitionId : null;
  const cron = typeof record.cron === 'string' ? record.cron : null;
  if (!id || !workflowDefinitionId || !cron) {
    return null;
  }

  const timezone = typeof record.timezone === 'string' ? record.timezone : null;
  const name = typeof record.name === 'string' ? record.name : null;
  const description = typeof record.description === 'string' ? record.description : null;
  const startWindow = typeof record.startWindow === 'string' ? record.startWindow : null;
  const endWindow = typeof record.endWindow === 'string' ? record.endWindow : null;
  const catchUp = Boolean(record.catchUp);
  const nextRunAt = typeof record.nextRunAt === 'string' ? record.nextRunAt : null;
  const catchupCursor = typeof record.catchupCursor === 'string' ? record.catchupCursor : null;
  const isActive = Boolean(record.isActive);
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : '';
  const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : '';

  const lastWindowRaw = toRecord(record.lastWindow);
  const lastWindow = lastWindowRaw
    ? {
        start: typeof lastWindowRaw.start === 'string' ? lastWindowRaw.start : null,
        end: typeof lastWindowRaw.end === 'string' ? lastWindowRaw.end : null
      }
    : null;

  const parameters = record.parameters ?? null;

  return {
    id,
    workflowDefinitionId,
    name,
    description,
    cron,
    timezone,
    parameters,
    startWindow,
    endWindow,
    catchUp,
    nextRunAt,
    lastWindow,
    catchupCursor,
    isActive,
    createdAt,
    updatedAt
  } satisfies WorkflowSchedule;
}

function normalizeFanOutTemplate(raw: unknown): WorkflowFanOutTemplateStep | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const template = raw as Record<string, unknown>;
  const id = typeof template.id === 'string' ? template.id : null;
  const name = typeof template.name === 'string' ? template.name : null;
  if (!id || !name) {
    return null;
  }
  const jobSlug = typeof template.jobSlug === 'string' ? template.jobSlug : undefined;
  const serviceSlug = typeof template.serviceSlug === 'string' ? template.serviceSlug : undefined;
  const rawType = typeof template.type === 'string' ? template.type.toLowerCase() : null;
  const normalizedType: WorkflowFanOutTemplateStep['type'] =
    rawType === 'service'
      ? 'service'
      : rawType === 'job'
        ? 'job'
        : serviceSlug
          ? 'service'
          : 'job';

  return {
    id,
    name,
    type: normalizedType,
    jobSlug,
    serviceSlug,
    description:
      typeof template.description === 'string'
        ? template.description
        : template.description === null
          ? null
          : undefined,
    dependsOn: normalizeStringArray(template.dependsOn),
    parameters: 'parameters' in template ? template.parameters : undefined,
    timeoutMs:
      typeof template.timeoutMs === 'number'
        ? template.timeoutMs
        : template.timeoutMs === null
          ? null
          : undefined,
    retryPolicy: 'retryPolicy' in template ? template.retryPolicy : undefined,
    storeResultAs: typeof template.storeResultAs === 'string' ? template.storeResultAs : undefined,
    requireHealthy: typeof template.requireHealthy === 'boolean' ? template.requireHealthy : undefined,
    allowDegraded: typeof template.allowDegraded === 'boolean' ? template.allowDegraded : undefined,
    captureResponse: typeof template.captureResponse === 'boolean' ? template.captureResponse : undefined,
    storeResponseAs: typeof template.storeResponseAs === 'string' ? template.storeResponseAs : undefined,
    request: 'request' in template ? template.request : undefined
  } satisfies WorkflowFanOutTemplateStep;
}

function normalizeNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeEventTriggerPredicate(raw: unknown): WorkflowEventTriggerPredicate | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const type = typeof record.type === 'string' ? record.type : 'jsonPath';
  if (type !== 'jsonPath') {
    return null;
  }
  const path = typeof record.path === 'string' ? record.path.trim() : '';
  if (!path) {
    return null;
  }
  const operator = typeof record.operator === 'string' ? record.operator : null;
  if (!operator) {
    return null;
  }
  const caseSensitive = typeof record.caseSensitive === 'boolean' ? record.caseSensitive : undefined;
  switch (operator) {
    case 'exists':
      return { type: 'jsonPath', path, operator: 'exists', ...(caseSensitive !== undefined ? { caseSensitive } : {}) };
    case 'equals':
    case 'notEquals': {
      if (!('value' in record)) {
        return null;
      }
      return {
        type: 'jsonPath',
        path,
        operator,
        value: record.value,
        ...(caseSensitive !== undefined ? { caseSensitive } : {})
      };
    }
    case 'in':
    case 'notIn': {
      const rawValues = Array.isArray(record.values) ? (record.values as unknown[]) : null;
      if (!rawValues || rawValues.length === 0) {
        return null;
      }
      return {
        type: 'jsonPath',
        path,
        operator,
        values: rawValues,
        ...(caseSensitive !== undefined ? { caseSensitive } : {})
      };
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const value = Number(record.value);
      if (!Number.isFinite(value)) {
        return null;
      }
      return {
        type: 'jsonPath',
        path,
        operator,
        value
      };
    }
    case 'contains': {
      if (!('value' in record)) {
        return null;
      }
      return {
        type: 'jsonPath',
        path,
        operator: 'contains',
        value: record.value,
        ...(caseSensitive !== undefined ? { caseSensitive } : {})
      };
    }
    case 'regex': {
      const pattern = typeof record.value === 'string' ? record.value : null;
      if (!pattern) {
        return null;
      }
      const flags = typeof record.flags === 'string' ? record.flags : undefined;
      return {
        type: 'jsonPath',
        path,
        operator: 'regex',
        value: pattern,
        ...(caseSensitive !== undefined ? { caseSensitive } : {}),
        ...(flags ? { flags } : {})
      };
    }
    default:
      return null;
  }
}

export function normalizeWorkflowEventTrigger(raw: unknown): WorkflowEventTrigger | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const id = typeof record.id === 'string' ? record.id : null;
  const workflowDefinitionId = typeof record.workflowDefinitionId === 'string' ? record.workflowDefinitionId : null;
  const eventType = typeof record.eventType === 'string' ? record.eventType : null;
  if (!id || !workflowDefinitionId || !eventType) {
    return null;
  }

  const rawPredicates = Array.isArray(record.predicates) ? record.predicates : [];
  const predicates = rawPredicates
    .map((entry) => normalizeEventTriggerPredicate(entry))
    .filter((entry): entry is WorkflowEventTriggerPredicate => Boolean(entry));

  const statusRaw = typeof record.status === 'string' ? record.status.toLowerCase() : 'active';
  const status: WorkflowEventTriggerStatus = statusRaw === 'disabled' ? 'disabled' : 'active';

  const parameterTemplate = 'parameterTemplate' in record ? record.parameterTemplate ?? null : null;
  const metadata = 'metadata' in record ? record.metadata ?? null : null;
  const throttleWindowMs = normalizeNullableNumber(record.throttleWindowMs);
  const throttleCount = normalizeNullableNumber(record.throttleCount);
  const maxConcurrency = normalizeNullableNumber(record.maxConcurrency);
  const idempotencyKeyExpression =
    typeof record.idempotencyKeyExpression === 'string' ? record.idempotencyKeyExpression : null;

  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString();
  const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : createdAt;

  return {
    id,
    workflowDefinitionId,
    version: typeof record.version === 'number' ? record.version : 1,
    status,
    name: typeof record.name === 'string' ? record.name : null,
    description: typeof record.description === 'string' ? record.description : null,
    eventType,
    eventSource: typeof record.eventSource === 'string' ? record.eventSource : null,
    predicates,
    parameterTemplate,
    throttleWindowMs,
    throttleCount,
    maxConcurrency,
    idempotencyKeyExpression,
    metadata,
    createdAt,
    updatedAt,
    createdBy: typeof record.createdBy === 'string' ? record.createdBy : null,
    updatedBy: typeof record.updatedBy === 'string' ? record.updatedBy : null
  } satisfies WorkflowEventTrigger;
}

export function normalizeWorkflowEventTriggers(raw: unknown): WorkflowEventTrigger[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => normalizeWorkflowEventTrigger(entry))
    .filter((entry): entry is WorkflowEventTrigger => Boolean(entry));
}

export function normalizeWorkflowTriggerDelivery(raw: unknown): WorkflowTriggerDelivery | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const id = typeof record.id === 'string' ? record.id : null;
  const triggerId = typeof record.triggerId === 'string' ? record.triggerId : null;
  const workflowDefinitionId = typeof record.workflowDefinitionId === 'string' ? record.workflowDefinitionId : null;
  const eventId = typeof record.eventId === 'string' ? record.eventId : null;
  if (!id || !triggerId || !workflowDefinitionId || !eventId) {
    return null;
  }
  const validStatuses = new Set([
    'pending',
    'matched',
    'throttled',
    'skipped',
    'launched',
    'failed'
  ] as const);
  const statusRaw = typeof record.status === 'string' ? record.status : 'pending';
  const status = validStatuses.has(statusRaw as WorkflowTriggerDelivery['status'])
    ? (statusRaw as WorkflowTriggerDelivery['status'])
    : 'pending';

  return {
    id,
    triggerId,
    workflowDefinitionId,
    eventId,
    status,
    attempts: typeof record.attempts === 'number' ? record.attempts : 0,
    lastError: typeof record.lastError === 'string' ? record.lastError : null,
    workflowRunId: typeof record.workflowRunId === 'string' ? record.workflowRunId : null,
    dedupeKey: typeof record.dedupeKey === 'string' ? record.dedupeKey : null,
    nextAttemptAt: typeof record.nextAttemptAt === 'string' ? record.nextAttemptAt : null,
    throttledUntil: typeof record.throttledUntil === 'string' ? record.throttledUntil : null,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString(),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString()
  } satisfies WorkflowTriggerDelivery;
}

export function normalizeWorkflowTriggerDeliveries(raw: unknown): WorkflowTriggerDelivery[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => normalizeWorkflowTriggerDelivery(entry))
    .filter((entry): entry is WorkflowTriggerDelivery => Boolean(entry));
}

export function normalizeWorkflowEventSample(raw: unknown): WorkflowEventSample | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const id = typeof record.id === 'string' ? record.id : null;
  const type = typeof record.type === 'string' ? record.type : null;
  const source = typeof record.source === 'string' ? record.source : null;
  const occurredAt = typeof record.occurredAt === 'string' ? record.occurredAt : null;
  const receivedAt = typeof record.receivedAt === 'string' ? record.receivedAt : null;
  if (!id || !type || !source || !occurredAt || !receivedAt) {
    return null;
  }
  return {
    id,
    type,
    source,
    occurredAt,
    receivedAt,
    payload: 'payload' in record ? record.payload : null,
    correlationId: typeof record.correlationId === 'string' ? record.correlationId : null,
    ttlMs: normalizeNullableNumber(record.ttlMs),
    metadata: 'metadata' in record ? record.metadata ?? null : null,
    severity: normalizeWorkflowEventSeverity(record.severity),
    links: normalizeWorkflowEventLinkHints(record.links),
    derived: normalizeWorkflowEventDerived(record.derived)
  } satisfies WorkflowEventSample;
}

export function normalizeWorkflowEventSamples(raw: unknown): WorkflowEventSample[] {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => normalizeWorkflowEventSample(entry))
      .filter((entry): entry is WorkflowEventSample => Boolean(entry));
  }
  const record = toRecord(raw);
  if (!record || !Array.isArray(record.events)) {
    return [];
  }
  return record.events
    .map((entry) => normalizeWorkflowEventSample(entry))
    .filter((entry): entry is WorkflowEventSample => Boolean(entry));
}

const EVENT_SCHEMA_VALUE_TYPES = new Set<WorkflowEventSchemaValueType>([
  'string',
  'number',
  'boolean',
  'null',
  'object',
  'array',
  'unknown'
]);

const EVENT_SCHEMA_FIELD_KINDS = new Set<WorkflowEventSchemaFieldKind>(['value', 'object', 'array']);

export function normalizeWorkflowEventSchemaField(raw: unknown): WorkflowEventSchemaField | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const pathSegments = Array.isArray(record.path)
    ? record.path.filter((segment): segment is string => typeof segment === 'string')
    : [];
  if (pathSegments.length === 0) {
    return null;
  }
  const jsonPath = typeof record.jsonPath === 'string' ? record.jsonPath : null;
  const liquidPath = typeof record.liquidPath === 'string' ? record.liquidPath : null;
  if (!jsonPath || !liquidPath) {
    return null;
  }
  const occurrencesValue = Number(record.occurrences);
  const occurrences = Number.isFinite(occurrencesValue) && occurrencesValue >= 0 ? Math.floor(occurrencesValue) : 0;
  const typesRaw = Array.isArray(record.types) ? record.types : [];
  const types = typesRaw
    .map((entry) => (typeof entry === 'string' ? entry : '').trim())
    .filter((entry): entry is WorkflowEventSchemaValueType => EVENT_SCHEMA_VALUE_TYPES.has(entry as WorkflowEventSchemaValueType));
  const kindRaw = typeof record.kind === 'string' ? record.kind : null;
  const kind = kindRaw && EVENT_SCHEMA_FIELD_KINDS.has(kindRaw as WorkflowEventSchemaFieldKind)
    ? (kindRaw as WorkflowEventSchemaFieldKind)
    : 'value';
  const examples = Array.isArray(record.examples) ? record.examples.slice(0, 5) : [];
  return {
    path: pathSegments,
    jsonPath,
    liquidPath,
    occurrences,
    types: types.length > 0 ? types : ['unknown'],
    kind,
    examples
  } satisfies WorkflowEventSchemaField;
}

export function normalizeWorkflowEventSchema(raw: unknown): WorkflowEventSchema | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const totalSamplesValue = Number(record.totalSamples);
  const totalSamples = Number.isFinite(totalSamplesValue) && totalSamplesValue >= 0
    ? Math.floor(totalSamplesValue)
    : 0;
  const fieldsRaw = Array.isArray(record.fields) ? record.fields : [];
  const fields = fieldsRaw
    .map((entry) => normalizeWorkflowEventSchemaField(entry))
    .filter((entry): entry is WorkflowEventSchemaField => Boolean(entry));
  return {
    totalSamples,
    fields
  } satisfies WorkflowEventSchema;
}

function normalizeQueueMetrics(raw: unknown): {
  processingAvgMs?: number | null;
  waitingAvgMs?: number | null;
} | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }

  const processing = normalizeNullableNumber(record.processingAvgMs);
  const waiting = normalizeNullableNumber(record.waitingAvgMs);

  if (processing === null && waiting === null) {
    return null;
  }

  return {
    processingAvgMs: processing,
    waitingAvgMs: waiting
  };
}

export function normalizeWorkflowEventHealth(raw: unknown): WorkflowEventSchedulerHealth | null {
  const root = toRecord(raw);
  const payload = toRecord(root?.data ?? root);
  if (!payload) {
    return null;
  }

  const queuesRaw = toRecord(payload.queues);
  const ingressQueues = toRecord(queuesRaw?.ingress) ?? {};
  const triggerQueues = toRecord(queuesRaw?.triggers) ?? {};
  const ingressMetrics = normalizeQueueMetrics(ingressQueues.metrics);
  const triggerMetrics = normalizeQueueMetrics(triggerQueues.metrics);

  const metricsRaw = toRecord(payload.metrics);
  const generatedAt = typeof metricsRaw?.generatedAt === 'string' ? metricsRaw.generatedAt : new Date().toISOString();

  const triggerMetricsEntries = Array.isArray(metricsRaw?.triggers) ? metricsRaw?.triggers : [];
  const triggers: Record<string, WorkflowEventTriggerMetrics> = {};
  for (const entry of triggerMetricsEntries as unknown[]) {
    const record = toRecord(entry);
    if (!record) {
      continue;
    }
    const triggerId = typeof record.triggerId === 'string' ? record.triggerId : null;
    if (!triggerId) {
      continue;
    }
    const countsRecord = toRecord(record.counts) ?? {};
    const counts = {
      filtered: Number(countsRecord.filtered) || 0,
      matched: Number(countsRecord.matched) || 0,
      launched: Number(countsRecord.launched) || 0,
      throttled: Number(countsRecord.throttled) || 0,
      skipped: Number(countsRecord.skipped) || 0,
      failed: Number(countsRecord.failed) || 0,
      paused: Number(countsRecord.paused) || 0
    } as Record<'filtered' | 'matched' | 'launched' | 'throttled' | 'skipped' | 'failed' | 'paused', number>;
    const lastStatus = typeof record.lastStatus === 'string' ? record.lastStatus : null;
    triggers[triggerId] = {
      counts,
      lastStatus: ['filtered', 'matched', 'launched', 'throttled', 'skipped', 'failed', 'paused'].includes(
        lastStatus ?? ''
      )
        ? (lastStatus as WorkflowEventTriggerMetrics['lastStatus'])
        : null,
      lastUpdatedAt: typeof record.lastUpdatedAt === 'string' ? record.lastUpdatedAt : null,
      lastError: typeof record.lastError === 'string' ? record.lastError : null
    } satisfies WorkflowEventTriggerMetrics;
  }

  const sourceMetricsEntries = Array.isArray(metricsRaw?.sources) ? metricsRaw.sources : [];
  const sources: WorkflowEventSchedulerHealth['sources'] = {};
  for (const entry of sourceMetricsEntries as unknown[]) {
    const record = toRecord(entry);
    if (!record) {
      continue;
    }
    const source = typeof record.source === 'string' ? record.source : null;
    if (!source) {
      continue;
    }
    sources[source] = {
      total: Number(record.total) || 0,
      throttled: Number(record.throttled) || 0,
      dropped: Number(record.dropped) || 0,
      failures: Number(record.failures) || 0,
      averageLagMs: normalizeNullableNumber(record.averageLagMs),
      lastLagMs: Number(record.lastLagMs) || 0,
      maxLagMs: Number(record.maxLagMs) || 0,
      lastEventAt: typeof record.lastEventAt === 'string' ? record.lastEventAt : null
    };
  }

  const pausedTriggerEntries = Array.isArray(payload.pausedTriggers) ? payload.pausedTriggers : [];
  const pausedTriggers: Record<string, { reason: string; until?: string }> = {};
  for (const entry of pausedTriggerEntries as unknown[]) {
    const record = toRecord(entry);
    if (!record) {
      continue;
    }
    const triggerId = typeof record.triggerId === 'string' ? record.triggerId : null;
    const reason = typeof record.reason === 'string' ? record.reason : null;
    if (!triggerId || !reason) {
      continue;
    }
    const until = typeof record.until === 'string' ? record.until : undefined;
    pausedTriggers[triggerId] = { reason, ...(until ? { until } : {}) };
  }

  const pausedSourcesEntries = Array.isArray(payload.pausedSources) ? payload.pausedSources : [];
  const pausedSources = pausedSourcesEntries
    .map((entry) => {
      const record = toRecord(entry);
      if (!record) {
        return null;
      }
      const source = typeof record.source === 'string' ? record.source : null;
      const reason = typeof record.reason === 'string' ? record.reason : null;
      if (!source || !reason) {
        return null;
      }
      const until = typeof record.until === 'string' ? record.until : undefined;
      const details = toRecord(record.details) ?? undefined;
      return { source, reason, ...(until ? { until } : {}), ...(details ? { details } : {}) };
    })
    .filter((entry): entry is { source: string; reason: string; until?: string; details?: Record<string, unknown> } =>
      Boolean(entry)
    );

  const rateLimitsEntries = Array.isArray(payload.rateLimits) ? payload.rateLimits : [];
  const rateLimits = rateLimitsEntries
    .map((entry) => {
      const record = toRecord(entry);
      if (!record) {
        return null;
      }
      const source = typeof record.source === 'string' ? record.source : null;
      if (!source) {
        return null;
      }
      const limit = Number(record.limit);
      const intervalMs = Number(record.intervalMs ?? record.windowMs);
      const pauseMs = Number(record.pauseMs ?? intervalMs);
      if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(intervalMs) || intervalMs <= 0) {
        return null;
      }
      return {
        source,
        limit: Math.floor(limit),
        intervalMs: Math.floor(intervalMs),
        pauseMs: Number.isFinite(pauseMs) && pauseMs > 0 ? Math.floor(pauseMs) : Math.floor(intervalMs)
      };
    })
    .filter(
      (entry): entry is { source: string; limit: number; intervalMs: number; pauseMs: number } => Boolean(entry)
    );

  const parseSummary = (input: unknown): RetryBacklogSummary => {
    const record = toRecord(input);
    if (!record) {
      return {
        total: 0,
        overdue: 0,
        nextAttemptAt: null
      } satisfies RetryBacklogSummary;
    }
    const total = Number(record.total ?? 0);
    const overdue = Number(record.overdue ?? 0);
    return {
      total: Number.isFinite(total) && total > 0 ? total : 0,
      overdue: Number.isFinite(overdue) && overdue > 0 ? overdue : 0,
      nextAttemptAt: typeof record.nextAttemptAt === 'string' ? record.nextAttemptAt : null
    } satisfies RetryBacklogSummary;
  };

  const normalizeEventRetryEntry = (entry: unknown): EventRetryBacklogEntry | null => {
    const record = toRecord(entry);
    if (!record) {
      return null;
    }
    const eventId = typeof record.eventId === 'string' ? record.eventId : null;
    if (!eventId) {
      return null;
    }
    const attempts = Number(record.attempts ?? 0);
    return {
      eventId,
      source: typeof record.source === 'string' ? record.source : 'unknown',
      eventType: typeof record.eventType === 'string' ? record.eventType : null,
      eventSource: typeof record.eventSource === 'string' ? record.eventSource : null,
      attempts: Number.isFinite(attempts) && attempts > 0 ? attempts : 0,
      nextAttemptAt: typeof record.nextAttemptAt === 'string' ? record.nextAttemptAt : null,
      overdue: Boolean(record.overdue),
      retryState:
        record.retryState === 'pending' || record.retryState === 'scheduled' || record.retryState === 'cancelled'
          ? (record.retryState as EventRetryBacklogEntry['retryState'])
          : 'pending',
      lastError: typeof record.lastError === 'string' ? record.lastError : null,
      metadata: 'metadata' in record ? record.metadata : null,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : ''
    } satisfies EventRetryBacklogEntry;
  };

  const normalizeTriggerRetryEntry = (entry: unknown): TriggerRetryBacklogEntry | null => {
    const record = toRecord(entry);
    if (!record) {
      return null;
    }
    const deliveryId = typeof record.deliveryId === 'string' ? record.deliveryId : null;
    const triggerId = typeof record.triggerId === 'string' ? record.triggerId : null;
    if (!deliveryId || !triggerId) {
      return null;
    }
    const attempts = Number(record.attempts ?? 0);
    const retryAttempts = Number(record.retryAttempts ?? 0);
    return {
      deliveryId,
      triggerId,
      workflowDefinitionId: typeof record.workflowDefinitionId === 'string' ? record.workflowDefinitionId : '',
      workflowSlug: typeof record.workflowSlug === 'string' ? record.workflowSlug : null,
      triggerName: typeof record.triggerName === 'string' ? record.triggerName : null,
      eventType: typeof record.eventType === 'string' ? record.eventType : null,
      eventSource: typeof record.eventSource === 'string' ? record.eventSource : null,
      attempts: Number.isFinite(attempts) && attempts > 0 ? attempts : 0,
      retryAttempts: Number.isFinite(retryAttempts) && retryAttempts > 0 ? retryAttempts : 0,
      nextAttemptAt: typeof record.nextAttemptAt === 'string' ? record.nextAttemptAt : null,
      overdue: Boolean(record.overdue),
      retryState:
        record.retryState === 'pending' || record.retryState === 'scheduled' || record.retryState === 'cancelled'
          ? (record.retryState as TriggerRetryBacklogEntry['retryState'])
          : 'pending',
      lastError: typeof record.lastError === 'string' ? record.lastError : null,
      workflowRunId: typeof record.workflowRunId === 'string' ? record.workflowRunId : null,
      dedupeKey: typeof record.dedupeKey === 'string' ? record.dedupeKey : null,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : ''
    } satisfies TriggerRetryBacklogEntry;
  };

  const normalizeWorkflowStepRetryEntry = (entry: unknown): WorkflowStepRetryBacklogEntry | null => {
    const record = toRecord(entry);
    if (!record) {
      return null;
    }
    const workflowRunStepId = typeof record.workflowRunStepId === 'string' ? record.workflowRunStepId : null;
    const workflowRunId = typeof record.workflowRunId === 'string' ? record.workflowRunId : null;
    const stepId = typeof record.stepId === 'string' ? record.stepId : null;
    if (!workflowRunStepId || !workflowRunId || !stepId) {
      return null;
    }
    const attempts = Number(record.attempt ?? record.attempts ?? 0);
    const retryAttempts = Number(record.retryAttempts ?? 0);
    const retryCount = Number(record.retryCount ?? 0);
    return {
      workflowRunStepId,
      workflowRunId,
      workflowDefinitionId: typeof record.workflowDefinitionId === 'string' ? record.workflowDefinitionId : '',
      workflowSlug: typeof record.workflowSlug === 'string' ? record.workflowSlug : null,
      stepId,
      status: typeof record.status === 'string' ? record.status : 'pending',
      attempt: Number.isFinite(attempts) && attempts > 0 ? attempts : 0,
      retryAttempts: Number.isFinite(retryAttempts) && retryAttempts > 0 ? retryAttempts : 0,
      nextAttemptAt: typeof record.nextAttemptAt === 'string' ? record.nextAttemptAt : null,
      overdue: Boolean(record.overdue),
      retryState:
        record.retryState === 'pending' || record.retryState === 'scheduled' || record.retryState === 'cancelled'
          ? (record.retryState as WorkflowStepRetryBacklogEntry['retryState'])
          : 'pending',
      retryCount: Number.isFinite(retryCount) && retryCount > 0 ? retryCount : 0,
      retryMetadata: 'retryMetadata' in record ? record.retryMetadata : null,
      errorMessage: typeof record.errorMessage === 'string' ? record.errorMessage : null,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : ''
    } satisfies WorkflowStepRetryBacklogEntry;
  };

  const retriesRecord = toRecord(payload.retries);
  const eventsRecord = toRecord(retriesRecord?.['events']);
  const triggersRecordValue = toRecord(retriesRecord?.['triggers']);
  const workflowStepsRecordValue = toRecord(retriesRecord?.['workflowSteps']);

  const eventsEntries = eventsRecord?.['entries'];
  const triggersEntries = triggersRecordValue?.['entries'];
  const workflowStepEntries = workflowStepsRecordValue?.['entries'];

  const eventsRetryBacklog: RetryBacklog<EventRetryBacklogEntry> = {
    summary: parseSummary(eventsRecord?.['summary']),
    entries: Array.isArray(eventsEntries)
      ? (eventsEntries as unknown[])
          .map((entry) => normalizeEventRetryEntry(entry))
          .filter((entry): entry is EventRetryBacklogEntry => Boolean(entry))
      : Array.isArray(retriesRecord?.['events'])
        ? (retriesRecord?.['events'] as unknown[])
            .map((entry) => normalizeEventRetryEntry(entry))
            .filter((entry): entry is EventRetryBacklogEntry => Boolean(entry))
        : []
  } satisfies RetryBacklog<EventRetryBacklogEntry>;

  const triggersRetryBacklog: RetryBacklog<TriggerRetryBacklogEntry> = {
    summary: parseSummary(triggersRecordValue?.['summary']),
    entries: Array.isArray(triggersEntries)
      ? (triggersEntries as unknown[])
          .map((entry) => normalizeTriggerRetryEntry(entry))
          .filter((entry): entry is TriggerRetryBacklogEntry => Boolean(entry))
      : Array.isArray(retriesRecord?.['triggers'])
        ? (retriesRecord?.['triggers'] as unknown[])
            .map((entry) => normalizeTriggerRetryEntry(entry))
            .filter((entry): entry is TriggerRetryBacklogEntry => Boolean(entry))
        : []
  } satisfies RetryBacklog<TriggerRetryBacklogEntry>;

  const workflowStepRetryBacklog: RetryBacklog<WorkflowStepRetryBacklogEntry> = {
    summary: parseSummary(workflowStepsRecordValue?.['summary']),
    entries: Array.isArray(workflowStepEntries)
      ? (workflowStepEntries as unknown[])
          .map((entry) => normalizeWorkflowStepRetryEntry(entry))
          .filter((entry): entry is WorkflowStepRetryBacklogEntry => Boolean(entry))
      : Array.isArray(retriesRecord?.['workflowSteps'])
        ? (retriesRecord?.['workflowSteps'] as unknown[])
            .map((entry) => normalizeWorkflowStepRetryEntry(entry))
            .filter((entry): entry is WorkflowStepRetryBacklogEntry => Boolean(entry))
        : []
  } satisfies RetryBacklog<WorkflowStepRetryBacklogEntry>;

  return {
    generatedAt,
    queues: {
      ingress: {
        mode:
          ingressQueues.mode === 'queue' || ingressQueues.mode === 'disabled'
            ? ingressQueues.mode
            : 'inline',
        counts:
          ingressQueues.counts && typeof ingressQueues.counts === 'object'
            ? (ingressQueues.counts as Record<string, number>)
            : undefined,
        metrics: ingressMetrics
      },
      triggers: {
        mode:
          triggerQueues.mode === 'queue' || triggerQueues.mode === 'disabled'
            ? triggerQueues.mode
            : 'inline',
        counts:
          triggerQueues.counts && typeof triggerQueues.counts === 'object'
            ? (triggerQueues.counts as Record<string, number>)
            : undefined,
        metrics: triggerMetrics
      }
    },
    triggers,
    sources,
    pausedTriggers,
    pausedSources,
    rateLimits,
    retries: {
      events: eventsRetryBacklog,
      triggers: triggersRetryBacklog,
      workflowSteps: workflowStepRetryBacklog
    }
  } satisfies WorkflowEventSchedulerHealth;
}

export function normalizeWorkflowDefinition(payload: unknown): WorkflowDefinition | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : null;
  const slug = typeof raw.slug === 'string' ? raw.slug : null;
  const name = typeof raw.name === 'string' ? raw.name : null;
  if (!id || !slug || !name) {
    return null;
  }

  const steps: WorkflowDefinition['steps'] = [];
  if (Array.isArray(raw.steps)) {
    for (const entry of raw.steps) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const step = entry as Record<string, unknown>;
      const stepId = typeof step.id === 'string' ? step.id : null;
      const stepName = typeof step.name === 'string' ? step.name : null;
      if (!stepId || !stepName) {
        continue;
      }
      const jobSlug = typeof step.jobSlug === 'string' ? step.jobSlug : undefined;
      const serviceSlug = typeof step.serviceSlug === 'string' ? step.serviceSlug : undefined;
      const rawType = typeof step.type === 'string' ? step.type.toLowerCase() : null;
      const description =
        typeof step.description === 'string'
          ? step.description
          : step.description === null
            ? null
            : undefined;
      const dependsOn = normalizeStringArray(step.dependsOn);
      const dependents = normalizeStringArray(step.dependents);

      if (rawType === 'fanout') {
        const fanOutStep = {
          id: stepId,
          name: stepName,
          type: 'fanout' as const,
          description,
          dependsOn,
          dependents,
          collection: 'collection' in step ? step.collection : undefined,
          template: normalizeFanOutTemplate(step.template),
          maxItems:
            typeof step.maxItems === 'number'
              ? step.maxItems
              : step.maxItems === null
                ? null
                : undefined,
          maxConcurrency:
            typeof step.maxConcurrency === 'number'
              ? step.maxConcurrency
              : step.maxConcurrency === null
                ? null
                : undefined,
          storeResultsAs: typeof step.storeResultsAs === 'string' ? step.storeResultsAs : undefined
        } satisfies WorkflowDefinition['steps'][number];
        steps.push(fanOutStep);
        continue;
      }

      const stepType =
        rawType === 'service'
          ? 'service'
          : rawType === 'job'
            ? 'job'
            : serviceSlug
              ? 'service'
              : 'job';

      const normalizedStep = {
        id: stepId,
        name: stepName,
        type: stepType,
        jobSlug,
        serviceSlug,
        description,
        dependsOn,
        dependents,
        parameters: 'parameters' in step ? step.parameters : undefined,
        timeoutMs:
          typeof step.timeoutMs === 'number'
            ? step.timeoutMs
            : step.timeoutMs === null
              ? null
              : undefined,
        retryPolicy: 'retryPolicy' in step ? step.retryPolicy : undefined,
        storeResultAs: typeof step.storeResultAs === 'string' ? step.storeResultAs : undefined,
        requireHealthy: typeof step.requireHealthy === 'boolean' ? step.requireHealthy : undefined,
        allowDegraded: typeof step.allowDegraded === 'boolean' ? step.allowDegraded : undefined,
        captureResponse: typeof step.captureResponse === 'boolean' ? step.captureResponse : undefined,
        storeResponseAs: typeof step.storeResponseAs === 'string' ? step.storeResponseAs : undefined,
        request: 'request' in step ? step.request : undefined
      } satisfies WorkflowDefinition['steps'][number];
      steps.push(normalizedStep);
    }
  }

  const triggers: WorkflowDefinition['triggers'] = [];
  if (Array.isArray(raw.triggers)) {
    for (const entry of raw.triggers) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const trigger = entry as Record<string, unknown>;
      const type = typeof trigger.type === 'string' ? trigger.type : null;
      if (!type) {
        continue;
      }
      triggers.push({
        type,
        options: 'options' in trigger ? trigger.options : undefined
      });
    }
  }

  const schedules: WorkflowSchedule[] = [];
  if (Array.isArray((raw as Record<string, unknown>).schedules)) {
    for (const entry of (raw as Record<string, unknown>).schedules as unknown[]) {
      const schedule = normalizeWorkflowSchedule(entry);
      if (schedule) {
        schedules.push(schedule);
      }
    }
  }

  return {
    id,
    slug,
    name,
    description: typeof raw.description === 'string' ? raw.description : null,
    version: typeof raw.version === 'number' ? raw.version : 1,
    steps,
    triggers,
    schedules,
    parametersSchema: raw.parametersSchema ?? null,
    defaultParameters: raw.defaultParameters ?? null,
    outputSchema: raw.outputSchema ?? null,
    metadata: raw.metadata ?? null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : ''
  };
}

function normalizeStatusCounts(value: unknown): Record<string, number> {
  const record = toRecord(value);
  if (!record) {
    return {};
  }
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (!key) {
      continue;
    }
    const count = typeof raw === 'number' ? raw : Number(raw ?? 0);
    if (Number.isFinite(count)) {
      result[key.toLowerCase()] = count;
    }
  }
  return result;
}

export function normalizeWorkflowRunStats(payload: unknown): WorkflowRunStatsSummary | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const workflowId = typeof raw.workflowId === 'string' ? raw.workflowId : null;
  const slug = typeof raw.slug === 'string' ? raw.slug : null;
  const rangeRaw = toRecord(raw.range);
  const rangeFrom = typeof rangeRaw?.from === 'string' ? rangeRaw.from : null;
  const rangeTo = typeof rangeRaw?.to === 'string' ? rangeRaw.to : null;
  const rangeKey = typeof rangeRaw?.key === 'string' ? rangeRaw.key : 'custom';
  if (!workflowId || !slug || !rangeFrom || !rangeTo) {
    return null;
  }
  const totalRunsRaw = typeof raw.totalRuns === 'number' ? raw.totalRuns : Number(raw.totalRuns ?? 0);
  const successRate = typeof raw.successRate === 'number' ? raw.successRate : 0;
  const failureRate = typeof raw.failureRate === 'number' ? raw.failureRate : 0;
  const averageDurationMs =
    typeof raw.averageDurationMs === 'number'
      ? raw.averageDurationMs
      : raw.averageDurationMs === null
        ? null
        : typeof raw.averageDurationMs === 'string'
          ? Number(raw.averageDurationMs)
          : null;
  const failureCategories: WorkflowRunStatsSummary['failureCategories'] = Array.isArray(
    raw.failureCategories
  )
    ? (raw.failureCategories as unknown[])
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }
          const item = entry as Record<string, unknown>;
          const category = typeof item.category === 'string' ? item.category : null;
          const count =
            typeof item.count === 'number' ? item.count : Number.isFinite(Number(item.count)) ? Number(item.count) : null;
          if (!category || count === null) {
            return null;
          }
          return { category, count };
        })
        .filter((entry): entry is { category: string; count: number } => Boolean(entry))
    : [];

  return {
    workflowId,
    slug,
    range: { from: rangeFrom, to: rangeTo, key: rangeKey },
    totalRuns: Number.isFinite(totalRunsRaw) ? totalRunsRaw : 0,
    statusCounts: normalizeStatusCounts(raw.statusCounts),
    successRate,
    failureRate,
    averageDurationMs: Number.isFinite(averageDurationMs ?? NaN) ? averageDurationMs : null,
    failureCategories
  } satisfies WorkflowRunStatsSummary;
}

export function normalizeWorkflowRunMetrics(payload: unknown): WorkflowRunMetricsSummary | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const workflowId = typeof raw.workflowId === 'string' ? raw.workflowId : null;
  const slug = typeof raw.slug === 'string' ? raw.slug : null;
  const rangeRaw = toRecord(raw.range);
  const rangeFrom = typeof rangeRaw?.from === 'string' ? rangeRaw.from : null;
  const rangeTo = typeof rangeRaw?.to === 'string' ? rangeRaw.to : null;
  const rangeKey = typeof rangeRaw?.key === 'string' ? rangeRaw.key : 'custom';
  if (!workflowId || !slug || !rangeFrom || !rangeTo) {
    return null;
  }

  const bucketInterval = typeof raw.bucketInterval === 'string' ? raw.bucketInterval : '1 hour';
  const bucketRecord = toRecord(raw.bucket);
  const bucket = bucketRecord
    ? {
        interval: typeof bucketRecord.interval === 'string' ? bucketRecord.interval : bucketInterval,
        key:
          typeof bucketRecord.key === 'string'
            ? bucketRecord.key
            : bucketRecord.key === null
              ? null
              : null
      }
    : undefined;

  const series: WorkflowRunMetricsSummary['series'] = Array.isArray(raw.series)
    ? (raw.series as unknown[])
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }
          const point = entry as Record<string, unknown>;
          const bucketStart = typeof point.bucketStart === 'string' ? point.bucketStart : null;
          const bucketEnd = typeof point.bucketEnd === 'string' ? point.bucketEnd : null;
          if (!bucketStart || !bucketEnd) {
            return null;
          }
          const totalRuns =
            typeof point.totalRuns === 'number'
              ? point.totalRuns
              : Number.isFinite(Number(point.totalRuns))
                ? Number(point.totalRuns)
                : 0;
          const averageDurationMs =
            typeof point.averageDurationMs === 'number'
              ? point.averageDurationMs
              : point.averageDurationMs === null
                ? null
                : typeof point.averageDurationMs === 'string'
                  ? Number(point.averageDurationMs)
                  : null;
          const rollingSuccessCount =
            typeof point.rollingSuccessCount === 'number'
              ? point.rollingSuccessCount
              : Number.isFinite(Number(point.rollingSuccessCount))
                ? Number(point.rollingSuccessCount)
                : 0;
          return {
            bucketStart,
            bucketEnd,
            totalRuns,
            statusCounts: normalizeStatusCounts(point.statusCounts),
            averageDurationMs: Number.isFinite(averageDurationMs ?? NaN) ? averageDurationMs : null,
            rollingSuccessCount
          } satisfies WorkflowRunMetricsSummary['series'][number];
        })
        .filter((entry): entry is WorkflowRunMetricsSummary['series'][number] => Boolean(entry))
    : [];

  return {
    workflowId,
    slug,
    range: { from: rangeFrom, to: rangeTo, key: rangeKey },
    bucketInterval,
    bucket,
    series
  } satisfies WorkflowRunMetricsSummary;
}

export function normalizeWorkflowRun(payload: unknown): WorkflowRun | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : null;
  const workflowDefinitionId =
    typeof raw.workflowDefinitionId === 'string' ? raw.workflowDefinitionId : null;
  const status = typeof raw.status === 'string' ? raw.status : null;
  if (!id || !workflowDefinitionId || !status) {
    return null;
  }
  const health = raw.health === 'degraded' || raw.health === 'healthy' ? (raw.health as WorkflowRun['health']) : 'healthy';
  const retrySummaryRaw = raw.retrySummary;
  const retrySummary: WorkflowRun['retrySummary'] = (() => {
    if (retrySummaryRaw && typeof retrySummaryRaw === 'object') {
      const record = retrySummaryRaw as Record<string, unknown>;
      const pendingSteps = Number(record.pendingSteps ?? record.pending ?? 0);
      const overdueSteps = Number(record.overdueSteps ?? record.overdue ?? 0);
      const nextAttempt = typeof record.nextAttemptAt === 'string' ? record.nextAttemptAt : null;
      return {
        pendingSteps: Number.isFinite(pendingSteps) && pendingSteps > 0 ? pendingSteps : 0,
        nextAttemptAt: nextAttempt,
        overdueSteps: Number.isFinite(overdueSteps) && overdueSteps > 0 ? overdueSteps : 0
      } satisfies WorkflowRun['retrySummary'];
    }
    return {
      pendingSteps: 0,
      nextAttemptAt: null,
      overdueSteps: 0
    } satisfies WorkflowRun['retrySummary'];
  })();
  return {
    id,
    workflowDefinitionId,
    status,
    health,
    currentStepId: typeof raw.currentStepId === 'string' ? raw.currentStepId : null,
    currentStepIndex: typeof raw.currentStepIndex === 'number' ? raw.currentStepIndex : null,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
    durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : null,
    errorMessage:
      typeof raw.errorMessage === 'string'
        ? raw.errorMessage
        : raw.errorMessage === null
          ? null
          : null,
    triggeredBy:
      typeof raw.triggeredBy === 'string'
        ? raw.triggeredBy
        : raw.triggeredBy === null
          ? null
          : null,
    partitionKey:
      typeof raw.partitionKey === 'string'
        ? raw.partitionKey
        : raw.partitionKey === null
          ? null
          : null,
    metrics:
      raw.metrics && typeof raw.metrics === 'object' && !Array.isArray(raw.metrics)
        ? (raw.metrics as { totalSteps?: number; completedSteps?: number })
        : null,
    parameters: raw.parameters ?? null,
    context: raw.context ?? null,
    output: raw.output ?? null,
    trigger: raw.trigger ?? null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    retrySummary
  };
}

export function normalizeWorkflowRunStep(payload: unknown): WorkflowRunStep | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : null;
  const workflowRunId = typeof raw.workflowRunId === 'string' ? raw.workflowRunId : null;
  const stepId = typeof raw.stepId === 'string' ? raw.stepId : null;
  const status = typeof raw.status === 'string' ? raw.status : null;
  const attempt = typeof raw.attempt === 'number' ? raw.attempt : null;
  if (!id || !workflowRunId || !stepId || attempt === null || !status) {
    return null;
  }
  return {
    id,
    workflowRunId,
    stepId,
    status,
    attempt,
    jobRunId: typeof raw.jobRunId === 'string' ? raw.jobRunId : null,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
    errorMessage:
      typeof raw.errorMessage === 'string'
        ? raw.errorMessage
        : raw.errorMessage === null
          ? null
          : null,
    logsUrl: typeof raw.logsUrl === 'string' ? raw.logsUrl : null,
    parameters: 'parameters' in raw ? raw.parameters : undefined,
    result: 'result' in raw ? raw.result : undefined,
    metrics: 'metrics' in raw ? raw.metrics : undefined,
    input: 'input' in raw ? raw.input : undefined,
    output: 'output' in raw ? raw.output : undefined,
    context: 'context' in raw ? raw.context : undefined,
    parentStepId:
      typeof raw.parentStepId === 'string'
        ? raw.parentStepId
        : raw.parentStepId === null
          ? null
          : null,
    fanoutIndex:
      typeof raw.fanoutIndex === 'number'
        ? raw.fanoutIndex
        : raw.fanoutIndex === null
          ? null
          : null,
    templateStepId:
      typeof raw.templateStepId === 'string'
        ? raw.templateStepId
        : raw.templateStepId === null
          ? null
          : null,
    retryState:
      raw.retryState === 'pending' || raw.retryState === 'scheduled' || raw.retryState === 'cancelled'
        ? (raw.retryState as WorkflowRunStep['retryState'])
        : undefined,
    retryAttempts: typeof raw.retryAttempts === 'number' ? raw.retryAttempts : undefined,
    nextAttemptAt:
      typeof raw.nextAttemptAt === 'string'
        ? raw.nextAttemptAt
        : raw.nextAttemptAt === null
          ? null
          : undefined,
    retryMetadata: 'retryMetadata' in raw ? raw.retryMetadata : undefined,
    retryCount: typeof raw.retryCount === 'number' ? raw.retryCount : undefined
  };
}

function normalizeAutoMaterializeClaim(payload: unknown): WorkflowAutoMaterializeClaim | null {
  const record = toRecord(payload);
  if (!record) {
    return null;
  }
  const reason = typeof record.reason === 'string' ? record.reason : null;
  const requestedAt = typeof record.requestedAt === 'string' ? record.requestedAt : null;
  const claimedAt = typeof record.claimedAt === 'string' ? record.claimedAt : null;
  const claimOwner = typeof record.claimOwner === 'string' ? record.claimOwner : null;
  if (!reason || !requestedAt || !claimedAt || !claimOwner) {
    return null;
  }
  return {
    workflowRunId:
      typeof record.workflowRunId === 'string' && record.workflowRunId.trim().length > 0
        ? record.workflowRunId
        : null,
    reason,
    assetId:
      typeof record.assetId === 'string' && record.assetId.trim().length > 0 ? record.assetId : null,
    partitionKey:
      typeof record.partitionKey === 'string' && record.partitionKey.trim().length > 0
        ? record.partitionKey
        : null,
    requestedAt,
    claimedAt,
    claimOwner,
    context: 'context' in record ? (record.context as unknown) : null
  };
}

function normalizeAutoMaterializeCooldown(payload: unknown): WorkflowAutoMaterializeCooldown | null {
  const record = toRecord(payload);
  if (!record) {
    return null;
  }
  const failures = typeof record.failures === 'number' && Number.isFinite(record.failures)
    ? Math.max(0, Math.floor(record.failures))
    : null;
  if (failures === null) {
    return null;
  }
  const nextEligibleAt =
    typeof record.nextEligibleAt === 'string' && record.nextEligibleAt.trim().length > 0
      ? record.nextEligibleAt
      : null;
  return {
    failures,
    nextEligibleAt
  };
}

export function normalizeWorkflowAutoMaterializeOps(payload: unknown): WorkflowAutoMaterializeOps | null {
  const root = toRecord(payload);
  if (!root) {
    return null;
  }
  const data = toRecord(root.data);
  if (!data) {
    return null;
  }
  const runs = Array.isArray(data.runs)
    ? data.runs
        .map((entry) => normalizeWorkflowRun(entry))
        .filter((run): run is WorkflowRun => Boolean(run))
    : [];
  const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString();
  const inFlight = 'inFlight' in data ? normalizeAutoMaterializeClaim(data.inFlight) : null;
  const cooldown = 'cooldown' in data ? normalizeAutoMaterializeCooldown(data.cooldown) : null;

  return {
    runs,
    inFlight,
    cooldown,
    updatedAt
  };
}

function getTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function sortRuns(runs: WorkflowRun[]): WorkflowRun[] {
  return runs
    .slice()
    .sort((a, b) => {
      const createdDiff = getTimestamp(b.createdAt) - getTimestamp(a.createdAt);
      if (createdDiff !== 0) {
        return createdDiff;
      }
      const startedDiff = getTimestamp(b.startedAt) - getTimestamp(a.startedAt);
      if (startedDiff !== 0) {
        return startedDiff;
      }
      return getTimestamp(b.updatedAt) - getTimestamp(a.updatedAt);
    });
}

export function summarizeWorkflowMetadata(workflow: WorkflowDefinition) {
  const metadata = toRecord(workflow.metadata);
  const repos = new Set<string>();
  const services = new Set<string>();
  const tags = new Set<string>();
  let status: string | undefined;

  const addString = (value: unknown, target: Set<string>) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      target.add(value.trim());
    }
  };

  if (metadata) {
    addString(metadata.repo, repos);
    addString(metadata.repository, repos);
    addString(metadata.repositoryUrl, repos);
    addString(metadata.repoUrl, repos);
    const source = toRecord(metadata.source);
    if (source) {
      addString(source.repo, repos);
      addString(source.repository, repos);
      addString(source.repositoryUrl, repos);
    }

    const tagsField = metadata.tags;
    if (typeof tagsField === 'string') {
      addString(tagsField, tags);
    } else if (Array.isArray(tagsField)) {
      for (const entry of tagsField) {
        if (typeof entry === 'string') {
          addString(entry, tags);
          continue;
        }
        const record = toRecord(entry);
        if (!record) {
          continue;
        }
        const key = typeof record.key === 'string' ? record.key : undefined;
        const value = typeof record.value === 'string' ? record.value : undefined;
        if (key && value) {
          tags.add(`${key}:${value}`);
        } else if (key) {
          tags.add(key);
        } else if (value) {
          tags.add(value);
        }
      }
    }

    const statusValue = metadata.status ?? metadata.latestStatus ?? metadata.state;
    if (typeof statusValue === 'string') {
      status = statusValue;
    }

    const serviceMeta = metadata.service ?? metadata.workflowService ?? metadata.targetService;
    addString(serviceMeta, services);
    if (typeof metadata.services === 'string') {
      addString(metadata.services, services);
    } else if (Array.isArray(metadata.services)) {
      for (const value of metadata.services) {
        addString(value, services);
      }
    }

    if (Array.isArray(metadata.stepSummaries)) {
      for (const entry of metadata.stepSummaries) {
        const record = toRecord(entry);
        if (!record) {
          continue;
        }
        addString(record.repo, repos);
        addString(record.service, services);
        addString(record.tag, tags);
      }
    }
  }

  for (const step of workflow.steps) {
    if (step.serviceSlug) {
      services.add(step.serviceSlug);
    }
  }

  return {
    repos: Array.from(repos),
    services: Array.from(services),
    tags: Array.from(tags),
    status: status ?? 'unknown'
  } satisfies Pick<WorkflowSummary, 'repos' | 'services' | 'tags' | 'status'>;
}

function normalizeAssetFreshnessValue(value: unknown): WorkflowAssetRoleDescriptor['freshness'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const freshness: WorkflowAssetRoleDescriptor['freshness'] = {};
  if (typeof record.maxAgeMs === 'number' && Number.isFinite(record.maxAgeMs)) {
    freshness.maxAgeMs = record.maxAgeMs;
  }
  if (typeof record.ttlMs === 'number' && Number.isFinite(record.ttlMs)) {
    freshness.ttlMs = record.ttlMs;
  }
  if (typeof record.cadenceMs === 'number' && Number.isFinite(record.cadenceMs)) {
    freshness.cadenceMs = record.cadenceMs;
  }
  return Object.keys(freshness).length > 0 ? freshness : null;
}

function normalizeAssetAutoMaterialize(value: unknown): WorkflowAssetAutoMaterialize | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }
  const auto: WorkflowAssetAutoMaterialize = {};
  if (typeof record.onUpstreamUpdate === 'boolean') {
    auto.onUpstreamUpdate = record.onUpstreamUpdate;
  }
  if (typeof record.priority === 'number' && Number.isFinite(record.priority)) {
    auto.priority = record.priority;
  }
  return Object.keys(auto).length > 0 ? auto : null;
}

function normalizeAssetPartitioning(value: unknown): WorkflowAssetPartitioning | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }
  const type = typeof record.type === 'string' ? record.type : null;
  if (type === 'timeWindow') {
    const granularity = typeof record.granularity === 'string' ? record.granularity : null;
    if (
      granularity !== 'minute' &&
      granularity !== 'hour' &&
      granularity !== 'day' &&
      granularity !== 'week' &&
      granularity !== 'month'
    ) {
      return null;
    }
    return {
      type: 'timeWindow',
      granularity,
      timezone: typeof record.timezone === 'string' ? record.timezone : null,
      format: typeof record.format === 'string' ? record.format : null,
      lookbackWindows:
        typeof record.lookbackWindows === 'number' && Number.isFinite(record.lookbackWindows)
          ? record.lookbackWindows
          : null
    };
  }
  if (type === 'static') {
    const keys = Array.isArray(record.keys)
      ? record.keys.filter((key): key is string => typeof key === 'string' && key.length > 0)
      : null;
    if (!keys || keys.length === 0) {
      return null;
    }
    return {
      type: 'static',
      keys
    };
  }
  if (type === 'dynamic') {
    const partitioning: WorkflowAssetPartitioning = {
      type: 'dynamic',
      maxKeys:
        typeof record.maxKeys === 'number' && Number.isFinite(record.maxKeys) ? record.maxKeys : null,
      retentionDays:
        typeof record.retentionDays === 'number' && Number.isFinite(record.retentionDays)
          ? record.retentionDays
          : null
    };
    return partitioning;
  }
  return null;
}

function normalizeAssetRoleDescriptor(raw: unknown): WorkflowAssetRoleDescriptor | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const stepId = typeof record.stepId === 'string' ? record.stepId : null;
  if (!stepId) {
    return null;
  }
  const stepName = typeof record.stepName === 'string' ? record.stepName : stepId;
  const rawType = typeof record.stepType === 'string' ? record.stepType.toLowerCase() : null;
  const stepType: WorkflowAssetRoleDescriptor['stepType'] =
    rawType === 'service' ? 'service' : rawType === 'fanout' ? 'fanout' : 'job';

  return {
    stepId,
    stepName,
    stepType,
    schema: 'schema' in record ? record.schema : null,
    freshness: normalizeAssetFreshnessValue(record.freshness),
    autoMaterialize: normalizeAssetAutoMaterialize(record.autoMaterialize),
    partitioning: normalizeAssetPartitioning(record.partitioning)
  };
}

function normalizeAssetSnapshot(raw: unknown): WorkflowAssetSnapshot | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const runId = typeof record.runId === 'string' ? record.runId : null;
  const stepId = typeof record.stepId === 'string' ? record.stepId : null;
  const producedAt = typeof record.producedAt === 'string' ? record.producedAt : null;
  if (!runId || !stepId || !producedAt) {
    return null;
  }
  const runStatus = typeof record.runStatus === 'string' ? record.runStatus : 'unknown';
  const stepStatus = typeof record.stepStatus === 'string' ? record.stepStatus : 'unknown';
  const stepName = typeof record.stepName === 'string' ? record.stepName : stepId;
  const rawType = typeof record.stepType === 'string' ? record.stepType.toLowerCase() : null;
  const stepType: WorkflowAssetSnapshot['stepType'] =
    rawType === 'service' ? 'service' : rawType === 'fanout' ? 'fanout' : 'job';

  return {
    runId,
    runStatus,
    stepId,
    stepName,
    stepType,
    stepStatus,
    producedAt,
    payload: 'payload' in record ? record.payload : null,
    schema: 'schema' in record ? record.schema : null,
    freshness: normalizeAssetFreshnessValue(record.freshness),
    partitionKey: typeof record.partitionKey === 'string' ? record.partitionKey : null,
    runStartedAt: typeof record.runStartedAt === 'string' ? record.runStartedAt : null,
    runCompletedAt: typeof record.runCompletedAt === 'string' ? record.runCompletedAt : null
  };
}

export function normalizeWorkflowAssetInventoryResponse(payload: unknown): WorkflowAssetInventoryEntry[] {
  const root = toRecord(payload);
  if (!root) {
    return [];
  }
  const data = toRecord(root.data);
  if (!data) {
    return [];
  }
  const entries = Array.isArray(data.assets) ? data.assets : [];
  const normalized: WorkflowAssetInventoryEntry[] = [];
  for (const entry of entries) {
    const record = toRecord(entry);
    if (!record) {
      continue;
    }
    const assetId = typeof record.assetId === 'string' ? record.assetId : '';
    if (!assetId) {
      continue;
    }
    const producers = Array.isArray(record.producers)
      ? record.producers
          .map(normalizeAssetRoleDescriptor)
          .filter((value): value is WorkflowAssetRoleDescriptor => Boolean(value))
      : [];
    const consumers = Array.isArray(record.consumers)
      ? record.consumers
          .map(normalizeAssetRoleDescriptor)
          .filter((value): value is WorkflowAssetRoleDescriptor => Boolean(value))
      : [];
    const latest = 'latest' in record ? normalizeAssetSnapshot(record.latest) : null;
    const available = Boolean(record.available);
    normalized.push({ assetId, producers, consumers, latest, available });
  }
  return normalized;
}

export function normalizeWorkflowAssetDetailResponse(payload: unknown): WorkflowAssetDetail | null {
  const root = toRecord(payload);
  if (!root) {
    return null;
  }
  const data = toRecord(root.data);
  if (!data) {
    return null;
  }
  const assetId = typeof data.assetId === 'string' ? data.assetId : null;
  if (!assetId) {
    return null;
  }
  const producers = Array.isArray(data.producers)
    ? data.producers
        .map(normalizeAssetRoleDescriptor)
        .filter((value): value is WorkflowAssetRoleDescriptor => Boolean(value))
    : [];
  const consumers = Array.isArray(data.consumers)
    ? data.consumers
        .map(normalizeAssetRoleDescriptor)
        .filter((value): value is WorkflowAssetRoleDescriptor => Boolean(value))
    : [];
  const historyEntries = Array.isArray(data.history) ? data.history : [];
  const history = historyEntries
    .map(normalizeAssetSnapshot)
    .filter((value): value is WorkflowAssetSnapshot => Boolean(value));
  const limit = typeof data.limit === 'number' && Number.isFinite(data.limit) ? data.limit : history.length;

  return {
    assetId,
    producers,
    consumers,
    history,
    limit
  };
}

export function normalizeWorkflowAssetPartitionsResponse(payload: unknown): WorkflowAssetPartitions | null {
  const root = toRecord(payload);
  if (!root) {
    return null;
  }
  const data = toRecord(root.data);
  if (!data) {
    return null;
  }
  const assetId = typeof data.assetId === 'string' ? data.assetId : null;
  if (!assetId) {
    return null;
  }
  const partitioning = normalizeAssetPartitioning(data.partitioning);
  const partitionsEntries = Array.isArray(data.partitions) ? data.partitions : [];
  const partitions = partitionsEntries
    .map((entry) => {
      const record = toRecord(entry);
      if (!record) {
        return null;
      }
      const materializations =
        typeof record.materializations === 'number' && Number.isFinite(record.materializations)
          ? record.materializations
          : 0;
      const latest = 'latest' in record ? normalizeAssetSnapshot(record.latest) : null;
      const isStale = record.isStale === true;
      const staleRecord = toRecord(record.staleMetadata);
      const staleMetadata = staleRecord
        ? {
            requestedAt:
              typeof staleRecord.requestedAt === 'string' ? staleRecord.requestedAt : new Date(0).toISOString(),
            requestedBy:
              typeof staleRecord.requestedBy === 'string' && staleRecord.requestedBy.trim().length > 0
                ? staleRecord.requestedBy
                : null,
            note:
              typeof staleRecord.note === 'string' && staleRecord.note.trim().length > 0
                ? staleRecord.note
                : null
          }
        : null;
      const partitionKeyValue =
        typeof record.partitionKey === 'string' && record.partitionKey.trim().length > 0
          ? record.partitionKey
          : null;
      const parameters = 'parameters' in record ? (record.parameters as unknown) : null;
      const parametersSource =
        typeof record.parametersSource === 'string' && record.parametersSource.trim().length > 0
          ? record.parametersSource
          : null;
      const parametersCapturedAt =
        typeof record.parametersCapturedAt === 'string' ? record.parametersCapturedAt : null;
      const parametersUpdatedAt =
        typeof record.parametersUpdatedAt === 'string' ? record.parametersUpdatedAt : null;
      return {
        partitionKey: partitionKeyValue,
        materializations,
        latest,
        isStale,
        staleMetadata,
        parameters,
        parametersSource,
        parametersCapturedAt,
        parametersUpdatedAt
      };
    })
    .filter((value): value is WorkflowAssetPartitions['partitions'][number] => Boolean(value));

  return {
    assetId,
    partitioning,
    partitions
  };
}

function normalizeTimelineTriggerSummary(raw: unknown): WorkflowTimelineTriggerSummary | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const id = typeof record.id === 'string' ? record.id : null;
  if (!id) {
    return null;
  }
  const eventType = typeof record.eventType === 'string' ? record.eventType : 'unknown';
  const eventSource = typeof record.eventSource === 'string' ? record.eventSource : null;
  const name = typeof record.name === 'string' ? record.name : null;
  const statusRaw = typeof record.status === 'string' ? record.status : 'active';
  const status: WorkflowTimelineTriggerSummary['status'] = statusRaw === 'disabled' ? 'disabled' : 'active';
  return {
    id,
    name,
    eventType,
    eventSource,
    status
  } satisfies WorkflowTimelineTriggerSummary;
}

function normalizeTimelineEvent(raw: unknown): WorkflowTimelineEvent | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const id = typeof record.id === 'string' ? record.id : null;
  const type = typeof record.type === 'string' ? record.type : null;
  const source = typeof record.source === 'string' ? record.source : null;
  const occurredAt = typeof record.occurredAt === 'string' ? record.occurredAt : null;
  const receivedAt = typeof record.receivedAt === 'string' ? record.receivedAt : null;
  if (!id || !type || !source || !occurredAt || !receivedAt) {
    return null;
  }
  const correlationId = typeof record.correlationId === 'string' ? record.correlationId : null;
  const ttlValue = Number(record.ttlMs);
  const ttlMs = Number.isFinite(ttlValue) ? ttlValue : null;
  const payload = 'payload' in record ? record.payload : null;
  const metadata = 'metadata' in record ? record.metadata : null;
  return {
    id,
    type,
    source,
    occurredAt,
    receivedAt,
    payload,
    correlationId,
    ttlMs,
    metadata
  } satisfies WorkflowTimelineEvent;
}

function normalizeTimelineEntry(raw: unknown): WorkflowTimelineEntry | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const kind = typeof record.kind === 'string' ? record.kind : null;
  const id = typeof record.id === 'string' ? record.id : null;
  const timestamp = typeof record.timestamp === 'string' ? record.timestamp : null;
  if (!kind || !id || !timestamp) {
    return null;
  }

  if (kind === 'run') {
    const run = normalizeWorkflowRun(record.run);
    if (!run) {
      return null;
    }
    return {
      kind: 'run',
      id,
      timestamp,
      run
    } satisfies WorkflowTimelineRunEntry;
  }

  if (kind === 'trigger') {
    const delivery = normalizeWorkflowTriggerDelivery(record.delivery);
    if (!delivery) {
      return null;
    }
    const trigger = 'trigger' in record ? normalizeTimelineTriggerSummary(record.trigger) : null;
    const event = 'event' in record ? normalizeTimelineEvent(record.event) : null;
    return {
      kind: 'trigger',
      id,
      timestamp,
      delivery,
      trigger,
      event
    } satisfies WorkflowTimelineTriggerEntry;
  }

  if (kind === 'scheduler') {
    const category = typeof record.category === 'string' ? record.category : null;
    if (
      category !== 'trigger_failure' &&
      category !== 'trigger_paused' &&
      category !== 'source_paused'
    ) {
      return null;
    }
    const entry: WorkflowTimelineSchedulerEntry = {
      kind: 'scheduler',
      id,
      timestamp,
      category
    };
    if ('trigger' in record) {
      const trigger = normalizeTimelineTriggerSummary(record.trigger);
      if (trigger) {
        entry.trigger = trigger;
      }
    }
    if (category === 'source_paused' && typeof record.source === 'string') {
      entry.source = record.source;
    }
    if (typeof record.reason === 'string') {
      entry.reason = record.reason;
    } else if (record.reason === null) {
      entry.reason = null;
    }
    const failuresValue = Number(record.failures);
    if (Number.isFinite(failuresValue)) {
      entry.failures = failuresValue;
    }
    if (typeof record.until === 'string') {
      entry.until = record.until;
    } else if (record.until === null) {
      entry.until = null;
    }
    if (record.details && typeof record.details === 'object' && !Array.isArray(record.details)) {
      entry.details = record.details as Record<string, unknown>;
    } else if (record.details === null) {
      entry.details = null;
    }
    return entry;
  }

  return null;
}

export function normalizeWorkflowTimeline(raw: unknown): WorkflowTimelineSnapshot | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }

  const workflowRecord = toRecord(record.workflow);
  if (!workflowRecord) {
    return null;
  }
  const workflowId = typeof workflowRecord.id === 'string' ? workflowRecord.id : null;
  const workflowSlug = typeof workflowRecord.slug === 'string' ? workflowRecord.slug : null;
  const workflowName = typeof workflowRecord.name === 'string' ? workflowRecord.name : null;
  if (!workflowId || !workflowSlug || !workflowName) {
    return null;
  }

  const rangeRecord = toRecord(record.range);
  const rangeFrom = typeof rangeRecord?.from === 'string' ? rangeRecord.from : null;
  const rangeTo = typeof rangeRecord?.to === 'string' ? rangeRecord.to : null;
  if (!rangeFrom || !rangeTo) {
    return null;
  }

  const entriesRaw = Array.isArray(record.entries) ? record.entries : [];
  const entries = entriesRaw
    .map((entry) => normalizeTimelineEntry(entry))
    .filter((entry): entry is WorkflowTimelineEntry => Boolean(entry));

  return {
    workflow: {
      id: workflowId,
      slug: workflowSlug,
      name: workflowName
    },
    range: {
      from: rangeFrom,
      to: rangeTo
    },
    entries
  } satisfies WorkflowTimelineSnapshot;
}

export function normalizeWorkflowTimelineMeta(raw: unknown): WorkflowTimelineMeta | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }

  const countsRecord = toRecord(record.counts);
  const runsValue = Number(countsRecord?.runs ?? 0);
  const triggerDeliveriesValue = Number(countsRecord?.triggerDeliveries ?? 0);
  const schedulerSignalsValue = Number(countsRecord?.schedulerSignals ?? 0);

  const statusesRaw = Array.isArray(record.appliedTriggerStatuses) ? record.appliedTriggerStatuses : [];
  const appliedTriggerStatuses: WorkflowTimelineTriggerStatus[] = [];
  for (const status of statusesRaw) {
    if (typeof status !== 'string') {
      continue;
    }
    const normalized = status.trim().toLowerCase();
    if (TIMELINE_STATUS_SET.has(normalized)) {
      appliedTriggerStatuses.push(normalized as WorkflowTimelineTriggerStatus);
    }
  }

  const limitValue = Number(record.limit ?? 0);
  const limit = Number.isFinite(limitValue) && limitValue > 0 ? Math.floor(limitValue) : 0;

  return {
    counts: {
      runs: Number.isFinite(runsValue) ? runsValue : 0,
      triggerDeliveries: Number.isFinite(triggerDeliveriesValue) ? triggerDeliveriesValue : 0,
      schedulerSignals: Number.isFinite(schedulerSignalsValue) ? schedulerSignalsValue : 0
    },
    appliedTriggerStatuses,
    limit
  } satisfies WorkflowTimelineMeta;
}

export function buildFilterOptions(values: string[]): Array<{ value: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function buildStatusOptions(summaries: WorkflowSummary[]): Array<{ value: string; label: string; count: number }> {
  return buildFilterOptions(summaries.map((summary) => summary.status.toLowerCase())).map((option) => ({
    ...option,
    label: option.label.toUpperCase()
  }));
}

export function filterSummaries(
  summaries: WorkflowSummary[],
  filters: WorkflowFiltersState,
  searchTerm: string
): WorkflowSummary[] {
  const normalizedSearch = searchTerm.trim().toLowerCase();
  return summaries.filter((summary) => {
    if (filters.statuses.length > 0 && !filters.statuses.includes(summary.status.toLowerCase())) {
      return false;
    }
    if (filters.repos.length > 0 && summary.repos.every((repo) => !filters.repos.includes(repo))) {
      return false;
    }
    if (filters.services.length > 0 && summary.services.every((service) => !filters.services.includes(service))) {
      return false;
    }
    if (filters.tags.length > 0 && summary.tags.every((tag) => !filters.tags.includes(tag))) {
      return false;
    }
    if (!normalizedSearch) {
      return true;
    }
    const haystacks = [
      summary.workflow.name,
      summary.workflow.slug,
      summary.workflow.description ?? '',
      summary.status,
      ...summary.repos,
      ...summary.services,
      ...summary.tags
    ]
      .filter(Boolean)
      .map((value) => value.toLowerCase());
    return haystacks.some((text) => text.includes(normalizedSearch));
  });
}

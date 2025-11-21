import type {
  WorkflowEventDerived,
  WorkflowEventLinkHints,
  WorkflowEventSeverity as CoreWorkflowEventSeverity
} from '@apphub/shared/coreEvents';

export type WorkflowEventSeverity = CoreWorkflowEventSeverity;

export type WorkflowFanOutTemplateStep = {
  id: string;
  name: string;
  type?: 'job' | 'service';
  jobSlug?: string;
  serviceSlug?: string;
  description?: string | null;
  dependsOn?: string[];
  parameters?: unknown;
  timeoutMs?: number | null;
  retryPolicy?: unknown;
  storeResultAs?: string;
  requireHealthy?: boolean;
  allowDegraded?: boolean;
  captureResponse?: boolean;
  storeResponseAs?: string;
  request?: unknown;
  bundle?: WorkflowStepBundle | null;
};

export type WorkflowDefinitionStep = {
  id: string;
  name: string;
  type?: 'job' | 'service' | 'fanout';
  jobSlug?: string;
  serviceSlug?: string;
  description?: string | null;
  dependsOn?: string[];
  dependents?: string[];
  parameters?: unknown;
  timeoutMs?: number | null;
  retryPolicy?: unknown;
  storeResultAs?: string;
  storeResultsAs?: string;
  requireHealthy?: boolean;
  allowDegraded?: boolean;
  captureResponse?: boolean;
  storeResponseAs?: string;
  request?: unknown;
  collection?: unknown;
  template?: WorkflowFanOutTemplateStep | null;
  maxItems?: number | null;
  maxConcurrency?: number | null;
  bundle?: WorkflowStepBundle | null;
};

export type WorkflowStepBundle = {
  slug: string;
  version?: string | null;
  strategy?: 'pinned' | 'latest';
  exportName?: string | null;
};

export type WorkflowTrigger = {
  type: string;
  options?: unknown;
};

export type WorkflowEventTriggerPredicate =
  | {
      type: 'jsonPath';
      path: string;
      operator: 'exists';
      caseSensitive?: boolean;
    }
  | {
      type: 'jsonPath';
      path: string;
      operator: 'equals' | 'notEquals';
      value: unknown;
      caseSensitive?: boolean;
    }
  | {
      type: 'jsonPath';
      path: string;
      operator: 'in' | 'notIn';
      values: unknown[];
      caseSensitive?: boolean;
    }
  | {
      type: 'jsonPath';
      path: string;
      operator: 'gt' | 'gte' | 'lt' | 'lte';
      value: number;
    }
  | {
      type: 'jsonPath';
      path: string;
      operator: 'contains';
      value: unknown;
      caseSensitive?: boolean;
    }
  | {
      type: 'jsonPath';
      path: string;
      operator: 'regex';
      value: string;
      caseSensitive?: boolean;
      flags?: string;
    };

export type WorkflowEventTriggerStatus = 'active' | 'disabled';

export type WorkflowEventTrigger = {
  id: string;
  workflowDefinitionId: string;
  version: number;
  status: WorkflowEventTriggerStatus;
  name: string | null;
  description: string | null;
  eventType: string;
  eventSource: string | null;
  predicates: WorkflowEventTriggerPredicate[];
  parameterTemplate: unknown;
  runKeyTemplate: string | null;
  throttleWindowMs: number | null;
  throttleCount: number | null;
  maxConcurrency: number | null;
  idempotencyKeyExpression: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
};

export type WorkflowTriggerDelivery = {
  id: string;
  triggerId: string;
  workflowDefinitionId: string;
  eventId: string;
  status: 'pending' | 'matched' | 'throttled' | 'skipped' | 'launched' | 'failed';
  attempts: number;
  lastError: string | null;
  workflowRunId: string | null;
  dedupeKey: string | null;
  nextAttemptAt: string | null;
  throttledUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowEventSample = {
  id: string;
  type: string;
  source: string;
  occurredAt: string;
  receivedAt: string;
  payload: unknown;
  correlationId: string | null;
  ttlMs: number | null;
  metadata: unknown;
  severity: WorkflowEventSeverity | null;
  links: WorkflowEventLinkHints | null;
  derived: WorkflowEventDerived | null;
};

export type WorkflowEventSchemaValueType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'unknown';

export type WorkflowEventSchemaFieldKind = 'value' | 'object' | 'array';

export type WorkflowEventSchemaField = {
  path: string[];
  jsonPath: string;
  liquidPath: string;
  occurrences: number;
  types: WorkflowEventSchemaValueType[];
  kind: WorkflowEventSchemaFieldKind;
  examples: unknown[];
};

export type WorkflowEventSchema = {
  totalSamples: number;
  fields: WorkflowEventSchemaField[];
};

export type WorkflowEventTriggerMetrics = {
  counts: Record<'filtered' | 'matched' | 'launched' | 'throttled' | 'skipped' | 'failed' | 'paused', number>;
  lastStatus: 'filtered' | 'matched' | 'launched' | 'throttled' | 'skipped' | 'failed' | 'paused' | null;
  lastUpdatedAt: string | null;
  lastError: string | null;
};

export type RetryBacklogSummary = {
  total: number;
  overdue: number;
  nextAttemptAt: string | null;
};

export type RetryBacklog<TEntry> = {
  summary: RetryBacklogSummary;
  entries: TEntry[];
};

export type EventRetryBacklogEntry = {
  eventId: string;
  source: string;
  eventType: string | null;
  eventSource: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  overdue: boolean;
  retryState: 'pending' | 'scheduled' | 'cancelled';
  lastError: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
};

export type TriggerRetryBacklogEntry = {
  deliveryId: string;
  triggerId: string;
  workflowDefinitionId: string;
  workflowSlug: string | null;
  triggerName: string | null;
  eventType: string | null;
  eventSource: string | null;
  attempts: number;
  retryAttempts: number;
  nextAttemptAt: string | null;
  overdue: boolean;
  retryState: 'pending' | 'scheduled' | 'cancelled';
  lastError: string | null;
  workflowRunId: string | null;
  dedupeKey: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowStepRetryBacklogEntry = {
  workflowRunStepId: string;
  workflowRunId: string;
  workflowDefinitionId: string;
  workflowSlug: string | null;
  stepId: string;
  status: string;
  attempt: number;
  retryAttempts: number;
  nextAttemptAt: string | null;
  overdue: boolean;
  retryState: 'pending' | 'scheduled' | 'cancelled';
  retryCount: number;
  retryMetadata: unknown;
  errorMessage: string | null;
  updatedAt: string;
};

export type WorkflowEventSchedulerHealth = {
  generatedAt: string;
  queues: {
    ingress: {
      mode: 'inline' | 'queue' | 'disabled';
      counts?: Record<string, number>;
      metrics?: {
        processingAvgMs?: number | null;
        waitingAvgMs?: number | null;
      } | null;
    };
    triggers: {
      mode: 'inline' | 'queue' | 'disabled';
      counts?: Record<string, number>;
      metrics?: {
        processingAvgMs?: number | null;
        waitingAvgMs?: number | null;
      } | null;
    };
  };
  triggers: Record<string, WorkflowEventTriggerMetrics>;
  sources: Record<
    string,
    {
      total: number;
      throttled: number;
      dropped: number;
      failures: number;
      averageLagMs: number | null;
      lastLagMs: number;
      maxLagMs: number;
      lastEventAt: string | null;
    }
  >;
  pausedTriggers: Record<string, { reason: string; until?: string }>;
  pausedSources: Array<{ source: string; reason: string; until?: string; details?: Record<string, unknown> }>;
  rateLimits: Array<{ source: string; limit: number; intervalMs: number; pauseMs: number }>;
  retries: {
    events: RetryBacklog<EventRetryBacklogEntry>;
    triggers: RetryBacklog<TriggerRetryBacklogEntry>;
    workflowSteps: RetryBacklog<WorkflowStepRetryBacklogEntry>;
  };
};

export const WORKFLOW_TIMELINE_TRIGGER_STATUSES = [
  'pending',
  'matched',
  'throttled',
  'skipped',
  'launched',
  'failed'
] as const;

export type WorkflowTimelineTriggerStatus = (typeof WORKFLOW_TIMELINE_TRIGGER_STATUSES)[number];

export const WORKFLOW_TIMELINE_RANGE_KEYS = ['1h', '3h', '6h', '12h', '24h', '3d', '7d'] as const;

export type WorkflowTimelineRangeKey = (typeof WORKFLOW_TIMELINE_RANGE_KEYS)[number];

export type WorkflowTimelineTriggerSummary = {
  id: string;
  name: string | null;
  eventType: string;
  eventSource: string | null;
  status: WorkflowEventTriggerStatus;
};

export type WorkflowTimelineEvent = {
  id: string;
  type: string;
  source: string;
  occurredAt: string;
  receivedAt: string;
  payload: unknown;
  correlationId: string | null;
  ttlMs: number | null;
  metadata: unknown;
};

export type WorkflowTimelineRunEntry = {
  kind: 'run';
  id: string;
  timestamp: string;
  run: WorkflowRun;
};

export type WorkflowTimelineTriggerEntry = {
  kind: 'trigger';
  id: string;
  timestamp: string;
  delivery: WorkflowTriggerDelivery;
  trigger: WorkflowTimelineTriggerSummary | null;
  event: WorkflowTimelineEvent | null;
};

export type WorkflowTimelineSchedulerEntry = {
  kind: 'scheduler';
  id: string;
  timestamp: string;
  category: 'trigger_failure' | 'trigger_paused' | 'source_paused';
  trigger?: WorkflowTimelineTriggerSummary;
  source?: string;
  reason?: string | null;
  failures?: number;
  until?: string | null;
  details?: Record<string, unknown> | null;
};

export type WorkflowTimelineEntry =
  | WorkflowTimelineRunEntry
  | WorkflowTimelineTriggerEntry
  | WorkflowTimelineSchedulerEntry;

export type WorkflowTimelineSnapshot = {
  workflow: {
    id: string;
    slug: string;
    name: string;
  };
  range: {
    from: string;
    to: string;
  };
  entries: WorkflowTimelineEntry[];
};

export type WorkflowTimelineMeta = {
  counts: {
    runs: number;
    triggerDeliveries: number;
    schedulerSignals: number;
  };
  appliedTriggerStatuses: WorkflowTimelineTriggerStatus[];
  limit: number;
};

export type WorkflowSchedule = {
  id: string;
  workflowDefinitionId: string;
  name: string | null;
  description: string | null;
  cron: string;
  timezone: string | null;
  parameters: unknown;
  startWindow: string | null;
  endWindow: string | null;
  catchUp: boolean;
  nextRunAt: string | null;
  lastWindow: {
    start: string | null;
    end: string | null;
  } | null;
  catchupCursor: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowDefinition = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  version: number;
  steps: WorkflowDefinitionStep[];
  triggers: WorkflowTrigger[];
  schedules: WorkflowSchedule[];
  parametersSchema: unknown;
  defaultParameters: unknown;
  outputSchema: unknown;
  metadata: unknown;
  dag?: {
    adjacency: Record<string, string[]>;
    roots: string[];
    topologicalOrder: string[];
    edges: number;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowRun = {
  id: string;
  workflowDefinitionId: string;
  status: string;
  runKey: string | null;
  health: 'healthy' | 'degraded';
  currentStepId: string | null;
  currentStepIndex: number | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  triggeredBy: string | null;
  partitionKey: string | null;
  metrics: { totalSteps?: number; completedSteps?: number } | null;
  parameters: unknown;
  context: unknown;
  trigger: unknown;
  output: unknown;
  createdAt: string;
  updatedAt: string;
  retrySummary: {
    pendingSteps: number;
    nextAttemptAt: string | null;
    overdueSteps: number;
  };
};

export type WorkflowAutoMaterializeClaim = {
  workflowRunId: string | null;
  reason: string;
  assetId: string | null;
  partitionKey: string | null;
  requestedAt: string;
  claimedAt: string;
  claimOwner: string;
  context: unknown;
};

export type WorkflowAutoMaterializeCooldown = {
  failures: number;
  nextEligibleAt: string | null;
};

export type WorkflowAutoMaterializeOps = {
  runs: WorkflowRun[];
  inFlight: WorkflowAutoMaterializeClaim | null;
  cooldown: WorkflowAutoMaterializeCooldown | null;
  updatedAt: string;
};

export type WorkflowRunStep = {
  id: string;
  workflowRunId: string;
  stepId: string;
  status: string;
  attempt: number;
  jobRunId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  logsUrl: string | null;
  parameters?: unknown;
  result?: unknown;
  metrics?: unknown;
  input?: unknown;
  output?: unknown;
  context?: unknown;
  parentStepId?: string | null;
  fanoutIndex?: number | null;
  templateStepId?: string | null;
  retryState?: 'pending' | 'scheduled' | 'cancelled';
  retryAttempts?: number;
  nextAttemptAt?: string | null;
  retryMetadata?: unknown;
  retryCount?: number;
  resolutionError?: boolean;
};

export type WorkflowAssetFreshness = {
  maxAgeMs?: number | null;
  ttlMs?: number | null;
  cadenceMs?: number | null;
};

export type WorkflowAssetAutoMaterialize = {
  enabled?: boolean | null;
  onUpstreamUpdate?: boolean | null;
  priority?: number | null;
  parameterDefaults?: unknown;
};

export type WorkflowAssetPartitioning =
  | {
      type: 'timeWindow';
      granularity: 'minute' | 'hour' | 'day' | 'week' | 'month';
      timezone?: string | null;
      format?: string | null;
      lookbackWindows?: number | null;
    }
  | {
      type: 'static';
      keys: string[];
    }
  | {
      type: 'dynamic';
      maxKeys?: number | null;
      retentionDays?: number | null;
    };

export type WorkflowAssetRoleDescriptor = {
  stepId: string;
  stepName: string;
  stepType: 'job' | 'service' | 'fanout';
  schema: unknown | null;
  freshness: WorkflowAssetFreshness | null;
  autoMaterialize: WorkflowAssetAutoMaterialize | null;
  partitioning: WorkflowAssetPartitioning | null;
};

export type WorkflowAssetSnapshot = {
  runId: string;
  runStatus: string;
  stepId: string;
  stepName: string;
  stepType: 'job' | 'service' | 'fanout';
  stepStatus: string;
  producedAt: string;
  payload: unknown;
  schema: unknown;
  freshness: WorkflowAssetFreshness | null;
  partitionKey: string | null;
  runStartedAt: string | null;
  runCompletedAt: string | null;
};

export type WorkflowAssetInventoryEntry = {
  assetId: string;
  producers: WorkflowAssetRoleDescriptor[];
  consumers: WorkflowAssetRoleDescriptor[];
  latest: WorkflowAssetSnapshot | null;
  available: boolean;
};

export type WorkflowAssetHistoryEntry = WorkflowAssetSnapshot;

export type WorkflowAssetDetail = {
  assetId: string;
  producers: WorkflowAssetRoleDescriptor[];
  consumers: WorkflowAssetRoleDescriptor[];
  history: WorkflowAssetHistoryEntry[];
  limit: number;
};

export type WorkflowAssetPartitionSummary = {
  partitionKey: string | null;
  materializations: number;
  latest: WorkflowAssetSnapshot | null;
  isStale: boolean;
  staleMetadata: {
    requestedAt: string;
    requestedBy: string | null;
    note: string | null;
  } | null;
  parameters: unknown;
  parametersSource: string | null;
  parametersCapturedAt: string | null;
  parametersUpdatedAt: string | null;
};

export type WorkflowAssetPartitions = {
  assetId: string;
  partitioning: WorkflowAssetPartitioning | null;
  partitions: WorkflowAssetPartitionSummary[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    nextOffset: number | null;
  };
};

export type WorkflowFiltersState = {
  statuses: string[];
  repos: string[];
  services: string[];
  tags: string[];
};

export type WorkflowRuntimeSummary = {
  runId?: string;
  runKey?: string | null;
  status?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  triggeredBy?: string | null;
};

export type WorkflowOwnerMetadata = {
  name?: string | null;
  contact?: string | null;
};

export type WorkflowMetadata = Record<string, unknown> & {
  owner?: WorkflowOwnerMetadata | null;
  tags?: string[];
  status?: string;
  ownerName?: string | null;
  ownerContact?: string | null;
  versionNote?: string | null;
};

export type WorkflowDraftStepType = 'job' | 'service';

export type WorkflowDraftStep = {
  id: string;
  name: string;
  type: WorkflowDraftStepType;
  jobSlug?: string;
  serviceSlug?: string;
  description?: string | null;
  dependsOn: string[];
  parameters: unknown;
  timeoutMs: number | null;
  retryPolicy: unknown;
  storeResultAs?: string;
  requireHealthy?: boolean;
  allowDegraded?: boolean;
  captureResponse?: boolean;
  storeResponseAs?: string;
  request?: unknown;
  parametersText?: string;
  parametersError?: string | null;
  requestBodyText?: string;
  requestBodyError?: string | null;
  bundle?: WorkflowStepBundle | null;
};

export type WorkflowDraft = {
  slug: string;
  name: string;
  description: string | null;
  ownerName: string;
  ownerContact: string;
  tags: string[];
  tagsInput?: string;
  version: number;
  versionNote: string;
  steps: WorkflowDraftStep[];
  triggers: WorkflowTrigger[];
  parametersSchema: Record<string, unknown> | null;
  defaultParameters: unknown;
  metadata: WorkflowMetadata | null;
  parametersSchemaText?: string;
  parametersSchemaError?: string | null;
  defaultParametersText?: string;
  defaultParametersError?: string | null;
};

export type WorkflowAnalyticsRangeKey = '24h' | '7d' | '30d' | 'custom';

export type WorkflowRunFailureCategory = {
  category: string;
  count: number;
};

export type WorkflowRunStatsSummary = {
  workflowId: string;
  slug: string;
  range: { from: string; to: string; key: string };
  totalRuns: number;
  statusCounts: Record<string, number>;
  successRate: number;
  failureRate: number;
  averageDurationMs: number | null;
  failureCategories: WorkflowRunFailureCategory[];
};

export type WorkflowRunMetricsPoint = {
  bucketStart: string;
  bucketEnd: string;
  totalRuns: number;
  statusCounts: Record<string, number>;
  averageDurationMs: number | null;
  rollingSuccessCount: number;
};

export type WorkflowRunMetricsSummary = {
  workflowId: string;
  slug: string;
  range: { from: string; to: string; key: string };
  bucketInterval: string;
  bucket?: { interval: string; key: string | null };
  series: WorkflowRunMetricsPoint[];
};

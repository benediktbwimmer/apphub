export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type WorkflowTopologyGraphVersion = 'v1' | 'v2';

export type WorkflowTopologyAnnotations = {
  tags: string[];
  ownerName?: string | null;
  ownerContact?: string | null;
  team?: string | null;
  domain?: string | null;
  environment?: string | null;
  slo?: string | null;
};

export type WorkflowTopologyAssetFreshness = {
  maxAgeMs?: number | null;
  ttlMs?: number | null;
  cadenceMs?: number | null;
};

export type WorkflowTopologyAssetAutoMaterialize = {
  onUpstreamUpdate?: boolean | null;
  priority?: number | null;
  parameterDefaults?: JsonValue | null;
};

export type WorkflowTopologyAssetPartitioning =
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

export type WorkflowTopologyWorkflowNode = {
  id: string;
  slug: string;
  name: string;
  version: number;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown> | null;
  annotations: WorkflowTopologyAnnotations;
};

export type WorkflowTopologyTriggerSchedule = {
  cron: string;
  timezone?: string | null;
  startWindow?: string | null;
  endWindow?: string | null;
  catchUp?: boolean | null;
};

export type WorkflowTopologyDefinitionTriggerNode = {
  id: string;
  workflowId: string;
  kind: 'definition';
  triggerType: string;
  options: JsonValue | null;
  schedule: WorkflowTopologyTriggerSchedule | null;
};

export type WorkflowTopologyEventTriggerPredicate =
  | {
      type: 'jsonPath';
      path: string;
      operator: 'exists';
    }
  | {
      type: 'jsonPath';
      path: string;
      operator: 'equals' | 'notEquals';
      value: JsonValue;
      caseSensitive?: boolean;
    }
  | {
      type: 'jsonPath';
      path: string;
      operator: 'in' | 'notIn';
      values: JsonValue[];
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
      value: JsonValue;
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

export type WorkflowTopologyEventTriggerNode = {
  id: string;
  workflowId: string;
  kind: 'event';
  name: string | null;
  description: string | null;
  status: 'active' | 'disabled';
  eventType: string;
  eventSource: string | null;
  predicates: WorkflowTopologyEventTriggerPredicate[];
  parameterTemplate: JsonValue | null;
  runKeyTemplate: string | null;
  throttleWindowMs: number | null;
  throttleCount: number | null;
  maxConcurrency: number | null;
  idempotencyKeyExpression: string | null;
  metadata: JsonValue | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
};

export type WorkflowTopologyTriggerNode =
  | WorkflowTopologyDefinitionTriggerNode
  | WorkflowTopologyEventTriggerNode;

export type WorkflowTopologyScheduleNode = {
  id: string;
  workflowId: string;
  name: string | null;
  description: string | null;
  cron: string;
  timezone: string | null;
  parameters: JsonValue | null;
  startWindow: string | null;
  endWindow: string | null;
  catchUp: boolean;
  nextRunAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowTopologyJobStepRuntime = {
  type: 'job';
  jobSlug: string;
  bundleStrategy?: 'latest' | 'pinned';
  bundleSlug?: string | null;
  bundleVersion?: string | null;
  exportName?: string | null;
  timeoutMs?: number | null;
};

export type WorkflowTopologyServiceStepRuntime = {
  type: 'service';
  serviceSlug: string;
  timeoutMs?: number | null;
  requireHealthy?: boolean | null;
  allowDegraded?: boolean | null;
  captureResponse?: boolean | null;
};

export type WorkflowTopologyStepTemplate = {
  id: string;
  name: string | null;
  runtime: WorkflowTopologyJobStepRuntime | WorkflowTopologyServiceStepRuntime;
};

export type WorkflowTopologyFanOutStepRuntime = {
  type: 'fanout';
  collection: string | JsonValue;
  maxItems?: number | null;
  maxConcurrency?: number | null;
  storeResultsAs?: string | null;
  template: WorkflowTopologyStepTemplate;
};

export type WorkflowTopologyStepRuntime =
  | WorkflowTopologyJobStepRuntime
  | WorkflowTopologyServiceStepRuntime
  | WorkflowTopologyFanOutStepRuntime;

export type WorkflowTopologyStepNode = {
  id: string;
  workflowId: string;
  name: string;
  description: string | null;
  type: 'job' | 'service' | 'fanout';
  dependsOn: string[];
  dependents: string[];
  runtime: WorkflowTopologyStepRuntime;
};

export type WorkflowTopologyAssetNode = {
  id: string;
  assetId: string;
  normalizedAssetId: string;
  annotations: WorkflowTopologyAnnotations;
};

export type WorkflowTopologyEventSourceNode = {
  id: string;
  eventType: string;
  eventSource: string | null;
};

export type WorkflowTopologyEdgeConfidence = {
  sampleCount: number;
  lastSeenAt: string;
};

export type WorkflowTopologyStepEventSourceEdge = {
  workflowId: string;
  stepId: string;
  sourceId: string;
  kind: 'inferred';
  confidence: WorkflowTopologyEdgeConfidence;
};

export type WorkflowTopologyTriggerWorkflowEdge =
  | {
      kind: 'event-trigger';
      triggerId: string;
      workflowId: string;
    }
  | {
      kind: 'definition-trigger';
      triggerId: string;
      workflowId: string;
    }
  | {
      kind: 'schedule';
      scheduleId: string;
      workflowId: string;
    };

export type WorkflowTopologyWorkflowStepEdge = {
  workflowId: string;
  fromStepId: string | null;
  toStepId: string;
};

export type WorkflowTopologyStepAssetEdge = {
  workflowId: string;
  stepId: string;
  assetId: string;
  normalizedAssetId: string;
  direction: 'produces' | 'consumes';
  freshness: WorkflowTopologyAssetFreshness | null;
  partitioning: WorkflowTopologyAssetPartitioning | null;
  autoMaterialize: WorkflowTopologyAssetAutoMaterialize | null;
};

export type WorkflowTopologyAssetWorkflowEdge = {
  assetId: string;
  normalizedAssetId: string;
  workflowId: string;
  stepId: string | null;
  reason: 'auto-materialize';
  priority: number | null;
};

export type WorkflowTopologyEventSourceTriggerEdge = {
  sourceId: string;
  triggerId: string;
};

export type WorkflowTopologyGraph = {
  version: WorkflowTopologyGraphVersion;
  generatedAt: string;
  nodes: {
    workflows: WorkflowTopologyWorkflowNode[];
    steps: WorkflowTopologyStepNode[];
    triggers: WorkflowTopologyTriggerNode[];
    schedules: WorkflowTopologyScheduleNode[];
    assets: WorkflowTopologyAssetNode[];
    eventSources: WorkflowTopologyEventSourceNode[];
  };
  edges: {
    triggerToWorkflow: WorkflowTopologyTriggerWorkflowEdge[];
    workflowToStep: WorkflowTopologyWorkflowStepEdge[];
    stepToAsset: WorkflowTopologyStepAssetEdge[];
    assetToWorkflow: WorkflowTopologyAssetWorkflowEdge[];
    eventSourceToTrigger: WorkflowTopologyEventSourceTriggerEdge[];
    stepToEventSource: WorkflowTopologyStepEventSourceEdge[];
  };
};

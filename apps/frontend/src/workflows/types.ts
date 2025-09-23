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

export type WorkflowDefinition = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  version: number;
  steps: WorkflowDefinitionStep[];
  triggers: WorkflowTrigger[];
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
  currentStepId: string | null;
  currentStepIndex: number | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  triggeredBy: string | null;
  metrics: { totalSteps?: number; completedSteps?: number } | null;
  parameters: unknown;
  context: unknown;
  trigger: unknown;
  output: unknown;
  createdAt: string;
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
};

export type WorkflowAssetFreshness = {
  maxAgeMs?: number | null;
  ttlMs?: number | null;
  cadenceMs?: number | null;
};

export type WorkflowAssetRoleDescriptor = {
  stepId: string;
  stepName: string;
  stepType: 'job' | 'service' | 'fanout';
  schema: unknown;
  freshness: WorkflowAssetFreshness | null;
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

export type WorkflowFiltersState = {
  statuses: string[];
  repos: string[];
  services: string[];
  tags: string[];
};

export type WorkflowRuntimeSummary = {
  runId?: string;
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

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

export type WorkflowDefinitionStep = {
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
  metadata: unknown;
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

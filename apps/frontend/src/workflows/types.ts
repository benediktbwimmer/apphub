export type WorkflowDefinitionStep = {
  id: string;
  name: string;
  jobSlug?: string;
  serviceSlug?: string;
  description?: string | null;
  dependsOn?: string[];
  parameters?: unknown;
  timeoutMs?: number | null;
  retryPolicy?: unknown;
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

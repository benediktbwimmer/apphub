import { API_BASE_URL } from '../../config';
import { ApiError, ensureOk, parseJson } from '../api';
import type { AuthorizedFetch, WorkflowCreateInput, JobDefinitionCreateInput, JobDefinitionSummary } from '../api';
import type { AiBuilderProvider } from '../../ai/types';

export type { AiBuilderProvider } from '../../ai/types';
export type AiBuilderMode = 'workflow' | 'job' | 'job-with-bundle' | 'workflow-with-jobs';

export type AiBundleFile = {
  path: string;
  contents: string;
  encoding?: 'utf8' | 'base64';
  executable?: boolean;
};

export type AiBundleSuggestion = {
  slug: string;
  version: string;
  entryPoint: string;
  manifest: Record<string, unknown>;
  manifestPath?: string;
  capabilityFlags?: string[];
  metadata?: unknown;
  description?: string | null;
  displayName?: string | null;
  files: AiBundleFile[];
};

export type AiJobSuggestion = {
  job: JobDefinitionCreateInput;
  bundle: AiBundleSuggestion;
  bundleValidation: {
    valid: boolean;
    errors: string[];
  };
};

export type AiWorkflowDependencyExistingJob = {
  kind: 'existing-job';
  jobSlug: string;
  name?: string;
  description?: string;
  rationale?: string;
};

export type AiWorkflowDependencyNewJob = {
  kind: 'job';
  jobSlug: string;
  name: string;
  summary?: string;
  prompt: string;
  rationale?: string;
  dependsOn?: string[];
};

export type AiWorkflowDependencyJobWithBundle = {
  kind: 'job-with-bundle';
  jobSlug: string;
  name: string;
  summary?: string;
  prompt: string;
  rationale?: string;
  bundleOutline?: {
    entryPoint: string;
    files?: Array<{
      path: string;
      description?: string;
    }>;
    manifestNotes?: string;
  };
  dependsOn?: string[];
};

export type AiWorkflowDependency =
  | AiWorkflowDependencyExistingJob
  | AiWorkflowDependencyNewJob
  | AiWorkflowDependencyJobWithBundle;

export type AiWorkflowPlan = {
  workflow: WorkflowCreateInput;
  dependencies: AiWorkflowDependency[];
  notes?: string | null;
};

export type AiSuggestionResponse = {
  mode: AiBuilderMode;
  raw: string;
  suggestion: WorkflowCreateInput | JobDefinitionCreateInput | null;
  validation: {
    valid: boolean;
    errors: string[];
  };
  stdout: string;
  stderr: string;
  metadataSummary: string;
  bundle?: AiBundleSuggestion | null;
  bundleValidation?: {
    valid: boolean;
    errors: string[];
  };
  jobSuggestions?: AiJobSuggestion[];
  plan?: AiWorkflowPlan | null;
  notes?: string | null;
  summary?: string | null;
};

export type AiSuggestRequest = {
  mode: AiBuilderMode;
  prompt: string;
  additionalNotes?: string;
  provider?: AiBuilderProvider;
  providerOptions?: {
    openAiApiKey?: string;
    openAiBaseUrl?: string;
    openAiMaxOutputTokens?: number;
    openRouterApiKey?: string;
    openRouterReferer?: string;
    openRouterTitle?: string;
  };
  promptOverrides?: {
    systemPrompt?: string;
    responseInstructions?: string;
  };
};

export type AiGenerationState = {
  generationId: string;
  provider: AiBuilderProvider;
  status: 'running' | 'succeeded' | 'failed';
  mode: AiBuilderMode;
  metadataSummary: string;
  stdout: string;
  stderr: string;
  summary: string | null;
  result: AiSuggestionResponse | null;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
};

function buildError(message: string, status: number, details?: unknown): Error {
  const error = new Error(message);
  (error as Error & { status?: number; details?: unknown }).status = status;
  (error as Error & { status?: number; details?: unknown }).details = details;
  return error;
}

async function parseGenerationResponse(response: Response): Promise<AiGenerationState> {
  const payload = (await response.json()) as { data?: unknown };
  if (!payload || typeof payload !== 'object' || !('data' in payload)) {
    throw new Error('Invalid AI generation response payload');
  }
  const data = (payload as { data?: AiGenerationState }).data;
  if (!data || typeof data !== 'object') {
    throw new Error('AI generation response missing data property');
  }
  return data as AiGenerationState;
}

export async function startAiGeneration(
  fetcher: AuthorizedFetch,
  input: AiSuggestRequest
): Promise<AiGenerationState> {
  const response = await fetcher(`${API_BASE_URL}/ai/builder/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const fallback = (await response.text().catch(() => '')) ?? '';
    throw buildError(fallback || 'Failed to start AI generation', response.status, fallback);
  }

  return parseGenerationResponse(response);
}

export async function fetchAiGeneration(
  fetcher: AuthorizedFetch,
  generationId: string
): Promise<AiGenerationState> {
  const response = await fetcher(`${API_BASE_URL}/ai/builder/generations/${generationId}`, {
    method: 'GET'
  });

  if (!response.ok) {
    const fallback = (await response.text().catch(() => '')) ?? '';
    throw buildError(fallback || 'Failed to fetch AI generation status', response.status, fallback);
  }

  return parseGenerationResponse(response);
}

export type AiGenerationMetadata = {
  id: string;
  prompt?: string;
  additionalNotes?: string;
  metadataSummary?: string;
  rawOutput?: string;
  stdout?: string;
  stderr?: string;
  summary?: string;
  provider?: AiBuilderProvider;
};

export type CreateJobWithBundleRequest = {
  job: JobDefinitionCreateInput;
  bundle: AiBundleSuggestion;
  generation?: AiGenerationMetadata;
};

export type CreateJobWithBundleResponse = {
  job: JobDefinitionSummary;
};

export async function createJobWithBundle(
  fetcher: AuthorizedFetch,
  input: CreateJobWithBundleRequest
): Promise<CreateJobWithBundleResponse> {
  const response = await fetcher(`${API_BASE_URL}/ai/builder/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  await ensureOk(response, 'Failed to create job');
  const payload = await parseJson<{
    data?: {
      job?: JobDefinitionSummary;
    };
  }>(response);
  if (!payload.data?.job) {
    throw new ApiError('Invalid job response', response.status, payload);
  }
  return { job: payload.data.job };
}

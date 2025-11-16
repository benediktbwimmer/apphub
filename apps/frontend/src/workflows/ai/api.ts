import { API_BASE_URL } from '../../config';
import { coreRequest, CoreApiError } from '../../core/api';
import { ApiError } from '../api';
import { createApiClient, type AuthorizedFetch, type QueryValue } from '../../lib/apiClient';
import type { WorkflowCreateInput, JobDefinitionCreateInput, JobDefinitionSummary } from '../api';
import type { AiBuilderProvider } from '../../ai/types';

export type { AiBuilderProvider } from '../../ai/types';
export type AiBuilderMode = 'workflow' | 'job' | 'job-with-bundle' | 'workflow-with-jobs';

export type AiContextFile = {
  path: string;
  contents: string;
  bytes: number;
  tokens?: number | null;
};

export type AiContextMessage = {
  role: 'system' | 'user';
  content: string;
  tokens: number | null;
};

export type AiContextPreview = {
  provider: AiBuilderProvider;
  tokenCount: number | null;
  messages: AiContextMessage[];
  contextFiles: AiContextFile[];
};

export type AiContextPreviewResponse = {
  provider: AiBuilderProvider;
  mode: AiBuilderMode;
  metadataSummary: string;
  contextPreview: AiContextPreview;
};

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
    capabilities?: string[];
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
  contextPreview?: AiContextPreview;
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
  contextPreview?: AiContextPreview;
};

function parseGenerationPayload(payload: unknown): AiGenerationState {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid AI generation response payload');
  }
  const record = payload as { data?: unknown };
  if (!record.data || typeof record.data !== 'object') {
    throw new Error('AI generation response missing data property');
  }
  return record.data as AiGenerationState;
}

type Token = string | null | undefined;
type TokenInput = Token | AuthorizedFetch;

type CoreJsonOptions = {
  method?: string;
  url: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  errorMessage: string;
};

type FetchWithMetadata = AuthorizedFetch & {
  authToken?: string | null | undefined;
  authOptional?: boolean | null | undefined;
};

function ensureToken(input: TokenInput): string | undefined {
  if (typeof input === 'function') {
    const fetcher = input as FetchWithMetadata;
    const candidate = typeof fetcher.authToken === 'string' ? fetcher.authToken.trim() : '';
    if (candidate.length > 0) {
      return candidate;
    }
    if (fetcher.authOptional) {
      return undefined;
    }
  } else if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
    return undefined;
  } else if (input === null || input === undefined) {
    return undefined;
  }
  throw new Error('Authentication required for AI builder requests.');
}

function toApiError(error: CoreApiError, fallback: string): ApiError {
  const message = error.message && error.message.trim().length > 0 ? error.message : fallback;
  return new ApiError(message, error.status ?? 500, error.details ?? null);
}

async function coreJson<T>(token: TokenInput, options: CoreJsonOptions): Promise<T> {
  if (typeof token === 'function') {
    const client = createApiClient(token, { baseUrl: API_BASE_URL });
    const bodyIsFormData = options.body instanceof FormData;
    const result = await client.request(options.url, {
      method: options.method,
      query: options.query,
      body: bodyIsFormData ? (options.body as FormData) : undefined,
      json: !bodyIsFormData ? options.body : undefined,
      errorMessage: options.errorMessage
    });
    return result as T;
  }

  try {
    const resolvedToken = ensureToken(token);
    return (await coreRequest<T>(resolvedToken, {
      method: options.method,
      url: options.url,
      query: options.query,
      body: options.body
    })) as T;
  } catch (error) {
    if (error instanceof CoreApiError) {
      throw toApiError(error, options.errorMessage);
    }
    throw error;
  }
}

export async function startAiGeneration(
  token: TokenInput,
  input: AiSuggestRequest
): Promise<AiGenerationState> {
  const payload = await coreJson<{ data?: unknown }>(token, {
    method: 'POST',
    url: '/ai/builder/generations',
    body: input,
    errorMessage: 'Failed to start AI generation'
  });
  const data = parseGenerationPayload(payload);
  return data;
}

export async function fetchAiGeneration(
  token: TokenInput,
  generationId: string
): Promise<AiGenerationState> {
  const payload = await coreJson<{ data?: unknown }>(token, {
    url: `/ai/builder/generations/${encodeURIComponent(generationId)}`,
    errorMessage: 'Failed to fetch AI generation status'
  });
  return parseGenerationPayload(payload);
}

export async function fetchAiContextPreview(
  token: TokenInput,
  params: {
    provider: AiBuilderProvider;
    mode: AiBuilderMode;
  }
): Promise<AiContextPreviewResponse> {
  const query: Record<string, QueryValue> = {};
  if (params.provider) {
    query.provider = params.provider;
  }
  if (params.mode) {
    query.mode = params.mode;
  }
  const payload = await coreJson<{ data?: AiContextPreviewResponse }>(token, {
    url: '/ai/builder/context',
    query,
    errorMessage: 'Failed to load AI context preview'
  });
  if (!payload || typeof payload !== 'object' || !('data' in payload) || !payload.data) {
    throw new Error('Invalid AI context preview payload');
  }
  return payload.data;
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
  token: TokenInput,
  input: CreateJobWithBundleRequest
): Promise<CreateJobWithBundleResponse> {
  const payload = await coreJson<{
    data?: {
      job?: JobDefinitionSummary;
    };
  }>(token, {
    method: 'POST',
    url: '/ai/builder/jobs',
    body: input,
    errorMessage: 'Failed to create job'
  });
  if (!payload.data?.job) {
    throw new ApiError('Invalid job response', 500, payload);
  }
  return { job: payload.data.job };
}

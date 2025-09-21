import { API_BASE_URL } from '../../config';
import type { AuthorizedFetch } from '../api';
import type { WorkflowCreateInput, JobDefinitionCreateInput } from '../api';

export type AiBuilderMode = 'workflow' | 'job';

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
};

export type AiSuggestRequest = {
  mode: AiBuilderMode;
  prompt: string;
  additionalNotes?: string;
};

function buildError(message: string, status: number, details?: unknown): Error {
  const error = new Error(message);
  (error as Error & { status?: number; details?: unknown }).status = status;
  (error as Error & { status?: number; details?: unknown }).details = details;
  return error;
}

export async function requestAiSuggestion(
  fetcher: AuthorizedFetch,
  input: AiSuggestRequest
): Promise<AiSuggestionResponse> {
  const response = await fetcher(`${API_BASE_URL}/ai/builder/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const fallback = await response.text().catch(() => '') ?? '';
    throw buildError(fallback || 'Failed to generate suggestion', response.status, fallback);
  }

  const payload = (await response.json()) as { data?: unknown };
  if (!payload || typeof payload !== 'object' || !('data' in payload)) {
    throw new Error('Invalid AI suggestion response payload');
  }
  const data = (payload as { data?: AiSuggestionResponse }).data;
  if (!data || typeof data !== 'object') {
    throw new Error('AI suggestion response missing data property');
  }
  return data as AiSuggestionResponse;
}

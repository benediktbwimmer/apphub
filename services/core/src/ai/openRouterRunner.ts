import type { CodexGenerationOptions } from './codexRunner';
import { runOpenAiGeneration, type OpenAiGenerationResult } from './openAiRunner';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_DEFAULT_MODEL = 'x-ai/grok-4-fast:free';

export type OpenRouterGenerationOptions = CodexGenerationOptions & {
  apiKey: string;
  referer?: string;
  title?: string;
  responseFormat?:
    | { type: 'json_object' }
    | {
        type: 'json_schema';
        json_schema: {
          name: string;
          schema: Record<string, unknown>;
        };
      };
};

export async function runOpenRouterGeneration(
  options: OpenRouterGenerationOptions
): Promise<OpenAiGenerationResult> {
  const { apiKey, referer, title, responseFormat, ...rest } = options;
  const extraHeaders: Record<string, string> = {};
  if (referer) {
    extraHeaders['HTTP-Referer'] = referer;
  }
  if (title) {
    extraHeaders['X-Title'] = title;
  }

  return runOpenAiGeneration({
    ...rest,
    apiKey,
    baseUrl: OPENROUTER_BASE_URL,
    model: OPENROUTER_DEFAULT_MODEL,
    extraHeaders,
    responseFormat: responseFormat ?? { type: 'json_object' }
  });
}

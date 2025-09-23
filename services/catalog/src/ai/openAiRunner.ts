import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  aiJobWithBundleOutputSchema,
  aiWorkflowWithJobsOutputSchema,
  jobDefinitionCreateSchema,
  workflowDefinitionCreateSchema
} from '../workflows/zodSchemas';
import type { CodexContextFile, CodexGenerationMode, CodexGenerationOptions } from './codexRunner';

const DEFAULT_OPENAI_BASE_URL = process.env.APPHUB_OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 600_000;
const MAX_SECTION_LENGTH = 12_000;
const MAX_METADATA_LENGTH = 10_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;
const MIN_OUTPUT_TOKENS = 256;
const MAX_OUTPUT_TOKENS = 32_000;

export type OpenAiGenerationOptions = CodexGenerationOptions & {
  apiKey: string;
  baseUrl?: string;
  maxOutputTokens?: number;
};

export type OpenAiGenerationResult = {
  output: string;
  summary?: string | null;
};

type OpenAiMessage = {
  role: 'system' | 'user';
  content: Array<{ type: 'text'; text: string }>;
};

type OpenAiResponsePayload = {
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
      data?: unknown;
    }>;
  }>;
  response?: string;
  choices?: Array<{
    message?: {
      content?: Array<{ type?: string; text?: string }> | string;
    };
  }>;
};

function resolveBaseUrl(baseUrl?: string): string {
  const candidate = baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL;
  return candidate.replace(/\/$/, '');
}

function resolveTimeoutMs(timeout?: number): number {
  if (!timeout || timeout <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return timeout;
}

function resolveMaxOutputTokens(value?: number): number {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_MAX_OUTPUT_TOKENS;
  }
  const normalized = Math.trunc(value);
  if (normalized < MIN_OUTPUT_TOKENS) {
    return MIN_OUTPUT_TOKENS;
  }
  if (normalized > MAX_OUTPUT_TOKENS) {
    return MAX_OUTPUT_TOKENS;
  }
  return normalized;
}

function buildResponseSchema(mode: CodexGenerationMode): Record<string, unknown> {
  const schema =
    mode === 'workflow'
      ? workflowDefinitionCreateSchema
      : mode === 'job'
      ? jobDefinitionCreateSchema
      : mode === 'job-with-bundle'
      ? aiJobWithBundleOutputSchema
      : aiWorkflowWithJobsOutputSchema;

  const jsonSchema = zodToJsonSchema(schema, {
    name: 'AiBuilderSuggestion',
    target: 'jsonSchema7'
  });

  if (jsonSchema && typeof jsonSchema === 'object' && !('$schema' in jsonSchema)) {
    (jsonSchema as Record<string, unknown>).$schema = 'http://json-schema.org/draft-07/schema#';
  }

  return jsonSchema as Record<string, unknown>;
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}\n…\n[truncated]`;
}

function collectContextSections(contextFiles?: CodexContextFile[]): string {
  if (!contextFiles || contextFiles.length === 0) {
    return 'No reference context supplied.';
  }

  const includePatterns = [
    /^context\/reference\/.*$/, // schema documentation
    /^context\/jobs\/README\.md$/,
    /^context\/services\/README\.md$/,
    /^context\/workflows\/README\.md$/
  ];

  const sections: string[] = [];

  for (const file of contextFiles) {
    if (!includePatterns.some((pattern) => pattern.test(file.path))) {
      continue;
    }
    const heading = file.path.replace(/^context\//, '');
    sections.push(`### ${heading}\n${truncate(file.contents.trim(), MAX_SECTION_LENGTH)}`);
  }

  if (sections.length === 0) {
    return 'No reference context matched the include filters.';
  }

  return sections.join('\n\n');
}

const SYSTEM_PROMPT = `You are the AppHub AI builder, an expert workflow automation engineer.
Generate drafts that AppHub can register without edits and strictly follow these rules:
- Return only JSON conforming to the provided schema for the requested mode. Do not wrap the JSON in markdown fences.
- Reuse existing jobs and services from the catalog whenever they satisfy the request. Only introduce new jobs when no existing job fits.
- Ensure every job or workflow reference is valid, includes realistic parametersSchema and outputSchema, and omits placeholders like TODO.
- When generating bundles, provide complete runnable source files that align with the declared entry point.
- Use the reference material and catalog context verbatim. Prefer documented patterns over inventing new conventions.
- Prefer clarity over verbosity in descriptions and notes. Highlight any required operator follow-up in the optional notes field.`;

function buildUserPrompt(options: OpenAiGenerationOptions): string {
  const lines: string[] = [];

  lines.push(`Requested mode: ${options.mode}`);
  lines.push('Operator request:\n<<<\n' + options.operatorRequest.trim() + '\n>>>' );

  if (options.additionalNotes && options.additionalNotes.trim().length > 0) {
    lines.push('Additional notes:\n<<<\n' + options.additionalNotes.trim() + '\n>>>' );
  }

  if (options.metadataSummary && options.metadataSummary.trim().length > 0) {
    lines.push(
      'Catalog metadata summary:\n<<<\n' + truncate(options.metadataSummary.trim(), MAX_METADATA_LENGTH) + '\n>>>'
    );
  }

  const contextSummary = collectContextSections(options.contextFiles);
  lines.push('Reference context:\n<<<\n' + contextSummary + '\n>>>' );

  lines.push(
    'Respond with JSON that satisfies the response schema. Do not include explanatory prose outside the JSON payload.'
  );

  return lines.join('\n\n');
}

function buildMessages(options: OpenAiGenerationOptions): OpenAiMessage[] {
  return [
    {
      role: 'system',
      content: [{ type: 'text', text: SYSTEM_PROMPT }]
    },
    {
      role: 'user',
      content: [{ type: 'text', text: buildUserPrompt(options) }]
    }
  ];
}

function extractOutputText(payload: OpenAiResponsePayload): string | null {
  if (payload.output) {
    for (const item of payload.output) {
      const content = item?.content;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const entry of content) {
        if (entry && typeof entry === 'object') {
          if (typeof entry.text === 'string' && entry.text.trim().length > 0) {
            return entry.text.trim();
          }
          if (typeof entry.data === 'object' && entry.data !== null) {
            try {
              return JSON.stringify(entry.data);
            } catch {
              // ignore JSON stringify errors and keep searching
            }
          }
        }
      }
    }
  }

  if (payload.response && typeof payload.response === 'string' && payload.response.trim().length > 0) {
    return payload.response.trim();
  }

  if (payload.choices && Array.isArray(payload.choices)) {
    for (const choice of payload.choices) {
      const message = choice?.message;
      if (!message) {
        continue;
      }
      if (typeof message.content === 'string' && message.content.trim().length > 0) {
        return message.content.trim();
      }
      if (Array.isArray(message.content)) {
        for (const content of message.content) {
          if (content && typeof content.text === 'string' && content.text.trim().length > 0) {
            return content.text.trim();
          }
        }
      }
    }
  }

  return null;
}

export async function runOpenAiGeneration(
  options: OpenAiGenerationOptions
): Promise<OpenAiGenerationResult> {
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const maxOutputTokens = resolveMaxOutputTokens(options.maxOutputTokens);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs + 5_000);

  try {
    const response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${options.apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-5',
        reasoning: { effort: 'high' },
        input: buildMessages(options),
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'AiBuilderSuggestion',
            schema: buildResponseSchema(options.mode)
          }
        },
        temperature: 0.2,
        top_p: 0.95,
        max_output_tokens: maxOutputTokens
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      let detail: unknown;
      try {
        detail = await response.json();
      } catch {
        detail = await response.text();
      }
      const message = detail && typeof detail === 'object' ? JSON.stringify(detail) : String(detail);
      throw new Error(`OpenAI request failed (${response.status}): ${message}`);
    }

    const payload = (await response.json()) as OpenAiResponsePayload;
    const output = extractOutputText(payload);
    if (!output) {
      throw new Error('OpenAI response did not include any output text');
    }

    return {
      output,
      summary: null
    } satisfies OpenAiGenerationResult;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('OpenAI generation timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

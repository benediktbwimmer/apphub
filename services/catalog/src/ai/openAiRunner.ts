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
  model?: string;
  extraHeaders?: Record<string, string>;
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

export type OpenAiGenerationResult = {
  output: string;
  summary?: string | null;
};

type OpenAiMessage = {
  role: 'system' | 'user';
  content: string;
};

type OpenAiToolCall = {
  function?: {
    name?: string;
    arguments?: string;
  };
};

type OpenAiMessageContent =
  | string
  | Array<{ type?: string; text?: unknown }>;

type OpenAiResponsePayload = {
  choices?: Array<{
    message?: {
      content?: OpenAiMessageContent;
      tool_calls?: OpenAiToolCall[];
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

  const normalizedSchema = normalizeJsonSchema(jsonSchema as Record<string, unknown>);

  if (!('$schema' in normalizedSchema)) {
    normalizedSchema['$schema'] = 'http://json-schema.org/draft-07/schema#';
  }

  if (typeof normalizedSchema['type'] !== 'string') {
    normalizedSchema['type'] = 'object';
  }

  return normalizedSchema;
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}\n…\n[truncated]`;
}

function normalizeJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema) {
    return {};
  }

  const refValue = typeof schema['$ref'] === 'string' ? (schema['$ref'] as string) : null;
  const definitions = schema['definitions'] as Record<string, unknown> | undefined;

  if (refValue && refValue.startsWith('#/definitions/') && definitions) {
    const key = refValue.split('/').pop();
    const definition = key ? definitions[key] : undefined;

    if (definition && typeof definition === 'object') {
      const resolved: Record<string, unknown> = { ...(definition as Record<string, unknown>) };

      if (schema['$schema']) {
        resolved['$schema'] = schema['$schema'];
      }

      if (definitions) {
        resolved['definitions'] = definitions;
      }

      return resolved;
    }
  }

  const clone: Record<string, unknown> = { ...schema };
  delete clone['$ref'];
  return clone;
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
      content: SYSTEM_PROMPT
    },
    {
      role: 'user',
      content: buildUserPrompt(options)
    }
  ];
}

function coerceTextValue(candidate: unknown): string | null {
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (candidate && typeof candidate === 'object') {
    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        const text = coerceTextValue(entry);
        if (text) {
          return text;
        }
      }
      return null;
    }

    const record = candidate as Record<string, unknown>;

    if ('text' in record) {
      const text = coerceTextValue(record.text);
      if (text) {
        return text;
      }
    }

    if ('content' in record) {
      const text = coerceTextValue(record.content);
      if (text) {
        return text;
      }
    }

    if ('value' in record) {
      const text = coerceTextValue(record.value);
      if (text) {
        return text;
      }
    }

    if ('arguments' in record) {
      const args = record.arguments;
      if (typeof args === 'string') {
        const text = args.trim();
        if (text.length > 0) {
          return text;
        }
      } else if (args && typeof args === 'object') {
        try {
          const serialized = JSON.stringify(args);
          if (serialized && serialized !== '{}' && serialized !== '[]') {
            return serialized;
          }
        } catch {
          // ignore serialization issues
        }
      }
    }
  }
  return null;
}

function extractOutputText(payload: OpenAiResponsePayload): string | null {
  if (payload.choices && Array.isArray(payload.choices)) {
    for (const choice of payload.choices) {
      const message = choice?.message;
      if (!message) {
        continue;
      }
      if (message.tool_calls && Array.isArray(message.tool_calls)) {
        for (const toolCall of message.tool_calls) {
          const args = toolCall?.function?.arguments;
          const text = coerceTextValue(args);
          if (text) {
            return text;
          }
        }
      }
      if (typeof message.content === 'string') {
        const text = coerceTextValue(message.content);
        if (text) {
          return text;
        }
      }
      if (Array.isArray(message.content)) {
        for (const content of message.content) {
          const text = coerceTextValue(content?.text);
          if (text) {
            return text;
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
  const model = typeof options.model === 'string' && options.model.trim().length > 0 ? options.model.trim() : 'gpt-5';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs + 5_000);

  try {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${options.apiKey}`
    };
    if (options.extraHeaders) {
      for (const [key, value] of Object.entries(options.extraHeaders)) {
        if (typeof value === 'string' && value.length > 0) {
          headers[key] = value;
        }
      }
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: buildMessages(options),
        response_format:
          options.responseFormat ?? {
            type: 'json_schema',
            json_schema: {
              name: 'AiBuilderSuggestion',
              schema: buildResponseSchema(options.mode)
            }
          },
        temperature: 1,
        top_p: 1,
        max_completion_tokens: maxOutputTokens
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
      throw new Error(
        `OpenAI response did not include any output text: ${JSON.stringify(payload)} `
      );
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

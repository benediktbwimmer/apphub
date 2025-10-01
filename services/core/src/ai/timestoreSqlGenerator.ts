import { z } from 'zod';
import { runOpenAiGeneration, type OpenAiGenerationResult } from './openAiRunner';
import { runOpenRouterGeneration } from './openRouterRunner';

export type TimestoreSqlSchemaColumn = {
  name: string;
  type?: string | null;
  description?: string | null;
};

export type TimestoreSqlSchemaTable = {
  name: string;
  description?: string | null;
  columns: TimestoreSqlSchemaColumn[];
};

export type TimestoreSqlSchema = {
  tables: TimestoreSqlSchemaTable[];
};

export type TimestoreSqlProvider = 'openai' | 'openrouter';

export type TimestoreSqlProviderOptions = {
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openAiMaxOutputTokens?: number;
  openRouterApiKey?: string;
  openRouterReferer?: string;
  openRouterTitle?: string;
};

export type TimestoreSqlGenerationInput = {
  prompt: string;
  schema: TimestoreSqlSchema;
  provider: TimestoreSqlProvider;
  providerOptions?: TimestoreSqlProviderOptions;
};

export type TimestoreSqlGenerationDeps = {
  runOpenAi: typeof runOpenAiGeneration;
  runOpenRouter: typeof runOpenRouterGeneration;
};

export type TimestoreSqlGenerationSuggestion = {
  sql: string;
  notes: string | null;
  caveats: string | null;
  provider: TimestoreSqlProvider;
  warnings: string[];
};

const DEFAULT_MAX_OUTPUT_TOKENS = 1_500;
const MAX_TABLE_SECTIONS = 40;
const MAX_COLUMNS_PER_TABLE = 40;
const MAX_COLUMN_DESCRIPTION = 160;
const MAX_SCHEMA_CHARACTERS = 12_000;

const SUGGESTION_SCHEMA = z
  .object({
    sql: z.string().min(1, 'SQL field was empty'),
    notes: z.string().trim().min(1).optional(),
    caveats: z.string().trim().min(1).optional()
  })
  .passthrough();

const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sql'],
  properties: {
    sql: {
      type: 'string',
      description: 'DuckDB-compatible SQL query answering the user request.'
    },
    notes: {
      type: 'string',
      description: 'Optional explanation of the generated query.'
    },
    caveats: {
      type: 'string',
      description: 'Optional caveats or assumptions that apply to the query.'
    }
  }
} satisfies Record<string, unknown>;

const SYSTEM_PROMPT = [
  'You are the AppHub Timestore SQL assistant.',
  'Use DuckDB SQL syntax to answer questions about the provided datasets.',
  'Generate exactly one SELECT or WITH statement. Do not emit multiple statements or any destructive command.',
  'Only reference tables and columns that appear in the supplied schema summary.',
  'Prefer readable aliases and include comments only when essential.'
].join('\n');

const RESPONSE_INSTRUCTIONS =
  'Respond with a JSON object matching the schema you were given. Do not wrap the response in Markdown fences.';

function truncateDescription(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length <= MAX_COLUMN_DESCRIPTION) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_COLUMN_DESCRIPTION)}…`;
}

function formatSchemaForPrompt(schema: TimestoreSqlSchema): { text: string; warnings: string[] } {
  if (!schema.tables || schema.tables.length === 0) {
    return { text: 'No tables are available in this environment.', warnings: [] };
  }

  const warnings: string[] = [];
  const lines: string[] = [];
  let remainingBudget = MAX_SCHEMA_CHARACTERS;

  const limitedTables = schema.tables.slice(0, MAX_TABLE_SECTIONS);
  if (schema.tables.length > limitedTables.length) {
    warnings.push(
      `Schema truncated to the first ${limitedTables.length} tables out of ${schema.tables.length}.`
    );
  }

  for (const table of limitedTables) {
    const tableHeader = `Table: ${table.name}`;
    const tableDescription = truncateDescription(table.description);
    const sectionLines: string[] = [tableHeader];
    if (tableDescription) {
      sectionLines.push(`Description: ${tableDescription}`);
    }

    const limitedColumns = table.columns.slice(0, MAX_COLUMNS_PER_TABLE);
    if (table.columns.length > limitedColumns.length) {
      warnings.push(
        `Columns for table ${table.name} truncated to the first ${limitedColumns.length} of ${table.columns.length}.`
      );
    }

    sectionLines.push('Columns:');
    for (const column of limitedColumns) {
      const columnDescription = truncateDescription(column.description);
      const typeInfo = column.type ? column.type.trim() : 'unknown';
      const descriptionSuffix = columnDescription ? ` — ${columnDescription}` : '';
      sectionLines.push(`- ${column.name} (${typeInfo})${descriptionSuffix}`);
    }

    const sectionText = sectionLines.join('\n');
    if (sectionText.length > remainingBudget) {
      warnings.push(`Schema truncated due to size limit after table ${table.name}.`);
      break;
    }
    lines.push(sectionText);
    remainingBudget -= sectionText.length;
  }

  return { text: lines.join('\n\n'), warnings };
}

export function stripCodeFences(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  const fencePattern = /^```(?:sql|duckdb)?\s*([\s\S]*?)\s*```$/i;
  const match = trimmed.match(fencePattern);
  if (match && match[1]) {
    return match[1].trim();
  }
  return trimmed;
}

export function sanitizeGeneratedSql(sql: string): string {
  let normalized = stripCodeFences(sql);
  normalized = normalized.replace(/;\s*$/, '').trim();
  return normalized;
}

const FORBIDDEN_KEYWORDS = /(INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE|ATTACH|DETACH)\b/i;

export function validateGeneratedSql(sql: string): void {
  if (!sql || sql.trim().length === 0) {
    throw new Error('Generated SQL was empty.');
  }
  const normalized = sql.trim().replace(/;+\s*$/, '');

  const upper = normalized.replace(/^\s+/, '').slice(0, 10).toUpperCase();
  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
    throw new Error('Generated SQL must start with SELECT or WITH.');
  }

  if (FORBIDDEN_KEYWORDS.test(normalized)) {
    throw new Error('Generated SQL contains a forbidden operation.');
  }

  if (normalized.includes(';')) {
    throw new Error('Generated SQL must be a single statement.');
  }
}

const defaultDeps: TimestoreSqlGenerationDeps = {
  runOpenAi: runOpenAiGeneration,
  runOpenRouter: runOpenRouterGeneration
};

export async function generateTimestoreSql(
  input: TimestoreSqlGenerationInput,
  deps: TimestoreSqlGenerationDeps = defaultDeps
): Promise<TimestoreSqlGenerationSuggestion> {
  const prompt = input.prompt?.trim();
  if (!prompt) {
    throw new Error('Prompt is required.');
  }

  const schemaSummary = formatSchemaForPrompt(input.schema ?? { tables: [] });
  const operatorRequest = [
    'User question:',
    prompt,
    '',
    'Available schema:',
    schemaSummary.text,
    '',
    'Return a single DuckDB SQL statement that answers the question.'
  ].join('\n');

  const providerOptions = input.providerOptions ?? {};
  let generation: OpenAiGenerationResult;

  if (input.provider === 'openai') {
    const apiKey = providerOptions.openAiApiKey?.trim();
    if (!apiKey) {
      throw new Error('OpenAI API key is required.');
    }

    const baseUrl = providerOptions.openAiBaseUrl?.trim() || undefined;
    const maxOutputTokens =
      typeof providerOptions.openAiMaxOutputTokens === 'number' && Number.isFinite(providerOptions.openAiMaxOutputTokens)
        ? Math.min(Math.max(Math.trunc(providerOptions.openAiMaxOutputTokens), 256), 8_192)
        : DEFAULT_MAX_OUTPUT_TOKENS;

    generation = await deps.runOpenAi({
      mode: 'job',
      operatorRequest,
      metadataSummary: '',
      additionalNotes: undefined,
      systemPrompt: SYSTEM_PROMPT,
      responseInstructions: RESPONSE_INSTRUCTIONS,
      contextFiles: undefined,
      apiKey,
      baseUrl,
      maxOutputTokens,
      responseFormat: {
        type: 'json_schema',
        json_schema: {
          name: 'TimestoreSqlSuggestion',
          schema: RESPONSE_JSON_SCHEMA
        }
      }
    });
  } else {
    const apiKey = providerOptions.openRouterApiKey?.trim();
    if (!apiKey) {
      throw new Error('OpenRouter API key is required.');
    }
    const referer = providerOptions.openRouterReferer?.trim() || undefined;
    const title = providerOptions.openRouterTitle?.trim() || undefined;

    generation = await deps.runOpenRouter({
      mode: 'job',
      operatorRequest,
      metadataSummary: '',
      additionalNotes: undefined,
      systemPrompt: SYSTEM_PROMPT,
      responseInstructions: RESPONSE_INSTRUCTIONS,
      contextFiles: undefined,
      apiKey,
      referer,
      title,
      responseFormat: {
        type: 'json_schema',
        json_schema: {
          name: 'TimestoreSqlSuggestion',
          schema: RESPONSE_JSON_SCHEMA
        }
      }
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(generation.output);
  } catch (error) {
    throw new Error('AI response was not valid JSON.');
  }

  const suggestion = SUGGESTION_SCHEMA.parse(parsed);
  const sanitized = sanitizeGeneratedSql(suggestion.sql);
  validateGeneratedSql(sanitized);

  const warnings = [...schemaSummary.warnings];

  return {
    sql: sanitized,
    notes: suggestion.notes?.trim() ?? null,
    caveats: suggestion.caveats?.trim() ?? null,
    provider: input.provider,
    warnings
  } satisfies TimestoreSqlGenerationSuggestion;
}

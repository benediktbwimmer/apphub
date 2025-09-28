import type { ZodIssue } from 'zod';
import {
  bulkOperationSchema,
  type BulkOperation,
  type BulkRequestPayload
} from './types';

export type BulkInputFormat = 'json' | 'jsonl' | 'csv';

export type BulkRowStatus = 'valid' | 'invalid';

export interface BulkDraftRow {
  index: number;
  label: string;
  status: BulkRowStatus;
  operation: BulkOperation | null;
  error?: string;
  raw: unknown;
}

export interface BulkValidationResult {
  format: BulkInputFormat;
  rows: BulkDraftRow[];
  validRows: BulkDraftRow[];
  invalidRows: BulkDraftRow[];
  suggestedContinueOnError?: boolean;
}

const CSV_REQUIRED_HEADERS = ['type', 'namespace', 'key'] as const;

export function parseBulkJsonInput(raw: string): BulkValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Provide JSON payload for bulk operations.');
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(trimmed) as unknown;
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Bulk payload must be valid JSON');
  }

  let operationsSource: unknown;
  let suggestedContinueOnError: boolean | undefined;

  if (Array.isArray(candidate)) {
    operationsSource = candidate;
  } else if (candidate && typeof candidate === 'object' && 'operations' in (candidate as Record<string, unknown>)) {
    const candidateObject = candidate as Record<string, unknown>;
    operationsSource = candidateObject.operations;
    const continueOnError = candidateObject.continueOnError;
    if (typeof continueOnError === 'boolean') {
      suggestedContinueOnError = continueOnError;
    }
  } else {
    throw new Error('Bulk payload must be an array of operations or an object with an "operations" array.');
  }

  if (!Array.isArray(operationsSource) || operationsSource.length === 0) {
    throw new Error('Bulk payload must include at least one operation.');
  }

  const rows = operationsSource.map((entry, index) => buildRowFromCandidate(entry, index, (position) => `Item ${position}`));
  return aggregateRows('json', rows, suggestedContinueOnError);
}

export function parseBulkJsonlInput(raw: string): BulkValidationResult {
  const rows: BulkDraftRow[] = [];
  const lines = raw.split(/\r?\n/);
  let ordinal = 0;

  if (lines.every((line) => line.trim().length === 0)) {
    throw new Error('JSONL input must include at least one operation.');
  }

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    ordinal += 1;
    const label = `Line ${lineIndex + 1}`;

    try {
      const candidate = JSON.parse(trimmed) as unknown;
      rows.push(buildRowFromCandidate(candidate, ordinal - 1, () => label));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid JSON';
      rows.push({
        index: ordinal,
        label,
        status: 'invalid',
        operation: null,
        error: `${label}: ${message}`,
        raw: trimmed
      });
    }
  });

  if (rows.length === 0) {
    throw new Error('JSONL input must include at least one operation.');
  }

  return aggregateRows('jsonl', rows);
}

export function parseBulkCsvInput(raw: string): BulkValidationResult {
  const parsedRows = parseCsv(raw);
  if (parsedRows.length === 0) {
    throw new Error('CSV input must include a header row and at least one data row.');
  }

  const [headerRow, ...dataRows] = parsedRows;
  const headers = headerRow.map((value) => value.trim());
  const headerLookup = headers.map((value) => value.toLowerCase());

  const missing = CSV_REQUIRED_HEADERS.filter((required) => !headerLookup.includes(required));
  if (missing.length > 0) {
    throw new Error(`CSV header must include ${missing.join(', ')} columns.`);
  }

  const rows: BulkDraftRow[] = [];
  let ordinal = 0;

  dataRows.forEach((rowValues, dataIndex) => {
    const isEmpty = rowValues.every((value) => value.trim().length === 0);
    if (isEmpty) {
      return;
    }

    ordinal += 1;
    const label = `Row ${dataIndex + 2}`;
    const candidateResult = buildCandidateFromCsv(headers, rowValues);

    if (candidateResult.error) {
      rows.push({
        index: ordinal,
        label,
        status: 'invalid',
        operation: null,
        error: `${label}: ${candidateResult.error}`,
        raw: Object.fromEntries(headers.map((header, index) => [header, rowValues[index]]))
      });
      return;
    }

    rows.push(buildRowFromCandidate(candidateResult.candidate, ordinal - 1, () => label));
  });

  if (rows.length === 0) {
    throw new Error('CSV input must include at least one data row.');
  }

  return aggregateRows('csv', rows);
}

export function buildBulkPayloadFromRows(rows: BulkDraftRow[], continueOnError: boolean): BulkRequestPayload | null {
  const hasErrors = rows.some((row) => row.status !== 'valid' || !row.operation);
  if (rows.length === 0 || hasErrors) {
    return null;
  }

  const operations = rows.map((row) => row.operation!) as BulkOperation[];
  const payload: BulkRequestPayload = { operations };
  if (continueOnError) {
    payload.continueOnError = true;
  }
  return payload;
}

export function stringifyBulkPayload(rows: BulkDraftRow[], continueOnError: boolean): string | null {
  const payload = buildBulkPayloadFromRows(rows, continueOnError);
  if (!payload) {
    return null;
  }
  return JSON.stringify(payload, null, 2);
}

function aggregateRows(
  format: BulkInputFormat,
  rows: BulkDraftRow[],
  suggestedContinueOnError?: boolean
): BulkValidationResult {
  const validRows = rows.filter((row) => row.status === 'valid');
  const invalidRows = rows.filter((row) => row.status !== 'valid');
  return {
    format,
    rows,
    validRows,
    invalidRows,
    suggestedContinueOnError
  };
}

function buildRowFromCandidate(
  candidate: unknown,
  index: number,
  labelFactory: (position: number) => string
): BulkDraftRow {
  const label = labelFactory(index + 1);
  const parsed = bulkOperationSchema.safeParse(candidate);
  if (parsed.success) {
    return {
      index: index + 1,
      label,
      status: 'valid',
      operation: parsed.data,
      raw: candidate
    };
  }

  return {
    index: index + 1,
    label,
    status: 'invalid',
    operation: null,
    error: `${label}: ${formatZodIssues(parsed.error.issues)}`,
    raw: candidate
  };
}

function formatZodIssues(issues: ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'value';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

interface CsvCandidateResult {
  candidate: unknown;
  error?: string;
}

function buildCandidateFromCsv(headers: string[], values: string[]): CsvCandidateResult {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header.trim().toLowerCase()] = (values[index] ?? '').trim();
  });

  const type = record.type?.toLowerCase();
  if (type !== 'upsert' && type !== 'delete') {
    return { candidate: null, error: 'Type must be either "upsert" or "delete".' };
  }

  const namespace = record.namespace;
  if (!namespace) {
    return { candidate: null, error: 'Namespace is required.' };
  }

  const key = record.key;
  if (!key) {
    return { candidate: null, error: 'Key is required.' };
  }

  const expectedVersionRaw = record.expectedversion;
  let expectedVersion: number | undefined;
  if (expectedVersionRaw) {
    const parsedExpected = Number(expectedVersionRaw);
    if (Number.isNaN(parsedExpected)) {
      return { candidate: null, error: 'expectedVersion must be a number.' };
    }
    expectedVersion = parsedExpected;
  }

  const base = {
    type,
    namespace,
    key
  } as Record<string, unknown>;

  if (expectedVersion !== undefined) {
    base.expectedVersion = expectedVersion;
  }

  if (type === 'upsert') {
    const metadataRaw = record.metadata;
    if (metadataRaw) {
      try {
        const metadata = JSON.parse(metadataRaw) as unknown;
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
          return { candidate: null, error: 'metadata must be a JSON object.' };
        }
        base.metadata = metadata;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid metadata JSON';
        return { candidate: null, error: `metadata: ${message}` };
      }
    }

    const tagsRaw = record.tags;
    if (tagsRaw) {
      const tags = tagsRaw
        .split('|')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (tags.length > 0) {
        base.tags = tags;
      }
    }

    const owner = record.owner;
    if (owner) {
      base.owner = owner.toLowerCase() === 'null' ? null : owner;
    }

    const schemaHash = record.schemahash;
    if (schemaHash) {
      base.schemaHash = schemaHash;
    }
  }

  return { candidate: base };
}

function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (char === '"') {
      const nextChar = raw[index + 1];
      if (inQuotes && nextChar === '"') {
        value += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      current.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && raw[index + 1] === '\n') {
        index += 1;
      }
      current.push(value);
      rows.push(current);
      current = [];
      value = '';
      continue;
    }

    value += char;
  }

  current.push(value);
  rows.push(current);

  return rows.filter((row) => row.some((cell) => cell.trim().length > 0));
}

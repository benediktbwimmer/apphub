export type QueryField = 'key' | 'owner' | 'tags' | 'metadata';

export type QueryOperator = 'equals' | 'notEquals' | 'includesAny' | 'contains' | 'exists';

export type QueryClause = {
  id: string;
  field: QueryField;
  operator: QueryOperator;
  value: string;
  path?: string;
};

export type FilterConditionInput = {
  field: string;
  operator: 'eq' | 'neq' | 'contains' | 'array_contains' | 'exists';
  value?: unknown;
  values?: unknown[];
};

export type FilterNodeInput =
  | { type: 'condition'; condition: FilterConditionInput }
  | { type: 'group'; operator: 'and' | 'or'; filters: FilterNodeInput[] };

export type QueryPayload = {
  q?: string;
  filter?: FilterNodeInput;
};

const SIMPLE_TOKEN_REGEX = /^[A-Za-z0-9_.:-]+$/;

function generateId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `qc_${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyClause(): QueryClause {
  return {
    id: generateId(),
    field: 'key',
    operator: 'equals',
    value: ''
  } satisfies QueryClause;
}

export function cloneClause(clause: QueryClause): QueryClause {
  return {
    id: generateId(),
    field: clause.field,
    operator: clause.operator,
    value: clause.value,
    path: clause.path
  } satisfies QueryClause;
}

function quoteQueryValue(raw: string): string {
  if (raw.length === 0) {
    return '""';
  }
  if (SIMPLE_TOKEN_REGEX.test(raw)) {
    return raw;
  }
  const escaped = raw.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function normalizeMetadataField(path: string | undefined): string | null {
  if (!path) {
    return null;
  }
  const normalized = path.trim().replace(/^metadata\.?/, '');
  if (!normalized) {
    return null;
  }
  return normalized;
}

function parseFilterValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return '';
  }
  const lower = trimmed.toLowerCase();
  if (lower === 'null') {
    return null;
  }
  if (lower === 'true') {
    return true;
  }
  if (lower === 'false') {
    return false;
  }
  if (!Number.isNaN(Number(trimmed)) && trimmed.length < 32) {
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to string
    }
  }
  return trimmed;
}

function buildFilterCondition(condition: FilterConditionInput[]): FilterNodeInput | undefined {
  if (condition.length === 0) {
    return undefined;
  }
  if (condition.length === 1) {
    return { type: 'condition', condition: condition[0] } satisfies FilterNodeInput;
  }
  return {
    type: 'group',
    operator: 'and',
    filters: condition.map((entry) => ({ type: 'condition', condition: entry }))
  } satisfies FilterNodeInput;
}

export function buildQueryPayload(clauses: QueryClause[]): QueryPayload {
  const qSegments: string[] = [];
  const filters: FilterConditionInput[] = [];

  for (const clause of clauses) {
    if (clause.field !== 'tags' && clause.operator !== 'exists' && clause.value.trim().length === 0) {
      continue;
    }

    switch (clause.field) {
      case 'key': {
        const value = clause.value.trim();
        if (!value) {
          continue;
        }
        if (clause.operator === 'equals') {
          qSegments.push(`key:${quoteQueryValue(value)}`);
        } else if (clause.operator === 'notEquals') {
          qSegments.push(`key!=${quoteQueryValue(value)}`);
        }
        break;
      }
      case 'owner': {
        if (clause.operator === 'exists') {
          filters.push({ field: 'owner', operator: 'exists' });
          break;
        }
        const value = clause.value.trim();
        if (!value) {
          continue;
        }
        if (clause.operator === 'equals') {
          qSegments.push(`owner:${quoteQueryValue(value)}`);
        } else if (clause.operator === 'notEquals') {
          qSegments.push(`owner!=${quoteQueryValue(value)}`);
        }
        break;
      }
      case 'tags': {
        const tokens = clause.value
          .split(',')
          .map((token) => token.trim())
          .filter((token) => token.length > 0);
        if (tokens.length === 0) {
          continue;
        }
        filters.push({ field: 'tags', operator: 'array_contains', value: tokens });
        break;
      }
      case 'metadata': {
        const path = normalizeMetadataField(clause.path);
        if (!path) {
          continue;
        }
        const field = path.includes('.') ? `metadata.${path}` : path;
        if (clause.operator === 'exists') {
          filters.push({ field: field.startsWith('metadata.') ? field : `metadata.${field}`, operator: 'exists' });
          break;
        }
        const value = clause.value.trim();
        if (!value) {
          continue;
        }
        const qualifiedField = field.startsWith('metadata.') ? field : `metadata.${field}`;
        if (clause.operator === 'equals') {
          qSegments.push(`${path}:${quoteQueryValue(value)}`);
        } else if (clause.operator === 'notEquals') {
          qSegments.push(`${path}!=${quoteQueryValue(value)}`);
        } else if (clause.operator === 'contains') {
          filters.push({ field: qualifiedField, operator: 'contains', value: parseFilterValue(value) });
        }
        break;
      }
    }
  }

  const filter = buildFilterCondition(filters);
  const q = qSegments.length > 0 ? qSegments.join(' ') : undefined;

  if (!filter && !q) {
    return {} satisfies QueryPayload;
  }
  return { q, filter } satisfies QueryPayload;
}

const BASE64_PREFIX = 'b64:';

type BufferCtor = {
  from(input: string | Uint8Array, encoding?: string): { toString(encoding: string): string };
};

function encodeBase64Url(value: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  let base64: string;
  if (typeof globalThis.btoa === 'function') {
    base64 = globalThis.btoa(binary);
  } else {
    const bufferCtor = (globalThis as { Buffer?: BufferCtor }).Buffer;
    if (!bufferCtor) {
      throw new Error('Base64 encoding is not supported in this environment');
    }
    base64 = bufferCtor.from(bytes).toString('base64');
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function decodeBase64Url(encoded: string): string | null {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  try {
    let binary: string;
    if (typeof globalThis.atob === 'function') {
      binary = globalThis.atob(normalized + padding);
    } else {
      const bufferCtor = (globalThis as { Buffer?: BufferCtor }).Buffer;
      if (!bufferCtor) {
        throw new Error('Base64 decoding is not supported in this environment');
      }
      const buffer = bufferCtor.from(normalized + padding, 'base64');
      return new TextDecoder().decode(buffer as Uint8Array);
    }
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

export function encodeClausesForUrl(clauses: QueryClause[]): string | null {
  const serializable = clauses
    .filter((clause) => clause.value.trim().length > 0 || clause.operator === 'exists' || clause.field === 'tags')
    .map((clause) => ({ field: clause.field, operator: clause.operator, value: clause.value, path: clause.path ?? null }));
  if (serializable.length === 0) {
    return null;
  }
  const json = JSON.stringify(serializable);
  const encoded = encodeBase64Url(json);
  return `${BASE64_PREFIX}${encoded}`;
}

export function decodeClausesFromUrl(value: string | null | undefined): QueryClause[] {
  if (!value || !value.startsWith(BASE64_PREFIX)) {
    return [createEmptyClause()];
  }
  const encoded = value.slice(BASE64_PREFIX.length);
  try {
    const decoded = decodeBase64Url(encoded);
    if (decoded === null) {
      return [createEmptyClause()];
    }
    const json = decoded;
    const parsed = JSON.parse(json) as Array<{
      field?: QueryField;
      operator?: QueryOperator;
      value?: string;
      path?: string | null;
    }>;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [createEmptyClause()];
    }
    const clauses: QueryClause[] = [];
    for (const entry of parsed) {
      if (!entry || !entry.field || !entry.operator) {
        continue;
      }
      clauses.push({
        id: generateId(),
        field: entry.field,
        operator: entry.operator,
        value: entry.value ?? '',
        path: entry.path ?? undefined
      });
    }
    return clauses.length > 0 ? clauses : [createEmptyClause()];
  } catch {
    return [createEmptyClause()];
  }
}

export function encodeDslForUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }
  const encoded = encodeBase64Url(value);
  return `${BASE64_PREFIX}${encoded}`;
}

export function decodeDslFromUrl(value: string | null | undefined): string {
  if (!value || !value.startsWith(BASE64_PREFIX)) {
    return '';
  }
  const encoded = value.slice(BASE64_PREFIX.length);
  const decoded = decodeBase64Url(encoded);
  return decoded ?? '';
}

export function sanitizeClauses(clauses: QueryClause[]): QueryClause[] {
  if (clauses.length > 0) {
    return clauses;
  }
  return [createEmptyClause()];
}

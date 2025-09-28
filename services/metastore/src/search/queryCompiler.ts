import type { FilterCondition, FilterNode } from './types';

const SUPPORTED_OPERATORS = ['!=', '>=', '<=', '>', '<', ':', '='] as const;
const FIELD_NAME_REGEX = /^[A-Za-z0-9_.-]+$/;
const NUMERIC_REGEX = /^-?\d+(?:\.\d+)?$/;

const COLUMN_FIELDS = new Set([
  'namespace',
  'key',
  'owner',
  'schemaHash',
  'version',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'createdBy',
  'updatedBy',
  'tags'
]);

function tokenize(query: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;
  let escapeNext = false;

  for (const char of query) {
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (inQuote) {
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      if (char === inQuote) {
        inQuote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      inQuote = char;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char.trim().length === 0) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (inQuote) {
    throw new Error('Unterminated quote in query string');
  }

  if (escapeNext) {
    current += '\\';
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function findOperator(token: string): { symbol: (typeof SUPPORTED_OPERATORS)[number]; index: number } | null {
  for (const symbol of SUPPORTED_OPERATORS) {
    const index = token.indexOf(symbol);
    if (index > 0) {
      return { symbol, index };
    }
  }
  return null;
}

function normalizeField(rawField: string): string {
  const field = rawField.trim();
  if (!field) {
    throw new Error('Query segment is missing a field name');
  }
  if (!FIELD_NAME_REGEX.test(field)) {
    throw new Error(`Invalid field name: ${field}`);
  }
  if (field === 'metadata' || field.startsWith('metadata.')) {
    return field;
  }
  if (COLUMN_FIELDS.has(field)) {
    return field;
  }
  return `metadata.${field}`;
}

function parseValue(rawValue: string): unknown {
  const value = rawValue.trim();
  if (value.length === 0) {
    return '';
  }

  const lower = value.toLowerCase();
  if (lower === 'null') {
    return null;
  }
  if (lower === 'true') {
    return true;
  }
  if (lower === 'false') {
    return false;
  }
  if (NUMERIC_REGEX.test(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return value;
}

function parseConditionToken(token: string): FilterCondition {
  const operatorInfo = findOperator(token);
  if (!operatorInfo) {
    throw new Error(`Query segment "${token}" is missing a comparison operator`);
  }

  const { symbol, index } = operatorInfo;
  const fieldSegment = token.slice(0, index);
  const valueSegment = token.slice(index + symbol.length);

  const field = normalizeField(fieldSegment);
  const value = parseValue(valueSegment);

  switch (symbol) {
    case ':':
    case '=':
      return { field, operator: 'eq', value };
    case '!=':
      return { field, operator: 'neq', value };
    case '>':
      if (valueSegment.trim().length === 0) {
        throw new Error(`Query segment "${token}" is missing a value`);
      }
      return { field, operator: 'gt', value };
    case '<':
      if (valueSegment.trim().length === 0) {
        throw new Error(`Query segment "${token}" is missing a value`);
      }
      return { field, operator: 'lt', value };
    case '>=':
      if (valueSegment.trim().length === 0) {
        throw new Error(`Query segment "${token}" is missing a value`);
      }
      return { field, operator: 'gte', value };
    case '<=':
      if (valueSegment.trim().length === 0) {
        throw new Error(`Query segment "${token}" is missing a value`);
      }
      return { field, operator: 'lte', value };
    default:
      throw new Error(`Unsupported operator in query segment "${token}"`);
  }
}

function conditionToNode(condition: FilterCondition): FilterNode {
  return {
    type: 'condition',
    condition
  } satisfies FilterNode;
}

export function compileQueryString(query: string): FilterNode {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    throw new Error('Query string must include at least one expression');
  }

  const conditions = tokens.map((token) => conditionToNode(parseConditionToken(token)));
  return mergeFilterNodes(conditions) ?? conditions[0]!;
}

export function mergeFilterNodes(nodes: Array<FilterNode | undefined>): FilterNode | undefined {
  const filters = nodes.filter((node): node is FilterNode => Boolean(node));
  if (filters.length === 0) {
    return undefined;
  }
  if (filters.length === 1) {
    return filters[0];
  }
  return {
    type: 'group',
    operator: 'and',
    filters
  } satisfies FilterNode;
}

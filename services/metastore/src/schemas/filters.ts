import type { ComparisonOperator, FilterCondition, FilterNode } from '../search/types';

const COMPARISON_OPERATORS: Set<ComparisonOperator> = new Set([
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'between',
  'contains',
  'has_key',
  'array_contains',
  'exists'
]);

const BOOLEAN_OPERATORS = new Set(['and', 'or']);
const MAX_DEPTH = 8;

function isComparisonOperator(value: unknown): value is ComparisonOperator {
  return typeof value === 'string' && COMPARISON_OPERATORS.has(value as ComparisonOperator);
}

function parseCondition(raw: Record<string, unknown>): FilterCondition {
  const fieldRaw = raw.field;
  if (typeof fieldRaw !== 'string' || fieldRaw.trim().length === 0) {
    throw new Error('Filter condition requires a non-empty field');
  }
  const field = fieldRaw.trim();

  const operatorRaw = raw.operator;
  if (!isComparisonOperator(operatorRaw)) {
    throw new Error(`Unsupported comparison operator: ${String(operatorRaw)}`);
  }
  const operator = operatorRaw;

  const value = raw.value as unknown;
  const valuesRaw = raw.values;
  let values: unknown[] | undefined;
  if (Array.isArray(valuesRaw)) {
    values = [...valuesRaw];
  }

  if (operator === 'between') {
    if (!values || values.length !== 2) {
      throw new Error('Between operator expects an array of exactly two values');
    }
  }

  if (operator === 'has_key') {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error('has_key operator expects a non-empty string value');
    }
  }

  if ((operator === 'contains' || operator === 'array_contains') && value === undefined && (!values || values.length === 0)) {
    throw new Error(`${operator} operator expects at least one value`);
  }

  return {
    field,
    operator,
    value,
    values
  } satisfies FilterCondition;
}

export function parseFilterNode(raw: unknown, depth = 0): FilterNode {
  if (depth > MAX_DEPTH) {
    throw new Error('Filter tree exceeds maximum depth');
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error('Filter node must be an object');
  }

  const node = raw as Record<string, unknown>;
  const explicitType = typeof node.type === 'string' ? node.type : null;

  if (explicitType === 'not' || (!explicitType && node.not)) {
    const filterRaw = (node.filter ?? node.not) as unknown;
    if (!filterRaw) {
      throw new Error('not filter requires nested filter');
    }
    return {
      type: 'not',
      filter: parseFilterNode(filterRaw, depth + 1)
    };
  }

  const candidateFilters = Array.isArray(node.filters) ? node.filters : null;
  const operatorRaw = node.operator ?? node.op;
  if (explicitType === 'group' || (candidateFilters && typeof operatorRaw === 'string')) {
    const operator = String(operatorRaw).toLowerCase();
    if (!BOOLEAN_OPERATORS.has(operator)) {
      throw new Error(`Unsupported boolean operator: ${operator}`);
    }
    if (!candidateFilters || candidateFilters.length === 0) {
      throw new Error('Group filter requires at least one nested filter');
    }
    return {
      type: 'group',
      operator: operator as 'and' | 'or',
      filters: candidateFilters.map((entry) => parseFilterNode(entry, depth + 1))
    } satisfies FilterNode;
  }

  if (explicitType === 'condition' && typeof node.condition === 'object' && node.condition) {
    return {
      type: 'condition',
      condition: parseCondition(node.condition as Record<string, unknown>)
    } satisfies FilterNode;
  }

  return {
    type: 'condition',
    condition: parseCondition(node)
  } satisfies FilterNode;
}

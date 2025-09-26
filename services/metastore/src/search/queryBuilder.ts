import type { FilterCondition, FilterNode, SearchOptions, SortField } from './types';

const COLUMN_MAP: Record<
  string,
  {
    column: string;
    type: 'text' | 'integer' | 'timestamp' | 'json' | 'text_array';
    sortable?: boolean;
  }
> = {
  namespace: { column: 'namespace', type: 'text', sortable: true },
  key: { column: 'record_key', type: 'text', sortable: true },
  owner: { column: 'owner', type: 'text', sortable: true },
  schemaHash: { column: 'schema_hash', type: 'text', sortable: true },
  version: { column: 'version', type: 'integer', sortable: true },
  createdAt: { column: 'created_at', type: 'timestamp', sortable: true },
  updatedAt: { column: 'updated_at', type: 'timestamp', sortable: true },
  deletedAt: { column: 'deleted_at', type: 'timestamp', sortable: true },
  createdBy: { column: 'created_by', type: 'text', sortable: true },
  updatedBy: { column: 'updated_by', type: 'text', sortable: true },
  tags: { column: 'tags', type: 'text_array', sortable: false }
};

type FieldSpec =
  | { kind: 'column'; column: string; type: 'text' | 'integer' | 'timestamp' | 'json' | 'text_array' }
  | { kind: 'metadata'; path: string[] };

const FIELD_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

function parseField(field: string): FieldSpec {
  if (field.startsWith('metadata.')) {
    const path = field
      .slice('metadata.'.length)
      .split('.')
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (path.length === 0) {
      throw new Error('Metadata field path cannot be empty');
    }
    for (const segment of path) {
      if (!FIELD_NAME_REGEX.test(segment)) {
        throw new Error(`Invalid metadata path segment: ${segment}`);
      }
    }
    return { kind: 'metadata', path };
  }

  if (field === 'metadata') {
    return { kind: 'metadata', path: [] };
  }

  if (field in COLUMN_MAP) {
    const descriptor = COLUMN_MAP[field];
    return { kind: 'column', column: descriptor.column, type: descriptor.type };
  }

  throw new Error(`Unsupported field in filter: ${field}`);
}

class SqlBuilder {
  private readonly params: unknown[] = [];

  add(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  addJson(value: unknown): string {
    return `${this.add(value === undefined ? null : JSON.stringify(value))}::jsonb`;
  }

  getParameters(): unknown[] {
    return this.params;
  }
}

function buildJsonPath(path: string[]): string {
  if (path.length === 0) {
    return 'metadata';
  }
  const escaped = path.map((segment) => segment.replace(/"/g, '""'));
  return `metadata #> '{${escaped.join(',')}}'`;
}

function buildJsonTextPath(path: string[]): string {
  if (path.length === 0) {
    return '(metadata)::text';
  }
  const escaped = path.map((segment) => segment.replace(/"/g, '""'));
  return `metadata #>> '{${escaped.join(',')}}'`;
}

function ensureArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined ? [] : [value];
}

function buildCondition(builder: SqlBuilder, condition: FilterCondition): string {
  const fieldSpec = parseField(condition.field);
  const operator = condition.operator;

  if (fieldSpec.kind === 'column') {
    const column = fieldSpec.column;
    switch (operator) {
      case 'eq': {
        const placeholder = builder.add(condition.value ?? null);
        return `${column} = ${placeholder}`;
      }
      case 'neq': {
        const placeholder = builder.add(condition.value ?? null);
        return `${column} IS DISTINCT FROM ${placeholder}`;
      }
      case 'lt':
      case 'lte':
      case 'gt':
      case 'gte': {
        const placeholder = builder.add(condition.value ?? null);
        const opMap = { lt: '<', lte: '<=', gt: '>', gte: '>=' } as const;
        return `${column} ${opMap[operator]} ${placeholder}`;
      }
      case 'between': {
        const values = ensureArray(condition.values);
        if (values.length !== 2) {
          throw new Error('Between operator expects exactly two values');
        }
        const [start, end] = values;
        const startPlaceholder = builder.add(start);
        const endPlaceholder = builder.add(end);
        return `${column} BETWEEN ${startPlaceholder} AND ${endPlaceholder}`;
      }
      case 'contains': {
        if (fieldSpec.type === 'text_array') {
          const values = ensureArray(condition.value).map((value) => String(value ?? ''));
          if (values.length === 0) {
            throw new Error('Contains operator requires at least one value');
          }
          const placeholder = builder.add(values);
          return `${column} @> ${placeholder}::text[]`;
        }
        throw new Error(`Contains operator not supported for column ${condition.field}`);
      }
      case 'array_contains': {
        if (fieldSpec.type === 'text_array') {
          const values = ensureArray(condition.value).map((value) => String(value ?? ''));
          if (values.length === 0) {
            throw new Error('array_contains requires at least one value');
          }
          const placeholder = builder.add(values);
          return `${column} && ${placeholder}::text[]`;
        }
        throw new Error(`array_contains not supported for column ${condition.field}`);
      }
      case 'exists': {
        return `${column} IS NOT NULL`;
      }
      case 'has_key': {
        if (fieldSpec.type === 'json') {
          const placeholder = builder.add(condition.value ?? null);
          return `${column} ? ${placeholder}`;
        }
        throw new Error(`has_key not supported for column ${condition.field}`);
      }
      default:
        throw new Error(`Operator ${operator} not supported for column filters`);
    }
  }

  const jsonExpr = buildJsonPath(fieldSpec.path);
  switch (operator) {
    case 'eq': {
      const placeholder = builder.addJson(condition.value ?? null);
      return `${jsonExpr} = ${placeholder}`;
    }
    case 'neq': {
      const placeholder = builder.addJson(condition.value ?? null);
      return `${jsonExpr} IS DISTINCT FROM ${placeholder}`;
    }
    case 'contains': {
      const placeholder = builder.addJson(condition.value ?? null);
      return `${jsonExpr} @> ${placeholder}`;
    }
    case 'has_key': {
      const placeholder = builder.add(condition.value ?? null);
      return `${jsonExpr} ? ${placeholder}`;
    }
    case 'array_contains': {
      const values = ensureArray(condition.value ?? []);
      if (values.length === 0) {
        throw new Error('array_contains requires at least one value');
      }
      const placeholder = builder.addJson(values.length === 1 ? values[0] : values);
      return `EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(${jsonExpr}, '[]'::jsonb)) elem
        WHERE elem @> ${placeholder}
      )`;
    }
    case 'exists': {
      return `${jsonExpr} IS NOT NULL`;
    }
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      const textExpr = buildJsonTextPath(fieldSpec.path);
      const placeholder = builder.add(String(condition.value ?? ''));
      const opMap = { lt: '<', lte: '<=', gt: '>', gte: '>=' } as const;
      return `${textExpr} ${opMap[operator]} ${placeholder}`;
    }
    case 'between': {
      const values = ensureArray(condition.values);
      if (values.length !== 2) {
        throw new Error('Between operator expects exactly two values');
      }
      const textExpr = buildJsonTextPath(fieldSpec.path);
      const startPlaceholder = builder.add(String(values[0] ?? ''));
      const endPlaceholder = builder.add(String(values[1] ?? ''));
      return `${textExpr} BETWEEN ${startPlaceholder} AND ${endPlaceholder}`;
    }
    default:
      throw new Error(`Operator ${operator} not supported for metadata fields`);
  }
}

function buildFilter(builder: SqlBuilder, node: FilterNode): string {
  switch (node.type) {
    case 'condition':
      return buildCondition(builder, node.condition);
    case 'group': {
      if (!Array.isArray(node.filters) || node.filters.length === 0) {
        throw new Error('Filter group must include at least one filter');
      }
      const parts = node.filters.map((child) => `(${buildFilter(builder, child)})`);
      const joiner = node.operator === 'or' ? ' OR ' : ' AND ';
      return parts.join(joiner);
    }
    case 'not':
      return `NOT (${buildFilter(builder, node.filter)})`;
    default:
      throw new Error('Unsupported filter node');
  }
}

function buildOrderBy(sort: SortField[] | undefined): string {
  if (!sort || sort.length === 0) {
    return 'ORDER BY updated_at DESC';
  }
  const clauses: string[] = [];
  for (const entry of sort) {
    if (!entry || typeof entry.field !== 'string') {
      continue;
    }
    if (!(entry.field in COLUMN_MAP)) {
      continue;
    }
    const descriptor = COLUMN_MAP[entry.field];
    if (!descriptor.sortable) {
      continue;
    }
    const direction = entry.direction === 'asc' ? 'ASC' : 'DESC';
    clauses.push(`${descriptor.column} ${direction}`);
  }
  if (clauses.length === 0) {
    return 'ORDER BY updated_at DESC';
  }
  return `ORDER BY ${clauses.join(', ')}`;
}

export function buildSearchQuery(options: SearchOptions): {
  text: string;
  values: unknown[];
} {
  const builder = new SqlBuilder();

  const predicates: string[] = [];
  predicates.push(`namespace = ${builder.add(options.namespace)}`);

  if (!options.includeDeleted) {
    predicates.push('deleted_at IS NULL');
  }

  if (options.filter) {
    predicates.push(`(${buildFilter(builder, options.filter)})`);
  }

  const whereClause = predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : '';
  const orderClause = buildOrderBy(options.sort);

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const limitPlaceholder = builder.add(limit);
  const offsetPlaceholder = builder.add(offset);

  const text = `
    SELECT *, COUNT(*) OVER() AS total_count
    FROM metastore_records
    ${whereClause}
    ${orderClause}
    LIMIT ${limitPlaceholder}
    OFFSET ${offsetPlaceholder}
  `;

  return {
    text,
    values: builder.getParameters()
  };
}

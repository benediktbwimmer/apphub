export type ComparisonOperator =
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'between'
  | 'contains'
  | 'has_key'
  | 'array_contains'
  | 'exists';

export type BooleanOperator = 'and' | 'or';

export type FilterCondition = {
  field: string;
  operator: ComparisonOperator;
  value?: unknown;
  values?: unknown[];
};

export type FilterNode =
  | { type: 'condition'; condition: FilterCondition }
  | { type: 'group'; operator: BooleanOperator; filters: FilterNode[] }
  | { type: 'not'; filter: FilterNode };

export type SortDirection = 'asc' | 'desc';

export type SortField = {
  field: string;
  direction: SortDirection;
};

export type SearchOptions = {
  namespace: string;
  includeDeleted?: boolean;
  filter?: FilterNode;
  limit?: number;
  offset?: number;
  sort?: SortField[];
  projection?: string[];
};

export type SearchResult<T> = {
  rows: T[];
  total: number;
};

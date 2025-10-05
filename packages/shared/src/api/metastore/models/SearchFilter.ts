/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type SearchFilter = ({
  type?: 'condition';
  field: string;
  operator: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'between' | 'contains' | 'has_key' | 'array_contains' | 'exists';
  value?: any;
  values?: Array<any>;
} | {
  type: 'group';
  operator: 'and' | 'or';
  filters: Array<SearchFilter>;
} | {
  type: 'not';
  filter: SearchFilter;
});


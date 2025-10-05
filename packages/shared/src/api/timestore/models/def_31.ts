/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_31 = {
  intervalUnit?: 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month';
  intervalSize?: number;
  aggregations: Array<({
    fn: 'avg' | 'min' | 'max' | 'sum' | 'median';
    column: string;
    alias?: string | null;
  } | {
    fn: 'count';
    column?: string | null;
    alias?: string | null;
  } | {
    fn: 'count_distinct';
    column: string;
    alias?: string | null;
  } | {
    fn: 'percentile';
    column: string;
    percentile: number;
    alias?: string | null;
  })>;
};


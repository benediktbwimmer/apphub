/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type DatasetQueryRequest = {
  timeRange: {
    start: string;
    end: string;
  };
  /**
   * Logical timestamp column to use for range filtering.
   */
  timestampColumn?: string;
  columns?: Array<string> | null;
  filters?: {
    partitionKey?: Record<string, ({
      type?: 'string';
      eq?: string | null;
      in?: Array<string> | null;
    } | {
      type?: 'number';
      eq?: number | null;
      in?: Array<number> | null;
      gt?: number | null;
      gte?: number | null;
      lt?: number | null;
      lte?: number | null;
    } | {
      type?: 'timestamp';
      eq?: string | null;
      in?: Array<string> | null;
      gt?: string | null;
      gte?: string | null;
      lt?: string | null;
      lte?: string | null;
    } | Array<string>)> | null;
    columns?: Record<string, ({
      type?: 'string';
      eq?: string | null;
      in?: Array<string> | null;
    } | {
      type?: 'number';
      eq?: number | null;
      in?: Array<number> | null;
      gt?: number | null;
      gte?: number | null;
      lt?: number | null;
      lte?: number | null;
    } | {
      type?: 'timestamp';
      eq?: string | null;
      in?: Array<string> | null;
      gt?: string | null;
      gte?: string | null;
      lt?: string | null;
      lte?: string | null;
    } | {
      type?: 'boolean';
      eq?: boolean | null;
      in?: Array<boolean> | null;
    })> | null;
  } | null;
  downsample?: {
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
  } | null;
  limit?: number | null;
};


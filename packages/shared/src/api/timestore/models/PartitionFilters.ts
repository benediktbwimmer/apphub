/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type PartitionFilters = {
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
};


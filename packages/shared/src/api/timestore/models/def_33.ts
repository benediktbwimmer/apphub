/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_33 = {
  rows: Array<Record<string, any>>;
  columns: Array<string>;
  mode: 'raw' | 'downsampled';
  /**
   * Non-fatal issues encountered while executing the query.
   */
  warnings?: Array<string>;
  streaming?: any | null;
};


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
  sources?: {
    published: {
      /**
       * Number of rows returned from published partitions.
       */
      rows: number;
      /**
       * Total published partitions inspected for this query.
       */
      partitions: number;
    };
    staging: {
      /**
       * Number of rows returned from staging batches pending flush.
       */
      rows: number;
    };
    hotBuffer: {
      /**
       * Number of rows returned from the streaming hot buffer.
       */
      rows: number;
    };
  };
};


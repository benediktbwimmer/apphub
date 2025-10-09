/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type DatasetQueryResponse = {
  rows: Array<Record<string, any>>;
  columns: Array<string>;
  mode: 'raw' | 'downsampled';
  /**
   * Non-fatal issues encountered while executing the query.
   */
  warnings?: Array<string>;
  streaming?: {
    /**
     * Indicates whether streaming integration was active for the query.
     */
    enabled: boolean;
    /**
     * State of the streaming hot buffer during query execution.
     */
    bufferState: 'disabled' | 'ready' | 'unavailable';
    /**
     * Number of streaming rows merged into the response.
     */
    rows: number;
    watermark?: string | null;
    latestTimestamp?: string | null;
    /**
     * True when streaming data covers the requested range end.
     */
    fresh: boolean;
  } | null;
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
    hotBuffer: {
      /**
       * Number of rows returned from the streaming hot buffer.
       */
      rows: number;
    };
  };
};


/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type IngestionPartition = {
  /**
   * Partition key identifying the shard the data belongs to.
   */
  key: Record<string, string>;
  /**
   * Optional attributes describing the partition.
   */
  attributes?: Record<string, string> | null;
  timeRange: {
    start: string;
    end: string;
  };
};


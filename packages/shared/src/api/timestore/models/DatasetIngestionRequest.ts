/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type DatasetIngestionRequest = {
  /**
   * Display name to assign if the dataset is created automatically.
   */
  datasetName?: string | null;
  /**
   * Explicit storage target identifier. Defaults to the dataset's configured target.
   */
  storageTargetId?: string | null;
  /**
   * Physical table name override for the dataset backend.
   */
  tableName?: string | null;
  schema: {
    /**
     * Field definitions describing the expected columns.
     */
    fields: Array<{
      /**
       * Logical column name defined by the dataset schema.
       */
      name: string;
      /**
       * Logical field type used to validate incoming rows.
       */
      type: 'timestamp' | 'string' | 'double' | 'integer' | 'boolean';
    }>;
    evolution?: {
      defaults?: Record<string, def_0> | null;
      backfill?: boolean | null;
    };
  };
  partition: {
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
  /**
   * Collection of rows that should be appended to the partition.
   */
  rows: Array<Record<string, (string | number | boolean | Record<string, any>) | null>>;
  /**
   * Client supplied token to deduplicate ingestion attempts.
   */
  idempotencyKey?: string | null;
  actor?: {
    /**
     * Identifier of the actor that initiated the ingestion.
     */
    id: string;
    /**
     * Authorization scopes granted to the actor.
     */
    scopes: Array<string>;
  } | null;
};


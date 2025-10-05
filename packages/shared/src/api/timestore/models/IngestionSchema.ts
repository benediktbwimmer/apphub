/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type IngestionSchema = {
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


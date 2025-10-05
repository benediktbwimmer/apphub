/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_15 = {
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
    defaults?: any | null;
    backfill?: boolean | null;
  };
};


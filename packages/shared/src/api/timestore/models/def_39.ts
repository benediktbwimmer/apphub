/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_39 = {
  executionId: string;
  columns: Array<{
    name: string;
    type: string;
    nullable?: boolean | null;
    description?: string | null;
  }>;
  rows: Array<Record<string, ((string | number | boolean | Record<string, any>) | null)>>;
  /**
   * Indicates whether results were truncated due to limits.
   */
  truncated: boolean;
  warnings: Array<string>;
  statistics: {
    rowCount: number;
    elapsedMs: number;
  };
};


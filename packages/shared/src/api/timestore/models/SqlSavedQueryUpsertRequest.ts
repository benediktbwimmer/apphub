/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type SqlSavedQueryUpsertRequest = {
  /**
   * SQL statement to persist.
   */
  statement: string;
  label?: string | null;
  stats?: {
    rowCount?: number | null;
    elapsedMs?: number | null;
  } | null;
};


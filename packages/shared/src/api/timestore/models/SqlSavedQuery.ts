/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type SqlSavedQuery = {
  id: string;
  statement: string;
  label?: string | null;
  stats?: {
    rowCount?: number | null;
    elapsedMs?: number | null;
  } | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};


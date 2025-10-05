/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type SqlSchemaTable = {
  name: string;
  description?: string | null;
  partitionKeys?: Array<string> | null;
  columns: Array<{
    name: string;
    type: string;
    nullable?: boolean | null;
    description?: string | null;
  }>;
};


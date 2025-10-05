/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type MetastoreRecord = {
  namespace: string;
  key: string;
  metadata: Record<string, any>;
  tags: Array<string>;
  owner?: string | null;
  schemaHash?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
};


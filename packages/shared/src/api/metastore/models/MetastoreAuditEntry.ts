/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type MetastoreAuditEntry = {
  id: number;
  namespace: string;
  key: string;
  action: 'create' | 'update' | 'delete' | 'restore';
  actor?: string | null;
  previousVersion?: number | null;
  version?: number | null;
  metadata?: Record<string, any> | null;
  previousMetadata?: Record<string, any> | null;
  tags?: Array<string> | null;
  previousTags?: Array<string> | null;
  owner?: string | null;
  previousOwner?: string | null;
  schemaHash?: string | null;
  previousSchemaHash?: string | null;
  createdAt: string;
};


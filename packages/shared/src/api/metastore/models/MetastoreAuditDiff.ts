/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MetastoreAuditSnapshot } from './MetastoreAuditSnapshot';
export type MetastoreAuditDiff = {
  audit: {
    id: number;
    namespace: string;
    key: string;
    action: string;
    actor?: string | null;
    previousVersion?: number | null;
    version?: number | null;
    createdAt: string;
  };
  metadata: {
    added: Array<{
      path: string;
      value: any;
    }>;
    removed: Array<{
      path: string;
      value: any;
    }>;
    changed: Array<{
      path: string;
      before: any;
      after: any;
    }>;
  };
  tags: {
    added: Array<string>;
    removed: Array<string>;
  };
  owner: {
    before: string | null;
    after: string | null;
    changed: boolean;
  };
  schemaHash: {
    before: string | null;
    after: string | null;
    changed: boolean;
  };
  snapshots: {
    current: MetastoreAuditSnapshot;
    previous: MetastoreAuditSnapshot;
  };
};


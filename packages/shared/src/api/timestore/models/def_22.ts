/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type def_22 = {
  mode: 'inline';
  manifest?: any | null;
  dataset: {
    id: string;
    slug: string;
    name: string;
    description?: string | null;
    status: 'active' | 'inactive';
    writeFormat: 'clickhouse';
    defaultStorageTargetId: string | null;
    metadata: Record<string, def_0>;
    createdAt: string;
    updatedAt: string;
  };
  storageTarget: {
    id: string;
    name: string;
    kind: 'local' | 's3' | 'gcs' | 'azure_blob';
    description?: string | null;
    config: Record<string, def_0>;
    createdAt: string;
    updatedAt: string;
  };
  flushPending: boolean;
};


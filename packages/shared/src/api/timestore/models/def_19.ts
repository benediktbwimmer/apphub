/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type def_19 = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  status: 'active' | 'inactive';
  writeFormat: 'duckdb' | 'parquet';
  defaultStorageTargetId: string | null;
  metadata: Record<string, def_0>;
  createdAt: string;
  updatedAt: string;
};


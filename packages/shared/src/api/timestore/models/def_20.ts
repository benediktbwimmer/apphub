/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type def_20 = {
  id: string;
  datasetId: string;
  version: number;
  status: 'draft' | 'published' | 'superseded';
  schemaVersionId?: string | null;
  parentManifestId?: string | null;
  manifestShard: string;
  summary: Record<string, def_0>;
  statistics: Record<string, def_0>;
  metadata: Record<string, def_0>;
  partitionCount: number;
  totalRows: number;
  totalBytes: number;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
  partitions: Array<{
    id: string;
    datasetId: string;
    manifestId: string;
    manifestShard?: string;
    partitionKey: Record<string, def_0>;
    storageTargetId: string;
    fileFormat: 'duckdb' | 'parquet';
    filePath: string;
    fileSizeBytes?: number | null;
    rowCount?: number | null;
    startTime: string;
    endTime: string;
    checksum?: string | null;
    metadata: Record<string, def_0>;
    columnStatistics: Record<string, def_0>;
    columnBloomFilters: Record<string, def_0>;
    ingestionSignature?: string | null;
    createdAt: string;
  }>;
};


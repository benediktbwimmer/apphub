/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type DatasetIngestionInlineResponse = {
  mode: 'inline';
  manifest?: {
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
      fileFormat: 'clickhouse';
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
  } | null;
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


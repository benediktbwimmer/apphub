/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type DatasetPartition = {
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
};


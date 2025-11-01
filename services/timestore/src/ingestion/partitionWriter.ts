import type { ServiceConfig } from '../config/serviceConfig';
import type { StorageTargetRecord } from '../db/metadata';
import { createStorageDriver, type FieldDefinition, type PartitionWriteResult } from '../storage';

export interface PartitionBuildRequest {
  datasetSlug: string;
  partitionId: string;
  partitionKey: Record<string, string>;
  tableName: string;
  schema: FieldDefinition[];
  rows?: Record<string, unknown>[];
  sourceFilePath?: string;
  rowCountHint?: number;
}

export async function writePartitionFile(
  config: ServiceConfig,
  storageTarget: StorageTargetRecord,
  request: PartitionBuildRequest
): Promise<PartitionWriteResult> {
  const driver = createStorageDriver(config, storageTarget);
  return driver.writePartition({
    datasetSlug: request.datasetSlug,
    partitionId: request.partitionId,
    partitionKey: request.partitionKey,
    tableName: request.tableName,
    schema: request.schema,
    rows: request.rows,
    sourceFilePath: request.sourceFilePath,
    rowCountHint: request.rowCountHint
  });
}

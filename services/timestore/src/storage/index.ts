import type { DatasetPartitionRecord, StorageTargetRecord } from '../db/metadata';
import type { ServiceConfig } from '../config/serviceConfig';

export type FieldType = 'timestamp' | 'string' | 'double' | 'integer' | 'boolean';

export interface FieldDefinition {
  name: string;
  type: FieldType;
}

export function resolvePartitionLocation(
  partition: DatasetPartitionRecord,
  _target: StorageTargetRecord,
  _config: ServiceConfig
): string {
  const tableName = typeof partition.metadata?.tableName === 'string'
    ? partition.metadata.tableName
    : 'records';
  return `clickhouse://${partition.datasetId}/${tableName}`;
}

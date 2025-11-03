import { ServiceConfig } from '../config/serviceConfig';
import type { DatasetPartitionRecord, StorageTargetRecord } from '../db/metadata';

export type FieldType = 'timestamp' | 'string' | 'double' | 'integer' | 'boolean';

export interface FieldDefinition {
  name: string;
  type: FieldType;
}

export interface PartitionWriteRequest {
  datasetSlug: string;
  partitionId: string;
  partitionKey: Record<string, string>;
  tableName: string;
  schema: FieldDefinition[];
  rows?: Record<string, unknown>[];
  sourceFilePath?: string;
  rowCountHint?: number;
}

export interface PartitionWriteResult {
  relativePath: string;
  fileSizeBytes: number;
  rowCount: number;
  checksum: string;
}

export interface StorageDriver {
  writePartition(request: PartitionWriteRequest): Promise<PartitionWriteResult>;
}

const CLICKHOUSE_URI_SCHEME = 'clickhouse://';
const DEFAULT_TABLE_NAME = 'records';

export function createStorageDriver(
  _config: ServiceConfig,
  target: StorageTargetRecord
): StorageDriver {
  if (target.kind !== 'clickhouse') {
    throw new Error(`Unsupported storage target kind: ${target.kind}`);
  }

  return new ClickHouseStorageDriver(target);
}

export function resolvePartitionLocation(
  partition: DatasetPartitionRecord,
  target: StorageTargetRecord,
  _config: ServiceConfig
): string {
  if (target.kind !== 'clickhouse') {
    throw new Error(`Unsupported storage target kind: ${target.kind}`);
  }

  const storedPath =
    typeof partition.filePath === 'string' && partition.filePath.trim().length > 0
      ? partition.filePath.trim()
      : null;

  if (storedPath) {
    return storedPath;
  }

  const metadata = (partition.metadata as { tableName?: unknown } | null) ?? null;
  const tableName =
    metadata && typeof metadata.tableName === 'string' && metadata.tableName.trim().length > 0
      ? metadata.tableName.trim()
      : DEFAULT_TABLE_NAME;

  return buildFallbackClickHouseUri(target.id, tableName, partition.id);
}

export async function partitionFileExists(
  _partition: DatasetPartitionRecord,
  target: StorageTargetRecord,
  _config: ServiceConfig
): Promise<boolean> {
  if (target.kind !== 'clickhouse') {
    throw new Error(`Unsupported storage target kind: ${target.kind}`);
  }

  // ClickHouse storage is interior to the service; data is not addressed via URIs.
  return true;
}

export async function deletePartitionFile(
  _partition: DatasetPartitionRecord,
  target: StorageTargetRecord,
  _config: ServiceConfig
): Promise<void> {
  if (target.kind !== 'clickhouse') {
    throw new Error(`Unsupported storage target kind: ${target.kind}`);
  }

  // Nothing to delete for clickhouse-backed partitions.
}

class ClickHouseStorageDriver implements StorageDriver {
  constructor(private readonly target: StorageTargetRecord) {}

  async writePartition(request: PartitionWriteRequest): Promise<PartitionWriteResult> {
    const relativePath = buildClickHouseUri({
      datasetSlug: request.datasetSlug,
      tableName: request.tableName,
      partitionId: request.partitionId
    });
    const rowCount = request.rowCountHint ?? (request.rows ? request.rows.length : 0);

    return {
      relativePath,
      fileSizeBytes: 0,
      rowCount,
      checksum: ''
    };
  }
}

interface ClickHouseUriParts {
  datasetSlug: string;
  tableName?: string;
  partitionId: string;
}

function buildClickHouseUri(parts: ClickHouseUriParts): string {
  const datasetSegment = sanitizeSegment(parts.datasetSlug) || 'dataset';
  const tableSegment = sanitizeSegment(parts.tableName ?? DEFAULT_TABLE_NAME) || DEFAULT_TABLE_NAME;
  const partitionSegment = sanitizeSegment(parts.partitionId) || parts.partitionId;

  return `${CLICKHOUSE_URI_SCHEME}${datasetSegment}/${tableSegment}/${partitionSegment}`;
}

function buildFallbackClickHouseUri(
  storageTargetId: string,
  tableName: string,
  partitionId: string
): string {
  const datasetSegment = sanitizeSegment(storageTargetId) || 'clickhouse';
  const tableSegment = sanitizeSegment(tableName) || DEFAULT_TABLE_NAME;
  const partitionSegment = sanitizeSegment(partitionId) || partitionId;

  return `${CLICKHOUSE_URI_SCHEME}${datasetSegment}/${tableSegment}/${partitionSegment}`;
}

function sanitizeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s/\\]+/g, '_')
    .replace(/[^a-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

import { randomUUID } from 'node:crypto';
import { loadDuckDb, isCloseable } from '@apphub/shared';
import type {
  DatasetPartitionRecord,
  DatasetSchemaVersionRecord,
  LifecycleAuditLogInput,
  PartitionInput,
  PartitionWithTarget
} from '../db/metadata';
import { createDatasetManifest, getNextManifestVersion, getSchemaVersionById } from '../db/metadata';
import {
  createStorageDriver,
  resolvePartitionLocation,
  type FieldDefinition,
  type FieldType
} from '../storage';
import type { ServiceConfig } from '../config/serviceConfig';
import type { LifecycleJobContext, LifecycleOperationExecutionResult } from './types';
import {
  computeStatistics,
  mergeMetadataLifecycle,
  mergeSummaryLifecycle,
  partitionRecordToInput
} from './manifest';
import { invalidateSqlRuntimeCache } from '../sql/runtime';

interface CompactionGroup {
  partitions: PartitionWithTarget[];
  totalBytes: number;
  totalRows: number;
}

export async function performCompaction(
  context: LifecycleJobContext,
  partitions: PartitionWithTarget[]
): Promise<LifecycleOperationExecutionResult> {
  const { config, manifest } = context;
  const lifecycleConfig = config.lifecycle;
  const groups = buildCompactionGroups(partitions, lifecycleConfig.compaction);

  if (groups.length === 0) {
    return {
      operation: 'compaction',
      status: 'skipped',
      message: 'no small partition groups found for compaction'
    };
  }

  if (!manifest.schemaVersionId) {
    return {
      operation: 'compaction',
      status: 'failed',
      message: 'manifest missing schema version; cannot compact'
    };
  }

  const schemaVersion = await getSchemaVersionById(manifest.schemaVersionId);
  if (!schemaVersion) {
    return {
      operation: 'compaction',
      status: 'failed',
      message: `schema version ${manifest.schemaVersionId} not found`
    };
  }

  const schemaFields = extractSchemaFields(schemaVersion);
  if (schemaFields.length === 0) {
    return {
      operation: 'compaction',
      status: 'failed',
      message: 'schema version missing field definitions'
    };
  }

  const replacementPartitionInputs: PartitionInput[] = [];
  const partitionsToDelete: PartitionWithTarget[] = [];
  const auditEvents: LifecycleAuditLogInput[] = [];
  let bytesWritten = 0;

  for (const group of groups) {
    const tableName = extractTableName(group.partitions[0]);
    const { rows, startTime, endTime } = await readRowsForGroup(group, tableName, config);

    const storageTarget = group.partitions[0].storageTarget;
    const partitionId = `part-${randomUUID()}`;
    const driver = createStorageDriver(config, storageTarget);
    const partitionKey = buildPartitionKey(group, startTime, endTime);
    const writeResult = await driver.writePartition({
      datasetSlug: context.dataset.slug,
      partitionId,
      partitionKey,
      tableName,
      schema: schemaFields,
      rows
    });

    bytesWritten += writeResult.fileSizeBytes;

    replacementPartitionInputs.push({
      id: partitionId,
      storageTargetId: storageTarget.id,
      fileFormat: 'duckdb',
      filePath: writeResult.relativePath,
      partitionKey,
      startTime,
      endTime,
      fileSizeBytes: writeResult.fileSizeBytes,
      rowCount: writeResult.rowCount,
      checksum: writeResult.checksum,
      metadata: {
        tableName,
        lifecycle: {
          compaction: {
            sourcePartitionIds: group.partitions.map((partition) => partition.id)
          }
        }
      }
    });

    partitionsToDelete.push(...group.partitions);
    auditEvents.push({
      id: `la-${randomUUID()}`,
      datasetId: context.dataset.id,
      manifestId: manifest.id,
      eventType: 'compaction.group.compacted',
      payload: {
        datasetId: context.dataset.id,
        partitionIds: group.partitions.map((partition) => partition.id),
        replacementPartitionId: partitionId,
        tableName,
        rowCount: writeResult.rowCount,
        bytesWritten: writeResult.fileSizeBytes
      }
    });
  }

  const replacementIds = new Set(partitionsToDelete.map((partition) => partition.id));
  const retainedPartitionInputs = manifest.partitions
    .filter((partition) => !replacementIds.has(partition.id))
    .map(partitionRecordToInput);

  const finalPartitionInputs = [...retainedPartitionInputs, ...replacementPartitionInputs];
  const summaryPayload = {
    appliedAt: new Date().toISOString(),
    groups: groups.map((group) => ({
      sourcePartitionIds: group.partitions.map((partition) => partition.id),
      totalRows: group.totalRows,
      totalBytes: group.totalBytes
    }))
  } as Record<string, unknown>;
  const metadataPayload = {
    appliedAt: new Date().toISOString(),
    previousManifestId: manifest.id
  } as Record<string, unknown>;
  const newManifest = await createDatasetManifest({
    id: `dm-${randomUUID()}`,
    datasetId: context.dataset.id,
    version: await getNextManifestVersion(context.dataset.id),
    status: 'published',
    schemaVersionId: manifest.schemaVersionId,
    parentManifestId: manifest.id,
    summary: mergeSummaryLifecycle(manifest, 'compaction', summaryPayload),
    statistics: computeStatistics(finalPartitionInputs),
    metadata: mergeMetadataLifecycle(manifest, 'compaction', metadataPayload),
    createdBy: 'timestore-lifecycle',
    partitions: finalPartitionInputs
  });

  invalidateSqlRuntimeCache();

  return {
    operation: 'compaction',
    status: 'completed',
    manifest: newManifest,
    auditEvents,
    totals: {
      partitions: partitionsToDelete.length,
      bytes: bytesWritten
    },
    partitionsToDelete,
    details: {
      replacementPartitionIds: replacementPartitionInputs.map((partition) => partition.id)
    }
  };
}

function buildCompactionGroups(
  partitions: PartitionWithTarget[],
  config: {
    smallPartitionBytes: number;
    targetPartitionBytes: number;
    maxPartitionsPerGroup: number;
  }
): CompactionGroup[] {
  const sorted = [...partitions]
    .filter((partition) => partition.fileFormat === 'duckdb')
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const groups: CompactionGroup[] = [];
  let current: CompactionGroup | null = null;

  const flushCurrent = () => {
    if (current && current.partitions.length > 1) {
      groups.push(current);
    }
    current = null;
  };

  for (const partition of sorted) {
    const size = partition.fileSizeBytes ?? 0;
    if (size > config.smallPartitionBytes) {
      flushCurrent();
      continue;
    }

    const tableName = extractTableName(partition);

    if (
      current &&
      (current.totalBytes + size > config.targetPartitionBytes ||
        current.partitions.length >= config.maxPartitionsPerGroup ||
        current.partitions[0].storageTarget.id !== partition.storageTarget.id ||
        extractTableName(current.partitions[0]) !== tableName)
    ) {
      flushCurrent();
    }

    if (!current) {
      current = {
        partitions: [],
        totalBytes: 0,
        totalRows: 0
      };
    }

    current.partitions.push(partition);
    current.totalBytes += size;
    current.totalRows += partition.rowCount ?? 0;
  }

  flushCurrent();
  return groups;
}

function extractTableName(partition: DatasetPartitionRecord): string {
  const metadata = partition.metadata ?? {};
  const tableName = typeof metadata.tableName === 'string' ? metadata.tableName : 'records';
  return tableName;
}

function extractSchemaFields(schema: DatasetSchemaVersionRecord): FieldDefinition[] {
  const candidate = schema.schema as { fields?: { name: string; type: string }[] } | undefined;
  if (!candidate || !Array.isArray(candidate.fields)) {
    return [];
  }
  return candidate.fields
    .map((field) => ({
      name: field.name,
      type: normalizeFieldType(field.type)
    }))
    .filter((field): field is FieldDefinition => field.type !== null);
}

function normalizeFieldType(value: string): FieldType | null {
  const allowed: FieldType[] = ['timestamp', 'string', 'double', 'integer', 'boolean'];
  if (allowed.includes(value as FieldType)) {
    return value as FieldType;
  }
  return null;
}

async function readRowsForGroup(
  group: CompactionGroup,
  tableName: string,
  config: ServiceConfig
): Promise<{ rows: Record<string, unknown>[]; startTime: Date; endTime: Date }> {
  const duckdb = loadDuckDb();
  const db = new duckdb.Database(':memory:');
  const connection = db.connect();

  try {
    const selects: string[] = [];
    let index = 0;
    let minStart = Number.POSITIVE_INFINITY;
    let maxEnd = Number.NEGATIVE_INFINITY;

    for (const partition of group.partitions) {
      const alias = `p${index++}`;
      const location = resolvePartitionLocation(partition, partition.storageTarget, config);
      const escapedLocation = location.replace(/'/g, "''");
      await run(connection, `ATTACH '${escapedLocation}' AS ${alias}`);
      const quotedTable = quoteIdentifier(tableName);
      selects.push(`SELECT * FROM ${alias}.${quotedTable}`);

      const start = new Date(partition.startTime);
      const end = new Date(partition.endTime);
      minStart = Math.min(minStart, start.getTime());
      maxEnd = Math.max(maxEnd, end.getTime());
    }

    const unionSql = selects.join('\nUNION ALL\n');
    const rows = await all(connection, unionSql);

    return {
      rows,
      startTime: new Date(minStart),
      endTime: new Date(maxEnd)
    };
  } finally {
    await closeConnection(connection);
    if (isCloseable(db)) {
      db.close();
    }
  }
}

function buildPartitionKey(
  group: CompactionGroup,
  startTime: Date,
  endTime: Date
): Record<string, string> {
  const startIso = startTime.toISOString();
  const endIso = endTime.toISOString();
  return {
    compacted_range: `${startIso}__${endIso}`,
    partition_count: String(group.partitions.length)
  };
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function run(connection: any, sql: string, ...params: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.run(sql, ...params, (err: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function all(connection: any, sql: string, ...params: unknown[]): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    connection.all(sql, ...params, (err: Error | null, rows?: Record<string, unknown>[]) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows ?? []);
    });
  });
}

function closeConnection(connection: any): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.close((err: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

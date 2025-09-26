import type {
  DatasetManifestWithPartitions,
  DatasetPartitionRecord,
  PartitionInput
} from '../db/metadata';

export function partitionRecordToInput(partition: DatasetPartitionRecord): PartitionInput {
  return {
    id: partition.id,
    storageTargetId: partition.storageTargetId,
    fileFormat: partition.fileFormat,
    filePath: partition.filePath,
    partitionKey: partition.partitionKey,
    startTime: new Date(partition.startTime),
    endTime: new Date(partition.endTime),
    fileSizeBytes: partition.fileSizeBytes ?? undefined,
    rowCount: partition.rowCount ?? undefined,
    checksum: partition.checksum ?? undefined,
    metadata: partition.metadata
  };
}

export function computeStatistics(partitions: PartitionInput[]): Record<string, unknown> {
  const totals = partitions.reduce(
    (acc, partition) => {
      acc.bytes += partition.fileSizeBytes ?? 0;
      acc.rows += partition.rowCount ?? 0;
      acc.start = Math.min(acc.start, partition.startTime.getTime());
      acc.end = Math.max(acc.end, partition.endTime.getTime());
      return acc;
    },
    { bytes: 0, rows: 0, start: Number.POSITIVE_INFINITY, end: Number.NEGATIVE_INFINITY }
  );

  return {
    rowCount: totals.rows,
    fileSizeBytes: totals.bytes,
    startTime: Number.isFinite(totals.start) ? new Date(totals.start).toISOString() : undefined,
    endTime: Number.isFinite(totals.end) ? new Date(totals.end).toISOString() : undefined
  };
}

export function mergeSummaryLifecycle(
  manifest: DatasetManifestWithPartitions,
  key: string,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const previous = manifest.summary ?? {};
  const lifecycle = asRecord(previous.lifecycle);
  return {
    ...previous,
    lifecycle: {
      ...lifecycle,
      [key]: payload
    }
  };
}

export function mergeMetadataLifecycle(
  manifest: DatasetManifestWithPartitions,
  key: string,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const previous = manifest.metadata ?? {};
  const lifecycle = asRecord(previous.lifecycle);
  return {
    ...previous,
    lifecycle: {
      ...lifecycle,
      [key]: payload
    }
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

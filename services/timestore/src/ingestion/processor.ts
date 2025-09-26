import { createHash, randomUUID } from 'node:crypto';
import {
  createDataset,
  createDatasetManifest,
  createDatasetSchemaVersion,
  findSchemaVersionByChecksum,
  getLatestPublishedManifest,
  getDatasetBySlug,
  getIngestionBatch,
  getManifestById,
  getNextManifestVersion,
  getNextSchemaVersion,
  getStorageTargetById,
  recordIngestionBatch,
  updateDatasetDefaultStorageTarget,
  type DatasetRecord,
  type StorageTargetRecord
} from '../db/metadata';
import { loadServiceConfig } from '../config/serviceConfig';
import { createStorageDriver } from '../storage';
import { ensureDefaultStorageTarget } from '../service/bootstrap';
import type { IngestionJobPayload, IngestionProcessingResult } from './types';

export async function processIngestionJob(
  payload: IngestionJobPayload
): Promise<IngestionProcessingResult> {
  const config = loadServiceConfig();
  const datasetSlug = payload.datasetSlug.trim();
  const storageTarget = await resolveStorageTarget(payload);

  let dataset: DatasetRecord | null = await getDatasetBySlug(datasetSlug);
  if (!dataset) {
    dataset = await createDataset({
      id: `ds-${randomUUID()}`,
      slug: datasetSlug,
      name: payload.datasetName ?? datasetSlug,
      description: null,
      defaultStorageTargetId: storageTarget.id,
      metadata: {
        createdBy: 'timestore-ingestion'
      }
    });
  } else if (!dataset.defaultStorageTargetId) {
    await updateDatasetDefaultStorageTarget(dataset.id, storageTarget.id);
    dataset = {
      ...dataset,
      defaultStorageTargetId: storageTarget.id
    };
  }

  if (payload.idempotencyKey) {
    const existing = await getIngestionBatch(dataset.id, payload.idempotencyKey);
    if (existing) {
      const manifest = await getManifestById(existing.manifestId);
      if (manifest) {
        return {
          dataset,
          manifest,
          storageTarget,
          idempotencyKey: payload.idempotencyKey
        };
      }
    }
  }

  const schemaChecksum = createSchemaChecksum(payload.schema.fields);
  let schemaVersion = await findSchemaVersionByChecksum(dataset.id, schemaChecksum);
  if (!schemaVersion) {
    const version = await getNextSchemaVersion(dataset.id);
    schemaVersion = await createDatasetSchemaVersion({
      id: `dsv-${randomUUID()}`,
      datasetId: dataset.id,
      version,
      description: `Schema derived from ingestion at ${payload.receivedAt}`,
      schema: { fields: payload.schema.fields },
      checksum: schemaChecksum
    });
  }

  const manifestVersion = await getNextManifestVersion(dataset.id);
  const partitionId = `part-${randomUUID()}`;
  const tableName = payload.tableName ?? 'records';
  const driver = createStorageDriver(config, storageTarget);
  const writeResult = await driver.writePartition({
    datasetSlug,
    partitionId,
    partitionKey: payload.partition.key,
    tableName,
    schema: payload.schema.fields,
    rows: payload.rows
  });

  const startTime = new Date(payload.partition.timeRange.start);
  const endTime = new Date(payload.partition.timeRange.end);
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    throw new Error('Partition time range must include valid ISO timestamps');
  }

  if (endTime.getTime() < startTime.getTime()) {
    throw new Error('Partition end time must be greater than or equal to start time');
  }

  const previousManifest = await getLatestPublishedManifest(dataset.id);

  const manifest = await createDatasetManifest({
    id: `dm-${randomUUID()}`,
    datasetId: dataset.id,
    version: manifestVersion,
    status: 'published',
    schemaVersionId: schemaVersion.id,
    parentManifestId: previousManifest?.id,
    summary: {
      batchRowCount: writeResult.rowCount,
      tableName
    },
    statistics: {
      rowCount: writeResult.rowCount,
      fileSizeBytes: writeResult.fileSizeBytes,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString()
    },
    metadata: {
      tableName,
      storageTargetId: storageTarget.id
    },
    createdBy: 'timestore-ingestion',
    partitions: [
      {
        id: partitionId,
        storageTargetId: storageTarget.id,
        fileFormat: 'duckdb',
        filePath: writeResult.relativePath,
        partitionKey: payload.partition.key,
        startTime,
        endTime,
        fileSizeBytes: writeResult.fileSizeBytes,
        rowCount: writeResult.rowCount,
        checksum: writeResult.checksum,
        metadata: {
          tableName
        }
      }
    ]
  });

  if (payload.idempotencyKey) {
    await recordIngestionBatch({
      id: `ing-${randomUUID()}`,
      datasetId: dataset.id,
      idempotencyKey: payload.idempotencyKey,
      manifestId: manifest.id
    });
  }

  return {
    dataset,
    manifest,
    storageTarget,
    idempotencyKey: payload.idempotencyKey
  };
}

async function resolveStorageTarget(payload: IngestionJobPayload): Promise<StorageTargetRecord> {
  if (payload.storageTargetId) {
    const target = await getStorageTargetById(payload.storageTargetId);
    if (!target) {
      throw new Error(`Storage target ${payload.storageTargetId} not found`);
    }
    return target;
  }

  const defaultTarget = await ensureDefaultStorageTarget();
  return defaultTarget;
}

function createSchemaChecksum(fields: IngestionJobPayload['schema']['fields']): string {
  const canonical = JSON.stringify(fields.map((field) => ({ name: field.name, type: field.type })));
  return createHash('sha1').update(canonical).digest('hex');
}

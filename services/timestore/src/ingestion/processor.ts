import { createHash, randomUUID } from 'node:crypto';
import {
  appendPartitionsToManifest,
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
  getSchemaVersionById,
  getStorageTargetById,
  getPartitionsWithTargetsForManifest,
  recordIngestionBatch,
  updateDatasetDefaultStorageTarget,
  type DatasetRecord,
  type PartitionInput,
  type StorageTargetRecord
} from '../db/metadata';
import { loadServiceConfig } from '../config/serviceConfig';
import { createStorageDriver } from '../storage';
import type { FieldDefinition } from '../storage';
import { ensureDefaultStorageTarget } from '../service/bootstrap';
import type { IngestionJobPayload, IngestionProcessingResult } from './types';
import { observeIngestionJob } from '../observability/metrics';
import { publishTimestoreEvent } from '../events/publisher';
import { endSpan, startSpan } from '../observability/tracing';
import { invalidateSqlRuntimeCache } from '../sql/runtime';
import { refreshManifestCache } from '../cache/manifestCache';
import { deriveManifestShardKey } from '../service/manifestShard';
import {
  analyzeSchemaCompatibility,
  extractFieldDefinitions,
  normalizeFieldDefinitions,
  type SchemaCompatibilityResult,
  type SchemaMigrationPlan
} from '../schema/compatibility';

class SchemaEvolutionError extends Error {
  readonly reasons: string[];
  readonly migrationPlan?: SchemaMigrationPlan;

  constructor(datasetSlug: string, result: SchemaCompatibilityResult) {
    const reasons = result.breakingReasons.length > 0
      ? result.breakingReasons.join('; ')
      : 'incompatible schema change detected';
    super(`Schema evolution for dataset '${datasetSlug}' is incompatible: ${reasons}`);
    this.name = 'SchemaEvolutionError';
    this.reasons = result.breakingReasons;
    this.migrationPlan = result.migrationPlan;
  }
}

export async function processIngestionJob(
  payload: IngestionJobPayload
): Promise<IngestionProcessingResult> {
  const config = loadServiceConfig();
  const datasetSlug = payload.datasetSlug.trim();
  const span = startSpan('timestore.ingest.process', {
    'timestore.dataset_slug': datasetSlug
  });
  const start = process.hrtime.bigint();
  try {
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
          observeIngestionJob({
            datasetSlug,
            result: 'success',
            durationSeconds: durationSince(start)
          });
          endSpan(span);
          return {
            dataset,
            manifest,
            storageTarget,
            idempotencyKey: payload.idempotencyKey
          };
        }
      }
    }

    const schemaFields = normalizeFieldDefinitions(payload.schema.fields);
    const rawDefaults = payload.schema.evolution?.defaults;
    const schemaDefaults =
      rawDefaults && typeof rawDefaults === 'object' && !Array.isArray(rawDefaults)
        ? (rawDefaults as Record<string, unknown>)
        : {};
    const backfillRequested = payload.schema.evolution?.backfill === true;

    const startTime = new Date(payload.partition.timeRange.start);
    const endTime = new Date(payload.partition.timeRange.end);
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
      throw new Error('Partition time range must include valid ISO timestamps');
    }

    if (endTime.getTime() < startTime.getTime()) {
      throw new Error('Partition end time must be greater than or equal to start time');
    }

    const manifestShard = deriveManifestShardKey(startTime);
    const previousManifest = await getLatestPublishedManifest(dataset.id, { shard: manifestShard });
    const baselineManifest = previousManifest ?? (await getLatestPublishedManifest(dataset.id));

    let compatibility: SchemaCompatibilityResult | null = null;
    if (baselineManifest?.schemaVersionId) {
      const baselineSchemaVersion = await getSchemaVersionById(baselineManifest.schemaVersionId);
      const baselineFields = baselineSchemaVersion
        ? extractFieldDefinitions(baselineSchemaVersion.schema)
        : [];
      compatibility = analyzeSchemaCompatibility(baselineFields, schemaFields);
      if (compatibility.status === 'breaking') {
        throw new SchemaEvolutionError(datasetSlug, compatibility);
      }
    }

    const schemaChecksum = createSchemaChecksum(schemaFields);
    let schemaVersion = await findSchemaVersionByChecksum(dataset.id, schemaChecksum);
    if (!schemaVersion) {
      const version = await getNextSchemaVersion(dataset.id);
      schemaVersion = await createDatasetSchemaVersion({
        id: `dsv-${randomUUID()}`,
        datasetId: dataset.id,
        version,
        description: `Schema derived from ingestion at ${payload.receivedAt}`,
        schema: { fields: schemaFields },
        checksum: schemaChecksum
      });
    }

    const partitionId = `part-${randomUUID()}`;
    const tableName = payload.tableName ?? 'records';
    const driver = createStorageDriver(config, storageTarget);
    const writeResult = await driver.writePartition({
      datasetSlug,
      partitionId,
      partitionKey: payload.partition.key,
      tableName,
      schema: schemaFields,
      rows: payload.rows
    });
    const partitionInput = {
      id: partitionId,
      storageTargetId: storageTarget.id,
      fileFormat: 'duckdb' as const,
      filePath: writeResult.relativePath,
      partitionKey: payload.partition.key,
      startTime,
      endTime,
      fileSizeBytes: writeResult.fileSizeBytes,
      rowCount: writeResult.rowCount,
      checksum: writeResult.checksum,
      metadata: {
        tableName,
        schemaVersionId: schemaVersion.id
      }
    } satisfies PartitionInput;

    const summaryPatch = {
      batchRowCount: writeResult.rowCount,
      tableName,
      lastPartitionId: partitionId,
      lastIngestedAt: payload.receivedAt,
      schemaVersionId: schemaVersion.id
    } satisfies Record<string, unknown>;

    const metadataPatch: Record<string, unknown> = {
      tableName,
      storageTargetId: storageTarget.id,
      schemaVersionId: schemaVersion.id
    };

    if (compatibility?.status === 'additive' && compatibility.addedFields.length > 0) {
      metadataPatch.schemaEvolution = {
        status: 'additive',
        addedColumns: compatibility.addedFields.map((field) => field.name),
        requestedBackfill: backfillRequested
      } satisfies Record<string, unknown>;
    }

    let manifest: import('../db/metadata').DatasetManifestWithPartitions;

    const canReuseManifest =
      Boolean(previousManifest) &&
      (previousManifest?.schemaVersionId === schemaVersion.id || compatibility?.status === 'additive');

    if (previousManifest && canReuseManifest) {
      manifest = await appendPartitionsToManifest({
        datasetId: dataset.id,
        manifestId: previousManifest.id,
        partitions: [partitionInput],
        summaryPatch,
        metadataPatch,
        schemaVersionId: schemaVersion.id
      });
    } else {
      const manifestVersion = await getNextManifestVersion(dataset.id);
      manifest = await createDatasetManifest({
        id: `dm-${randomUUID()}`,
        datasetId: dataset.id,
        version: manifestVersion,
        status: 'published',
        manifestShard,
        schemaVersionId: schemaVersion.id,
        parentManifestId: previousManifest?.id ?? null,
        summary: summaryPatch,
        statistics: {
          rowCount: writeResult.rowCount,
          fileSizeBytes: writeResult.fileSizeBytes,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString()
        },
        metadata: metadataPatch,
        createdBy: 'timestore-ingestion',
        partitions: [partitionInput]
      });
    }

    if (payload.idempotencyKey) {
      await recordIngestionBatch({
        id: `ing-${randomUUID()}`,
        datasetId: dataset.id,
        idempotencyKey: payload.idempotencyKey,
        manifestId: manifest.id
      });
    }

    try {
      const partitionsWithTargets = await getPartitionsWithTargetsForManifest(manifest.id);
      const { partitions: _cachedPartitions, ...manifestRecord } = manifest;
      await refreshManifestCache(
        { id: dataset.id, slug: dataset.slug },
        manifestRecord,
        partitionsWithTargets
      );
    } catch (err) {
      console.warn('[timestore] failed to refresh manifest cache after ingestion', err);
    }

    observeIngestionJob({
      datasetSlug,
      result: 'success',
      durationSeconds: durationSince(start)
    });

    const addedColumns = compatibility?.addedFields.map((field) => field.name) ?? [];

    try {
      await publishTimestoreEvent(
        'timestore.partition.created',
        {
          datasetId: dataset.id,
          datasetSlug,
          manifestId: manifest.id,
          partitionId,
          partitionKey: payload.partition.key,
          storageTargetId: storageTarget.id,
          filePath: writeResult.relativePath,
          rowCount: writeResult.rowCount,
          fileSizeBytes: writeResult.fileSizeBytes,
          checksum: writeResult.checksum ?? null,
          receivedAt: payload.receivedAt
        },
        'timestore.ingest'
      );
    } catch (err) {
      console.error('[timestore] failed to publish partition.created event', err);
    }

    if (addedColumns.length > 0) {
      try {
        await publishTimestoreEvent(
          'timestore.schema.evolved',
          {
            datasetId: dataset.id,
            datasetSlug,
            manifestId: manifest.id,
            previousManifestId: previousManifest?.id ?? null,
            schemaVersionId: schemaVersion.id,
            addedColumns
          },
          'timestore.ingest'
        );
      } catch (err) {
        console.error('[timestore] failed to publish schema.evolved event', err);
      }
    }

    if (backfillRequested && addedColumns.length > 0) {
      try {
        const defaults = Object.fromEntries(
          addedColumns.map((column) => [column, schemaDefaults[column] ?? null])
        );
        await publishTimestoreEvent(
          'timestore.schema.backfill.requested',
          {
            datasetId: dataset.id,
            datasetSlug,
            manifestId: manifest.id,
            schemaVersionId: schemaVersion.id,
            addedColumns,
            defaults
          },
          'timestore.ingest'
        );
      } catch (err) {
        console.error('[timestore] failed to publish schema.backfill.requested event', err);
      }
    }

    invalidateSqlRuntimeCache();

    endSpan(span);
    return {
      dataset,
      manifest,
      storageTarget,
      idempotencyKey: payload.idempotencyKey
    };
  } catch (error) {
    observeIngestionJob({
      datasetSlug,
      result: 'failure',
      durationSeconds: durationSince(start)
    });
    endSpan(span, error);
    throw error;
  }
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

function createSchemaChecksum(fields: FieldDefinition[]): string {
  const canonical = JSON.stringify(fields.map((field) => ({ name: field.name, type: field.type })));
  return createHash('sha1').update(canonical).digest('hex');
}

function durationSince(start: bigint): number {
  const elapsed = Number(process.hrtime.bigint() - start);
  return elapsed / 1_000_000_000;
}

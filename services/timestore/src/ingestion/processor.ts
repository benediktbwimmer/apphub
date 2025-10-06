import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseError } from 'pg';
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
  findPartitionByIngestionSignature,
  recordIngestionBatch,
  replacePartitionsInManifest,
  updateDatasetDefaultStorageTarget,
  type DatasetRecord,
  type DatasetManifestWithPartitions,
  type DatasetPartitionRecord,
  type PartitionInput,
  type StorageTargetRecord
} from '../db/metadata';
import { loadServiceConfig, type ServiceConfig } from '../config/serviceConfig';
import { partitionFileExists, type FieldDefinition } from '../storage';
import { ensureDefaultStorageTarget } from '../service/bootstrap';
import type { IngestionJobPayload, IngestionProcessingResult } from './types';
import { observeIngestionJob, observeStagingFlush, recordStagingRetry } from '../observability/metrics';
import { publishTimestoreEvent } from '../events/publisher';
import { endSpan, startSpan } from '../observability/tracing';
import { invalidateSqlRuntimeCache } from '../sql/runtime';
import { refreshManifestCache } from '../cache/manifestCache';
import { deriveManifestShardKey } from '../service/manifestShard';
import { computePartitionIndexForRows } from '../indexing/partitionIndex';
import { executePartitionBuild } from './partitionBuilderClient';
import { getStagingWriteManager, resetStagingWriteManager } from './stagingManager';
import { resolveFlushThresholds, maybePrepareDatasetFlush } from './flushPlanner';
import {
  DuckDbSpoolManager,
  type PreparedFlushBatch,
  type PreparedFlushResult,
  type StagePartitionRequest
} from '../storage/spoolManager';
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

interface FlushExecutionContext {
  dataset: DatasetRecord;
  datasetSlug: string;
  storageTarget: StorageTargetRecord;
  config: ServiceConfig;
  spoolManager: DuckDbSpoolManager;
  flushResult: PreparedFlushResult;
  baselineManifest: DatasetManifestWithPartitions | null;
  previousManifest: DatasetManifestWithPartitions | null;
  reusePartition?: (
    partition: DatasetPartitionRecord,
    idempotencyKey: string | null
  ) => Promise<DatasetManifestWithPartitions | null>;
}

interface FlushExecutionOutcome {
  latestManifest: DatasetManifestWithPartitions | null;
}

async function performPreparedFlush(context: FlushExecutionContext): Promise<FlushExecutionOutcome> {
  const {
    dataset,
    datasetSlug,
    storageTarget,
    config,
    spoolManager,
    flushResult,
    baselineManifest,
    previousManifest,
    reusePartition
  } = context;

  const schemaVersionCache = new Map<string, string>();
  const manifestByShard = new Map<string, DatasetManifestWithPartitions>();
  let globalBaselineManifest = baselineManifest ?? null;
  let latestManifest: DatasetManifestWithPartitions | null = previousManifest ?? baselineManifest ?? null;

  try {
    for (const batch of flushResult.batches) {
      const manifest = await processFlushBatch(batch);
      if (manifest) {
        latestManifest = manifest;
        manifestByShard.set(manifest.manifestShard, manifest);
        globalBaselineManifest = manifest;
      }
    }

    await spoolManager.finalizeFlush(datasetSlug, flushResult.flushToken);

    return { latestManifest } satisfies FlushExecutionOutcome;
  } catch (error) {
    await spoolManager.abortFlush(datasetSlug, flushResult.flushToken).catch(() => undefined);
    throw error;
  }

  async function processFlushBatch(batch: PreparedFlushBatch): Promise<DatasetManifestWithPartitions | null> {
    const schemaFields = normalizeFieldDefinitions(batch.schema);
    const partitionKey = batch.partitionKey ?? {};
    const partitionAttributes = batch.partitionAttributes ?? null;
    const partitionKeyString = buildPartitionKeyString(partitionKey);
    const startTime = new Date(batch.timeRange.start);
    const endTime = new Date(batch.timeRange.end);

    if (!Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime())) {
      throw new Error('Staged partition includes invalid time range');
    }

    const manifestShardKey = deriveManifestShardKey(startTime);

    let shardManifest = manifestByShard.get(manifestShardKey);
    if (!shardManifest) {
      const fetchedManifest = await getLatestPublishedManifest(dataset.id, { shard: manifestShardKey });
      if (fetchedManifest) {
        shardManifest = fetchedManifest;
        manifestByShard.set(manifestShardKey, fetchedManifest);
      }
    }

    let baselineForCompatibility = shardManifest ?? globalBaselineManifest;
    if (!baselineForCompatibility) {
      baselineForCompatibility = await getLatestPublishedManifest(dataset.id);
      globalBaselineManifest = baselineForCompatibility;
    }

    let compatibility: SchemaCompatibilityResult | null = null;
    if (baselineForCompatibility?.schemaVersionId) {
      const baselineSchemaVersion = await getSchemaVersionById(baselineForCompatibility.schemaVersionId);
      const baselineFields = baselineSchemaVersion
        ? extractFieldDefinitions(baselineSchemaVersion.schema)
        : [];
      compatibility = analyzeSchemaCompatibility(baselineFields, schemaFields);
      if (compatibility.status === 'breaking') {
        throw new SchemaEvolutionError(datasetSlug, compatibility);
      }
    }

    const schemaChecksum = createSchemaChecksum(schemaFields);
    let schemaVersionId = schemaVersionCache.get(schemaChecksum);
    let schemaVersionRecord = schemaVersionId
      ? await getSchemaVersionById(schemaVersionId)
      : await findSchemaVersionByChecksum(dataset.id, schemaChecksum);

    if (!schemaVersionRecord) {
      const versionNumber = await getNextSchemaVersion(dataset.id);
      schemaVersionRecord = await createDatasetSchemaVersion({
        id: `dsv-${randomUUID()}`,
        datasetId: dataset.id,
        version: versionNumber,
        description: `Schema derived from staged ingestion at ${batch.receivedAt}`,
        schema: { fields: schemaFields },
        checksum: schemaChecksum
      });
    }
    schemaVersionCache.set(schemaChecksum, schemaVersionRecord.id);

    const partitionIndex = computePartitionIndexForRows(batch.rows, schemaFields, config.partitionIndex);

    const partitionId = `part-${randomUUID()}`;
    const writeResult = await executePartitionBuild(config, {
      datasetSlug,
      storageTarget,
      partitionId,
      partitionKey,
      tableName: batch.tableName,
      schema: schemaFields,
      sourceFilePath: batch.parquetFilePath,
      rowCountHint: batch.rowCount
    });

    const partitionInput: PartitionInput = {
      id: partitionId,
      storageTargetId: storageTarget.id,
      fileFormat: 'parquet',
      filePath: writeResult.relativePath,
      partitionKey,
      startTime,
      endTime,
      fileSizeBytes: writeResult.fileSizeBytes,
      rowCount: writeResult.rowCount,
      checksum: writeResult.checksum,
      metadata: {
        tableName: batch.tableName,
        schemaVersionId: schemaVersionRecord.id,
        ...(partitionAttributes ? { attributes: partitionAttributes } : {})
      },
      columnStatistics: partitionIndex.columnStatistics,
      columnBloomFilters: partitionIndex.columnBloomFilters,
      ingestionSignature: batch.ingestionSignature
    };

    const summaryPatch = {
      batchRowCount: writeResult.rowCount,
      tableName: batch.tableName,
      lastPartitionId: partitionId,
      lastIngestedAt: batch.receivedAt,
      schemaVersionId: schemaVersionRecord.id
    } satisfies Record<string, unknown>;

    const metadataPatch: Record<string, unknown> = {
      tableName: batch.tableName,
      storageTargetId: storageTarget.id,
      schemaVersionId: schemaVersionRecord.id,
      ...(partitionAttributes ? { attributes: partitionAttributes } : {})
    };

    if (compatibility?.status === 'additive' && compatibility.addedFields.length > 0) {
      metadataPatch.schemaEvolution = {
        status: 'additive',
        addedColumns: compatibility.addedFields.map((field) => field.name),
        requestedBackfill: batch.backfillRequested === true
      } satisfies Record<string, unknown>;
    }

    try {
      if (shardManifest && (shardManifest.schemaVersionId === schemaVersionRecord.id || compatibility?.status === 'additive')) {
        shardManifest = await appendPartitionsToManifest({
          datasetId: dataset.id,
          manifestId: shardManifest.id,
          partitions: [partitionInput],
          summaryPatch,
          metadataPatch,
          schemaVersionId: schemaVersionRecord.id
        });
      } else {
        const manifestVersion = await getNextManifestVersion(dataset.id);
        shardManifest = await createDatasetManifest({
          id: `dm-${randomUUID()}`,
          datasetId: dataset.id,
          version: manifestVersion,
          status: 'published',
          manifestShard: manifestShardKey,
          schemaVersionId: schemaVersionRecord.id,
          parentManifestId: shardManifest?.id ?? null,
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
    } catch (error) {
      if (isIngestionSignatureConflict(error)) {
        const existingPartition = await findPartitionByIngestionSignature(
          dataset.id,
          batch.ingestionSignature
        );
        if (existingPartition) {
          const reusedManifest = await (reusePartition
            ? reusePartition(existingPartition, batch.idempotencyKey ?? null)
            : getManifestById(existingPartition.manifestId));
          if (reusedManifest) {
            if (batch.idempotencyKey) {
              await recordIngestionBatch({
                id: `ing-${randomUUID()}`,
                datasetId: dataset.id,
                idempotencyKey: batch.idempotencyKey,
                manifestId: reusedManifest.id
              });
            }
            return reusedManifest;
          }
        }
      }
      throw error;
    }

    if (batch.idempotencyKey) {
      await recordIngestionBatch({
        id: `ing-${randomUUID()}`,
        datasetId: dataset.id,
        idempotencyKey: batch.idempotencyKey,
        manifestId: shardManifest.id
      });
    }

    try {
      const partitionsWithTargets = await getPartitionsWithTargetsForManifest(shardManifest.id);
      const { partitions: _cachedPartitions, ...manifestRecord } = shardManifest;
      await refreshManifestCache(
        { id: dataset.id, slug: dataset.slug },
        manifestRecord,
        partitionsWithTargets
      );
    } catch (err) {
      console.warn('[timestore] failed to refresh manifest cache after ingestion', err);
    }

    const addedColumns = compatibility?.addedFields.map((field) => field.name) ?? [];

    try {
      await publishTimestoreEvent(
        'timestore.partition.created',
        {
          datasetId: dataset.id,
          datasetSlug,
          manifestId: shardManifest.id,
          partitionId,
          partitionKey: partitionKeyString,
          partitionKeyFields: partitionKey,
          storageTargetId: storageTarget.id,
          filePath: writeResult.relativePath,
          rowCount: writeResult.rowCount,
          fileSizeBytes: writeResult.fileSizeBytes,
          checksum: writeResult.checksum ?? null,
          receivedAt: batch.receivedAt,
          attributes: partitionAttributes ?? null
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
            manifestId: shardManifest.id,
            previousManifestId: shardManifest.parentManifestId ?? null,
            schemaVersionId: schemaVersionRecord.id,
            addedColumns
          },
          'timestore.ingest'
        );
      } catch (err) {
        console.error('[timestore] failed to publish schema.evolved event', err);
      }
    }

    if (batch.backfillRequested && addedColumns.length > 0) {
      try {
        const defaultsSource = batch.schemaDefaults ?? {};
        const defaults = Object.fromEntries(
          addedColumns.map((column) => [column, (defaultsSource as Record<string, unknown>)[column] ?? null])
        );
        await publishTimestoreEvent(
          'timestore.schema.backfill.requested',
          {
            datasetId: dataset.id,
            datasetSlug,
            manifestId: shardManifest.id,
            schemaVersionId: schemaVersionRecord.id,
            addedColumns,
            defaults
          },
          'timestore.ingest'
        );
      } catch (err) {
        console.error('[timestore] failed to publish schema.backfill.requested event', err);
      }
    }

    invalidateSqlRuntimeCache({
      datasetId: dataset.id,
      datasetSlug,
      reason: 'ingestion'
    });

    return shardManifest;
  }
}

export async function processIngestionJob(
  payload: IngestionJobPayload
): Promise<IngestionProcessingResult> {
  const config = loadServiceConfig();
  await resetStagingWriteManager();
  const stagingManager = getStagingWriteManager(config);
  const datasetSlug = payload.datasetSlug.trim();
  const span = startSpan('timestore.ingest.process', {
    'timestore.dataset_slug': datasetSlug
  });
  const start = process.hrtime.bigint();
  try {
    const storageTarget = await resolveStorageTarget(payload);

    const existingDataset = await getDatasetBySlug(datasetSlug);
    let dataset: DatasetRecord;
    if (!existingDataset) {
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
    } else if (!existingDataset.defaultStorageTargetId) {
      await updateDatasetDefaultStorageTarget(existingDataset.id, storageTarget.id);
      dataset = {
        ...existingDataset,
        defaultStorageTargetId: storageTarget.id
      };
    } else {
      dataset = existingDataset;
    }

    const reuseExistingPartition = async (
      partition: DatasetPartitionRecord,
      idempotencyKey: string | null | undefined
    ): Promise<IngestionProcessingResult | null> => {
      const manifest = await getManifestById(partition.manifestId);
      if (!manifest) {
        return null;
      }

      const existingTarget = partition.storageTargetId
        ? await getStorageTargetById(partition.storageTargetId)
        : null;
      if (!existingTarget) {
        return null;
      }

      const filePresent = await partitionFileExists(partition, existingTarget, config);
      if (!filePresent) {
        console.warn('[timestore:ingest] partition reuse skipped; partition file missing', {
          datasetSlug,
          partitionId: partition.id,
          storageTargetId: existingTarget.id,
          partitionPath: manifest.partitions?.[0]?.filePath ?? partition.filePath
        });
        try {
          await replacePartitionsInManifest({
            datasetId: dataset.id,
            manifestId: manifest.id,
            removePartitionIds: [partition.id],
            addPartitions: [],
            summaryPatch: {},
            metadataPatch: {}
          });
        } catch (removeError) {
          console.warn('[timestore:ingest] failed to remove stale partition during reuse fallback', {
            datasetSlug,
            partitionId: partition.id,
            error: removeError instanceof Error ? removeError.message : removeError
          });
        }
        return null;
      }

      if (idempotencyKey) {
        await recordIngestionBatch({
          id: `ing-${randomUUID()}`,
          datasetId: dataset.id,
          idempotencyKey,
          manifestId: manifest.id
        });
      }

      observeIngestionJob({
        datasetSlug,
        result: 'success',
        durationSeconds: durationSince(start)
      });
      return {
        dataset,
        manifest,
        storageTarget: existingTarget,
        idempotencyKey: idempotencyKey ?? null,
        flushPending: false
      };
    };

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
            idempotencyKey: payload.idempotencyKey,
            flushPending: false
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
    const partitionKey = normalizeStringMap(payload.partition.key) ?? {};
    const partitionAttributes = normalizeStringMap(payload.partition.attributes ?? null);
    const partitionKeyString = buildPartitionKeyString(partitionKey);

    const ingestionSignature = computeIngestionSignature({
      datasetId: dataset.id,
      datasetSlug,
      schemaChecksum,
      partitionKey,
      startTime,
      endTime,
      rows: payload.rows ?? []
    });

    const existingPartitionBySignature = await findPartitionByIngestionSignature(
      dataset.id,
      ingestionSignature
    );
    if (existingPartitionBySignature) {
      const reused = await reuseExistingPartition(existingPartitionBySignature, payload.idempotencyKey ?? null);
      if (reused) {
        endSpan(span);
        return reused;
      }
    }

    const tableName = payload.tableName ?? 'records';
    const stageRequest: StagePartitionRequest = {
      datasetSlug,
      tableName,
      schema: schemaFields,
      rows: payload.rows,
      partitionKey,
      partitionAttributes: partitionAttributes ?? null,
      timeRange: {
        start: payload.partition.timeRange.start,
        end: payload.partition.timeRange.end
      },
      ingestionSignature,
      receivedAt: payload.receivedAt
    };

    await stagingManager.enqueue({
      ...stageRequest,
      idempotencyKey: payload.idempotencyKey ?? null,
      schemaDefaults,
      backfillRequested
    });

    const spoolManager = stagingManager.getSpoolManager();
    const flushThresholds = resolveFlushThresholds(config, dataset);
    const flushPreparation = await maybePrepareDatasetFlush(spoolManager, datasetSlug, flushThresholds);

    if (!flushPreparation) {
      observeIngestionJob({
        datasetSlug,
        result: 'success',
        durationSeconds: durationSince(start)
      });

      endSpan(span);
      return {
        dataset,
        manifest: previousManifest ?? baselineManifest ?? null,
        storageTarget,
        idempotencyKey: payload.idempotencyKey,
        flushPending: true
      } satisfies IngestionProcessingResult;
    }

    const flushStart = process.hrtime.bigint();
    const flushBatchCount = flushPreparation.result.batches.length;
    const flushRowCount = flushPreparation.result.batches.reduce(
      (total, batch) => total + Math.max(0, Number(batch.rowCount ?? 0)),
      0
    );

    try {
      const { latestManifest } = await performPreparedFlush({
        dataset,
        datasetSlug,
        storageTarget,
        config,
        spoolManager,
        flushResult: flushPreparation.result,
        baselineManifest,
        previousManifest,
        reusePartition: async (partition, idempotencyKey) => {
          const reused = await reuseExistingPartition(partition, idempotencyKey ?? null);
          return reused?.manifest ?? null;
        }
      });

      observeStagingFlush({
        datasetSlug,
        result: 'success',
        durationSeconds: durationSince(flushStart),
        batches: flushBatchCount,
        rows: flushRowCount
      });

      observeIngestionJob({
        datasetSlug,
        result: 'success',
        durationSeconds: durationSince(start)
      });

      endSpan(span);
      return {
        dataset,
        manifest: latestManifest ?? previousManifest ?? baselineManifest ?? null,
        storageTarget,
        idempotencyKey: payload.idempotencyKey,
        flushPending: false
      } satisfies IngestionProcessingResult;
    } catch (error) {
      observeStagingFlush({
        datasetSlug,
        result: 'failure',
        durationSeconds: durationSince(flushStart),
        batches: flushBatchCount,
        rows: flushRowCount
      });

      observeIngestionJob({
        datasetSlug,
        result: 'failure',
        durationSeconds: durationSince(start)
      });

      endSpan(span, error);
      throw error;
    }
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

export interface DatasetFlushResult {
  status: 'noop' | 'flushed';
  batches: number;
  rows: number;
  manifest: DatasetManifestWithPartitions | null;
}

export async function flushDatasetStaging(
  datasetSlug: string,
  options: { storageTargetId?: string } = {}
): Promise<DatasetFlushResult> {
  const config = loadServiceConfig();
  const stagingManager = getStagingWriteManager(config);
  const spoolManager = stagingManager.getSpoolManager();

  const dataset = await getDatasetBySlug(datasetSlug);
  if (!dataset) {
    throw new Error(`Dataset ${datasetSlug} not found`);
  }

  let storageTarget: StorageTargetRecord | null = null;
  if (options.storageTargetId) {
    storageTarget = await getStorageTargetById(options.storageTargetId);
    if (!storageTarget) {
      throw new Error(`Storage target ${options.storageTargetId} not found`);
    }
  } else if (dataset.defaultStorageTargetId) {
    storageTarget = await getStorageTargetById(dataset.defaultStorageTargetId);
    if (!storageTarget) {
      throw new Error(`Storage target ${dataset.defaultStorageTargetId} not found`);
    }
  } else {
    storageTarget = await ensureDefaultStorageTarget();
  }

  const prepared = await spoolManager.prepareFlush(datasetSlug);
  if (!prepared || prepared.batches.length === 0) {
    return { status: 'noop', batches: 0, rows: 0, manifest: null } satisfies DatasetFlushResult;
  }

  const flushStart = process.hrtime.bigint();
  let pending = prepared;
  let attemptsRemaining = 5;

  while (attemptsRemaining > 0) {
    const flushBatchCount = pending.batches.length;
    const flushRowCount = pending.batches.reduce(
      (total, batch) => total + Math.max(0, Number(batch.rowCount ?? 0)),
      0
    );

    const firstBatch = pending.batches[0];
    const shardKey = deriveManifestShardKey(new Date(firstBatch.timeRange.start));
    const previousManifest = await getLatestPublishedManifest(dataset.id, { shard: shardKey });
    const baselineManifest = previousManifest ?? (await getLatestPublishedManifest(dataset.id));

    try {
      const { latestManifest } = await performPreparedFlush({
        dataset,
        datasetSlug,
        storageTarget,
        config,
        spoolManager,
        flushResult: pending,
        baselineManifest,
        previousManifest,
        reusePartition: async (partition, idempotencyKey) => {
          const manifest = await getManifestById(partition.manifestId);
          if (!manifest) {
            return null;
          }
          if (idempotencyKey) {
            await recordIngestionBatch({
              id: `ing-${randomUUID()}`,
              datasetId: dataset.id,
              idempotencyKey,
              manifestId: manifest.id
            });
          }
          return manifest;
        }
      });

      observeStagingFlush({
        datasetSlug,
        result: 'success',
        durationSeconds: durationSince(flushStart),
        batches: flushBatchCount,
        rows: flushRowCount
      });

      return {
        status: 'flushed',
        batches: flushBatchCount,
        rows: flushRowCount,
        manifest: latestManifest ?? previousManifest ?? baselineManifest ?? null
      } satisfies DatasetFlushResult;
    } catch (error) {
      attemptsRemaining -= 1;
      const retryable = isTransientDuckDbError(error) && attemptsRemaining > 0;
      if (!retryable) {
        observeStagingFlush({
          datasetSlug,
          result: 'failure',
          durationSeconds: durationSince(flushStart),
          batches: flushBatchCount,
          rows: flushRowCount
        });
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 500 * (6 - attemptsRemaining)));
      const retried = await spoolManager.prepareFlush(datasetSlug);
      if (!retried || retried.batches.length === 0) {
        observeStagingFlush({
          datasetSlug,
          result: 'success',
          durationSeconds: durationSince(flushStart),
          batches: 0,
          rows: 0
        });
        return {
          status: 'noop',
          batches: 0,
          rows: 0,
          manifest: null
        } satisfies DatasetFlushResult;
      }
      pending = retried;
    }
  }

  throw new Error('Failed to flush dataset staging after retries');
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

function isTransientDuckDbError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === 'DUCKDB_NODEJS_ERROR') {
    return true;
  }
  if (typeof candidate.message === 'string') {
    return /Connection Error:/i.test(candidate.message);
  }
  return false;
}

function normalizeStringMap(input: Record<string, string> | undefined | null): Record<string, string> | null {
  if (!input) {
    return null;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const trimmedKey = typeof key === 'string' ? key.trim() : '';
    if (!trimmedKey) {
      continue;
    }
    if (typeof value !== 'string') {
      continue;
    }
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      continue;
    }
    result[trimmedKey] = trimmedValue;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function buildPartitionKeyString(key: Record<string, string>): string | null {
  const entries = Object.entries(key);
  if (entries.length === 0) {
    return null;
  }
  const parts = entries
    .map(([field, value]) => ({ field, value }))
    .filter(({ field, value }) => field.length > 0 && value.length > 0)
    .sort((a, b) => a.field.localeCompare(b.field))
    .map(({ field, value }) => `${field}=${value}`);
  return parts.length > 0 ? parts.join('|') : null;
}

function computeIngestionSignature(params: {
  datasetId: string;
  datasetSlug: string;
  schemaChecksum: string;
  partitionKey: Record<string, string>;
  startTime: Date;
  endTime: Date;
  rows: Record<string, unknown>[];
}): string {
  const { datasetId, datasetSlug, schemaChecksum, partitionKey, startTime, endTime, rows } = params;
  const canonicalKey = Object.entries(partitionKey)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value }));
  const payload = {
    datasetId,
    datasetSlug,
    schemaChecksum,
    partitionKey: canonicalKey,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    rowHash: hashRowsForSignature(rows)
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function hashRowsForSignature(rows: Record<string, unknown>[]): string {
  if (!rows || rows.length === 0) {
    return createHash('sha256').update('[]').digest('hex');
  }
  const canonicalRows = rows.map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row).sort((a, b) => a[0].localeCompare(b[0]))) {
      if (value === undefined) {
        continue;
      }
      normalized[key] = normalizeValueForHash(value);
    }
    return normalized;
  });
  return createHash('sha256').update(JSON.stringify(canonicalRows)).digest('hex');
}

function normalizeValueForHash(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValueForHash(entry));
  }
  if (value && typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).sort((a, b) => a[0].localeCompare(b[0]))) {
      if (entry === undefined) {
        continue;
      }
      normalized[key] = normalizeValueForHash(entry);
    }
    return normalized;
  }
  return value;
}

function isIngestionSignatureConflict(error: unknown): error is DatabaseError {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const maybe = error as Partial<DatabaseError> & { constraint?: string };
  return maybe.code === '23505' && maybe.constraint === 'uq_dataset_partitions_ingestion_signature';
}

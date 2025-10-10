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
  getManifestById,
  getNextManifestVersion,
  getNextSchemaVersion,
  getSchemaVersionById,
  getStorageTargetById,
  getPartitionsWithTargetsForManifest,
  findPartitionByIngestionSignature,
  recordIngestionBatch,
  updateDatasetDefaultStorageTarget,
  type DatasetRecord,
  type DatasetManifestWithPartitions,
  type DatasetPartitionRecord,
  type PartitionInput,
  type StorageTargetRecord
} from '../db/metadata';
import { loadServiceConfig, type ServiceConfig } from '../config/serviceConfig';
import { ensureDefaultStorageTarget } from '../service/bootstrap';
import type { IngestionJobPayload, IngestionProcessingResult } from './types';
import {
  analyzeSchemaCompatibility,
  extractFieldDefinitions,
  normalizeFieldDefinitions,
  type SchemaCompatibilityResult,
  type SchemaMigrationPlan
} from '../schema/compatibility';
import { deriveManifestShardKey } from '../service/manifestShard';
import { computePartitionIndexForRows } from '../indexing/partitionIndex';
import { publishTimestoreEvent } from '../events/publisher';
import { observeIngestionJob, updateClickHouseMetrics } from '../observability/metrics';
import { startSpan, endSpan } from '../observability/tracing';
import { refreshManifestCache } from '../cache/manifestCache';
import type { FieldDefinition } from '../storage';
import { writeBatchToClickHouse } from '../clickhouse/writer';

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

interface IngestionBatch {
  batchId: string;
  tableName: string;
  schema: FieldDefinition[];
  rows: Record<string, unknown>[];
  ingestionSignature: string;
  partitionKey: Record<string, string>;
  partitionAttributes: Record<string, string> | null;
  timeRange: { start: string; end: string };
  receivedAt: string;
  idempotencyKey: string | null;
  schemaDefaults?: Record<string, unknown> | null;
  backfillRequested?: boolean;
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
    const dataset = await ensureDataset(datasetSlug, payload.datasetName ?? datasetSlug, storageTarget);

    const tableName = (payload.tableName ?? 'records').trim();
    const schemaFields = normalizeFieldDefinitions(payload.schema.fields);
    if (schemaFields.length === 0) {
      throw new Error('Ingestion request must include schema fields');
    }

    const partitionKey = normalizeStringMap(payload.partition.key) ?? {};
    const partitionAttributes = normalizeStringMap(payload.partition.attributes);
    const schemaDefaults = payload.schema.evolution?.defaults ?? null;
    const backfillRequested = Boolean(payload.schema.evolution?.backfill);
    const rangeStart = new Date(payload.partition.timeRange.start);
    const rangeEnd = new Date(payload.partition.timeRange.end);
    if (!Number.isFinite(rangeStart.getTime()) || !Number.isFinite(rangeEnd.getTime())) {
      throw new Error('Partition time range is invalid');
    }

    const schemaChecksum = createSchemaChecksum(schemaFields);
    const ingestionSignature = computeIngestionSignature({
      datasetId: dataset.id,
      datasetSlug,
      schemaChecksum,
      partitionKey,
      startTime: rangeStart,
      endTime: rangeEnd,
      rows: payload.rows
    });

    const latestManifest = await getLatestPublishedManifest(dataset.id);

    const reuseResult = await attemptPartitionReuse({
      dataset,
      datasetSlug,
      config,
      storageTarget,
      ingestionSignature,
      idempotencyKey: payload.idempotencyKey ?? null,
      start,
      span
    });
    if (reuseResult) {
      return reuseResult;
    }

    if (payload.rows.length > 0) {
      await writeBatchToClickHouse({
        config,
        datasetSlug,
        tableName,
        schema: schemaFields,
        rows: payload.rows,
        partitionKey,
        partitionAttributes,
        timeRange: {
          start: payload.partition.timeRange.start,
          end: payload.partition.timeRange.end
        },
        ingestionSignature,
        receivedAt: payload.receivedAt ?? new Date().toISOString()
      });
      await updateClickHouseMetrics(config).catch((error) => {
        console.warn('[timestore:ingest] failed updating clickhouse metrics', {
          datasetSlug,
          error: error instanceof Error ? error.message : error
        });
      });
    }

    const batch: IngestionBatch = {
      batchId: `ing-${randomUUID()}`,
      tableName,
      schema: schemaFields,
      rows: payload.rows,
      ingestionSignature,
      partitionKey,
      partitionAttributes,
      timeRange: {
        start: payload.partition.timeRange.start,
        end: payload.partition.timeRange.end
      },
      receivedAt: payload.receivedAt ?? new Date().toISOString(),
      idempotencyKey: payload.idempotencyKey ?? null,
      schemaDefaults,
      backfillRequested
    };

    const manifest = await buildPartition({
      dataset,
      datasetSlug,
      storageTarget,
      config,
      baselineManifest: latestManifest ?? null,
      previousManifest: latestManifest ?? null,
      batch
    });

    observeIngestionJob({
      datasetSlug,
      result: 'success',
      durationSeconds: durationSince(start)
    });
    endSpan(span);
    return {
      dataset,
      manifest: manifest ?? latestManifest ?? null,
      storageTarget,
      idempotencyKey: payload.idempotencyKey ?? null,
      flushPending: false
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

async function ensureDataset(
  datasetSlug: string,
  datasetName: string,
  storageTarget: StorageTargetRecord
): Promise<DatasetRecord> {
  const existing = await getDatasetBySlug(datasetSlug);
  if (!existing) {
    return createDataset({
      id: `ds-${randomUUID()}`,
      slug: datasetSlug,
      name: datasetName,
      description: null,
      defaultStorageTargetId: storageTarget.id,
      metadata: {
        createdBy: 'timestore-ingestion'
      }
    });
  }

  if (!existing.defaultStorageTargetId) {
    await updateDatasetDefaultStorageTarget(existing.id, storageTarget.id);
    return {
      ...existing,
      defaultStorageTargetId: storageTarget.id
    };
  }

  return existing;
}

async function attemptPartitionReuse(params: {
  dataset: DatasetRecord;
  datasetSlug: string;
  config: ServiceConfig;
  storageTarget: StorageTargetRecord;
  ingestionSignature: string;
  idempotencyKey: string | null;
  start: bigint;
  span: ReturnType<typeof startSpan>;
}): Promise<IngestionProcessingResult | null> {
  const { dataset, datasetSlug, config, storageTarget, ingestionSignature, idempotencyKey, start, span } = params;

  const existingPartition = await findPartitionByIngestionSignature(dataset.id, ingestionSignature);
  if (!existingPartition) {
    return null;
  }

  const manifest = await getManifestById(existingPartition.manifestId);
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
    idempotencyKey,
    flushPending: false
  };
}

async function buildPartition(params: {
  dataset: DatasetRecord;
  datasetSlug: string;
  storageTarget: StorageTargetRecord;
  config: ServiceConfig;
  baselineManifest: DatasetManifestWithPartitions | null;
  previousManifest: DatasetManifestWithPartitions | null;
  batch: IngestionBatch;
}): Promise<DatasetManifestWithPartitions | null> {
  const { dataset, datasetSlug, storageTarget, config, baselineManifest, previousManifest, batch } = params;

  const schemaFields = normalizeFieldDefinitions(batch.schema);
  const partitionKey = batch.partitionKey;
  const partitionAttributes = batch.partitionAttributes ?? null;
  const partitionKeyString = buildPartitionKeyString(partitionKey);
  const startTime = new Date(batch.timeRange.start);
  const endTime = new Date(batch.timeRange.end);

  if (!Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime())) {
    throw new Error('Ingestion partition includes invalid time range');
  }

  const manifestShardKey = deriveManifestShardKey(startTime);
  const manifestByShard = new Map<string, DatasetManifestWithPartitions>();
  if (previousManifest) {
    manifestByShard.set(previousManifest.manifestShard, previousManifest);
  }

  let shardManifest = manifestByShard.get(manifestShardKey) ?? null;
  let baselineForCompatibility = shardManifest ?? baselineManifest ?? null;
  if (!baselineForCompatibility) {
    baselineForCompatibility = await getLatestPublishedManifest(dataset.id);
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
  let schemaVersionRecord = await findSchemaVersionByChecksum(dataset.id, schemaChecksum);
  if (!schemaVersionRecord) {
    const versionNumber = await getNextSchemaVersion(dataset.id);
    schemaVersionRecord = await createDatasetSchemaVersion({
      id: `dsv-${randomUUID()}`,
      datasetId: dataset.id,
      version: versionNumber,
      description: `Schema derived from ingestion at ${batch.receivedAt}`,
      schema: { fields: schemaFields },
      checksum: schemaChecksum
    });
  }

  const partitionIndex = computePartitionIndexForRows(batch.rows, schemaFields, config.partitionIndex);

  const partitionId = `part-${randomUUID()}`;
  const rowCount = batch.rows.length;
  const writeResult = {
    relativePath: `clickhouse://${datasetSlug}/${partitionId}`,
    fileSizeBytes: 0,
    rowCount,
    checksum: null
  };

  const partitionInput: PartitionInput = {
    id: partitionId,
    storageTargetId: storageTarget.id,
    fileFormat: 'clickhouse',
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
    };
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
      const existingPartition = await findPartitionByIngestionSignature(dataset.id, batch.ingestionSignature);
      if (existingPartition) {
        const reusedManifest = await getManifestById(existingPartition.manifestId);
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
  } catch (error) {
    console.warn('[timestore] failed to refresh manifest cache after ingestion', error);
  }

  await publishPartitionEvents({
    dataset,
    datasetSlug,
    storageTarget,
    shardManifest,
    partitionId,
    partitionKey,
    partitionKeyString,
    writeResult,
    batch,
    compatibility
  });

  return shardManifest;
}

async function publishPartitionEvents(params: {
  dataset: DatasetRecord;
  datasetSlug: string;
  storageTarget: StorageTargetRecord;
  shardManifest: DatasetManifestWithPartitions;
  partitionId: string;
  partitionKey: Record<string, string>;
  partitionKeyString: string | null;
  writeResult: {
    relativePath: string;
    fileSizeBytes: number;
    rowCount: number;
    checksum: string | null;
  };
  batch: IngestionBatch;
  compatibility: SchemaCompatibilityResult | null;
}): Promise<void> {
  const { dataset, datasetSlug, storageTarget, shardManifest, partitionId, partitionKey, partitionKeyString, writeResult, batch, compatibility } = params;

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
        attributes: batch.partitionAttributes ?? null
      },
      'timestore.ingest'
    );
  } catch (error) {
    console.error('[timestore] failed to publish partition.created event', error);
  }

  const addedColumns = compatibility?.addedFields.map((field) => field.name) ?? [];
  if (compatibility?.status === 'additive' && addedColumns.length > 0) {
    try {
      const defaultsSource = batch.schemaDefaults ?? {};
      const defaults = Object.fromEntries(
        addedColumns.map((column) => [column, (defaultsSource as Record<string, unknown>)[column] ?? null])
      );
      await publishTimestoreEvent(
        'timestore.schema.evolved',
        {
          datasetId: dataset.id,
          datasetSlug,
          manifestId: shardManifest.id,
          schemaVersionId: shardManifest.schemaVersionId,
          addedColumns,
          defaults
        },
        'timestore.ingest'
      );
    } catch (error) {
      console.error('[timestore] failed to publish schema.evolved event', error);
    }

    if (batch.backfillRequested) {
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
            schemaVersionId: shardManifest.schemaVersionId,
            addedColumns,
            defaults
          },
          'timestore.ingest'
        );
      } catch (error) {
        console.error('[timestore] failed to publish schema.backfill.requested event', error);
      }
    }
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
  return ensureDefaultStorageTarget();
}

function createSchemaChecksum(fields: FieldDefinition[]): string {
  const canonical = fields
    .map((field) => ({ name: field.name, type: field.type }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function normalizeStringMap(
  input: Record<string, string> | undefined | null
): Record<string, string> | null {
  if (!input) {
    return null;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const trimmedKey = typeof key === 'string' ? key.trim() : '';
    const trimmedValue = typeof value === 'string' ? value.trim() : '';
    if (!trimmedKey || !trimmedValue) {
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

function durationSince(start: bigint): number {
  const elapsed = Number(process.hrtime.bigint() - start);
  return elapsed / 1_000_000_000;
}

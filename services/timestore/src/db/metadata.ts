import type { PoolClient, DatabaseError } from 'pg';
import {
  type NumberPartitionKeyPredicate,
  type PartitionFilters,
  type PartitionKeyPredicate,
  type StringPartitionKeyPredicate,
  type TimestampPartitionKeyPredicate
} from '../types/partitionFilters';
import type {
  PartitionColumnBloomFilterMap,
  PartitionColumnStatisticsMap
} from '../types/partitionIndex';
import { withConnection, withTransaction } from './client';

export type StorageTargetKind = 'clickhouse';
export type FileFormat = 'clickhouse';
export type DatasetStatus = 'active' | 'inactive';
export type WriteFormat = 'clickhouse';
export type ManifestStatus = 'draft' | 'published' | 'superseded';

export type JsonObject = Record<string, unknown>;

export interface StorageTargetRecord {
  id: string;
  name: string;
  kind: StorageTargetKind;
  description: string | null;
  config: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStorageTargetInput {
  id: string;
  name: string;
  kind: StorageTargetKind;
  description?: string | null;
  config: JsonObject;
}

export interface DatasetRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: DatasetStatus;
  writeFormat: WriteFormat;
  defaultStorageTargetId: string | null;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDatasetInput {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  status?: DatasetStatus;
  writeFormat?: WriteFormat;
  defaultStorageTargetId?: string | null;
  metadata?: JsonObject;
}

export interface UpdateDatasetInput {
  id: string;
  name?: string;
  description?: string | null;
  status?: DatasetStatus;
  defaultStorageTargetId?: string | null;
  metadata?: JsonObject;
  ifMatch?: string | null;
}

export class DatasetConcurrentUpdateError extends Error {
  readonly code = 'DATASET_CONCURRENT_UPDATE';

  constructor(message = 'Dataset was modified by another process') {
    super(message);
    this.name = 'DatasetConcurrentUpdateError';
  }
}

export interface DatasetSchemaVersionRecord {
  id: string;
  datasetId: string;
  version: number;
  description: string | null;
  schema: JsonObject;
  checksum: string | null;
  createdAt: string;
}

export interface CreateDatasetSchemaVersionInput {
  id: string;
  datasetId: string;
  version: number;
  description?: string | null;
  schema: JsonObject;
  checksum?: string | null;
}

export interface DatasetManifestRecord {
  id: string;
  datasetId: string;
  version: number;
  status: ManifestStatus;
  schemaVersionId: string | null;
  parentManifestId: string | null;
  manifestShard: string;
  summary: JsonObject;
  statistics: JsonObject;
  metadata: JsonObject;
  partitionCount: number;
  totalRows: number;
  totalBytes: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface StreamingWatermarkRecord {
  connectorId: string;
  datasetId: string;
  datasetSlug: string;
  sealedThrough: string;
  backlogLagMs: number;
  recordsProcessed: number;
  updatedAt: string;
}

export interface UpsertStreamingWatermarkInput {
  connectorId: string;
  datasetId: string;
  datasetSlug: string;
  sealedThrough: Date;
  backlogLagMs: number;
  recordsProcessedDelta?: number;
}

export interface DatasetPartitionRecord {
  id: string;
  datasetId: string;
  manifestId: string;
  manifestShard: string;
  partitionKey: JsonObject;
  storageTargetId: string;
  fileFormat: FileFormat;
  filePath: string;
  fileSizeBytes: number | null;
  rowCount: number | null;
  startTime: string;
  endTime: string;
  checksum: string | null;
  metadata: JsonObject;
  columnStatistics: PartitionColumnStatisticsMap;
  columnBloomFilters: PartitionColumnBloomFilterMap;
  ingestionSignature: string | null;
  createdAt: string;
}

export interface PartitionInput {
  id: string;
  storageTargetId: string;
  fileFormat: FileFormat;
  filePath: string;
  partitionKey: JsonObject;
  startTime: Date;
  endTime: Date;
  fileSizeBytes?: number | null;
  rowCount?: number | null;
  checksum?: string | null;
  metadata?: JsonObject;
  columnStatistics?: PartitionColumnStatisticsMap;
  columnBloomFilters?: PartitionColumnBloomFilterMap;
  ingestionSignature?: string | null;
}

export interface CreateDatasetManifestInput {
  id: string;
  datasetId: string;
  version: number;
  status: ManifestStatus;
  manifestShard: string;
  schemaVersionId?: string | null;
  parentManifestId?: string | null;
  summary?: JsonObject;
  statistics?: JsonObject;
  metadata?: JsonObject;
  createdBy?: string | null;
  partitions: PartitionInput[];
}

export interface DatasetManifestWithPartitions extends DatasetManifestRecord {
  partitions: DatasetPartitionRecord[];
}

export interface ManifestLookupOptions {
  shard?: string | null;
}

export interface RetentionPolicyRecord {
  datasetId: string;
  policy: JsonObject;
  updatedAt: string;
}

export interface DatasetAccessAuditRecord {
  id: string;
  datasetId: string | null;
  datasetSlug: string;
  actorId: string | null;
  actorScopes: string[];
  action: string;
  success: boolean;
  metadata: JsonObject;
  createdAt: string;
}

export type LifecycleJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'skipped';

export interface LifecycleJobRunRecord {
  id: string;
  jobKind: string;
  datasetId: string | null;
  operations: string[];
  triggerSource: string;
  status: LifecycleJobStatus;
  scheduledFor: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  attempts: number;
  error: string | null;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface CompactionCheckpointRecord {
  id: string;
  datasetId: string;
  manifestId: string;
  manifestShard: string;
  status: 'pending' | 'completed';
  cursor: number;
  totalGroups: number;
  retryCount: number;
  lastError: string | null;
  metadata: JsonObject;
  stats: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertCompactionCheckpointInput {
  id: string;
  datasetId: string;
  manifestId: string;
  manifestShard: string;
  totalGroups: number;
  metadata: JsonObject;
  stats?: JsonObject;
}

export interface UpdateCompactionCheckpointInput {
  id: string;
  cursor?: number;
  totalGroups?: number;
  status?: 'pending' | 'completed';
  retryCount?: number;
  lastError?: string | null;
  metadataPatch?: JsonObject;
  metadataReplace?: JsonObject;
  statsPatch?: JsonObject;
  statsReplace?: JsonObject;
}

export interface LifecycleAuditLogRecord {
  id: string;
  datasetId: string;
  manifestId: string | null;
  eventType: string;
  payload: JsonObject;
  createdAt: string;
}

export interface CreateLifecycleJobRunInput {
  id: string;
  jobKind: string;
  datasetId?: string | null;
  operations?: string[];
  triggerSource: string;
  scheduledFor?: Date | null;
  startedAt?: Date | null;
  attempts?: number;
  status?: LifecycleJobStatus;
  metadata?: JsonObject;
}

export interface UpdateLifecycleJobRunInput {
  id: string;
  status: LifecycleJobStatus;
  completedAt?: Date | null;
  durationMs?: number | null;
  error?: string | null;
  attemptsDelta?: number;
  metadataPatch?: JsonObject;
}

export interface LifecycleAuditLogInput {
  id?: string;
  datasetId: string;
  manifestId?: string | null;
  eventType: string;
  payload?: JsonObject;
}

export interface DatasetAccessAuditInput {
  id: string;
  datasetId?: string | null;
  datasetSlug: string;
  actorId?: string | null;
  actorScopes?: string[];
  action: string;
  success: boolean;
  metadata?: JsonObject;
}

export interface IngestionBatchRecord {
  id: string;
  datasetId: string;
  idempotencyKey: string;
  manifestId: string;
  createdAt: string;
}

export interface CreateIngestionBatchInput {
  id: string;
  datasetId: string;
  idempotencyKey: string;
  manifestId: string;
}

export interface PartitionWithTarget extends DatasetPartitionRecord {
  storageTarget: StorageTargetRecord;
}

export interface PartitionQueryOptions {
  shards?: string[] | null;
}

export async function upsertStorageTarget(input: CreateStorageTargetInput): Promise<StorageTargetRecord> {
  return withConnection(async (client) => {
    const { rows } = await client.query<StorageTargetRow>(
      `INSERT INTO storage_targets (id, name, kind, description, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (id) DO UPDATE
       SET
         name = EXCLUDED.name,
         kind = EXCLUDED.kind,
         description = EXCLUDED.description,
         config = EXCLUDED.config,
         updated_at = NOW()
       RETURNING *` as const,
      [input.id, input.name, input.kind, input.description ?? null, JSON.stringify(input.config)]
    );
    return mapStorageTarget(rows[0]);
  });
}

export async function createDataset(input: CreateDatasetInput): Promise<DatasetRecord> {
  return withConnection(async (client) => {
    const { rows } = await client.query<DatasetRow>(
      `INSERT INTO datasets (
         id,
         slug,
         name,
         description,
         status,
         write_format,
         default_storage_target_id,
         metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING *` as const,
      [
        input.id,
        input.slug,
        input.name,
        input.description ?? null,
        input.status ?? 'active',
        input.writeFormat ?? 'clickhouse',
        input.defaultStorageTargetId ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    return mapDataset(rows[0]);
  });
}

export async function updateDataset(input: UpdateDatasetInput): Promise<DatasetRecord> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    values.push(input.name);
    fields.push(`name = $${values.length}`);
  }

  if (input.description !== undefined) {
    values.push(input.description);
    fields.push(`description = $${values.length}`);
  }

  if (input.status !== undefined) {
    values.push(input.status);
    fields.push(`status = $${values.length}`);
  }

  if (input.defaultStorageTargetId !== undefined) {
    values.push(input.defaultStorageTargetId ?? null);
    fields.push(`default_storage_target_id = $${values.length}`);
  }

  if (input.metadata !== undefined) {
    values.push(JSON.stringify(input.metadata));
    fields.push(`metadata = $${values.length}::jsonb`);
  }

  if (fields.length === 0) {
    const existing = await getDatasetById(input.id);
    if (!existing) {
      throw new Error(`Dataset ${input.id} not found`);
    }
    if (input.ifMatch) {
      const expectedMs = Date.parse(input.ifMatch);
      const currentMs = Date.parse(existing.updatedAt);
      if (Number.isNaN(expectedMs) || Number.isNaN(currentMs) || currentMs !== expectedMs) {
        throw new DatasetConcurrentUpdateError();
      }
    }
    return existing;
  }

  const whereParts: string[] = [];

  values.push(input.id);
  whereParts.push(`id = $${values.length}`);

  if (input.ifMatch) {
    values.push(input.ifMatch);
    const parameter = values.length;
    whereParts.push(
      `date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $${parameter}::timestamptz)`
    );
  }

  const setFragments = [...fields, 'updated_at = NOW()'];
  const query = `UPDATE datasets
                   SET ${setFragments.join(', ')}
                 WHERE ${whereParts.join(' AND ')}
               RETURNING *`;

  return withConnection(async (client) => {
    const { rows } = await client.query<DatasetRow>(query, values);
    if (rows.length === 0) {
      if (input.ifMatch) {
        const { rows: existing } = await client.query<{ id: string }>(
          'SELECT id FROM datasets WHERE id = $1 LIMIT 1',
          [input.id]
        );
        if (existing.length > 0) {
          throw new DatasetConcurrentUpdateError();
        }
      }
      throw new Error(`Dataset ${input.id} not found`);
    }
    return mapDataset(rows[0]);
  });
}

export async function createDatasetSchemaVersion(
  input: CreateDatasetSchemaVersionInput
): Promise<DatasetSchemaVersionRecord> {
  return withConnection(async (client) => {
    try {
      const { rows } = await client.query<DatasetSchemaVersionRow>(
        `INSERT INTO dataset_schema_versions (
           id,
           dataset_id,
           version,
           description,
           schema,
           checksum
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         RETURNING *` as const,
        [
          input.id,
          input.datasetId,
          input.version,
          input.description ?? null,
          JSON.stringify(input.schema),
          input.checksum ?? null
        ]
      );
      return mapSchemaVersion(rows[0]);
    } catch (error) {
      if (isSchemaVersionConflict(error) && input.checksum) {
        const { rows } = await client.query<DatasetSchemaVersionRow>(
          `SELECT *
             FROM dataset_schema_versions
            WHERE dataset_id = $1 AND checksum = $2
            ORDER BY version DESC
            LIMIT 1`,
          [input.datasetId, input.checksum]
        );
        if (rows.length > 0) {
          return mapSchemaVersion(rows[0]);
        }
      }
      throw error;
    }
  });
}

export async function createDatasetManifest(
  input: CreateDatasetManifestInput
): Promise<DatasetManifestWithPartitions> {
  return withTransaction(async (client) => {
    await assertVersionIsMonotonic(client, input.datasetId, input.version);

    if (input.parentManifestId && input.status === 'published') {
      await client.query(
        `UPDATE dataset_manifests
            SET status = 'superseded',
                updated_at = NOW()
          WHERE id = $1`,
        [input.parentManifestId]
      );
    }

    const publishedAt = input.status === 'published' ? new Date() : null;
    const { rows: manifestRows } = await client.query<DatasetManifestRow>(
      `INSERT INTO dataset_manifests (
         id,
         dataset_id,
         version,
         status,
         schema_version_id,
         parent_manifest_id,
         manifest_shard,
         summary,
         statistics,
         metadata,
         created_by,
         published_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12)
       RETURNING *` as const,
      [
        input.id,
        input.datasetId,
        input.version,
        input.status,
        input.schemaVersionId ?? null,
        input.parentManifestId ?? null,
        input.manifestShard,
        JSON.stringify(input.summary ?? {}),
        JSON.stringify(input.statistics ?? {}),
        JSON.stringify(input.metadata ?? {}),
        input.createdBy ?? null,
        publishedAt
      ]
    );

    const partitions = await insertPartitions(client, input);
    const rollups = calculatePartitionRollups(partitions);
    await updateManifestRollups(client, input.id, rollups);
    await touchDataset(client, input.datasetId);

    const { rows: updatedRows } = await client.query<DatasetManifestRow>(
      'SELECT * FROM dataset_manifests WHERE id = $1',
      [input.id]
    );
    const manifest = mapManifest(updatedRows[0] ?? manifestRows[0]);
    return {
      ...manifest,
      partitionCount: rollups.partitionCount,
      totalRows: rollups.totalRows,
      totalBytes: rollups.totalBytes,
      partitions
    };
  });
}

export interface AppendManifestPartitionsInput {
  datasetId: string;
  manifestId: string;
  partitions: PartitionInput[];
  summaryPatch?: JsonObject;
  metadataPatch?: JsonObject;
  schemaVersionId?: string | null;
}

export async function appendPartitionsToManifest(
  input: AppendManifestPartitionsInput
): Promise<DatasetManifestWithPartitions> {
  return withTransaction(async (client) => {
    const { manifestId, datasetId, partitions, summaryPatch, metadataPatch } = input;
    if (partitions.length === 0) {
      throw new Error('appendPartitionsToManifest requires at least one partition');
    }

    const { rows: manifestRows } = await client.query<DatasetManifestRow>(
      'SELECT * FROM dataset_manifests WHERE id = $1 FOR UPDATE',
      [manifestId]
    );
    const manifestRow = manifestRows[0];
    if (!manifestRow) {
      throw new Error(`Manifest ${manifestId} not found`);
    }
    if (manifestRow.dataset_id !== datasetId) {
      throw new Error('Manifest does not belong to provided dataset');
    }
    if (manifestRow.status !== 'published') {
      throw new Error('Cannot append partitions to a non-published manifest');
    }

    for (const partition of partitions) {
      await client.query<DatasetPartitionRow>(
        `INSERT INTO dataset_partitions (
           id,
           dataset_id,
           manifest_id,
           manifest_shard,
           partition_key,
           storage_target_id,
           file_format,
           file_path,
           file_size_bytes,
           row_count,
           start_time,
           end_time,
           checksum,
           metadata,
           column_statistics,
           column_bloom_filters,
           ingestion_signature
         ) VALUES (
           $1,
           $2,
           $3,
           $4,
           $5::jsonb,
           $6,
           $7,
           $8,
           $9,
           $10,
           $11,
           $12,
           $13,
           $14::jsonb,
           $15::jsonb,
           $16::jsonb,
         $17
        )
        ON CONFLICT (dataset_id, ingestion_signature)
          WHERE ingestion_signature IS NOT NULL DO NOTHING` as const,
        [
          partition.id,
          datasetId,
          manifestId,
          manifestRow.manifest_shard,
          JSON.stringify(partition.partitionKey),
          partition.storageTargetId,
          partition.fileFormat,
          partition.filePath,
          partition.fileSizeBytes ?? null,
          partition.rowCount ?? null,
          partition.startTime.toISOString(),
          partition.endTime.toISOString(),
          partition.checksum ?? null,
          JSON.stringify(partition.metadata ?? {}),
          JSON.stringify(partition.columnStatistics ?? {}),
          JSON.stringify(partition.columnBloomFilters ?? {}),
          partition.ingestionSignature ?? null
        ]
      );
    }

    const allPartitions = await fetchPartitions(client, manifestId);
    const rollups = calculatePartitionRollups(allPartitions);
    await updateManifestRollups(client, manifestId, rollups);

    const firstPartition = allPartitions[0];
    const lastPartition = allPartitions[allPartitions.length - 1];

    const statistics = {
      rowCount: rollups.totalRows,
      fileSizeBytes: rollups.totalBytes,
      startTime: firstPartition?.startTime ?? null,
      endTime: lastPartition?.endTime ?? null
    } satisfies JsonObject;

    const summary = summaryPatch ?? {};
    const metadata = metadataPatch ?? {};
    const updateParams: unknown[] = [
      manifestId,
      JSON.stringify(summary),
      JSON.stringify(statistics),
      JSON.stringify(metadata)
    ];

    let schemaUpdateClause = '';
    if (input.schemaVersionId !== undefined) {
      updateParams.push(input.schemaVersionId ?? null);
      schemaUpdateClause = ',\n              schema_version_id = $5';
    }

    await client.query(
      `UPDATE dataset_manifests
          SET summary = summary || $2::jsonb,
              statistics = $3::jsonb,
              metadata = metadata || $4::jsonb${schemaUpdateClause},
              updated_at = NOW()
        WHERE id = $1`,
      updateParams
    );

    await touchDataset(client, datasetId);

    const { rows: updatedRows } = await client.query<DatasetManifestRow>(
      'SELECT * FROM dataset_manifests WHERE id = $1',
      [manifestId]
    );
    const updatedManifest = mapManifest(updatedRows[0] ?? manifestRow);

    return {
      ...updatedManifest,
      partitionCount: rollups.partitionCount,
      totalRows: rollups.totalRows,
      totalBytes: rollups.totalBytes,
      partitions: allPartitions
    } satisfies DatasetManifestWithPartitions;
  });
}

export interface ReplaceManifestPartitionsInput {
  datasetId: string;
  manifestId: string;
  removePartitionIds: string[];
  addPartitions: PartitionInput[];
  summaryPatch?: JsonObject;
  metadataPatch?: JsonObject;
}

export async function replacePartitionsInManifest(
  input: ReplaceManifestPartitionsInput
): Promise<DatasetManifestWithPartitions> {
  return withTransaction(async (client) => {
    const { datasetId, manifestId, removePartitionIds, addPartitions, summaryPatch, metadataPatch } = input;
    if (removePartitionIds.length === 0 && addPartitions.length === 0) {
      throw new Error('replacePartitionsInManifest requires partitions to add or remove');
    }

    const { rows: manifestRows } = await client.query<DatasetManifestRow>(
      'SELECT * FROM dataset_manifests WHERE id = $1 FOR UPDATE',
      [manifestId]
    );
    const manifestRow = manifestRows[0];
    if (!manifestRow) {
      throw new Error(`Manifest ${manifestId} not found`);
    }
    if (manifestRow.dataset_id !== datasetId) {
      throw new Error('Manifest does not belong to provided dataset');
    }
    if (manifestRow.status !== 'published') {
      throw new Error('Cannot replace partitions on a non-published manifest');
    }

    if (removePartitionIds.length > 0) {
      await client.query(
        `DELETE FROM dataset_partitions
           WHERE dataset_id = $1
             AND manifest_id = $2
             AND id = ANY($3::text[])`,
        [datasetId, manifestId, removePartitionIds]
      );
    }

    for (const partition of addPartitions) {
      await client.query<DatasetPartitionRow>(
        `INSERT INTO dataset_partitions (
           id,
           dataset_id,
           manifest_id,
           manifest_shard,
           partition_key,
           storage_target_id,
           file_format,
           file_path,
           file_size_bytes,
           row_count,
           start_time,
           end_time,
           checksum,
           metadata,
           column_statistics,
           column_bloom_filters,
           ingestion_signature
         ) VALUES (
           $1,
           $2,
           $3,
           $4,
           $5::jsonb,
           $6,
           $7,
           $8,
           $9,
           $10,
           $11,
           $12,
           $13,
           $14::jsonb,
           $15::jsonb,
           $16::jsonb,
           $17
         )
        ON CONFLICT (dataset_id, ingestion_signature)
          WHERE ingestion_signature IS NOT NULL DO NOTHING` as const,
        [
          partition.id,
          datasetId,
          manifestId,
          manifestRow.manifest_shard,
          JSON.stringify(partition.partitionKey),
          partition.storageTargetId,
          partition.fileFormat,
          partition.filePath,
          partition.fileSizeBytes ?? null,
          partition.rowCount ?? null,
          partition.startTime.toISOString(),
          partition.endTime.toISOString(),
          partition.checksum ?? null,
          JSON.stringify(partition.metadata ?? {}),
          JSON.stringify(partition.columnStatistics ?? {}),
          JSON.stringify(partition.columnBloomFilters ?? {}),
          partition.ingestionSignature ?? null
        ]
      );
    }

    const allPartitions = await fetchPartitions(client, manifestId);
    const rollups = calculatePartitionRollups(allPartitions);
    await updateManifestRollups(client, manifestId, rollups);

    const firstPartition = allPartitions[0];
    const lastPartition = allPartitions[allPartitions.length - 1];

    const statistics = {
      rowCount: rollups.totalRows,
      fileSizeBytes: rollups.totalBytes,
      startTime: firstPartition?.startTime ?? null,
      endTime: lastPartition?.endTime ?? null
    } satisfies JsonObject;

    const summary = summaryPatch ?? {};
    const metadata = metadataPatch ?? {};

    await client.query(
      `UPDATE dataset_manifests
          SET summary = summary || $2::jsonb,
              statistics = $3::jsonb,
              metadata = metadata || $4::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [manifestId, JSON.stringify(summary), JSON.stringify(statistics), JSON.stringify(metadata)]
    );

    await touchDataset(client, datasetId);

    const { rows: updatedRows } = await client.query<DatasetManifestRow>(
      'SELECT * FROM dataset_manifests WHERE id = $1',
      [manifestId]
    );
    const updatedManifest = mapManifest(updatedRows[0] ?? manifestRow);

    return {
      ...updatedManifest,
      partitionCount: rollups.partitionCount,
      totalRows: rollups.totalRows,
      totalBytes: rollups.totalBytes,
      partitions: allPartitions
    } satisfies DatasetManifestWithPartitions;
  });
}

export async function getDatasetBySlug(slug: string): Promise<DatasetRecord | null> {
  return withConnection(async (client) => {
    const { rows } = await client.query<DatasetRow>(
      'SELECT * FROM datasets WHERE slug = $1 LIMIT 1',
      [slug]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapDataset(rows[0]);
  });
}

export async function getDatasetById(id: string): Promise<DatasetRecord | null> {
  return withConnection(async (client) => {
    const { rows } = await client.query<DatasetRow>(
      'SELECT * FROM datasets WHERE id = $1 LIMIT 1',
      [id]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapDataset(rows[0]);
  });
}

export async function listActiveDatasets(): Promise<DatasetRecord[]> {
  return withConnection(async (client) => {
    const { rows } = await client.query<DatasetRow>(
      `SELECT *
         FROM datasets
        WHERE status = 'active'
        ORDER BY updated_at DESC`
    );
    return rows.map(mapDataset);
  });
}

export interface DatasetListOptions {
  limit?: number;
  cursor?: { updatedAt: string; id: string } | null;
  status?: DatasetStatus | 'all';
  search?: string;
}

export interface DatasetListResult {
  datasets: DatasetRecord[];
  nextCursor: { updatedAt: string; id: string } | null;
}

export async function listDatasets(options: DatasetListOptions = {}): Promise<DatasetListResult> {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const statusFilter = options.status && options.status !== 'all' ? options.status : null;
  const cursor = options.cursor;
  const search = options.search?.trim();

  return withConnection(async (client) => {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (statusFilter) {
      values.push(statusFilter);
      conditions.push(`status = $${values.length}`);
    }

    if (search && search.length > 0) {
      values.push(`%${search.toLowerCase()}%`);
      conditions.push(`(LOWER(slug) LIKE $${values.length} OR LOWER(name) LIKE $${values.length})`);
    }

    if (cursor) {
      values.push(cursor.updatedAt);
      values.push(cursor.id);
      const updatedAtParam = values.length - 1;
      const idParam = values.length;
      conditions.push(`(updated_at, id) < ($${updatedAtParam}::timestamptz, $${idParam}::text)`);
    }

    values.push(limit + 1);
    const limitParam = values.length;

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await client.query<DatasetRow>(
      `SELECT *
         FROM datasets
        ${whereClause}
        ORDER BY updated_at DESC, id DESC
        LIMIT $${limitParam}`,
      values
    );

    let nextCursor: { updatedAt: string; id: string } | null = null;
    let resultRows = rows;

    if (rows.length > limit) {
      const cursorRow = rows[limit];
      nextCursor = {
        updatedAt: cursorRow.updated_at,
        id: cursorRow.id
      };
      resultRows = rows.slice(0, limit);
    }

    return {
      datasets: resultRows.map(mapDataset),
      nextCursor
    } satisfies DatasetListResult;
  });
}

export async function updateDatasetDefaultStorageTarget(
  datasetId: string,
  storageTargetId: string
): Promise<void> {
  await withConnection(async (client) => {
    await client.query(
      `UPDATE datasets
          SET default_storage_target_id = $2,
              updated_at = NOW()
        WHERE id = $1`,
      [datasetId, storageTargetId]
    );
  });
}

export async function getLatestPublishedManifest(
  datasetId: string,
  options: ManifestLookupOptions = {}
): Promise<DatasetManifestWithPartitions | null> {
  return withConnection(async (client) => {
    const params: unknown[] = [datasetId];
    let whereClause = "dataset_id = $1 AND status = 'published'";

    if (options.shard) {
      params.push(options.shard);
      whereClause += ` AND manifest_shard = $${params.length}`;
    }

    const query = `SELECT *
                     FROM dataset_manifests
                    WHERE ${whereClause}
                    ORDER BY version DESC
                    LIMIT 1`;

    const { rows } = await client.query<DatasetManifestRow>(query, params);

    if (rows.length === 0) {
      return null;
    }

    const manifest = mapManifest(rows[0]);
    const partitions = await fetchPartitions(client, manifest.id);
    return {
      ...manifest,
      partitions
    };
  });
}

export async function listPublishedManifests(
  datasetId: string
): Promise<DatasetManifestRecord[]> {
  return withConnection(async (client) => {
    const { rows } = await client.query<DatasetManifestRow>(
      `SELECT *
         FROM dataset_manifests
        WHERE dataset_id = $1
          AND status = 'published'
        ORDER BY manifest_shard ASC, version DESC`,
      [datasetId]
    );

    return rows.map(mapManifest);
  });
}

export async function listPublishedManifestsForRange(
  datasetId: string,
  rangeStart: Date,
  rangeEnd: Date
): Promise<DatasetManifestRecord[]> {
  return withConnection(async (client) => {
    const { rows } = await client.query<DatasetManifestRow>(
      `SELECT DISTINCT ON (m.manifest_shard) m.*
         FROM dataset_manifests m
         JOIN dataset_partitions p ON p.manifest_id = m.id
        WHERE m.dataset_id = $1
          AND m.status = 'published'
          AND p.end_time >= $2
          AND p.start_time <= $3
        ORDER BY m.manifest_shard ASC, m.version DESC`,
      [datasetId, rangeStart.toISOString(), rangeEnd.toISOString()]
    );

    return rows.map(mapManifest);
  });
}

export async function listPublishedManifestsWithPartitions(
  datasetId: string
): Promise<DatasetManifestWithPartitions[]> {
  return withConnection(async (client) => {
    const { rows } = await client.query<DatasetManifestRow>(
      `SELECT *
         FROM dataset_manifests
        WHERE dataset_id = $1
          AND status = 'published'
        ORDER BY manifest_shard ASC, version DESC`,
      [datasetId]
    );

    const manifests: DatasetManifestWithPartitions[] = [];
    for (const row of rows) {
      const manifest = mapManifest(row);
      const partitions = await fetchPartitions(client, manifest.id);
      manifests.push({
        ...manifest,
        partitions
      });
    }

    return manifests;
  });
}

export async function upsertRetentionPolicy(
  datasetId: string,
  policy: JsonObject
): Promise<RetentionPolicyRecord> {
  return withConnection(async (client) => {
    const { rows } = await client.query<RetentionPolicyRow>(
      `INSERT INTO dataset_retention_policies (dataset_id, policy)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (dataset_id) DO UPDATE
       SET policy = EXCLUDED.policy,
           updated_at = NOW()
       RETURNING *` as const,
      [datasetId, JSON.stringify(policy)]
    );
    return mapRetentionPolicy(rows[0]);
  });
}

export async function getRetentionPolicy(datasetId: string): Promise<RetentionPolicyRecord | null> {
  return withConnection(async (client) => {
    const { rows } = await client.query<RetentionPolicyRow>(
      'SELECT * FROM dataset_retention_policies WHERE dataset_id = $1 LIMIT 1',
      [datasetId]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapRetentionPolicy(rows[0]);
  });
}

export async function createLifecycleJobRun(
  input: CreateLifecycleJobRunInput
): Promise<LifecycleJobRunRecord> {
  const operations = input.operations && input.operations.length > 0 ? input.operations : [];
  const metadataJson = JSON.stringify(input.metadata ?? {});
  const status = input.status ?? 'running';
  const attempts = input.attempts ?? 1;
  const scheduledFor = input.scheduledFor ? input.scheduledFor.toISOString() : null;
  const startedAt = (input.startedAt ?? new Date()).toISOString();

  return withConnection(async (client) => {
    const { rows } = await client.query<LifecycleJobRunRow>(
      `INSERT INTO lifecycle_job_runs (
         id,
         job_kind,
         dataset_id,
         operations,
         trigger_source,
         status,
         scheduled_for,
         started_at,
         attempts,
         metadata
       ) VALUES ($1, $2, $3, $4::text[], $5, $6, $7, $8, $9, $10::jsonb)
       RETURNING *` as const,
      [
        input.id,
        input.jobKind,
        input.datasetId ?? null,
        operations,
        input.triggerSource,
        status,
        scheduledFor,
        startedAt,
        attempts,
        metadataJson
      ]
    );
    return mapLifecycleJobRun(rows[0]);
  });
}

export async function getLifecycleJobRun(id: string): Promise<LifecycleJobRunRecord | null> {
  return withConnection(async (client) => {
    const { rows } = await client.query<LifecycleJobRunRow>(
      'SELECT * FROM lifecycle_job_runs WHERE id = $1 LIMIT 1',
      [id]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapLifecycleJobRun(rows[0]);
  });
}

export async function updateLifecycleJobRun(
  updates: UpdateLifecycleJobRunInput
): Promise<LifecycleJobRunRecord> {
  const metadataJson = JSON.stringify(updates.metadataPatch ?? {});
  const attemptsDelta = updates.attemptsDelta ?? 0;
  const completedAt = updates.completedAt ? updates.completedAt.toISOString() : null;
  const shouldUpdateError = Object.prototype.hasOwnProperty.call(updates, 'error');
  const errorValue = shouldUpdateError ? updates.error ?? null : null;

  return withConnection(async (client) => {
    const { rows } = await client.query<LifecycleJobRunRow>(
      `UPDATE lifecycle_job_runs
          SET status = $2,
              completed_at = COALESCE($3::timestamptz, completed_at),
              duration_ms = COALESCE($4::integer, duration_ms),
              error = CASE WHEN $8 THEN $5 ELSE error END,
              attempts = attempts + $6,
              metadata = metadata || $7::jsonb,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *` as const,
      [
        updates.id,
        updates.status,
        completedAt,
        updates.durationMs ?? null,
        errorValue,
        attemptsDelta,
        metadataJson,
        shouldUpdateError
      ]
    );
    if (rows.length === 0) {
      throw new Error(`Lifecycle job run ${updates.id} not found`);
    }
    return mapLifecycleJobRun(rows[0]);
  });
}

export async function listRecentLifecycleJobRuns(limit = 20): Promise<LifecycleJobRunRecord[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  return withConnection(async (client) => {
    const { rows } = await client.query<LifecycleJobRunRow>(
      `SELECT *
         FROM lifecycle_job_runs
        ORDER BY created_at DESC
        LIMIT $1`,
      [boundedLimit]
    );
    return rows.map(mapLifecycleJobRun);
  });
}

export async function recordLifecycleAuditEvent(
  input: LifecycleAuditLogInput
): Promise<LifecycleAuditLogRecord> {
  const payload = JSON.stringify(input.payload ?? {});
  return withConnection(async (client) => {
    const { rows } = await client.query<LifecycleAuditLogRow>(
      `INSERT INTO lifecycle_audit_log (
         id,
         dataset_id,
         manifest_id,
         event_type,
         payload
       ) VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING *` as const,
      [input.id, input.datasetId, input.manifestId ?? null, input.eventType, payload]
    );
    return mapLifecycleAuditLog(rows[0]);
  });
}

export async function recordDatasetAccessEvent(
  input: DatasetAccessAuditInput
): Promise<DatasetAccessAuditRecord> {
  const metadataJson = JSON.stringify(input.metadata ?? {});
  const actorScopes = input.actorScopes ?? [];
  return withConnection(async (client) => {
    const { rows } = await client.query<DatasetAccessAuditRow>(
      `INSERT INTO dataset_access_audit (
         id,
         dataset_id,
         dataset_slug,
         actor_id,
         actor_scopes,
         action,
         success,
         metadata
       ) VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8::jsonb)
       RETURNING *` as const,
      [
        input.id,
        input.datasetId ?? null,
        input.datasetSlug,
        input.actorId ?? null,
        actorScopes,
        input.action,
        input.success,
        metadataJson
      ]
    );
    return mapDatasetAccessAudit(rows[0]);
  });
}

export async function upsertStreamingWatermark(input: UpsertStreamingWatermarkInput): Promise<void> {
  const recordsDelta = Number.isFinite(input.recordsProcessedDelta ?? NaN)
    ? Math.max(0, Math.floor(input.recordsProcessedDelta ?? 0))
    : 0;
  const backlogLag = Math.max(0, Math.floor(input.backlogLagMs));

  await withConnection(async (client) => {
    await client.query(
      `INSERT INTO streaming_watermarks (
         connector_id,
         dataset_id,
         dataset_slug,
         sealed_through,
         backlog_lag_ms,
         records_processed
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (connector_id, dataset_id)
       DO UPDATE SET
         dataset_slug = EXCLUDED.dataset_slug,
         sealed_through = GREATEST(streaming_watermarks.sealed_through, EXCLUDED.sealed_through),
         backlog_lag_ms = EXCLUDED.backlog_lag_ms,
         records_processed = streaming_watermarks.records_processed + EXCLUDED.records_processed,
         updated_at = NOW();`,
      [
        input.connectorId,
        input.datasetId,
        input.datasetSlug,
        input.sealedThrough.toISOString(),
        backlogLag,
        recordsDelta
      ]
    );
  });
}

export async function getStreamingWatermark(
  datasetId: string,
  connectorId: string
): Promise<StreamingWatermarkRecord | null> {
  return withConnection(async (client) => {
    const { rows } = await client.query(
      `SELECT connector_id,
              dataset_id,
              dataset_slug,
              sealed_through,
              backlog_lag_ms,
              records_processed,
              updated_at
         FROM streaming_watermarks
        WHERE dataset_id = $1
          AND connector_id = $2`,
      [datasetId, connectorId]
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0] as {
      connector_id: string;
      dataset_id: string;
      dataset_slug: string;
      sealed_through: Date;
      backlog_lag_ms: number;
      records_processed: string | number;
      updated_at: Date;
    };

    return {
      connectorId: row.connector_id,
      datasetId: row.dataset_id,
      datasetSlug: row.dataset_slug,
      sealedThrough: new Date(row.sealed_through).toISOString(),
      backlogLagMs: Number(row.backlog_lag_ms ?? 0),
      recordsProcessed: Number(row.records_processed ?? 0),
      updatedAt: new Date(row.updated_at).toISOString()
    } satisfies StreamingWatermarkRecord;
  });
}

export async function listStreamingWatermarks(): Promise<StreamingWatermarkRecord[]> {
  return withConnection(async (client) => {
    const { rows } = await client.query(
      `SELECT connector_id,
              dataset_id,
              dataset_slug,
              sealed_through,
              backlog_lag_ms,
              records_processed,
              updated_at
         FROM streaming_watermarks`
    );

    return rows.map((row) => {
      const record = row as {
        connector_id: string;
        dataset_id: string;
        dataset_slug: string;
        sealed_through: Date;
        backlog_lag_ms: number;
        records_processed: string | number;
        updated_at: Date;
      };

      return {
        connectorId: record.connector_id,
        datasetId: record.dataset_id,
        datasetSlug: record.dataset_slug,
        sealedThrough: new Date(record.sealed_through).toISOString(),
        backlogLagMs: Number(record.backlog_lag_ms ?? 0),
        recordsProcessed: Number(record.records_processed ?? 0),
        updatedAt: new Date(record.updated_at).toISOString()
      } satisfies StreamingWatermarkRecord;
    });
  });
}

export interface DatasetAccessAuditCursor {
  createdAt: string;
  id: string;
}

export interface DatasetAccessAuditListOptions {
  limit?: number;
  cursor?: DatasetAccessAuditCursor | null;
  actions?: string[];
  success?: boolean | null;
  startTime?: string | null;
  endTime?: string | null;
}

export interface DatasetAccessAuditListResult {
  events: DatasetAccessAuditRecord[];
  nextCursor: DatasetAccessAuditCursor | null;
}

export async function listDatasetAccessEvents(
  datasetId: string,
  options: DatasetAccessAuditListOptions = {}
): Promise<DatasetAccessAuditListResult> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const actions = (options.actions ?? [])
    .map((action) => action.trim())
    .filter((action) => action.length > 0);
  const startTime = options.startTime ?? null;
  const endTime = options.endTime ?? null;
  const cursor = options.cursor ?? null;
  const enforceSuccess = typeof options.success === 'boolean' ? options.success : null;

  return withConnection(async (client) => {
    const conditions: string[] = ['dataset_id = $1'];
    const values: unknown[] = [datasetId];

    if (actions.length > 0) {
      values.push(actions);
      conditions.push(`action = ANY($${values.length}::text[])`);
    }

    if (enforceSuccess !== null) {
      values.push(enforceSuccess);
      conditions.push(`success = $${values.length}`);
    }

    if (startTime) {
      values.push(startTime);
      conditions.push(`created_at >= $${values.length}::timestamptz`);
    }

    if (endTime) {
      values.push(endTime);
      conditions.push(`created_at <= $${values.length}::timestamptz`);
    }

    if (cursor) {
      values.push(cursor.createdAt);
      values.push(cursor.id);
      const createdAtParam = values.length - 1;
      const idParam = values.length;
      conditions.push(`(created_at, id) < ($${createdAtParam}::timestamptz, $${idParam}::text)`);
    }

    values.push(limit + 1);
    const limitParam = values.length;

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const { rows } = await client.query<DatasetAccessAuditRow>(
      `SELECT *
         FROM dataset_access_audit
        ${whereClause}
        ORDER BY created_at DESC, id DESC
        LIMIT $${limitParam}`,
      values
    );

    let nextCursor: DatasetAccessAuditCursor | null = null;
    let resultRows = rows;

    if (rows.length > limit) {
      const trimmedRows = rows.slice(0, limit);
      const cursorRow = trimmedRows[trimmedRows.length - 1];
      nextCursor = {
        createdAt: cursorRow.created_at,
        id: cursorRow.id
      };
      resultRows = trimmedRows;
    }

    return {
      events: resultRows.map(mapDatasetAccessAudit),
      nextCursor
    } satisfies DatasetAccessAuditListResult;
  });
}

export async function deleteExpiredDatasetAccessEvents(
  cutoffIso: string,
  limit = 1_000
): Promise<number> {
  if (!cutoffIso) {
    return 0;
  }
  const boundedLimit = Math.max(1, Math.min(limit, 5_000));
  return withConnection(async (client) => {
    const { rows } = await client.query<{ deleted: number }>(
      `WITH removed AS (
         DELETE FROM dataset_access_audit
          WHERE id IN (
            SELECT id
              FROM dataset_access_audit
             WHERE created_at < $1::timestamptz
             ORDER BY created_at ASC, id ASC
             LIMIT $2
          )
          RETURNING 1
       )
       SELECT COUNT(*)::int AS deleted FROM removed`,
      [cutoffIso, boundedLimit]
    );
    const deletedCount = rows[0]?.deleted;
    return typeof deletedCount === 'number' && Number.isFinite(deletedCount)
      ? deletedCount
      : 0;
  });
}

export async function updateManifestSummaryAndMetadata(
  manifestId: string,
  summary: JsonObject,
  metadata: JsonObject
): Promise<DatasetManifestRecord> {
  return withConnection(async (client) => {
    const { rows } = await client.query<DatasetManifestRow>(
      `UPDATE dataset_manifests
          SET summary = $2::jsonb,
              metadata = $3::jsonb,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *` as const,
      [manifestId, JSON.stringify(summary ?? {}), JSON.stringify(metadata ?? {})]
    );
    if (rows.length === 0) {
      throw new Error(`Manifest ${manifestId} not found`);
    }
    return mapManifest(rows[0]);
  });
}

export async function listLifecycleAuditEvents(
  datasetId: string,
  limit = 50
): Promise<LifecycleAuditLogRecord[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 200));
  return withConnection(async (client) => {
    const { rows } = await client.query<LifecycleAuditLogRow>(
      `SELECT *
         FROM lifecycle_audit_log
        WHERE dataset_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [datasetId, boundedLimit]
    );
    return rows.map(mapLifecycleAuditLog);
  });
}

export async function getCompactionCheckpointByManifest(
  manifestId: string
): Promise<CompactionCheckpointRecord | null> {
  return withConnection(async (client) => {
    const { rows } = await client.query<CompactionCheckpointRow>(
      `SELECT *
         FROM compaction_checkpoints
        WHERE manifest_id = $1
        LIMIT 1`,
      [manifestId]
    );
    const row = rows[0];
    return row ? mapCompactionCheckpoint(row) : null;
  });
}

export async function upsertCompactionCheckpoint(
  input: UpsertCompactionCheckpointInput
): Promise<CompactionCheckpointRecord> {
  const metadataJson = JSON.stringify(input.metadata ?? {});
  const statsJson = JSON.stringify(input.stats ?? {});
  return withConnection(async (client) => {
    const { rows } = await client.query<CompactionCheckpointRow>(
      `INSERT INTO compaction_checkpoints (
         id,
         dataset_id,
         manifest_id,
         manifest_shard,
         status,
         cursor,
         total_groups,
         retry_count,
         last_error,
         metadata,
         stats
       ) VALUES ($1, $2, $3, $4, 'pending', 0, $5, 0, NULL, $6::jsonb, $7::jsonb)
       ON CONFLICT (manifest_id) DO UPDATE
         SET dataset_id = EXCLUDED.dataset_id,
             manifest_shard = EXCLUDED.manifest_shard,
             status = 'pending',
             cursor = 0,
             total_groups = EXCLUDED.total_groups,
             metadata = EXCLUDED.metadata,
             stats = EXCLUDED.stats,
             retry_count = compaction_checkpoints.retry_count + 1,
             last_error = NULL,
             updated_at = NOW()
       RETURNING *` as const,
      [
        input.id,
        input.datasetId,
        input.manifestId,
        input.manifestShard,
        input.totalGroups,
        metadataJson,
        statsJson
      ]
    );
    return mapCompactionCheckpoint(rows[0]);
  });
}

export async function updateCompactionCheckpoint(
  input: UpdateCompactionCheckpointInput
): Promise<CompactionCheckpointRecord> {
  return withConnection(async (client) => {
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [input.id];
    let index = 2;

    if (input.cursor !== undefined) {
      setClauses.push(`cursor = $${index}`);
      values.push(input.cursor);
      index += 1;
    }

    if (input.totalGroups !== undefined) {
      setClauses.push(`total_groups = $${index}`);
      values.push(input.totalGroups);
      index += 1;
    }

    if (input.status) {
      setClauses.push(`status = $${index}`);
      values.push(input.status);
      index += 1;
    }

    if (input.retryCount !== undefined) {
      setClauses.push(`retry_count = $${index}`);
      values.push(input.retryCount);
      index += 1;
    }

    if (input.lastError !== undefined) {
      setClauses.push(`last_error = $${index}`);
      values.push(input.lastError);
      index += 1;
    }

    if (input.metadataReplace) {
      setClauses.push(`metadata = $${index}::jsonb`);
      values.push(JSON.stringify(input.metadataReplace));
      index += 1;
    } else if (input.metadataPatch) {
      setClauses.push(`metadata = metadata || $${index}::jsonb`);
      values.push(JSON.stringify(input.metadataPatch));
      index += 1;
    }

    if (input.statsReplace) {
      setClauses.push(`stats = $${index}::jsonb`);
      values.push(JSON.stringify(input.statsReplace));
      index += 1;
    } else if (input.statsPatch) {
      setClauses.push(`stats = stats || $${index}::jsonb`);
      values.push(JSON.stringify(input.statsPatch));
      index += 1;
    }

    if (setClauses.length === 1) {
      throw new Error('updateCompactionCheckpoint requires at least one field to update');
    }

    const sql = `UPDATE compaction_checkpoints
                    SET ${setClauses.join(', ')}
                  WHERE id = $1
                  RETURNING *`;
    const { rows } = await client.query<CompactionCheckpointRow>(sql, values);
    if (rows.length === 0) {
      throw new Error(`Compaction checkpoint ${input.id} not found`);
    }
    return mapCompactionCheckpoint(rows[0]);
  });
}

export async function deleteCompactionCheckpointByManifest(manifestId: string): Promise<void> {
  await withConnection(async (client) => {
    await client.query('DELETE FROM compaction_checkpoints WHERE manifest_id = $1', [manifestId]);
  });
}

export async function getStorageTargetById(id: string): Promise<StorageTargetRecord | null> {
  return withConnection(async (client) => {
    const { rows } = await client.query<StorageTargetRow>(
      'SELECT * FROM storage_targets WHERE id = $1 LIMIT 1',
      [id]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapStorageTarget(rows[0]);
  });
}

export async function getStorageTargetByName(name: string): Promise<StorageTargetRecord | null> {
  return withConnection(async (client) => {
    const { rows } = await client.query<StorageTargetRow>(
      'SELECT * FROM storage_targets WHERE name = $1 LIMIT 1',
      [name]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapStorageTarget(rows[0]);
  });
}

export async function listStorageTargets(kind?: StorageTargetKind): Promise<StorageTargetRecord[]> {
  return withConnection(async (client) => {
    if (kind) {
      const { rows } = await client.query<StorageTargetRow>(
        `SELECT *
           FROM storage_targets
          WHERE kind = $1
          ORDER BY created_at DESC`,
        [kind]
      );
      return rows.map(mapStorageTarget);
    }

    const { rows } = await client.query<StorageTargetRow>(
      `SELECT *
         FROM storage_targets
        ORDER BY created_at DESC`
    );
    return rows.map(mapStorageTarget);
  });
}

export async function getNextSchemaVersion(datasetId: string): Promise<number> {
  return withConnection(async (client) => {
    const { rows } = await client.query<{ max_version: number | null }>(
      'SELECT MAX(version) AS max_version FROM dataset_schema_versions WHERE dataset_id = $1',
      [datasetId]
    );
    const maxVersion = rows[0]?.max_version ?? 0;
    return maxVersion + 1;
  });
}

export async function findSchemaVersionByChecksum(
  datasetId: string,
  checksum: string
): Promise<DatasetSchemaVersionRecord | null> {
  return withConnection(async (client) => {
    const { rows } = await client.query<DatasetSchemaVersionRow>(
      `SELECT *
         FROM dataset_schema_versions
        WHERE dataset_id = $1 AND checksum = $2
        ORDER BY version DESC
        LIMIT 1`,
      [datasetId, checksum]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapSchemaVersion(rows[0]);
  });
}

export async function getSchemaVersionById(id: string): Promise<DatasetSchemaVersionRecord | null> {
  return withConnection(async (client) => {
    const { rows } = await client.query<DatasetSchemaVersionRow>(
      'SELECT * FROM dataset_schema_versions WHERE id = $1 LIMIT 1',
      [id]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapSchemaVersion(rows[0]);
  });
}

export async function getNextManifestVersion(datasetId: string): Promise<number> {
  return withConnection(async (client) => {
    const { rows } = await client.query<{ max_version: number | null }>(
      'SELECT MAX(version) AS max_version FROM dataset_manifests WHERE dataset_id = $1',
      [datasetId]
    );
    const maxVersion = rows[0]?.max_version ?? 0;
    return maxVersion + 1;
  });
}

export async function getManifestById(manifestId: string): Promise<DatasetManifestWithPartitions | null> {
  return withConnection(async (client) => {
    const { rows } = await client.query<DatasetManifestRow>(
      'SELECT * FROM dataset_manifests WHERE id = $1 LIMIT 1',
      [manifestId]
    );
    if (rows.length === 0) {
      return null;
    }
    const manifest = mapManifest(rows[0]);
    const partitions = await fetchPartitions(client, manifest.id);
    return {
      ...manifest,
      partitions
    };
  });
}

export async function getIngestionBatch(
  datasetId: string,
  idempotencyKey: string
): Promise<IngestionBatchRecord | null> {
  return withConnection(async (client) => {
    const { rows } = await client.query<IngestionBatchRow>(
      `SELECT *
         FROM ingestion_batches
        WHERE dataset_id = $1 AND idempotency_key = $2
        LIMIT 1`,
      [datasetId, idempotencyKey]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapIngestionBatch(rows[0]);
  });
}

export async function recordIngestionBatch(
  input: CreateIngestionBatchInput
): Promise<IngestionBatchRecord> {
  return withConnection(async (client) => {
    const { rows } = await client.query<IngestionBatchRow>(
      `INSERT INTO ingestion_batches (id, dataset_id, idempotency_key, manifest_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (dataset_id, idempotency_key) DO NOTHING
       RETURNING *` as const,
      [input.id, input.datasetId, input.idempotencyKey, input.manifestId]
    );

    if (rows.length > 0) {
      return mapIngestionBatch(rows[0]);
    }

    const { rows: existingRows } = await client.query<IngestionBatchRow>(
      `SELECT * FROM ingestion_batches WHERE dataset_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [input.datasetId, input.idempotencyKey]
    );
    if (existingRows.length === 0) {
      throw new Error('Failed to record ingestion batch idempotency entry');
    }
    return mapIngestionBatch(existingRows[0]);
  });
}

export async function findPartitionByIngestionSignature(
  datasetId: string,
  ingestionSignature: string
): Promise<DatasetPartitionRecord | null> {
  return withConnection(async (client) => {
    const { rows } = await client.query<DatasetPartitionRow>(
      `SELECT *
         FROM dataset_partitions
        WHERE dataset_id = $1
          AND ingestion_signature = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [datasetId, ingestionSignature]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapPartition(rows[0]);
  });
}

export async function listPartitionsForQuery(
  datasetId: string,
  rangeStart: Date,
  rangeEnd: Date,
  filters: PartitionFilters = {},
  options: PartitionQueryOptions = {}
): Promise<PartitionWithTarget[]> {
  return withConnection(async (client) => {
    const params: unknown[] = [
      datasetId,
      rangeStart.toISOString(),
      rangeEnd.toISOString()
    ];

    const pushParam = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const partitionClauses = buildPartitionFilterClauses(filters.partitionKey ?? {}, pushParam);
    const partitionWhere = partitionClauses.length > 0
      ? `\n         AND ${partitionClauses.join('\n         AND ')}`
      : '';

    const shards = (options.shards ?? [])
      .map((shard) => shard.trim())
      .filter((shard) => shard.length > 0);

    let shardClause = '';
    if (shards.length > 0) {
      const shardParam = pushParam(shards);
      shardClause = `\n         AND p.manifest_shard = ANY(${shardParam}::text[])`;
    }

    const query = `SELECT
         p.*,
         t.id AS storage_target_id,
         t.name AS storage_target_name,
         t.kind AS storage_target_kind,
         t.description AS storage_target_description,
         t.config AS storage_target_config,
         t.created_at AS storage_target_created_at,
         t.updated_at AS storage_target_updated_at
       FROM dataset_partitions p
       JOIN dataset_manifests m ON m.id = p.manifest_id
       JOIN storage_targets t ON t.id = p.storage_target_id
       WHERE p.dataset_id = $1
         AND m.status = 'published'
         AND p.end_time >= $2
         AND p.start_time <= $3${shardClause}${partitionWhere}
       ORDER BY p.start_time ASC`;

    const { rows } = await client.query<PartitionWithTargetRow>(query, params);
    return rows.map(mapPartitionWithTarget);
  });
}

export async function getPartitionsWithTargetsForManifest(
  manifestId: string
): Promise<PartitionWithTarget[]> {
  return withConnection(async (client) => {
    const { rows } = await client.query<PartitionWithTargetRow>(
      `SELECT
         p.*,
         t.id AS storage_target_id,
         t.name AS storage_target_name,
         t.kind AS storage_target_kind,
         t.description AS storage_target_description,
         t.config AS storage_target_config,
         t.created_at AS storage_target_created_at,
         t.updated_at AS storage_target_updated_at
        FROM dataset_partitions p
        JOIN storage_targets t ON t.id = p.storage_target_id
       WHERE p.manifest_id = $1
       ORDER BY p.start_time ASC, p.id ASC`,
      [manifestId]
    );
    return rows.map(mapPartitionWithTarget);
  });
}

async function insertPartitions(
  client: PoolClient,
  input: CreateDatasetManifestInput
): Promise<DatasetPartitionRecord[]> {
  const partitions: DatasetPartitionRecord[] = [];
  for (const partition of input.partitions) {
    const { rows } = await client.query<DatasetPartitionRow>(
      `INSERT INTO dataset_partitions (
         id,
         dataset_id,
         manifest_id,
         manifest_shard,
         partition_key,
         storage_target_id,
         file_format,
         file_path,
         file_size_bytes,
         row_count,
         start_time,
         end_time,
         checksum,
         metadata,
         column_statistics,
         column_bloom_filters,
         ingestion_signature
       ) VALUES (
         $1,
         $2,
         $3,
         $4,
         $5::jsonb,
         $6,
         $7,
         $8,
         $9,
         $10,
         $11,
         $12,
         $13,
         $14::jsonb,
         $15::jsonb,
       $16::jsonb,
       $17
      )
      ON CONFLICT (dataset_id, ingestion_signature)
        WHERE ingestion_signature IS NOT NULL DO NOTHING
      RETURNING *` as const,
      [
        partition.id,
        input.datasetId,
        input.id,
        input.manifestShard,
        JSON.stringify(partition.partitionKey),
        partition.storageTargetId,
        partition.fileFormat,
        partition.filePath,
        partition.fileSizeBytes ?? null,
        partition.rowCount ?? null,
        partition.startTime.toISOString(),
        partition.endTime.toISOString(),
        partition.checksum ?? null,
        JSON.stringify(partition.metadata ?? {}),
        JSON.stringify(partition.columnStatistics ?? {}),
        JSON.stringify(partition.columnBloomFilters ?? {}),
        partition.ingestionSignature ?? null
      ]
    );
    let row = rows[0] ?? null;
    if (!row && partition.ingestionSignature) {
      const existing = await client.query<DatasetPartitionRow>(
        `SELECT *
           FROM dataset_partitions
          WHERE dataset_id = $1
            AND ingestion_signature = $2
          LIMIT 1`,
        [input.datasetId, partition.ingestionSignature]
      );
      row = existing.rows[0] ?? null;
    }
    if (row) {
      partitions.push(mapPartition(row));
    }
  }
  return partitions;
}

interface PartitionRollups {
  partitionCount: number;
  totalRows: number;
  totalBytes: number;
}

function calculatePartitionRollups(partitions: DatasetPartitionRecord[]): PartitionRollups {
  const totalRows = partitions.reduce((acc, partition) => acc + (partition.rowCount ?? 0), 0);
  const totalBytes = partitions.reduce((acc, partition) => acc + (partition.fileSizeBytes ?? 0), 0);
  return {
    partitionCount: partitions.length,
    totalRows,
    totalBytes
  };
}

async function updateManifestRollups(
  client: PoolClient,
  manifestId: string,
  rollups: PartitionRollups
): Promise<void> {
  await client.query(
    `UPDATE dataset_manifests
        SET partition_count = $2,
            total_rows = $3,
            total_bytes = $4,
            updated_at = NOW()
      WHERE id = $1`,
    [manifestId, rollups.partitionCount, rollups.totalRows, rollups.totalBytes]
  );
}

async function touchDataset(client: PoolClient, datasetId: string): Promise<void> {
  await client.query('UPDATE datasets SET updated_at = NOW() WHERE id = $1', [datasetId]);
}

async function fetchPartitions(client: PoolClient, manifestId: string): Promise<DatasetPartitionRecord[]> {
  const { rows } = await client.query<DatasetPartitionRow>(
    `SELECT *
       FROM dataset_partitions
      WHERE manifest_id = $1
      ORDER BY start_time ASC, id ASC`,
    [manifestId]
  );
  return rows.map(mapPartition);
}

async function assertVersionIsMonotonic(
  client: PoolClient,
  datasetId: string,
  version: number
): Promise<void> {
  const { rows } = await client.query<{ max_version: number | null }>(
    `SELECT MAX(version) AS max_version
       FROM dataset_manifests
      WHERE dataset_id = $1`,
    [datasetId]
  );
  const maxVersion = rows[0]?.max_version;
  if (typeof maxVersion === 'number' && version <= maxVersion) {
    throw new Error(
      `Manifest version ${version} is not greater than existing max version ${maxVersion} for dataset ${datasetId}`
    );
  }
}

type StorageTargetRow = {
  id: string;
  name: string;
  kind: StorageTargetKind;
  description: string | null;
  config: JsonObject;
  created_at: string;
  updated_at: string;
};

type DatasetRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: DatasetStatus;
  write_format: WriteFormat;
  default_storage_target_id: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

type DatasetSchemaVersionRow = {
  id: string;
  dataset_id: string;
  version: number;
  description: string | null;
  schema: JsonObject;
  checksum: string | null;
  created_at: string;
};

type DatasetManifestRow = {
  id: string;
  dataset_id: string;
  version: number;
  status: ManifestStatus;
  schema_version_id: string | null;
  parent_manifest_id: string | null;
  manifest_shard: string;
  summary: JsonObject;
  statistics: JsonObject;
  metadata: JsonObject;
  partition_count: number;
  total_rows: number;
  total_bytes: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

type DatasetPartitionRow = {
  id: string;
  dataset_id: string;
  manifest_id: string;
  manifest_shard: string;
  partition_key: JsonObject;
  storage_target_id: string;
  file_format: FileFormat;
  file_path: string;
  file_size_bytes: number | null;
  row_count: number | null;
  start_time: string;
  end_time: string;
  checksum: string | null;
  metadata: JsonObject;
  column_statistics: JsonObject;
  column_bloom_filters: JsonObject;
  ingestion_signature: string | null;
  created_at: string;
};

type RetentionPolicyRow = {
  dataset_id: string;
  policy: JsonObject;
  updated_at: string;
};

type IngestionBatchRow = {
  id: string;
  dataset_id: string;
  idempotency_key: string;
  manifest_id: string;
  created_at: string;
};

type PartitionWithTargetRow = DatasetPartitionRow & {
  storage_target_id: string;
  storage_target_name: string;
  storage_target_kind: StorageTargetKind;
  storage_target_description: string | null;
  storage_target_config: JsonObject;
  storage_target_created_at: string;
  storage_target_updated_at: string;
};

type LifecycleJobRunRow = {
  id: string;
  job_kind: string;
  dataset_id: string | null;
  operations: string[] | null;
  trigger_source: string;
  status: LifecycleJobStatus;
  scheduled_for: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  attempts: number;
  error: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

type LifecycleAuditLogRow = {
  id: string;
  dataset_id: string;
  manifest_id: string | null;
  event_type: string;
  payload: JsonObject;
  created_at: string;
};

type DatasetAccessAuditRow = {
  id: string;
  dataset_id: string | null;
  dataset_slug: string;
  actor_id: string | null;
  actor_scopes: string[] | null;
  action: string;
  success: boolean;
  metadata: JsonObject;
  created_at: string;
};

type CompactionCheckpointRow = {
  id: string;
  dataset_id: string;
  manifest_id: string;
  manifest_shard: string;
  status: 'pending' | 'completed';
  cursor: number;
  total_groups: number;
  retry_count: number;
  last_error: string | null;
  metadata: JsonObject;
  stats: JsonObject;
  updated_at: string;
  created_at: string;
};

function mapStorageTarget(row: StorageTargetRow): StorageTargetRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    description: row.description,
    config: row.config,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapDataset(row: DatasetRow): DatasetRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    status: row.status,
    writeFormat: row.write_format,
    defaultStorageTargetId: row.default_storage_target_id,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSchemaVersion(row: DatasetSchemaVersionRow): DatasetSchemaVersionRecord {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    version: row.version,
    description: row.description,
    schema: row.schema,
    checksum: row.checksum,
    createdAt: row.created_at
  };
}

function mapManifest(row: DatasetManifestRow): DatasetManifestRecord {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    version: row.version,
    status: row.status,
    schemaVersionId: row.schema_version_id,
    parentManifestId: row.parent_manifest_id,
    manifestShard: row.manifest_shard,
    summary: row.summary,
    statistics: row.statistics,
    metadata: row.metadata,
    partitionCount: row.partition_count,
    totalRows: row.total_rows,
    totalBytes: row.total_bytes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at
  };
}

function mapPartition(row: DatasetPartitionRow): DatasetPartitionRecord {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    manifestId: row.manifest_id,
    manifestShard: row.manifest_shard,
    partitionKey: row.partition_key,
    storageTargetId: row.storage_target_id,
    fileFormat: row.file_format,
    filePath: row.file_path,
    fileSizeBytes: row.file_size_bytes,
    rowCount: row.row_count,
    startTime: row.start_time,
    endTime: row.end_time,
    checksum: row.checksum,
    metadata: row.metadata,
    columnStatistics:
      (row.column_statistics as PartitionColumnStatisticsMap | undefined) ?? {},
    columnBloomFilters:
      (row.column_bloom_filters as PartitionColumnBloomFilterMap | undefined) ?? {},
    ingestionSignature: row.ingestion_signature,
    createdAt: row.created_at
  };
}

function mapRetentionPolicy(row: RetentionPolicyRow): RetentionPolicyRecord {
  return {
    datasetId: row.dataset_id,
    policy: row.policy,
    updatedAt: row.updated_at
  };
}

function mapIngestionBatch(row: IngestionBatchRow): IngestionBatchRecord {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    idempotencyKey: row.idempotency_key,
    manifestId: row.manifest_id,
    createdAt: row.created_at
  };
}

function mapPartitionWithTarget(row: PartitionWithTargetRow): PartitionWithTarget {
  return {
    ...mapPartition(row),
    storageTarget: {
      id: row.storage_target_id,
      name: row.storage_target_name,
      kind: row.storage_target_kind,
      description: row.storage_target_description,
      config: row.storage_target_config,
      createdAt: row.storage_target_created_at,
      updatedAt: row.storage_target_updated_at
    }
  };
}

function mapLifecycleJobRun(row: LifecycleJobRunRow): LifecycleJobRunRecord {
  return {
    id: row.id,
    jobKind: row.job_kind,
    datasetId: row.dataset_id,
    operations: row.operations ?? [],
    triggerSource: row.trigger_source,
    status: row.status,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    attempts: row.attempts,
    error: row.error,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapLifecycleAuditLog(row: LifecycleAuditLogRow): LifecycleAuditLogRecord {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    manifestId: row.manifest_id,
    eventType: row.event_type,
    payload: row.payload,
    createdAt: row.created_at
  };
}

function mapDatasetAccessAudit(row: DatasetAccessAuditRow): DatasetAccessAuditRecord {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    datasetSlug: row.dataset_slug,
    actorId: row.actor_id,
    actorScopes: row.actor_scopes ?? [],
    action: row.action,
    success: row.success,
    metadata: row.metadata,
    createdAt: row.created_at
  };
}

function mapCompactionCheckpoint(row: CompactionCheckpointRow): CompactionCheckpointRecord {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    manifestId: row.manifest_id,
    manifestShard: row.manifest_shard,
    status: row.status,
    cursor: row.cursor,
    totalGroups: row.total_groups,
    retryCount: row.retry_count,
    lastError: row.last_error,
    metadata: row.metadata,
    stats: row.stats,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function buildPartitionFilterClauses(
  filters: Record<string, PartitionKeyPredicate>,
  pushParam: (value: unknown) => string
): string[] {
  const clauses: string[] = [];
  for (const [key, predicate] of Object.entries(filters)) {
    if (!predicate) {
      continue;
    }
    const keyParam = pushParam(key);
    const keyExpression = `jsonb_extract_path_text(p.partition_key, ${keyParam})`;
    switch (predicate.type) {
      case 'string':
        clauses.push(...buildStringPartitionClauses(keyExpression, predicate, pushParam));
        break;
      case 'number':
        clauses.push(...buildNumberPartitionClauses(keyExpression, predicate, pushParam));
        break;
      case 'timestamp':
        clauses.push(...buildTimestampPartitionClauses(keyExpression, predicate, pushParam));
        break;
      default:
        break;
    }
  }
  return clauses;
}

function buildStringPartitionClauses(
  keyExpression: string,
  predicate: StringPartitionKeyPredicate,
  pushParam: (value: unknown) => string
): string[] {
  const clauses: string[] = [];
  if (typeof predicate.eq === 'string') {
    const valueParam = pushParam(predicate.eq);
    clauses.push(`${keyExpression} = ${valueParam}`);
  }
  if (hasItems(predicate.in)) {
    const valueParam = pushParam(predicate.in);
    clauses.push(`${keyExpression} = ANY(${valueParam}::text[])`);
  }
  return clauses;
}

function buildNumberPartitionClauses(
  keyExpression: string,
  predicate: NumberPartitionKeyPredicate,
  pushParam: (value: unknown) => string
): string[] {
  const clauses: string[] = [];
  const numericExpression = `(${keyExpression})::numeric`;
  if (predicate.eq !== undefined) {
    const valueParam = pushParam(predicate.eq);
    clauses.push(`${numericExpression} = ${valueParam}::numeric`);
  }
  if (hasItems(predicate.in)) {
    const valueParam = pushParam(predicate.in);
    clauses.push(`${numericExpression} = ANY(${valueParam}::numeric[])`);
  }
  if (predicate.gt !== undefined) {
    const valueParam = pushParam(predicate.gt);
    clauses.push(`${numericExpression} > ${valueParam}::numeric`);
  }
  if (predicate.gte !== undefined) {
    const valueParam = pushParam(predicate.gte);
    clauses.push(`${numericExpression} >= ${valueParam}::numeric`);
  }
  if (predicate.lt !== undefined) {
    const valueParam = pushParam(predicate.lt);
    clauses.push(`${numericExpression} < ${valueParam}::numeric`);
  }
  if (predicate.lte !== undefined) {
    const valueParam = pushParam(predicate.lte);
    clauses.push(`${numericExpression} <= ${valueParam}::numeric`);
  }
  return clauses;
}

function buildTimestampPartitionClauses(
  keyExpression: string,
  predicate: TimestampPartitionKeyPredicate,
  pushParam: (value: unknown) => string
): string[] {
  const clauses: string[] = [];
  const timestampExpression = `(${keyExpression})::timestamptz`;
  if (typeof predicate.eq === 'string') {
    const valueParam = pushParam(predicate.eq);
    clauses.push(`${timestampExpression} = ${valueParam}::timestamptz`);
  }
  if (hasItems(predicate.in)) {
    const valueParam = pushParam(predicate.in);
    clauses.push(`${timestampExpression} = ANY(${valueParam}::timestamptz[])`);
  }
  if (typeof predicate.gt === 'string') {
    const valueParam = pushParam(predicate.gt);
    clauses.push(`${timestampExpression} > ${valueParam}::timestamptz`);
  }
  if (typeof predicate.gte === 'string') {
    const valueParam = pushParam(predicate.gte);
    clauses.push(`${timestampExpression} >= ${valueParam}::timestamptz`);
  }
  if (typeof predicate.lt === 'string') {
    const valueParam = pushParam(predicate.lt);
    clauses.push(`${timestampExpression} < ${valueParam}::timestamptz`);
  }
  if (typeof predicate.lte === 'string') {
    const valueParam = pushParam(predicate.lte);
    clauses.push(`${timestampExpression} <= ${valueParam}::timestamptz`);
  }
  return clauses;
}

function isSchemaVersionConflict(error: unknown): error is DatabaseError & { constraint?: string } {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as DatabaseError & { constraint?: string };
  return candidate.code === '23505' && candidate.constraint === 'dataset_schema_versions_dataset_id_version_key';
}

function hasItems<T>(values: readonly T[] | undefined): values is readonly T[] {
  return Array.isArray(values) && values.length > 0;
}

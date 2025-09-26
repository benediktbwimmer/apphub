import type { PoolClient } from 'pg';
import { withConnection, withTransaction } from './client';

export type StorageTargetKind = 'local' | 's3' | 'gcs' | 'azure_blob';
export type FileFormat = 'duckdb' | 'parquet';
export type DatasetStatus = 'active' | 'inactive';
export type WriteFormat = 'duckdb' | 'parquet';
export type ManifestStatus = 'draft' | 'published' | 'superseded';

type JsonObject = Record<string, unknown>;

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

export interface DatasetPartitionRecord {
  id: string;
  datasetId: string;
  manifestId: string;
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
}

export interface CreateDatasetManifestInput {
  id: string;
  datasetId: string;
  version: number;
  status: ManifestStatus;
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

export interface RetentionPolicyRecord {
  datasetId: string;
  policy: JsonObject;
  updatedAt: string;
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
        input.writeFormat ?? 'duckdb',
        input.defaultStorageTargetId ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    return mapDataset(rows[0]);
  });
}

export async function createDatasetSchemaVersion(
  input: CreateDatasetSchemaVersionInput
): Promise<DatasetSchemaVersionRecord> {
  return withConnection(async (client) => {
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
  });
}

export async function createDatasetManifest(
  input: CreateDatasetManifestInput
): Promise<DatasetManifestWithPartitions> {
  return withTransaction(async (client) => {
    await assertVersionIsMonotonic(client, input.datasetId, input.version);

    const publishedAt = input.status === 'published' ? new Date() : null;
    const { rows: manifestRows } = await client.query<DatasetManifestRow>(
      `INSERT INTO dataset_manifests (
         id,
         dataset_id,
         version,
         status,
         schema_version_id,
         parent_manifest_id,
         summary,
         statistics,
         metadata,
         created_by,
         published_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11)
       RETURNING *` as const,
      [
        input.id,
        input.datasetId,
        input.version,
        input.status,
        input.schemaVersionId ?? null,
        input.parentManifestId ?? null,
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
  datasetId: string
): Promise<DatasetManifestWithPartitions | null> {
  return withConnection(async (client) => {
    const { rows } = await client.query<DatasetManifestRow>(
      `SELECT *
         FROM dataset_manifests
        WHERE dataset_id = $1 AND status = 'published'
        ORDER BY version DESC
        LIMIT 1`,
      [datasetId]
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

export interface PartitionFilters {
  partitionKey?: Record<string, string[]>;
}

export async function listPartitionsForQuery(
  datasetId: string,
  rangeStart: Date,
  rangeEnd: Date,
  filters: PartitionFilters = {}
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
       JOIN dataset_manifests m ON m.id = p.manifest_id
       JOIN storage_targets t ON t.id = p.storage_target_id
       WHERE p.dataset_id = $1
         AND m.status = 'published'
         AND p.end_time >= $2
         AND p.start_time <= $3
       ORDER BY p.start_time ASC`,
      [datasetId, rangeStart.toISOString(), rangeEnd.toISOString()]
    );

    const partitionFilters = filters.partitionKey ?? {};

    return rows
      .filter((row) => partitionMatchesFilters(row.partition_key, partitionFilters))
      .map(mapPartitionWithTarget);
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
         partition_key,
         storage_target_id,
         file_format,
         file_path,
         file_size_bytes,
         row_count,
         start_time,
         end_time,
         checksum,
         metadata
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
       RETURNING *` as const,
      [
        partition.id,
        input.datasetId,
        input.id,
        JSON.stringify(partition.partitionKey),
        partition.storageTargetId,
        partition.fileFormat,
        partition.filePath,
        partition.fileSizeBytes ?? null,
        partition.rowCount ?? null,
        partition.startTime.toISOString(),
        partition.endTime.toISOString(),
        partition.checksum ?? null,
        JSON.stringify(partition.metadata ?? {})
      ]
    );
    partitions.push(mapPartition(rows[0]));
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

function partitionMatchesFilters(
  partitionKey: JsonObject,
  filters: Record<string, string[]>
): boolean {
  const entries = Object.entries(filters);
  if (entries.length === 0) {
    return true;
  }
  for (const [key, values] of entries) {
    if (!Array.isArray(values) || values.length === 0) {
      continue;
    }
    const actual = partitionKey[key];
    if (typeof actual !== 'string') {
      return false;
    }
    if (!values.includes(actual)) {
      return false;
    }
  }
  return true;
}

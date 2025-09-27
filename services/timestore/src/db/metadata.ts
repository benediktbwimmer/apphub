import type { PoolClient } from 'pg';
import { withConnection, withTransaction } from './client';

export type StorageTargetKind = 'local' | 's3' | 'gcs' | 'azure_blob';
export type FileFormat = 'duckdb' | 'parquet';
export type DatasetStatus = 'active' | 'inactive';
export type WriteFormat = 'duckdb' | 'parquet';
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
  id: string;
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

export async function listDatasetAccessEvents(
  datasetId: string,
  limit = 50
): Promise<DatasetAccessAuditRecord[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 200));
  return withConnection(async (client) => {
    const { rows } = await client.query<DatasetAccessAuditRow>(
      `SELECT *
         FROM dataset_access_audit
        WHERE dataset_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [datasetId, boundedLimit]
    );
    return rows.map(mapDatasetAccessAudit);
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

export async function deleteDatasetPartitions(partitionIds: string[]): Promise<void> {
  if (partitionIds.length === 0) {
    return;
  }
  await withConnection(async (client) => {
    await client.query('DELETE FROM dataset_partitions WHERE id = ANY($1)', [partitionIds]);
  });
}

export async function refreshManifestRollups(
  manifestId: string
): Promise<DatasetManifestWithPartitions> {
  return withTransaction(async (client) => {
    const { rows: manifestRows } = await client.query<DatasetManifestRow>(
      'SELECT * FROM dataset_manifests WHERE id = $1 LIMIT 1',
      [manifestId]
    );
    if (manifestRows.length === 0) {
      throw new Error(`Manifest ${manifestId} not found`);
    }
    const partitions = await fetchPartitions(client, manifestId);
    const rollups = calculatePartitionRollups(partitions);
    await updateManifestRollups(client, manifestId, rollups);
    const { rows: updatedRows } = await client.query<DatasetManifestRow>(
      'SELECT * FROM dataset_manifests WHERE id = $1 LIMIT 1',
      [manifestId]
    );
    const manifest = mapManifest(updatedRows[0] ?? manifestRows[0]);
    return {
      ...manifest,
      partitions
    };
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

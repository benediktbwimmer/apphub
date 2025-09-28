import type { PoolClient } from 'pg';
import { writeAuditEntry } from './audit';
import type {
  MetastoreRecord,
  MetastoreRecordProjection,
  MetastoreRecordRow,
  RecordDeleteInput,
  RecordPatchInput,
  RecordPurgeInput,
  RecordUpdateInput,
  RecordWriteInput
} from './types';
import type { SearchOptions } from '../search/types';
import { buildSearchQuery } from '../search/queryBuilder';

function toRecord(row: MetastoreRecordRow): MetastoreRecord {
  return {
    id: row.id,
    namespace: row.namespace,
    key: row.record_key,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    tags: Array.isArray(row.tags) ? row.tags : [],
    owner: row.owner,
    schemaHash: row.schema_hash,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by
  } satisfies MetastoreRecord;
}

function toProjectedRecord(row: Partial<MetastoreRecordRow>): MetastoreRecordProjection {
  if (!row.namespace || !row.record_key) {
    throw new Error('Projected metastore record is missing namespace or key');
  }

  const record: MetastoreRecordProjection = {
    namespace: row.namespace,
    key: row.record_key
  } satisfies MetastoreRecordProjection;

  if ('id' in row && typeof row.id === 'number') {
    record.id = row.id;
  }

  if ('metadata' in row) {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    record.metadata = normalizeMetadata(metadata);
  }

  if ('tags' in row) {
    const tags = Array.isArray(row.tags) ? row.tags : null;
    record.tags = normalizeTags(tags ?? undefined);
  }

  if ('owner' in row) {
    record.owner = row.owner ?? null;
  }

  if ('schema_hash' in row) {
    record.schemaHash = row.schema_hash ?? null;
  }

  if ('version' in row && typeof row.version === 'number') {
    record.version = row.version;
  }

  if ('created_at' in row && row.created_at instanceof Date) {
    record.createdAt = row.created_at;
  }

  if ('updated_at' in row && row.updated_at instanceof Date) {
    record.updatedAt = row.updated_at;
  }

  if ('deleted_at' in row) {
    record.deletedAt = row.deleted_at ?? null;
  }

  if ('created_by' in row) {
    record.createdBy = row.created_by ?? null;
  }

  if ('updated_by' in row) {
    record.updatedBy = row.updated_by ?? null;
  }

  return record;
}

function normalizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }
  return metadata;
}

function normalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }
  const deduped = new Set<string>();
  for (const tag of tags) {
    if (typeof tag === 'string' && tag.trim().length > 0) {
      deduped.add(tag.trim());
    }
  }
  return Array.from(deduped);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMergeMetadata(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMergeMetadata(current as Record<string, unknown>, value as Record<string, unknown>);
      continue;
    }
    result[key] = value;
  }
  return result;
}

function unsetPath(
  target: Record<string, unknown>,
  segments: string[]
): Record<string, unknown> {
  if (segments.length === 0) {
    return target;
  }
  const [head, ...rest] = segments;
  if (!Object.prototype.hasOwnProperty.call(target, head)) {
    return target;
  }

  const cloned: Record<string, unknown> = { ...target };

  if (rest.length === 0) {
    delete cloned[head];
    return cloned;
  }

  const next = target[head];
  if (!isPlainObject(next)) {
    delete cloned[head];
    return cloned;
  }

  const updatedChild = unsetPath(next as Record<string, unknown>, rest);
  if (updatedChild === next) {
    return target;
  }
  if (Object.keys(updatedChild).length === 0) {
    delete cloned[head];
  } else {
    cloned[head] = updatedChild;
  }
  return cloned;
}

function unsetMetadataPaths(
  metadata: Record<string, unknown>,
  paths: string[]
): Record<string, unknown> {
  let result: Record<string, unknown> = { ...metadata };
  for (const path of paths) {
    const trimmed = path.trim();
    if (!trimmed) {
      continue;
    }
    const segments = trimmed.split('.').map((segment) => segment.trim()).filter(Boolean);
    if (segments.length === 0) {
      continue;
    }
    const updated = unsetPath(result, segments);
    if (updated !== result) {
      result = updated;
    }
  }
  return result;
}

function applyTagPatch(existing: string[], patch?: RecordPatchInput['tags']): string[] {
  if (!patch) {
    return existing;
  }

  if (patch.set && patch.set.length > 0) {
    return normalizeTags(patch.set);
  }

  const working = new Set(existing.map((tag) => tag.trim()).filter(Boolean));

  if (patch.add) {
    for (const tag of patch.add) {
      if (typeof tag === 'string' && tag.trim().length > 0) {
        working.add(tag.trim());
      }
    }
  }

  if (patch.remove) {
    for (const tag of patch.remove) {
      if (typeof tag === 'string' && tag.trim().length > 0) {
        working.delete(tag.trim());
      }
    }
  }

  return Array.from(working);
}

export async function createRecord(
  client: PoolClient,
  input: RecordWriteInput
): Promise<{ record: MetastoreRecord; created: boolean }> {
  const metadata = normalizeMetadata(input.metadata);
  const tags = normalizeTags(input.tags);
  const owner = input.owner ?? null;
  const schemaHash = input.schemaHash ?? null;
  const actor = input.actor ?? null;

  const result = await client.query<MetastoreRecordRow>(
    `INSERT INTO metastore_records (namespace, record_key, metadata, tags, owner, schema_hash, created_by, updated_by)
     VALUES ($1, $2, $3::jsonb, $4::text[], $5, $6, $7, $7)
     ON CONFLICT (namespace, record_key) DO NOTHING
     RETURNING *`,
    [
      input.namespace,
      input.key,
      JSON.stringify(metadata),
      tags,
      owner,
      schemaHash,
      actor
    ]
  );

  if ((result.rowCount ?? 0) > 0) {
    const record = toRecord(result.rows[0]);
    await writeAuditEntry({ client, action: 'create', record, actor });
    return { record, created: true };
  }

  const existing = await client.query<MetastoreRecordRow>(
    `SELECT * FROM metastore_records WHERE namespace = $1 AND record_key = $2`,
    [input.namespace, input.key]
  );

  if ((existing.rowCount ?? 0) === 0) {
    throw new Error('Failed to locate record after insert conflict');
  }

  return { record: toRecord(existing.rows[0]), created: false };
}

export async function fetchRecord(
  client: PoolClient,
  namespace: string,
  key: string,
  options?: { includeDeleted?: boolean }
): Promise<MetastoreRecord | null> {
  const includeDeleted = options?.includeDeleted ?? false;

  const query = includeDeleted
    ? `SELECT * FROM metastore_records WHERE namespace = $1 AND record_key = $2`
    : `SELECT * FROM metastore_records WHERE namespace = $1 AND record_key = $2 AND deleted_at IS NULL`;

  const result = await client.query<MetastoreRecordRow>(query, [namespace, key]);
  if ((result.rowCount ?? 0) === 0) {
    return null;
  }
  return toRecord(result.rows[0]);
}

export class OptimisticLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptimisticLockError';
  }
}

export class RecordDeletedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordDeletedError';
  }
}

async function selectForUpdate(
  client: PoolClient,
  namespace: string,
  key: string,
  options?: { includeDeleted?: boolean }
): Promise<MetastoreRecord | null> {
  const includeDeleted = options?.includeDeleted ?? false;
  const query = includeDeleted
    ? `SELECT * FROM metastore_records WHERE namespace = $1 AND record_key = $2 FOR UPDATE`
    : `SELECT * FROM metastore_records WHERE namespace = $1 AND record_key = $2 AND deleted_at IS NULL FOR UPDATE`;
  const result = await client.query<MetastoreRecordRow>(query, [namespace, key]);
  if ((result.rowCount ?? 0) === 0) {
    return null;
  }
  return toRecord(result.rows[0]);
}

export async function updateRecord(
  client: PoolClient,
  input: RecordUpdateInput
): Promise<MetastoreRecord | null> {
  const previous = await selectForUpdate(client, input.namespace, input.key, {
    includeDeleted: true
  });

  if (!previous) {
    return null;
  }

  if (typeof input.expectedVersion === 'number' && previous.version !== input.expectedVersion) {
    throw new OptimisticLockError('Version mismatch while updating metastore record');
  }

  const metadata = normalizeMetadata(input.metadata);
  const tags = normalizeTags(input.tags);
  const owner = input.owner ?? null;
  const schemaHash = input.schemaHash ?? null;
  const actor = input.actor ?? null;

  const result = await client.query<MetastoreRecordRow>(
    `UPDATE metastore_records
       SET metadata = $1::jsonb,
           tags = $2::text[],
           owner = $3,
           schema_hash = $4,
           updated_at = NOW(),
           updated_by = $5,
           version = version + 1,
           deleted_at = NULL
     WHERE namespace = $6
       AND record_key = $7
     RETURNING *`,
    [
      JSON.stringify(metadata),
      tags,
      owner,
      schemaHash,
      actor,
      input.namespace,
      input.key
    ]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error('Failed to update metastore record');
  }

  const updated = toRecord(result.rows[0]);
  await writeAuditEntry({ client, action: 'update', record: updated, previousRecord: previous, actor });
  return updated;
}

export async function softDeleteRecord(
  client: PoolClient,
  input: RecordDeleteInput
): Promise<MetastoreRecord | null> {
  const previous = await selectForUpdate(client, input.namespace, input.key, {
    includeDeleted: true
  });

  if (!previous) {
    return null;
  }

  if (previous.deletedAt) {
    return previous;
  }

  if (typeof input.expectedVersion === 'number' && previous.version !== input.expectedVersion) {
    throw new OptimisticLockError('Version mismatch while deleting metastore record');
  }

  const actor = input.actor ?? null;

  const result = await client.query<MetastoreRecordRow>(
    `UPDATE metastore_records
       SET deleted_at = NOW(),
           updated_at = NOW(),
           updated_by = $1,
           version = version + 1
     WHERE namespace = $2
       AND record_key = $3
     RETURNING *`,
    [actor, input.namespace, input.key]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error('Failed to delete metastore record');
  }

  const deleted = toRecord(result.rows[0]);
  await writeAuditEntry({ client, action: 'delete', record: deleted, previousRecord: previous, actor });
  return deleted;
}

export async function patchRecord(
  client: PoolClient,
  input: RecordPatchInput
): Promise<MetastoreRecord | null> {
  const previous = await selectForUpdate(client, input.namespace, input.key, {
    includeDeleted: true
  });

  if (!previous) {
    return null;
  }

  if (previous.deletedAt) {
    throw new RecordDeletedError('Cannot patch a soft-deleted record');
  }

  if (typeof input.expectedVersion === 'number' && previous.version !== input.expectedVersion) {
    throw new OptimisticLockError('Version mismatch while patching metastore record');
  }

  let metadata = previous.metadata;
  if (input.metadataPatch) {
    metadata = deepMergeMetadata(metadata, normalizeMetadata(input.metadataPatch));
  }

  if (input.metadataUnset && input.metadataUnset.length > 0) {
    metadata = unsetMetadataPaths(metadata, input.metadataUnset);
  }

  metadata = normalizeMetadata(metadata);

  const tags = applyTagPatch(previous.tags, input.tags);
  const owner = input.owner !== undefined ? input.owner : previous.owner;
  const schemaHash = input.schemaHash !== undefined ? input.schemaHash : previous.schemaHash;
  const actor = input.actor ?? null;

  const result = await client.query<MetastoreRecordRow>(
    `UPDATE metastore_records
       SET metadata = $1::jsonb,
           tags = $2::text[],
           owner = $3,
           schema_hash = $4,
           updated_at = NOW(),
           updated_by = $5,
           version = version + 1
     WHERE namespace = $6
       AND record_key = $7
     RETURNING *`,
    [
      JSON.stringify(metadata),
      normalizeTags(tags),
      owner ?? null,
      schemaHash ?? null,
      actor,
      input.namespace,
      input.key
    ]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error('Failed to patch metastore record');
  }

  const updated = toRecord(result.rows[0]);
  await writeAuditEntry({ client, action: 'update', record: updated, previousRecord: previous, actor });
  return updated;
}

export type RestoreRecordInput = {
  namespace: string;
  key: string;
  snapshot: {
    metadata: Record<string, unknown> | null;
    tags: string[] | null;
    owner: string | null;
    schemaHash: string | null;
  };
  expectedVersion?: number;
  actor?: string | null;
};

export async function restoreRecordFromAudit(
  client: PoolClient,
  input: RestoreRecordInput
): Promise<MetastoreRecord | null> {
  const previous = await selectForUpdate(client, input.namespace, input.key, {
    includeDeleted: true
  });

  if (!previous) {
    return null;
  }

  if (typeof input.expectedVersion === 'number' && previous.version !== input.expectedVersion) {
    throw new OptimisticLockError('Version mismatch while restoring metastore record');
  }

  const snapshotMetadata = input.snapshot.metadata;
  const metadataObject =
    snapshotMetadata && typeof snapshotMetadata === 'object' && !Array.isArray(snapshotMetadata)
      ? (snapshotMetadata as Record<string, unknown>)
      : {};
  const metadata = normalizeMetadata(metadataObject);

  const snapshotTags = Array.isArray(input.snapshot.tags)
    ? input.snapshot.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  const tags = normalizeTags(snapshotTags);

  const owner = typeof input.snapshot.owner === 'string' ? input.snapshot.owner : null;
  const schemaHash = typeof input.snapshot.schemaHash === 'string' ? input.snapshot.schemaHash : null;
  const actor = input.actor ?? null;

  const result = await client.query<MetastoreRecordRow>(
    `UPDATE metastore_records
        SET metadata = $1::jsonb,
            tags = $2::text[],
            owner = $3,
            schema_hash = $4,
            deleted_at = NULL,
            updated_at = NOW(),
            updated_by = $5,
            version = version + 1
      WHERE namespace = $6
        AND record_key = $7
      RETURNING *`,
    [
      JSON.stringify(metadata),
      tags,
      owner,
      schemaHash,
      actor,
      input.namespace,
      input.key
    ]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error('Failed to restore metastore record');
  }

  const restored = toRecord(result.rows[0]);
  await writeAuditEntry({ client, action: 'restore', record: restored, previousRecord: previous, actor });
  return restored;
}

export type UpsertResult = {
  record: MetastoreRecord | null;
  created: boolean;
};

export async function upsertRecord(
  client: PoolClient,
  input: RecordUpdateInput
): Promise<UpsertResult> {
  const existing = await selectForUpdate(client, input.namespace, input.key, {
    includeDeleted: true
  });

  if (!existing) {
    const { record } = await createRecord(client, input);
    return { record, created: true };
  }

  if (existing.deletedAt) {
    // treat as restore + update
    const updated = await updateRecord(client, {
      ...input,
      expectedVersion: input.expectedVersion ?? existing.version
    });
    return { record: updated, created: false };
  }

  const updated = await updateRecord(client, {
    ...input,
    expectedVersion: input.expectedVersion ?? existing.version
  });
  return { record: updated, created: false };
}

export async function hardDeleteRecord(
  client: PoolClient,
  input: RecordPurgeInput
): Promise<MetastoreRecord | null> {
  const previous = await selectForUpdate(client, input.namespace, input.key, {
    includeDeleted: true
  });

  if (!previous) {
    return null;
  }

  if (typeof input.expectedVersion === 'number' && previous.version !== input.expectedVersion) {
    throw new OptimisticLockError('Version mismatch while purging metastore record');
  }

  await client.query(`DELETE FROM metastore_record_audits WHERE namespace = $1 AND record_key = $2`, [
    input.namespace,
    input.key
  ]);

  const result = await client.query(`DELETE FROM metastore_records WHERE id = $1`, [previous.id]);

  if ((result.rowCount ?? 0) === 0) {
    throw new Error('Failed to purge metastore record');
  }

  return previous;
}

export type SearchRecordsResult = {
  records: MetastoreRecordProjection[];
  total: number;
};

export async function searchRecords(
  client: PoolClient,
  options: SearchOptions
): Promise<SearchRecordsResult> {
  const query = buildSearchQuery(options);
  const result = await client.query<(Record<string, unknown> & { total_count: string | number })>(
    query.text,
    query.values
  );

  if (result.rowCount === 0) {
    return { records: [], total: 0 };
  }

  const useFullRecord = !options.projection || options.projection.length === 0;
  const records = result.rows.map((row) => {
    const { total_count: _totalCount, ...rawRecord } = row;
    if (useFullRecord) {
      return toRecord(rawRecord as MetastoreRecordRow);
    }
    return toProjectedRecord(rawRecord as Partial<MetastoreRecordRow>);
  });
  const totalRaw = result.rows[0]?.total_count ?? 0;
  const total = typeof totalRaw === 'string' ? Number.parseInt(totalRaw, 10) : Number(totalRaw);

  return {
    records,
    total: Number.isFinite(total) ? total : records.length
  };
}

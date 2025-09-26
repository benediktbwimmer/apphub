import type { PoolClient } from 'pg';
import { writeAuditEntry } from './audit';
import type {
  MetastoreRecord,
  MetastoreRecordRow,
  RecordDeleteInput,
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

export type SearchRecordsResult = {
  records: MetastoreRecord[];
  total: number;
};

export async function searchRecords(
  client: PoolClient,
  options: SearchOptions
): Promise<SearchRecordsResult> {
  const query = buildSearchQuery(options);
  const result = await client.query<(MetastoreRecordRow & { total_count: string | number })>(
    query.text,
    query.values
  );

  if (result.rowCount === 0) {
    return { records: [], total: 0 };
  }

  const records = result.rows.map((row) => toRecord(row));
  const totalRaw = result.rows[0]?.total_count ?? 0;
  const total = typeof totalRaw === 'string' ? Number.parseInt(totalRaw, 10) : Number(totalRaw);

  return {
    records,
    total: Number.isFinite(total) ? total : records.length
  };
}

import type { PoolClient } from 'pg';

export type RecordAuditView = {
  id: number;
  namespace: string;
  recordKey: string;
  action: string;
  actor: string | null;
  previousVersion: number | null;
  version: number | null;
  metadata: Record<string, unknown> | null;
  previousMetadata: Record<string, unknown> | null;
  tags: string[] | null;
  previousTags: string[] | null;
  owner: string | null;
  previousOwner: string | null;
  schemaHash: string | null;
  previousSchemaHash: string | null;
  createdAt: Date;
};

export type ListRecordAuditsOptions = {
  namespace: string;
  key: string;
  limit?: number;
  offset?: number;
};

export type ListRecordAuditsResult = {
  entries: RecordAuditView[];
  total: number;
};

const AUDIT_COLUMNS = `id,
  namespace,
  record_key,
  action,
  actor,
  previous_version,
  version,
  metadata,
  previous_metadata,
  tags,
  previous_tags,
  owner,
  previous_owner,
  schema_hash,
  previous_schema_hash,
  created_at`;

function normalizeTagColumn(value: unknown): string[] | null {
  if (value == null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  return null;
}

function toAuditView(row: Record<string, unknown>): RecordAuditView {
  return {
    id: Number(row.id),
    namespace: String(row.namespace),
    recordKey: String(row.record_key),
    action: String(row.action),
    actor: (row.actor as string) ?? null,
    previousVersion: row.previous_version === null ? null : Number(row.previous_version),
    version: row.version === null ? null : Number(row.version),
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
    previousMetadata: (row.previous_metadata ?? null) as Record<string, unknown> | null,
    tags: normalizeTagColumn(row.tags),
    previousTags: normalizeTagColumn(row.previous_tags),
    owner: (row.owner ?? null) as string | null,
    previousOwner: (row.previous_owner ?? null) as string | null,
    schemaHash: (row.schema_hash ?? null) as string | null,
    previousSchemaHash: (row.previous_schema_hash ?? null) as string | null,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at))
  } satisfies RecordAuditView;
}

export async function listRecordAudits(
  client: PoolClient,
  options: ListRecordAuditsOptions
): Promise<ListRecordAuditsResult> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const { rows } = await client.query(
    `SELECT ${AUDIT_COLUMNS},
            COUNT(*) OVER() AS total_count
       FROM metastore_record_audits
      WHERE namespace = $1
        AND record_key = $2
      ORDER BY created_at DESC, id DESC
      LIMIT $3
      OFFSET $4`,
    [options.namespace, options.key, limit, offset]
  );

  if (rows.length === 0) {
    return { entries: [], total: 0 } satisfies ListRecordAuditsResult;
  }

  const totalRaw = rows[0]?.total_count ?? 0;
  const total = typeof totalRaw === 'string' ? Number.parseInt(totalRaw, 10) : Number(totalRaw);

  return {
    entries: rows.map((row) => toAuditView(row)),
    total: Number.isFinite(total) ? total : rows.length
  } satisfies ListRecordAuditsResult;
}

export async function getRecordAuditById(
  client: PoolClient,
  options: { namespace: string; key: string; id: number }
): Promise<RecordAuditView | null> {
  const { rows } = await client.query(
    `SELECT ${AUDIT_COLUMNS}
       FROM metastore_record_audits
      WHERE namespace = $1
        AND record_key = $2
        AND id = $3`,
    [options.namespace, options.key, options.id]
  );

  if (rows.length === 0) {
    return null;
  }

  return toAuditView(rows[0]);
}

export async function getRecordAuditByVersion(
  client: PoolClient,
  options: { namespace: string; key: string; version: number }
): Promise<RecordAuditView | null> {
  const { rows } = await client.query(
    `SELECT ${AUDIT_COLUMNS}
       FROM metastore_record_audits
      WHERE namespace = $1
        AND record_key = $2
        AND version = $3
      ORDER BY id DESC
      LIMIT 1`,
    [options.namespace, options.key, options.version]
  );

  if (rows.length === 0) {
    return null;
  }

  return toAuditView(rows[0]);
}

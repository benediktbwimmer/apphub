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
    `SELECT id,
            namespace,
            record_key,
            action,
            actor,
            previous_version,
            version,
            metadata,
            previous_metadata,
            created_at,
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

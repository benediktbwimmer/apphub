import type { PoolClient } from 'pg';

export type OwnerCount = {
  owner: string;
  count: number;
};

export type NamespaceSummary = {
  name: string;
  totalRecords: number;
  deletedRecords: number;
  lastUpdatedAt: Date | null;
  ownerCounts: OwnerCount[];
};

export type NamespaceQuery = {
  limit: number;
  offset: number;
  prefix?: string;
  namespaces: '*' | string[];
};

export type NamespacePage = {
  total: number;
  namespaces: NamespaceSummary[];
};

type FilterFragment = {
  clause: string;
  params: unknown[];
};

function buildFilterClause(query: NamespaceQuery): FilterFragment {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (query.prefix && query.prefix.trim().length > 0) {
    const normalized = query.prefix.trim().toLowerCase();
    params.push(`${normalized}%`);
    clauses.push(`LOWER(namespace) LIKE $${params.length}`);
  }

  if (Array.isArray(query.namespaces)) {
    if (query.namespaces.length === 0) {
      // An empty namespace list should yield no results; caller handles this earlier.
      return { clause: '1 = 0', params: [] } satisfies FilterFragment;
    }
    params.push(query.namespaces.map((ns) => ns.toLowerCase()));
    clauses.push(`LOWER(namespace) = ANY($${params.length})`);
  }

  if (clauses.length === 0) {
    return { clause: 'TRUE', params: [] } satisfies FilterFragment;
  }

  return { clause: clauses.join(' AND '), params } satisfies FilterFragment;
}

type NamespaceRow = {
  name: string;
  total_records: string;
  deleted_records: string;
  last_updated_at: Date | null;
  owner_counts: Array<{ owner: string; count: number }> | null;
};

export async function listNamespaces(client: PoolClient, query: NamespaceQuery): Promise<NamespacePage> {
  if (query.limit <= 0) {
    throw new Error('Namespace query limit must be positive');
  }

  if (query.offset < 0) {
    throw new Error('Namespace query offset cannot be negative');
  }

  if (Array.isArray(query.namespaces) && query.namespaces.length === 0) {
    return { total: 0, namespaces: [] } satisfies NamespacePage;
  }

  const { clause, params } = buildFilterClause(query);

  const totalResult = await client.query<{ total: string }>(
    `SELECT COUNT(*)::int AS total
     FROM (
       SELECT namespace
       FROM metastore_records
       WHERE ${clause}
       GROUP BY namespace
     ) counted`,
    params
  );

  const total = totalResult.rows[0]?.total ? Number(totalResult.rows[0].total) : 0;

  if (total === 0) {
    return { total: 0, namespaces: [] } satisfies NamespacePage;
  }

  const pageResult = await client.query<NamespaceRow>(
    `SELECT
       stats.namespace AS name,
       stats.total_records,
       stats.deleted_records,
       stats.last_updated_at,
       owners.owner_counts
     FROM (
       SELECT
         namespace,
         COUNT(*)::bigint AS total_records,
         COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::bigint AS deleted_records,
         MAX(updated_at) AS last_updated_at
       FROM metastore_records
       WHERE ${clause}
       GROUP BY namespace
       ORDER BY namespace
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}
     ) stats
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(
                jsonb_build_object('owner', owner, 'count', owner_count)
                ORDER BY owner_count DESC, owner
              ) AS owner_counts
       FROM (
         SELECT owner, COUNT(*)::bigint AS owner_count
         FROM metastore_records
         WHERE owner IS NOT NULL
           AND namespace = stats.namespace
           AND deleted_at IS NULL
         GROUP BY owner
       ) owner_summary
     ) owners ON TRUE
     ORDER BY stats.namespace`,
    [...params, query.limit, query.offset]
  );

  const namespaces: NamespaceSummary[] = pageResult.rows.map((row) => {
    const ownerCounts: OwnerCount[] = Array.isArray(row.owner_counts)
      ? row.owner_counts
          .filter((entry): entry is { owner: string; count: number } =>
            typeof entry?.owner === 'string' && typeof entry?.count === 'number'
          )
          .map((entry) => ({ owner: entry.owner, count: Number(entry.count) }))
      : [];

    return {
      name: row.name,
      totalRecords: Number(row.total_records),
      deletedRecords: Number(row.deleted_records),
      lastUpdatedAt: row.last_updated_at,
      ownerCounts
    } satisfies NamespaceSummary;
  });

  return { total, namespaces } satisfies NamespacePage;
}

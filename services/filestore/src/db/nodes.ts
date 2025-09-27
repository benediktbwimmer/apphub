import type { PoolClient } from 'pg';
import { FilestoreError } from '../errors';
import { getNodeDepth, getNodeName } from '../utils/path';

export type NodeKind = 'file' | 'directory';
export type NodeState = 'active' | 'inconsistent' | 'missing' | 'deleted';
export type ConsistencyState = 'active' | 'inconsistent' | 'missing';

export type NodeRecord = {
  id: number;
  backendMountId: number;
  parentId: number | null;
  path: string;
  name: string;
  depth: number;
  kind: NodeKind;
  sizeBytes: number;
  checksum: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  state: NodeState;
  version: number;
  isSymlink: boolean;
  lastSeenAt: Date;
  lastModifiedAt: Date | null;
  consistencyState: ConsistencyState;
  consistencyCheckedAt: Date;
  lastReconciledAt: Date | null;
  lastDriftDetectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

function mapRow(row: any): NodeRecord {
  return {
    id: row.id,
    backendMountId: row.backend_mount_id,
    parentId: row.parent_id === null ? null : row.parent_id,
    path: row.path,
    name: row.name,
    depth: row.depth,
    kind: row.kind,
    sizeBytes: row.size_bytes ?? 0,
    checksum: row.checksum ?? null,
    contentHash: row.content_hash ?? null,
    metadata: row.metadata ?? {},
    state: row.state,
    version: row.version,
    isSymlink: row.is_symlink,
    lastSeenAt: row.last_seen_at,
    lastModifiedAt: row.last_modified_at ?? null,
    consistencyState: row.consistency_state,
    consistencyCheckedAt: row.consistency_checked_at,
    lastReconciledAt: row.last_reconciled_at ?? null,
    lastDriftDetectedAt: row.last_drift_detected_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null
  };
}

export async function getNodeByPath(
  client: PoolClient,
  backendMountId: number,
  path: string,
  options: { forUpdate?: boolean } = {}
): Promise<NodeRecord | null> {
  const query = `SELECT * FROM nodes WHERE backend_mount_id = $1 AND path = $2${options.forUpdate ? ' FOR UPDATE' : ''}`;
  const result = await client.query(query, [backendMountId, path]);
  if (result.rowCount === 0) {
    return null;
  }
  return mapRow(result.rows[0]);
}

export async function getNodeById(
  client: PoolClient,
  id: number,
  options: { forUpdate?: boolean } = {}
): Promise<NodeRecord | null> {
  const query = `SELECT * FROM nodes WHERE id = $1${options.forUpdate ? ' FOR UPDATE' : ''}`;
  const result = await client.query(query, [id]);
  if (result.rowCount === 0) {
    return null;
  }
  return mapRow(result.rows[0]);
}

export async function insertNode(
  client: PoolClient,
  input: {
    backendMountId: number;
    parentId: number | null;
    path: string;
    kind: NodeKind;
    checksum?: string | null;
    contentHash?: string | null;
    sizeBytes?: number | null;
    metadata?: Record<string, unknown> | null;
    isSymlink?: boolean;
    lastModifiedAt?: Date | null;
    state?: NodeState;
    consistencyState?: ConsistencyState;
    consistencyCheckedAt?: Date | null;
    lastReconciledAt?: Date | null;
    lastDriftDetectedAt?: Date | null;
  }
): Promise<NodeRecord> {
  const metadataJson = JSON.stringify(input.metadata ?? {});
  const now = new Date();
  const resolvedState = input.state ?? 'active';
  const explicitConsistency = input.consistencyState ?? null;
  const baseConsistency: ConsistencyState =
    resolvedState === 'deleted'
      ? 'missing'
      : resolvedState === 'missing'
        ? 'missing'
        : resolvedState === 'inconsistent'
          ? 'inconsistent'
          : 'active';
  const consistencyState = explicitConsistency ?? baseConsistency;
  const consistencyCheckedAt = input.consistencyCheckedAt ?? now;
  const lastReconciledAt = input.lastReconciledAt ?? (consistencyState === 'active' ? now : null);
  const lastDriftDetectedAt = input.lastDriftDetectedAt ?? null;

  const result = await client.query(
    `INSERT INTO nodes (
       backend_mount_id,
       parent_id,
       path,
       name,
       depth,
       kind,
       size_bytes,
       checksum,
       content_hash,
       metadata,
       state,
       is_symlink,
       last_modified_at,
       consistency_state,
       consistency_checked_at,
       last_reconciled_at,
       last_drift_detected_at
     ) VALUES (
       $1,
       $2,
       $3,
       $4,
       $5,
       $6,
       COALESCE($7, 0),
       $8,
       $9,
       $10::jsonb,
       $11,
       COALESCE($12, false),
       $13,
       $14,
       $15,
       $16,
       $17
     )
     RETURNING *
    `,
    [
      input.backendMountId,
      input.parentId,
      input.path,
      getNodeName(input.path),
      getNodeDepth(input.path),
      input.kind,
      input.sizeBytes ?? 0,
      input.checksum ?? null,
      input.contentHash ?? null,
      metadataJson,
      resolvedState,
      input.isSymlink ?? false,
      input.lastModifiedAt ?? null,
      consistencyState,
      consistencyCheckedAt,
      lastReconciledAt,
      lastDriftDetectedAt
    ]
  );

  if (result.rowCount === 0) {
    throw new FilestoreError('Failed to insert node', 'NODE_NOT_FOUND');
  }

  return mapRow(result.rows[0]);
}

export async function updateNodeState(
  client: PoolClient,
  nodeId: number,
  state: NodeState,
  overrides: {
    checksum?: string | null;
    contentHash?: string | null;
    sizeBytes?: number | null;
    metadata?: Record<string, unknown> | null;
    lastModifiedAt?: Date | null;
    consistencyState?: ConsistencyState;
    consistencyCheckedAt?: Date | null;
    lastReconciledAt?: Date | null;
    lastDriftDetectedAt?: Date | null;
  } = {}
): Promise<NodeRecord> {
  const metadataJson = overrides.metadata ? JSON.stringify(overrides.metadata) : undefined;
  const now = new Date();
  const baseConsistency: ConsistencyState =
    state === 'deleted'
      ? 'missing'
      : state === 'missing'
        ? 'missing'
        : state === 'inconsistent'
          ? 'inconsistent'
          : 'active';
  const resolvedConsistency = overrides.consistencyState ?? baseConsistency;
  const consistencyCheckedAt = overrides.consistencyCheckedAt ?? now;
  const lastReconciledAt =
    resolvedConsistency === 'active'
      ? overrides.lastReconciledAt ?? now
      : overrides.lastReconciledAt ?? null;

  const result = await client.query(
    `UPDATE nodes
        SET state = $2,
            checksum = $3,
            content_hash = $4,
            size_bytes = COALESCE($5, size_bytes),
            metadata = COALESCE($6::jsonb, metadata),
            last_modified_at = COALESCE($7, last_modified_at),
            last_seen_at = NOW(),
            consistency_state = $8,
            consistency_checked_at = $9,
            last_reconciled_at = $10,
            last_drift_detected_at = COALESCE($11, last_drift_detected_at)
      WHERE id = $1
      RETURNING *
    `,
    [
      nodeId,
      state,
      overrides.checksum ?? null,
      overrides.contentHash ?? null,
      overrides.sizeBytes ?? null,
      metadataJson ?? null,
      overrides.lastModifiedAt ?? null,
      resolvedConsistency,
      consistencyCheckedAt,
      lastReconciledAt,
      overrides.lastDriftDetectedAt ?? null
    ]
  );

  const row = result.rows[0];
  if (!row) {
    throw new FilestoreError('Node not found', 'NODE_NOT_FOUND', { nodeId });
  }

  return mapRow(row);
}

export async function ensureNoActiveChildren(client: PoolClient, nodeId: number): Promise<void> {
  const result = await client.query(
    `SELECT id
       FROM nodes
      WHERE parent_id = $1
        AND state <> 'deleted'
      LIMIT 1`,
    [nodeId]
  );

  if (result.rows.length > 0) {
    throw new FilestoreError('Directory contains active children', 'CHILDREN_EXIST', { nodeId });
  }
}

export async function updateNodeMetadata(
  client: PoolClient,
  nodeId: number,
  metadata: Record<string, unknown>
): Promise<NodeRecord> {
  const metadataJson = JSON.stringify(metadata ?? {});
  const result = await client.query(
    `UPDATE nodes
        SET metadata = $2::jsonb,
            updated_at = NOW(),
            last_seen_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [nodeId, metadataJson]
  );

  if (result.rowCount === 0) {
    throw new FilestoreError('Node not found', 'NODE_NOT_FOUND', { nodeId });
  }

  return mapRow(result.rows[0]);
}

export async function listNodeSubtreeByPath(
  client: PoolClient,
  backendMountId: number,
  path: string
): Promise<NodeRecord[]> {
  const likePattern = `${path}%`;
  const result = await client.query(
    `SELECT *
       FROM nodes
      WHERE backend_mount_id = $1
        AND (path = $2 OR path LIKE $3)
      ORDER BY depth ASC`,
    [backendMountId, path, `${path}/%`]
  );

  return result.rows.map(mapRow);
}

export async function updateNodeLocation(
  client: PoolClient,
  nodeId: number,
  updates: {
    path: string;
    depth: number;
    parentId: number | null;
    backendMountId?: number | null;
  }
): Promise<NodeRecord> {
  const result = await client.query(
    `UPDATE nodes
        SET path = $2,
            depth = $3,
            parent_id = $4,
            backend_mount_id = COALESCE($5, backend_mount_id),
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [nodeId, updates.path, updates.depth, updates.parentId, updates.backendMountId ?? null]
  );

  if (result.rowCount === 0) {
    throw new FilestoreError('Node not found', 'NODE_NOT_FOUND', { nodeId });
  }

  return mapRow(result.rows[0]);
}

function escapeLikePattern(input: string): string {
  return input.replace(/([%_\\])/g, '\\$1');
}

type SqlValue = string | number | boolean | NodeState[] | NodeKind[] | string[];

export type NodeMetadataFilter = {
  key: string;
  value: unknown;
};

export type NodeNumericRangeFilter = {
  min?: number;
  max?: number;
};

export type NodeDateRangeFilter = {
  after?: string;
  before?: string;
};

export type NodeRollupFilter = {
  states?: string[];
  minChildCount?: number;
  maxChildCount?: number;
  minFileCount?: number;
  maxFileCount?: number;
  minDirectoryCount?: number;
  maxDirectoryCount?: number;
  minSizeBytes?: number;
  maxSizeBytes?: number;
  lastCalculatedAfter?: string;
  lastCalculatedBefore?: string;
};

export type NodeAdvancedFilters = {
  query?: string;
  metadata?: NodeMetadataFilter[];
  size?: NodeNumericRangeFilter;
  lastSeenAt?: NodeDateRangeFilter;
  rollup?: NodeRollupFilter;
};

function applyAdvancedFilters({
  filters,
  alias,
  rollupAlias,
  joins,
  conditions,
  values
}: {
  filters?: NodeAdvancedFilters;
  alias: string;
  rollupAlias: string;
  joins: string[];
  conditions: string[];
  values: SqlValue[];
}): void {
  if (!filters) {
    return;
  }

  const metadataFilters = filters.metadata as NodeMetadataFilter[] | undefined;
  if (metadataFilters && metadataFilters.length > 0) {
    for (const entry of metadataFilters) {
      const param = values.length + 1;
      values.push(JSON.stringify({ [entry.key]: entry.value }));
      conditions.push(`${alias}.metadata @> $${param}::jsonb`);
    }
  }

  const sizeFilter = filters.size as NodeNumericRangeFilter | undefined;
  if (sizeFilter) {
    if (typeof sizeFilter.min === 'number') {
      const param = values.length + 1;
      values.push(sizeFilter.min);
      conditions.push(`${alias}.size_bytes >= $${param}`);
    }
    if (typeof sizeFilter.max === 'number') {
      const param = values.length + 1;
      values.push(sizeFilter.max);
      conditions.push(`${alias}.size_bytes <= $${param}`);
    }
  }

  const lastSeenFilter = filters.lastSeenAt as NodeDateRangeFilter | undefined;
  if (lastSeenFilter) {
    if (typeof lastSeenFilter.after === 'string') {
      const param = values.length + 1;
      values.push(lastSeenFilter.after);
      conditions.push(`${alias}.last_seen_at >= $${param}`);
    }
    if (typeof lastSeenFilter.before === 'string') {
      const param = values.length + 1;
      values.push(lastSeenFilter.before);
      conditions.push(`${alias}.last_seen_at <= $${param}`);
    }
  }

  const rollup = filters.rollup as NodeRollupFilter | undefined;
  if (rollup) {
    const hasRollupJoin = joins.some((clause) => clause.includes(` ${rollupAlias} `));
    if (!hasRollupJoin) {
      joins.push(`LEFT JOIN rollups ${rollupAlias} ON ${rollupAlias}.node_id = ${alias}.id`);
    }

    if (rollup.states && rollup.states.length > 0) {
      const param = values.length + 1;
      values.push(rollup.states);
      conditions.push(`${rollupAlias}.state = ANY($${param}::text[])`);
    }

    const handleNumericFilter = (
      min: number | undefined,
      max: number | undefined,
      column: string,
      coalesceZero = true
    ) => {
      const wrappedColumn = coalesceZero ? `COALESCE(${column}, 0)` : column;
      if (typeof min === 'number') {
        const param = values.length + 1;
        values.push(min);
        conditions.push(`${wrappedColumn} >= $${param}`);
      }
      if (typeof max === 'number') {
        const param = values.length + 1;
        values.push(max);
        conditions.push(`${wrappedColumn} <= $${param}`);
      }
    };

    handleNumericFilter(rollup.minChildCount, rollup.maxChildCount, `${rollupAlias}.child_count`);
    handleNumericFilter(rollup.minFileCount, rollup.maxFileCount, `${rollupAlias}.file_count`);
    handleNumericFilter(
      rollup.minDirectoryCount,
      rollup.maxDirectoryCount,
      `${rollupAlias}.directory_count`
    );
    handleNumericFilter(rollup.minSizeBytes, rollup.maxSizeBytes, `${rollupAlias}.size_bytes`);

    if (typeof rollup.lastCalculatedAfter === 'string') {
      const param = values.length + 1;
      values.push(rollup.lastCalculatedAfter);
      conditions.push(`${rollupAlias}.last_calculated_at IS NOT NULL`);
      conditions.push(`${rollupAlias}.last_calculated_at >= $${param}`);
    }

    if (typeof rollup.lastCalculatedBefore === 'string') {
      const param = values.length + 1;
      values.push(rollup.lastCalculatedBefore);
      if (typeof rollup.lastCalculatedAfter === 'string') {
        conditions.push(`${rollupAlias}.last_calculated_at <= $${param}`);
      } else {
        conditions.push(`(${rollupAlias}.last_calculated_at IS NULL OR ${rollupAlias}.last_calculated_at <= $${param})`);
      }
    }
  }
}

type ListNodesOptions = {
  backendMountId: number;
  limit: number;
  offset: number;
  pathPrefix?: string;
  maxDepth?: number;
  states?: NodeState[];
  kinds?: NodeKind[];
  searchTerm?: string;
  driftOnly?: boolean;
  filters?: NodeAdvancedFilters;
};

type ListNodesResult = {
  nodes: NodeRecord[];
  total: number;
};

export async function listNodes(client: PoolClient, options: ListNodesOptions): Promise<ListNodesResult> {
  const conditions: string[] = [];
  const joins: string[] = [];
  const values: SqlValue[] = [];

  conditions.push(`nodes.backend_mount_id = $${values.length + 1}`);
  values.push(options.backendMountId);

  if (options.pathPrefix) {
    const normalized = options.pathPrefix;
    const escapedPrefix = escapeLikePattern(normalized);
    const equalsParam = values.length + 1;
    values.push(normalized);
    const likeParam = values.length + 1;
    values.push(`${escapedPrefix}/%`);
    conditions.push(`(nodes.path = $${equalsParam} OR nodes.path LIKE $${likeParam} ESCAPE '\\')`);
  }

  if (typeof options.maxDepth === 'number') {
    const depthParam = values.length + 1;
    values.push(options.maxDepth);
    conditions.push(`nodes.depth <= $${depthParam}`);
  }

  if (options.states && options.states.length > 0) {
    const stateParam = values.length + 1;
    values.push(options.states);
    conditions.push(`nodes.state = ANY($${stateParam}::text[])`);
  }

  if (options.kinds && options.kinds.length > 0) {
    const kindParam = values.length + 1;
    values.push(options.kinds);
    conditions.push(`nodes.kind = ANY($${kindParam}::text[])`);
  }

  if (options.driftOnly) {
    const consistencyParam = values.length + 1;
    values.push('active');
    conditions.push(
      `(nodes.consistency_state <> $${consistencyParam} OR nodes.last_drift_detected_at IS NOT NULL)`
    );
  }

  const searchTerm = options.searchTerm ?? (options.filters ? options.filters.query : undefined);
  if (searchTerm) {
    const escapedSearch = `%${escapeLikePattern(searchTerm)}%`;
    const searchParam = values.length + 1;
    values.push(escapedSearch);
    conditions.push(
      `(nodes.path ILIKE $${searchParam} ESCAPE '\\' OR nodes.name ILIKE $${searchParam} ESCAPE '\\')`
    );
  }

  applyAdvancedFilters({
    filters: options.filters,
    alias: 'nodes',
    rollupAlias: 'rollup_stats',
    joins,
    conditions,
    values
  });

  const limitParam = values.length + 1;
  values.push(options.limit);
  const offsetParam = values.length + 1;
  values.push(options.offset);

  const joinClause = joins.length > 0 ? ` ${joins.join(' ')}` : '';
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const query = `
    SELECT nodes.*, COUNT(*) OVER() AS total_count
      FROM nodes${joinClause}
      ${whereClause}
     ORDER BY nodes.depth ASC, nodes.path ASC
     LIMIT $${limitParam}
    OFFSET $${offsetParam}
  `;

  const result = await client.query(query, values);
  const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;
  return {
    nodes: result.rows.map(mapRow),
    total
  };
}

type ListChildrenOptions = {
  limit: number;
  offset: number;
  states?: NodeState[];
  kinds?: NodeKind[];
  searchTerm?: string;
  driftOnly?: boolean;
  filters?: NodeAdvancedFilters;
};

export async function listNodeChildren(
  client: PoolClient,
  parentId: number,
  options: ListChildrenOptions
): Promise<ListNodesResult> {
  const conditions: string[] = [`nodes.parent_id = $1`];
  const joins: string[] = [];
  const values: SqlValue[] = [parentId];

  if (options.states && options.states.length > 0) {
    const stateParam = values.length + 1;
    values.push(options.states);
    conditions.push(`nodes.state = ANY($${stateParam}::text[])`);
  }

  if (options.kinds && options.kinds.length > 0) {
    const kindParam = values.length + 1;
    values.push(options.kinds);
    conditions.push(`nodes.kind = ANY($${kindParam}::text[])`);
  }

  if (options.driftOnly) {
    const consistencyParam = values.length + 1;
    values.push('active');
    conditions.push(
      `(nodes.consistency_state <> $${consistencyParam} OR nodes.last_drift_detected_at IS NOT NULL)`
    );
  }

  const searchTerm = options.searchTerm ?? (options.filters ? options.filters.query : undefined);
  if (searchTerm) {
    const escapedSearch = `%${escapeLikePattern(searchTerm)}%`;
    const searchParam = values.length + 1;
    values.push(escapedSearch);
    conditions.push(
      `(nodes.path ILIKE $${searchParam} ESCAPE '\\' OR nodes.name ILIKE $${searchParam} ESCAPE '\\')`
    );
  }

  applyAdvancedFilters({
    filters: options.filters,
    alias: 'nodes',
    rollupAlias: 'rollup_stats',
    joins,
    conditions,
    values
  });

  const limitParam = values.length + 1;
  values.push(options.limit);
  const offsetParam = values.length + 1;
  values.push(options.offset);

  const joinClause = joins.length > 0 ? ` ${joins.join(' ')}` : '';
  const query = `
    SELECT nodes.*, COUNT(*) OVER() AS total_count
      FROM nodes${joinClause}
     WHERE ${conditions.join(' AND ')}
     ORDER BY nodes.kind ASC, nodes.name ASC
     LIMIT $${limitParam}
    OFFSET $${offsetParam}
  `;

  const result = await client.query(query, values);
  const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;
  return {
    nodes: result.rows.map(mapRow),
    total
  };
}

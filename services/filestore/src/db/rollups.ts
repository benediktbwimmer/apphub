import type { PoolClient } from 'pg';
import { getNodeById, type NodeRecord } from './nodes';

export type RollupState = 'up_to_date' | 'pending' | 'stale' | 'invalid';

export type RollupRecord = {
  nodeId: number;
  sizeBytes: number;
  fileCount: number;
  directoryCount: number;
  childCount: number;
  pendingBytesDelta: number;
  pendingItemsDelta: number;
  state: RollupState;
  lastCalculatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RollupDelta = {
  sizeBytesDelta?: number;
  fileCountDelta?: number;
  directoryCountDelta?: number;
  childCountDelta?: number;
  pendingBytesDelta?: number;
  pendingItemsDelta?: number;
  markPending?: boolean;
};

function mapRollupRow(row: any): RollupRecord {
  return {
    nodeId: row.node_id,
    sizeBytes: Number(row.size_bytes ?? 0),
    fileCount: Number(row.file_count ?? 0),
    directoryCount: Number(row.directory_count ?? 0),
    childCount: Number(row.child_count ?? 0),
    pendingBytesDelta: Number(row.pending_bytes_delta ?? 0),
    pendingItemsDelta: Number(row.pending_items_delta ?? 0),
    state: row.state as RollupState,
    lastCalculatedAt: row.last_calculated_at ? new Date(row.last_calculated_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

export async function ensureRollup(client: PoolClient, nodeId: number): Promise<RollupRecord> {
  const result = await client.query(
    `INSERT INTO rollups (node_id)
       VALUES ($1)
       ON CONFLICT (node_id) DO UPDATE SET node_id = EXCLUDED.node_id
       RETURNING *`,
    [nodeId]
  );

  return mapRollupRow(result.rows[0]);
}

export async function getRollup(client: PoolClient, nodeId: number): Promise<RollupRecord | null> {
  const result = await client.query(`SELECT * FROM rollups WHERE node_id = $1`, [nodeId]);
  if (result.rowCount === 0) {
    return null;
  }
  return mapRollupRow(result.rows[0]);
}

export async function applyRollupDelta(
  client: PoolClient,
  nodeId: number,
  delta: RollupDelta
): Promise<RollupRecord> {
  const sizeDelta = delta.sizeBytesDelta ?? 0;
  const fileDelta = delta.fileCountDelta ?? 0;
  const dirDelta = delta.directoryCountDelta ?? 0;
  const childDelta = delta.childCountDelta ?? 0;
  const pendingBytesDelta = delta.pendingBytesDelta ?? 0;
  const pendingItemsDelta = delta.pendingItemsDelta ?? 0;
  const markPending = delta.markPending === true;

  const result = await client.query(
    `INSERT INTO rollups (
       node_id,
       size_bytes,
       file_count,
       directory_count,
       child_count,
       pending_bytes_delta,
       pending_items_delta,
       state,
       last_calculated_at
     ) VALUES ($1, GREATEST($2::bigint, 0), GREATEST($3::bigint, 0), GREATEST($4::bigint, 0), GREATEST($5::bigint, 0), $6::bigint, $7::bigint, $8, NOW())
     ON CONFLICT (node_id) DO UPDATE SET
       size_bytes = GREATEST(rollups.size_bytes + $2::bigint, 0),
       file_count = GREATEST(rollups.file_count + $3::bigint, 0),
       directory_count = GREATEST(rollups.directory_count + $4::bigint, 0),
       child_count = GREATEST(rollups.child_count + $5::bigint, 0),
       pending_bytes_delta = CASE
         WHEN $9 THEN rollups.pending_bytes_delta + $6::bigint
         ELSE 0
       END,
       pending_items_delta = CASE
         WHEN $9 THEN rollups.pending_items_delta + $7::bigint
         ELSE 0
       END,
       state = CASE
         WHEN $9 THEN 'pending'
         ELSE 'up_to_date'
       END,
       last_calculated_at = CASE
         WHEN $9 THEN rollups.last_calculated_at
         ELSE NOW()
       END
     RETURNING *`,
    [
      nodeId,
      sizeDelta,
      fileDelta,
      dirDelta,
      childDelta,
      pendingBytesDelta,
      pendingItemsDelta,
      markPending ? 'pending' : 'up_to_date',
      markPending
    ]
  );

  return mapRollupRow(result.rows[0]);
}

export async function setRollupState(
  client: PoolClient,
  nodeId: number,
  state: RollupState
): Promise<RollupRecord> {
  const result = await client.query(
    `INSERT INTO rollups (node_id, state, size_bytes, file_count, directory_count, child_count, pending_bytes_delta, pending_items_delta, last_calculated_at)
       VALUES ($1, $2, 0, 0, 0, 0, 0, 0, NOW())
       ON CONFLICT (node_id) DO UPDATE SET
         state = EXCLUDED.state,
         size_bytes = 0,
         file_count = 0,
         directory_count = 0,
         child_count = 0,
         pending_bytes_delta = 0,
         pending_items_delta = 0,
         last_calculated_at = NOW()
       RETURNING *`,
    [nodeId, state]
  );

  return mapRollupRow(result.rows[0]);
}

export type RecalculateRollupResult = {
  record: RollupRecord;
  node: NodeRecord;
  parentId: number | null;
};

export async function recalculateRollup(
  client: PoolClient,
  nodeId: number
): Promise<RecalculateRollupResult | null> {
  const node = await getNodeById(client, nodeId, { forUpdate: true });
  if (!node) {
    return null;
  }

  const parentId = node.parentId;

  if (node.state === 'deleted') {
    const invalid = await setRollupState(client, nodeId, 'invalid');
    return { record: invalid, node, parentId };
  }

  const result = await client.query(
    `WITH child_nodes AS (
       SELECT id, kind, size_bytes, state
         FROM nodes
        WHERE parent_id = $1
          AND state <> 'deleted'
     ),
     aggregated AS (
       SELECT
         COALESCE(SUM(CASE
           WHEN child.kind = 'file' THEN child.size_bytes
           ELSE COALESCE(rollup.size_bytes, 0)
         END), 0) AS total_size_bytes,
         COALESCE(SUM(CASE
           WHEN child.kind = 'file' THEN 1
           ELSE COALESCE(rollup.file_count, 0)
         END), 0) AS total_file_count,
         COALESCE(SUM(CASE
           WHEN child.kind = 'directory' THEN 1 + COALESCE(rollup.directory_count, 0)
           ELSE 0
         END), 0) AS total_directory_count,
         COUNT(child.id) AS total_child_count
       FROM child_nodes child
       LEFT JOIN rollups rollup ON rollup.node_id = child.id
     )
     INSERT INTO rollups (
       node_id,
       size_bytes,
       file_count,
       directory_count,
       child_count,
       pending_bytes_delta,
       pending_items_delta,
       state,
       last_calculated_at
     )
     SELECT
       $1,
       COALESCE(aggregated.total_size_bytes, 0),
       COALESCE(aggregated.total_file_count, 0),
       COALESCE(aggregated.total_directory_count, 0),
       COALESCE(aggregated.total_child_count, 0),
       0,
       0,
       'up_to_date',
       NOW()
     FROM aggregated
     ON CONFLICT (node_id) DO UPDATE SET
       size_bytes = COALESCE(EXCLUDED.size_bytes, 0),
       file_count = COALESCE(EXCLUDED.file_count, 0),
       directory_count = COALESCE(EXCLUDED.directory_count, 0),
       child_count = COALESCE(EXCLUDED.child_count, 0),
       pending_bytes_delta = 0,
       pending_items_delta = 0,
       state = 'up_to_date',
       last_calculated_at = NOW()
     RETURNING *`,
    [nodeId]
  );

  const record = mapRollupRow(result.rows[0]);
  return {
    record,
    node,
    parentId
  };
}

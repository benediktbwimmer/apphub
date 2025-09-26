import type { PoolClient } from 'pg';

export type FilestoreNodeStateRow = {
  node_id: number;
  backend_mount_id: number | null;
  path: string | null;
  state: string | null;
  consistency_state: string | null;
  size_bytes: number | null;
  last_observed_at: Date;
  last_journal_id: number | null;
};

export type FilestoreNodeState = {
  nodeId: number;
  backendMountId: number | null;
  path: string | null;
  state: string | null;
  consistencyState: string | null;
  sizeBytes: number | null;
  lastObservedAt: Date;
  lastJournalId: number | null;
};

function mapRow(row: FilestoreNodeStateRow): FilestoreNodeState {
  return {
    nodeId: row.node_id,
    backendMountId: row.backend_mount_id,
    path: row.path,
    state: row.state,
    consistencyState: row.consistency_state,
    sizeBytes: row.size_bytes,
    lastObservedAt: row.last_observed_at,
    lastJournalId: row.last_journal_id
  } satisfies FilestoreNodeState;
}

export async function getFilestoreNodeState(client: PoolClient, nodeId: number): Promise<FilestoreNodeState | null> {
  const result = await client.query<FilestoreNodeStateRow>(
    `SELECT node_id,
            backend_mount_id,
            path,
            state,
            consistency_state,
            size_bytes,
            last_observed_at,
            last_journal_id
       FROM filestore_node_state
      WHERE node_id = $1`,
    [nodeId]
  );
  if (result.rowCount === 0) {
    return null;
  }
  return mapRow(result.rows[0]);
}

export async function upsertFilestoreNodeState(
  client: PoolClient,
  input: {
    nodeId: number;
    backendMountId: number | null;
    path: string | null;
    state: string | null;
    consistencyState: string | null;
    sizeBytes: number | null;
    lastObservedAt: Date;
    lastJournalId: number | null;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO filestore_node_state (
       node_id,
       backend_mount_id,
       path,
       state,
       consistency_state,
       size_bytes,
       last_observed_at,
       last_journal_id,
       updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (node_id) DO UPDATE SET
       backend_mount_id = EXCLUDED.backend_mount_id,
       path = EXCLUDED.path,
       state = EXCLUDED.state,
       consistency_state = EXCLUDED.consistency_state,
       size_bytes = EXCLUDED.size_bytes,
       last_observed_at = EXCLUDED.last_observed_at,
       last_journal_id = EXCLUDED.last_journal_id,
       updated_at = NOW();`,
    [
      input.nodeId,
      input.backendMountId,
      input.path,
      input.state,
      input.consistencyState,
      input.sizeBytes,
      input.lastObservedAt,
      input.lastJournalId
    ]
  );
}

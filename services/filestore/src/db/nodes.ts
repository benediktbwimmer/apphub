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

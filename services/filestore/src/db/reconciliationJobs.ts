import type { PoolClient } from 'pg';

export type ReconciliationJobState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export type ReconciliationJobRecord = {
  id: number;
  jobKey: string;
  backendMountId: number;
  nodeId: number | null;
  path: string;
  reason: 'drift' | 'audit' | 'manual';
  status: ReconciliationJobState;
  detectChildren: boolean;
  requestedHash: boolean;
  attempt: number;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  enqueuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  updatedAt: Date;
};

type InsertJobInput = {
  jobKey: string;
  backendMountId: number;
  nodeId: number | null;
  path: string;
  reason: 'drift' | 'audit' | 'manual';
  detectChildren: boolean;
  requestedHash: boolean;
  attempt: number;
};

type UpdateJobInput = {
  status: ReconciliationJobState;
  attempt?: number;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  durationMs?: number | null;
};

export type ReconciliationJobFilter = {
  backendMountId?: number;
  path?: string;
  status?: ReconciliationJobState[];
  limit?: number;
  offset?: number;
};

function mapRow(row: any): ReconciliationJobRecord {
  return {
    id: row.id,
    jobKey: row.job_key,
    backendMountId: row.backend_mount_id,
    nodeId: row.node_id ?? null,
    path: row.path,
    reason: row.reason,
    status: row.status,
    detectChildren: Boolean(row.detect_children),
    requestedHash: Boolean(row.requested_hash),
    attempt: row.attempt ?? 1,
    result:
      row.result === null || row.result === undefined
        ? null
        : typeof row.result === 'string'
          ? (JSON.parse(row.result) as Record<string, unknown>)
          : (row.result as Record<string, unknown>),
    error:
      row.error === null || row.error === undefined
        ? null
        : typeof row.error === 'string'
          ? (JSON.parse(row.error) as Record<string, unknown>)
          : (row.error as Record<string, unknown>),
    enqueuedAt: row.enqueued_at,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    durationMs: row.duration_ms ?? null,
    updatedAt: row.updated_at
  } satisfies ReconciliationJobRecord;
}

export async function insertReconciliationJob(
  client: PoolClient,
  input: InsertJobInput
): Promise<ReconciliationJobRecord> {
  const result = await client.query(
    `INSERT INTO reconciliation_jobs (
       job_key,
       backend_mount_id,
       node_id,
       path,
       reason,
       status,
       detect_children,
       requested_hash,
       attempt
     ) VALUES (
       $1,
       $2,
       $3,
       $4,
       $5,
       'queued',
       $6,
       $7,
       $8
     )
     RETURNING *
    `,
    [
      input.jobKey,
      input.backendMountId,
      input.nodeId,
      input.path,
      input.reason,
      input.detectChildren,
      input.requestedHash,
      input.attempt
    ]
  );

  return mapRow(result.rows[0]);
}

export async function updateReconciliationJob(
  client: PoolClient,
  id: number,
  input: UpdateJobInput
): Promise<ReconciliationJobRecord | null> {
  const sets: string[] = ['status = $1'];
  const params: unknown[] = [input.status];
  let paramIndex = 2;

  if (input.attempt !== undefined) {
    sets.push(`attempt = $${paramIndex}`);
    params.push(input.attempt);
    paramIndex += 1;
  }
  if (input.result !== undefined) {
    sets.push(`result = $${paramIndex}::jsonb`);
    params.push(input.result === null ? null : JSON.stringify(input.result));
    paramIndex += 1;
  }
  if (input.error !== undefined) {
    sets.push(`error = $${paramIndex}::jsonb`);
    params.push(input.error === null ? null : JSON.stringify(input.error));
    paramIndex += 1;
  }
  if (input.startedAt !== undefined) {
    sets.push(`started_at = $${paramIndex}`);
    params.push(input.startedAt ?? null);
    paramIndex += 1;
  }
  if (input.completedAt !== undefined) {
    sets.push(`completed_at = $${paramIndex}`);
    params.push(input.completedAt ?? null);
    paramIndex += 1;
  }
  if (input.durationMs !== undefined) {
    sets.push(`duration_ms = $${paramIndex}`);
    params.push(input.durationMs ?? null);
    paramIndex += 1;
  }

  params.push(id);

  const result = await client.query(
    `UPDATE reconciliation_jobs
        SET ${sets.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `,
    params
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapRow(result.rows[0]);
}

export async function getReconciliationJobById(
  client: PoolClient,
  id: number
): Promise<ReconciliationJobRecord | null> {
  const result = await client.query(`SELECT * FROM reconciliation_jobs WHERE id = $1`, [id]);
  if (result.rowCount === 0) {
    return null;
  }
  return mapRow(result.rows[0]);
}

export type ListReconciliationJobsResult = {
  jobs: ReconciliationJobRecord[];
  total: number;
};

export async function listReconciliationJobs(
  client: PoolClient,
  filters: ReconciliationJobFilter
): Promise<ListReconciliationJobsResult> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let index = 1;

  if (typeof filters.backendMountId === 'number') {
    conditions.push(`backend_mount_id = $${index}`);
    params.push(filters.backendMountId);
    index += 1;
  }
  if (filters.path && filters.path.trim().length > 0) {
    conditions.push(`path ILIKE $${index}`);
    params.push(`${filters.path.trim()}%`);
    index += 1;
  }
  if (filters.status && filters.status.length > 0) {
    conditions.push(`status = ANY($${index}::text[])`);
    params.push(filters.status);
    index += 1;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit && filters.limit > 0 ? Math.min(filters.limit, 200) : 50;
  const offset = filters.offset && filters.offset > 0 ? filters.offset : 0;

  const query = `
    WITH filtered AS (
      SELECT *, COUNT(*) OVER() AS total_count
        FROM reconciliation_jobs
        ${whereClause}
        ORDER BY enqueued_at DESC
        LIMIT $${index}
        OFFSET $${index + 1}
    )
    SELECT * FROM filtered
  `;

  params.push(limit, offset);

  const result = await client.query(query, params);
  const jobs = result.rows.map(mapRow);
  const total = result.rows[0]?.total_count ?? 0;
  return { jobs, total };
}

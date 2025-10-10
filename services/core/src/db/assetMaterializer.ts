import type { PoolClient } from 'pg';
import { withConnection, withTransaction } from './client';
import type { JsonValue } from './types';

export type WorkflowAutoRunClaim = {
  workflowDefinitionId: string;
  workflowRunId: string | null;
  reason: string;
  assetId: string | null;
  partitionKey: string | null;
  requestedAt: string;
  context: JsonValue | null;
  claimOwner: string;
  claimedAt: string;
};

const DEFAULT_STALE_CLAIM_MS = 5 * 60 * 1000;

function normalizeModuleIds(moduleIds?: string[] | null): string[] | null {
  if (!Array.isArray(moduleIds)) {
    return null;
  }
  const normalized = moduleIds
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter((id) => id.length > 0);
  if (normalized.length === 0) {
    return null;
  }
  return Array.from(new Set(normalized));
}

function toIso(date: Date): string {
  return date.toISOString();
}

async function removeCompletedRunClaims(client: PoolClient): Promise<void> {
  await client.query(`
    DELETE FROM asset_materializer_inflight_runs air
    WHERE air.workflow_run_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM workflow_runs wr
        WHERE wr.id = air.workflow_run_id
          AND wr.status IN ('pending', 'running')
      );
  `);
}

export async function cleanupStaleWorkflowRunClaims(options: { staleClaimMs?: number } = {}): Promise<void> {
  const staleClaimMs = Math.max(options.staleClaimMs ?? DEFAULT_STALE_CLAIM_MS, 60_000);
  const cutoffIso = toIso(new Date(Date.now() - staleClaimMs));

  await withTransaction(async (client) => {
    await client.query(
      `DELETE FROM asset_materializer_inflight_runs
         WHERE workflow_run_id IS NULL
           AND claimed_at <= $1` as string,
      [cutoffIso]
    );
    await removeCompletedRunClaims(client);
  });
}

export async function claimWorkflowAutoRun(
  workflowDefinitionId: string,
  ownerId: string,
  payload: {
    reason: string;
    assetId: string | null;
    partitionKey: string | null;
    context?: JsonValue | null;
  }
): Promise<boolean> {
  const claimedAtIso = toIso(new Date());
  const result = await withConnection(async (client) =>
    client.query(
      `INSERT INTO asset_materializer_inflight_runs (
         workflow_definition_id,
         workflow_run_id,
         reason,
         asset_id,
         partition_key,
         requested_at,
         context,
         claim_owner,
         claimed_at
       )
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $5)
       ON CONFLICT DO NOTHING` as string,
      [
        workflowDefinitionId,
        payload.reason,
        payload.assetId ?? null,
        payload.partitionKey ?? null,
        claimedAtIso,
        payload.context ?? null,
        ownerId
      ]
    )
  );
  return (result.rowCount ?? 0) > 0;
}

export async function attachWorkflowRunToClaim(
  workflowDefinitionId: string,
  ownerId: string,
  workflowRunId: string
): Promise<boolean> {
  const result = await withConnection(async (client) =>
    client.query(
      `UPDATE asset_materializer_inflight_runs
         SET workflow_run_id = $3,
             requested_at = NOW()
       WHERE workflow_definition_id = $1
         AND claim_owner = $2
         AND workflow_run_id IS NULL` as string,
      [workflowDefinitionId, ownerId, workflowRunId]
    )
  );
  return (result.rowCount ?? 0) === 1;
}

export async function releaseWorkflowAutoRun(
  workflowDefinitionId: string,
  options: { workflowRunId?: string | null; ownerId?: string | null } = {}
): Promise<void> {
  const { workflowRunId, ownerId } = options;
  await withConnection(async (client) => {
    if (workflowRunId) {
      await client.query(
        `DELETE FROM asset_materializer_inflight_runs
           WHERE workflow_definition_id = $1
             AND workflow_run_id = $2` as string,
        [workflowDefinitionId, workflowRunId]
      );
      return;
    }

    if (ownerId) {
      await client.query(
        `DELETE FROM asset_materializer_inflight_runs
           WHERE workflow_definition_id = $1
             AND claim_owner = $2
             AND workflow_run_id IS NULL` as string,
        [workflowDefinitionId, ownerId]
      );
      return;
    }

    await client.query(
      `DELETE FROM asset_materializer_inflight_runs
         WHERE workflow_definition_id = $1` as string,
      [workflowDefinitionId]
    );
  });
}

export async function getWorkflowAutoRunClaim(
  workflowDefinitionId: string,
  options: { moduleIds?: string[] | null } = {}
): Promise<WorkflowAutoRunClaim | null> {
  const moduleIds = normalizeModuleIds(options.moduleIds ?? null);
  const params: unknown[] = [workflowDefinitionId];
  let moduleParamIndex: number | null = null;
  if (moduleIds && moduleIds.length > 0) {
    moduleParamIndex = params.length + 1;
    params.push(moduleIds);
  }

  const moduleFilter = moduleParamIndex
    ? `AND (
         EXISTS (
           SELECT 1
             FROM module_resource_contexts def_ctx
            WHERE def_ctx.resource_type = 'workflow-definition'
              AND def_ctx.resource_id = air.workflow_definition_id
              AND def_ctx.module_id = ANY($${moduleParamIndex}::text[])
         )
         OR (
           air.workflow_run_id IS NOT NULL
           AND EXISTS (
             SELECT 1
               FROM module_resource_contexts run_ctx
              WHERE run_ctx.resource_type = 'workflow-run'
                AND run_ctx.resource_id = air.workflow_run_id
                AND run_ctx.module_id = ANY($${moduleParamIndex}::text[])
           )
         )
       )`
    : '';

  const { rows } = await withConnection((client) =>
    client.query<{
      workflow_definition_id: string;
      workflow_run_id: string | null;
      reason: string;
      asset_id: string | null;
      partition_key: string | null;
      requested_at: string;
      context: JsonValue | null;
      claim_owner: string;
      claimed_at: string;
    }>(
      `SELECT workflow_definition_id,
              workflow_run_id,
              reason,
              asset_id,
              partition_key,
              requested_at,
              context,
              claim_owner,
              claimed_at
         FROM asset_materializer_inflight_runs air
        WHERE air.workflow_definition_id = $1
          ${moduleFilter}
        ORDER BY air.claimed_at DESC
        LIMIT 1`,
      params
    )
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    workflowDefinitionId: row.workflow_definition_id,
    workflowRunId: row.workflow_run_id,
    reason: row.reason,
    assetId: row.asset_id,
    partitionKey: row.partition_key,
    requestedAt: row.requested_at,
    context: row.context ?? null,
    claimOwner: row.claim_owner,
    claimedAt: row.claimed_at
  } satisfies WorkflowAutoRunClaim;
}

export async function getFailureState(
  workflowDefinitionId: string,
  options: { moduleIds?: string[] | null } = {}
): Promise<{ failures: number; nextEligibleAt: string | null } | null> {
  const moduleIds = normalizeModuleIds(options.moduleIds ?? null);
  const params: unknown[] = [workflowDefinitionId];
  let moduleParamIndex: number | null = null;
  if (moduleIds && moduleIds.length > 0) {
    moduleParamIndex = params.length + 1;
    params.push(moduleIds);
  }

  const moduleFilter = moduleParamIndex
    ? `AND EXISTS (
         SELECT 1
           FROM module_resource_contexts def_ctx
          WHERE def_ctx.resource_type = 'workflow-definition'
            AND def_ctx.resource_id = afs.workflow_definition_id
            AND def_ctx.module_id = ANY($${moduleParamIndex}::text[])
       )`
    : '';

  const { rows } = await withConnection((client) =>
    client.query<{ failures: number; next_eligible_at: string | null }>(
      `SELECT failures, next_eligible_at
         FROM asset_materializer_failure_state afs
        WHERE afs.workflow_definition_id = $1
          ${moduleFilter}`,
      params
    )
  );

  if (rows.length === 0) {
    return null;
  }

  return {
    failures: rows[0].failures,
    nextEligibleAt: rows[0].next_eligible_at
  };
}

export async function upsertFailureState(
  workflowDefinitionId: string,
  failures: number,
  nextEligibleAt: Date | null
): Promise<void> {
  await withConnection((client) =>
    client.query(
      `INSERT INTO asset_materializer_failure_state (
         workflow_definition_id,
         failures,
         next_eligible_at,
         updated_at
       )
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (workflow_definition_id)
       DO UPDATE SET failures = EXCLUDED.failures,
                     next_eligible_at = EXCLUDED.next_eligible_at,
                     updated_at = NOW();`,
      [workflowDefinitionId, failures, nextEligibleAt ? toIso(nextEligibleAt) : null]
    )
  );
}

export async function clearFailureState(workflowDefinitionId: string): Promise<void> {
  await withConnection((client) =>
    client.query(
      `DELETE FROM asset_materializer_failure_state
         WHERE workflow_definition_id = $1`,
      [workflowDefinitionId]
    )
  );
}

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { normalizeAssetId } from '../assets/identifiers';
import type {
  JsonValue,
  WorkflowAssetProvenanceRecord,
  WorkflowAssetProvenanceInput,
  WorkflowAssetRecoveryRequestCreateInput,
  WorkflowAssetRecoveryRequestRecord,
  WorkflowAssetRecoveryRequestUpdateInput
} from './types';
import {
  mapWorkflowAssetProvenanceRow,
  mapWorkflowAssetRecoveryRequestRow
} from './rowMappers';
import type {
  WorkflowAssetProvenanceRow,
  WorkflowAssetRecoveryRequestRow,
  WorkflowAssetDeclarationRow
} from './rowTypes';
import { useConnection, useTransaction } from './utils';

function normalizePartitionKeyValue(
  partitionKey: string | null
): { raw: string | null; normalized: string } {
  if (typeof partitionKey === 'string') {
    const trimmed = partitionKey.trim();
    if (trimmed.length > 0) {
      return { raw: trimmed, normalized: trimmed };
    }
  }
  return { raw: null, normalized: '' };
}

function canonicalizeAssetId(assetId: string): { assetId: string; assetKey: string } {
  const trimmed = assetId.trim();
  const normalized = normalizeAssetId(trimmed);
  if (!trimmed || !normalized) {
    throw new Error('assetId is required');
  }
  return { assetId: trimmed, assetKey: normalized };
}

function coerceMetadata(metadata: JsonValue | undefined): string {
  const value = metadata === undefined ? {} : metadata;
  return JSON.stringify(value ?? {});
}

export async function upsertWorkflowAssetProvenance(
  input: WorkflowAssetProvenanceInput
): Promise<WorkflowAssetProvenanceRecord> {
  const { assetId, assetKey } = canonicalizeAssetId(input.assetId);
  const partition = normalizePartitionKeyValue(input.partitionKey ?? null);
  const metadataJson = coerceMetadata(input.metadata);

  return useTransaction(async (client) => {
    const params: unknown[] = [
      randomUUID(),
      assetId,
      assetKey,
      input.workflowDefinitionId,
      input.workflowSlug ?? null,
      input.stepId,
      input.workflowRunId,
      input.workflowRunStepId,
      input.jobRunId ?? null,
      input.jobSlug ?? null,
      partition.raw,
      partition.normalized,
      input.producedAt,
      metadataJson
    ];

    const { rows } = await client.query<WorkflowAssetProvenanceRow>(
      `INSERT INTO workflow_asset_provenance (
         id,
         asset_id,
         asset_key,
         workflow_definition_id,
         workflow_slug,
         step_id,
         workflow_run_id,
         workflow_run_step_id,
         job_run_id,
         job_slug,
         partition_key,
         partition_key_normalized,
         produced_at,
         metadata
       ) VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7,
         $8,
         $9,
         $10,
         $11,
         $12,
         $13,
         $14::jsonb
       )
       ON CONFLICT (asset_key, partition_key_normalized)
       DO UPDATE
         SET workflow_definition_id = EXCLUDED.workflow_definition_id,
             workflow_slug = EXCLUDED.workflow_slug,
             step_id = EXCLUDED.step_id,
             workflow_run_id = EXCLUDED.workflow_run_id,
             workflow_run_step_id = EXCLUDED.workflow_run_step_id,
             job_run_id = EXCLUDED.job_run_id,
             job_slug = EXCLUDED.job_slug,
             partition_key = EXCLUDED.partition_key,
             produced_at = EXCLUDED.produced_at,
             metadata = EXCLUDED.metadata,
             updated_at = NOW()
       RETURNING *`,
      params
    );

    if (rows.length === 0) {
      throw new Error('Failed to upsert workflow asset provenance');
    }

    return mapWorkflowAssetProvenanceRow(rows[0]);
  });
}

export async function getWorkflowAssetProvenance(
  input: {
    assetId: string;
    partitionKey?: string | null;
    workflowDefinitionId?: string | null;
  }
): Promise<WorkflowAssetProvenanceRecord | null> {
  const { assetKey } = canonicalizeAssetId(input.assetId);
  const partition = normalizePartitionKeyValue(input.partitionKey ?? null);

  return useConnection(async (client) => {
    const params: unknown[] = [assetKey, partition.normalized];
    let query =
      `SELECT *
         FROM workflow_asset_provenance
        WHERE asset_key = $1
          AND partition_key_normalized = $2`;

    if (input.workflowDefinitionId) {
      params.push(input.workflowDefinitionId);
      query += ' AND workflow_definition_id = $3';
    }

    query += ' ORDER BY produced_at DESC LIMIT 1';

    const { rows } = await client.query<WorkflowAssetProvenanceRow>(query, params);
    if (rows.length === 0) {
      return null;
    }
    return mapWorkflowAssetProvenanceRow(rows[0]);
  });
}

async function findActiveRecoveryRequest(
  client: PoolClient,
  assetKey: string,
  partitionNormalized: string
): Promise<WorkflowAssetRecoveryRequestRecord | null> {
  const { rows } = await client.query<WorkflowAssetRecoveryRequestRow>(
    `SELECT *
       FROM workflow_asset_recovery_requests
      WHERE asset_key = $1
        AND partition_key_normalized = $2
        AND status IN ('pending', 'running')
      ORDER BY created_at ASC
      LIMIT 1`,
    [assetKey, partitionNormalized]
  );
  if (rows.length === 0) {
    return null;
  }
  return mapWorkflowAssetRecoveryRequestRow(rows[0]);
}

export async function ensureAssetRecoveryRequest(
  input: WorkflowAssetRecoveryRequestCreateInput
): Promise<WorkflowAssetRecoveryRequestRecord> {
  const { assetId, assetKey } = canonicalizeAssetId(input.assetId);
  const partition = normalizePartitionKeyValue(input.partitionKey ?? null);
  const metadataJson = coerceMetadata(input.metadata);

  return useTransaction(async (client) => {
    const existing = await findActiveRecoveryRequest(client, assetKey, partition.normalized);
    if (existing) {
      return existing;
    }

    const params: unknown[] = [
      randomUUID(),
      assetId,
      assetKey,
      input.workflowDefinitionId,
      partition.raw,
      partition.normalized,
      'pending',
      input.requestedByWorkflowRunId,
      input.requestedByWorkflowRunStepId,
      input.requestedByStepId,
      metadataJson
    ];

    const { rows } = await client.query<WorkflowAssetRecoveryRequestRow>(
      `INSERT INTO workflow_asset_recovery_requests (
         id,
         asset_id,
         asset_key,
         workflow_definition_id,
         partition_key,
         partition_key_normalized,
         status,
         requested_by_workflow_run_id,
         requested_by_workflow_run_step_id,
         requested_by_step_id,
         metadata
       ) VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7,
         $8,
         $9,
         $10,
         $11::jsonb
       )
       RETURNING *`,
      params
    );

    if (rows.length === 0) {
      throw new Error('Failed to create asset recovery request');
    }

    return mapWorkflowAssetRecoveryRequestRow(rows[0]);
  });
}

export async function getAssetRecoveryRequestById(
  id: string
): Promise<WorkflowAssetRecoveryRequestRecord | null> {
  const trimmed = id.trim();
  if (!trimmed) {
    return null;
  }

  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowAssetRecoveryRequestRow>(
      `SELECT *
         FROM workflow_asset_recovery_requests
        WHERE id = $1
        LIMIT 1`,
      [trimmed]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapWorkflowAssetRecoveryRequestRow(rows[0]);
  });
}

export async function updateAssetRecoveryRequest(
  id: string,
  updates: WorkflowAssetRecoveryRequestUpdateInput
): Promise<WorkflowAssetRecoveryRequestRecord | null> {
  const trimmed = id.trim();
  if (!trimmed) {
    return null;
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];
  let index = 1;

  const pushUpdate = (clause: string, value: unknown) => {
    setClauses.push(`${clause} = $${index++}`);
    params.push(value);
  };

  if (updates.status !== undefined) {
    pushUpdate('status', updates.status);
  }
  if (updates.recoveryWorkflowDefinitionId !== undefined) {
    pushUpdate('recovery_workflow_definition_id', updates.recoveryWorkflowDefinitionId);
  }
  if (updates.recoveryWorkflowRunId !== undefined) {
    pushUpdate('recovery_workflow_run_id', updates.recoveryWorkflowRunId);
  }
  if (updates.recoveryJobRunId !== undefined) {
    pushUpdate('recovery_job_run_id', updates.recoveryJobRunId);
  }
  if (updates.attempts !== undefined) {
    pushUpdate('attempts', updates.attempts);
  }
  if (updates.lastAttemptAt !== undefined) {
    pushUpdate('last_attempt_at', updates.lastAttemptAt);
  }
  if (updates.lastError !== undefined) {
    pushUpdate('last_error', updates.lastError);
  }
  if (updates.metadata !== undefined) {
    pushUpdate('metadata', JSON.stringify(updates.metadata ?? {}));
  }
  if (updates.completedAt !== undefined) {
    pushUpdate('completed_at', updates.completedAt);
  }

  if (setClauses.length === 0) {
    return getAssetRecoveryRequestById(trimmed);
  }

  setClauses.push('updated_at = NOW()');

  params.push(trimmed);

  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowAssetRecoveryRequestRow>(
      `UPDATE workflow_asset_recovery_requests
          SET ${setClauses.join(', ')}
        WHERE id = $${params.length}
        RETURNING *`,
      params
    );

    if (rows.length === 0) {
      return null;
    }

    return mapWorkflowAssetRecoveryRequestRow(rows[0]);
  });
}

export async function listAssetRecoveryRequests(
  input: {
    assetId: string;
    partitionKey?: string | null;
    statuses?: ReadonlyArray<string>;
  }
): Promise<WorkflowAssetRecoveryRequestRecord[]> {
  const { assetKey } = canonicalizeAssetId(input.assetId);
  const partition = normalizePartitionKeyValue(input.partitionKey ?? null);
  const statuses = input.statuses && input.statuses.length > 0 ? input.statuses : ['pending', 'running'];

  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowAssetRecoveryRequestRow>(
      `SELECT *
         FROM workflow_asset_recovery_requests
        WHERE asset_key = $1
          AND partition_key_normalized = $2
          AND status = ANY($3)
        ORDER BY created_at ASC`,
      [assetKey, partition.normalized, statuses]
    );
    return rows.map(mapWorkflowAssetRecoveryRequestRow);
  });
}

export async function findAssetProducer(
  assetId: string
): Promise<{ workflowDefinitionId: string; stepId: string } | null> {
  const { assetKey } = canonicalizeAssetId(assetId);

  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowAssetDeclarationRow>(
      `SELECT *
         FROM workflow_asset_declarations
        WHERE LOWER(asset_id) = $1
          AND direction = 'produces'
        ORDER BY updated_at DESC
        LIMIT 1`,
      [assetKey]
    );

    if (rows.length === 0) {
      return null;
    }

    const record = rows[0];
    return {
      workflowDefinitionId: record.workflow_definition_id,
      stepId: record.step_id
    };
  });
}

import { mapWorkflowAssetDeclarationRow, mapWorkflowRunStepAssetRow, mapWorkflowAssetSnapshotRow, mapWorkflowAssetStalePartitionRow, mapWorkflowAssetPartitionParametersRow } from '../../db/rowMappers';
import { WorkflowAssetDeclarationRow, WorkflowRunStepAssetRow, WorkflowAssetSnapshotRow, WorkflowAssetStalePartitionRow, WorkflowAssetPartitionParametersRow } from '../../db/rowTypes';
import type { JsonValue, WorkflowStepDefinition, WorkflowAssetDeclaration, WorkflowAssetDeclarationRecord, WorkflowAssetDirection, WorkflowRunStepAssetRecord, WorkflowAssetSnapshotRecord, WorkflowAssetPartitionSummary, WorkflowAssetStalePartitionRecord, WorkflowAssetPartitionParametersRecord } from '../../db/types';
import { useConnection } from '../../db/utils';
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';

type AssetDeclarationRowInput = {
  stepId: string;
  direction: WorkflowAssetDirection;
  asset: WorkflowAssetDeclaration;
};

export function normalizePartitionKeyValue(
  partitionKey: string | null | undefined
): { raw: string | null; normalized: string } {
  if (typeof partitionKey === 'string') {
    const trimmed = partitionKey.trim();
    if (trimmed.length > 0) {
      return { raw: trimmed, normalized: trimmed };
    }
  }
  return { raw: null, normalized: '' };
}

function extractStepAssetDeclarations(
  stepId: string,
  step: { produces?: WorkflowAssetDeclaration[]; consumes?: WorkflowAssetDeclaration[] }
): AssetDeclarationRowInput[] {
  const declarations: AssetDeclarationRowInput[] = [];

  if (Array.isArray(step.produces)) {
    for (const asset of step.produces) {
      if (!asset || typeof asset.assetId !== 'string' || asset.assetId.trim().length === 0) {
        continue;
      }
      declarations.push({
        stepId,
        direction: 'produces',
        asset: {
          assetId: asset.assetId.trim(),
          schema: asset.schema ?? null,
          freshness: asset.freshness ?? null,
          autoMaterialize: asset.autoMaterialize ?? null,
          partitioning: asset.partitioning ?? null
        }
      });
    }
  }

  if (Array.isArray(step.consumes)) {
    for (const asset of step.consumes) {
      if (!asset || typeof asset.assetId !== 'string' || asset.assetId.trim().length === 0) {
        continue;
      }
      declarations.push({
        stepId,
        direction: 'consumes',
        asset: {
          assetId: asset.assetId.trim(),
          schema: asset.schema ?? null,
          freshness: asset.freshness ?? null,
          partitioning: asset.partitioning ?? null
        }
      });
    }
  }

  return declarations;
}

function collectWorkflowAssetDeclarations(
  steps: WorkflowStepDefinition[]
): AssetDeclarationRowInput[] {
  const collected: AssetDeclarationRowInput[] = [];
  for (const step of steps) {
    collected.push(...extractStepAssetDeclarations(step.id, step));
    if (step.type === 'fanout') {
      collected.push(...extractStepAssetDeclarations(step.template.id, step.template));
    }
  }
  return collected;
}

export async function replaceWorkflowAssetDeclarations(
  client: PoolClient,
  workflowDefinitionId: string,
  steps: WorkflowStepDefinition[]
): Promise<void> {
  const declarations = collectWorkflowAssetDeclarations(steps);

  await client.query('DELETE FROM workflow_asset_declarations WHERE workflow_definition_id = $1', [
    workflowDefinitionId
  ]);

  if (declarations.length === 0) {
    return;
  }

  const values: string[] = [];
  const params: unknown[] = [];
  let index = 1;

  for (const declaration of declarations) {
    const id = randomUUID();
    values.push(
      `($${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++})`
    );
    params.push(
      id,
      workflowDefinitionId,
      declaration.stepId,
      declaration.direction,
      declaration.asset.assetId,
      declaration.asset.schema ?? null,
      declaration.asset.freshness ?? null,
      declaration.asset.autoMaterialize ?? null,
      declaration.asset.partitioning ?? null
    );
  }

  await client.query(
    `INSERT INTO workflow_asset_declarations (
       id,
       workflow_definition_id,
       step_id,
       direction,
       asset_id,
       asset_schema,
       freshness,
       auto_materialize,
       partitioning
     )
     VALUES ${values.join(', ')}
     ON CONFLICT (workflow_definition_id, step_id, direction, asset_id)
     DO UPDATE
       SET asset_schema = EXCLUDED.asset_schema,
           freshness = EXCLUDED.freshness,
           auto_materialize = EXCLUDED.auto_materialize,
           partitioning = EXCLUDED.partitioning,
           updated_at = NOW()`,
    params
  );
}

async function fetchWorkflowAssetDeclarationsByDefinitionId(
  client: PoolClient,
  workflowDefinitionId: string
): Promise<WorkflowAssetDeclarationRecord[]> {
  const { rows } = await client.query<WorkflowAssetDeclarationRow>(
    `SELECT *
       FROM workflow_asset_declarations
       WHERE workflow_definition_id = $1
       ORDER BY step_id, direction, asset_id`,
    [workflowDefinitionId]
  );
  return rows.map(mapWorkflowAssetDeclarationRow);
}

async function fetchWorkflowAssetDeclarationsBySlug(
  client: PoolClient,
  slug: string
): Promise<WorkflowAssetDeclarationRecord[]> {
  const { rows } = await client.query<WorkflowAssetDeclarationRow>(
    `SELECT declarations.*
       FROM workflow_asset_declarations declarations
       INNER JOIN workflow_definitions defs ON defs.id = declarations.workflow_definition_id
       WHERE defs.slug = $1
       ORDER BY declarations.step_id, declarations.direction, declarations.asset_id`,
    [slug]
  );
  return rows.map(mapWorkflowAssetDeclarationRow);
}

async function fetchLatestWorkflowAssetSnapshots(
  client: PoolClient,
  workflowDefinitionId: string
): Promise<WorkflowAssetSnapshotRecord[]> {
  const { rows } = await client.query<WorkflowAssetSnapshotRow>(
    `SELECT DISTINCT ON (asset.asset_id, COALESCE(asset.partition_key, ''))
         asset.*,
            step.status AS step_status,
            run.status AS run_status,
            run.started_at AS run_started_at,
            run.completed_at AS run_completed_at
       FROM workflow_run_step_assets asset
       JOIN workflow_run_steps step ON step.id = asset.workflow_run_step_id
       JOIN workflow_runs run ON run.id = asset.workflow_run_id
       WHERE asset.workflow_definition_id = $1
       ORDER BY asset.asset_id,
                COALESCE(asset.partition_key, ''),
                asset.produced_at DESC,
                asset.created_at DESC,
                asset.id DESC`,
    [workflowDefinitionId]
  );
  return rows.map(mapWorkflowAssetSnapshotRow);
}

async function fetchWorkflowAssetHistory(
  client: PoolClient,
  workflowDefinitionId: string,
  assetId: string,
  limit: number,
  partitionKey?: string | null
): Promise<WorkflowAssetSnapshotRecord[]> {
  const params: unknown[] = [workflowDefinitionId, assetId];
  let partitionClause = '';

  if (partitionKey) {
    params.push(partitionKey);
    partitionClause = ' AND asset.partition_key = $3';
  }

  params.push(limit);
  const limitIndex = params.length;

  const { rows } = await client.query<WorkflowAssetSnapshotRow>(
    `SELECT asset.*,
            step.status AS step_status,
            run.status AS run_status,
            run.started_at AS run_started_at,
            run.completed_at AS run_completed_at
       FROM workflow_run_step_assets asset
       JOIN workflow_run_steps step ON step.id = asset.workflow_run_step_id
       JOIN workflow_runs run ON run.id = asset.workflow_run_id
      WHERE asset.workflow_definition_id = $1
        AND asset.asset_id = $2${partitionClause}
     ORDER BY asset.produced_at DESC,
              asset.created_at DESC,
              asset.id DESC
     LIMIT $${limitIndex}`,
    params
  );
  return rows.map(mapWorkflowAssetSnapshotRow);
}

async function fetchWorkflowAssetStalePartitions(
  client: PoolClient,
  workflowDefinitionId: string
): Promise<WorkflowAssetStalePartitionRecord[]> {
  const { rows } = await client.query<WorkflowAssetStalePartitionRow>(
    `SELECT *
       FROM workflow_asset_stale_partitions
      WHERE workflow_definition_id = $1
      ORDER BY requested_at DESC`,
    [workflowDefinitionId]
  );
  return rows.map(mapWorkflowAssetStalePartitionRow);
}

async function fetchWorkflowAssetStalePartitionsForAsset(
  client: PoolClient,
  workflowDefinitionId: string,
  assetId: string
): Promise<WorkflowAssetStalePartitionRecord[]> {
  const { rows } = await client.query<WorkflowAssetStalePartitionRow>(
    `SELECT *
       FROM workflow_asset_stale_partitions
      WHERE workflow_definition_id = $1
        AND asset_id = $2
      ORDER BY requested_at DESC`,
    [workflowDefinitionId, assetId]
  );
  return rows.map(mapWorkflowAssetStalePartitionRow);
}

async function fetchWorkflowAssetPartitionParameters(
  client: PoolClient,
  workflowDefinitionId: string,
  assetId: string
): Promise<WorkflowAssetPartitionParametersRecord[]> {
  const { rows } = await client.query<WorkflowAssetPartitionParametersRow>(
    `SELECT *
       FROM workflow_asset_partition_parameters
      WHERE workflow_definition_id = $1
        AND asset_id = $2
      ORDER BY updated_at DESC`,
    [workflowDefinitionId, assetId]
  );
  return rows.map(mapWorkflowAssetPartitionParametersRow);
}

async function fetchWorkflowAssetPartitionParametersByKey(
  client: PoolClient,
  workflowDefinitionId: string,
  assetId: string,
  partitionKey: string | null
): Promise<WorkflowAssetPartitionParametersRecord | null> {
  const { normalized } = normalizePartitionKeyValue(partitionKey);
  const { rows } = await client.query<WorkflowAssetPartitionParametersRow>(
    `SELECT *
       FROM workflow_asset_partition_parameters
      WHERE workflow_definition_id = $1
        AND asset_id = $2
        AND partition_key_normalized = $3
      LIMIT 1`,
    [workflowDefinitionId, assetId, normalized]
  );
  if (rows.length === 0) {
    return null;
  }
  return mapWorkflowAssetPartitionParametersRow(rows[0]);
}

export async function upsertWorkflowAssetPartitionParameters(
  client: PoolClient,
  input: {
    workflowDefinitionId: string;
    assetId: string;
    partitionKey: string | null;
    parameters: JsonValue;
    source: string;
  }
): Promise<void> {
  const { workflowDefinitionId, assetId, partitionKey, parameters, source } = input;
  const { raw, normalized } = normalizePartitionKeyValue(partitionKey);
  await client.query(
    `INSERT INTO workflow_asset_partition_parameters (
       workflow_definition_id,
       asset_id,
       partition_key,
       partition_key_normalized,
       parameters,
       source
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (workflow_definition_id, asset_id, partition_key_normalized)
     DO UPDATE
       SET parameters = EXCLUDED.parameters,
           source = EXCLUDED.source,
           updated_at = NOW()`,
    [workflowDefinitionId, assetId, raw, normalized, JSON.stringify(parameters ?? null), source]
  );
}

async function deleteWorkflowAssetPartitionParameters(
  client: PoolClient,
  workflowDefinitionId: string,
  assetId: string,
  partitionKey: string | null
): Promise<void> {
  const { normalized } = normalizePartitionKeyValue(partitionKey);
  await client.query(
    `DELETE FROM workflow_asset_partition_parameters
      WHERE workflow_definition_id = $1
        AND asset_id = $2
        AND partition_key_normalized = $3`,
    [workflowDefinitionId, assetId, normalized]
  );
}

async function fetchWorkflowAssetPartitions(
  client: PoolClient,
  workflowDefinitionId: string,
  assetId: string
): Promise<WorkflowAssetPartitionSummary[]> {
  const { rows } = await client.query<WorkflowAssetSnapshotRow>(
    `SELECT asset.*,
            step.status AS step_status,
            run.status AS run_status,
            run.started_at AS run_started_at,
            run.completed_at AS run_completed_at
       FROM workflow_run_step_assets asset
       JOIN workflow_run_steps step ON step.id = asset.workflow_run_step_id
       JOIN workflow_runs run ON run.id = asset.workflow_run_id
      WHERE asset.workflow_definition_id = $1
        AND asset.asset_id = $2
     ORDER BY COALESCE(asset.partition_key, ''),
              asset.produced_at DESC,
              asset.created_at DESC,
              asset.id DESC`,
    [workflowDefinitionId, assetId]
  );
  const staleRecords = await fetchWorkflowAssetStalePartitionsForAsset(
    client,
    workflowDefinitionId,
    assetId
  );
  const parameterRecords = await fetchWorkflowAssetPartitionParameters(
    client,
    workflowDefinitionId,
    assetId
  );
  const staleByNormalized = new Map<string, WorkflowAssetStalePartitionRecord>();
  for (const record of staleRecords) {
    staleByNormalized.set(record.partitionKeyNormalized, record);
  }
  const parametersByNormalized = new Map<string, WorkflowAssetPartitionParametersRecord>();
  for (const record of parameterRecords) {
    parametersByNormalized.set(record.partitionKeyNormalized, record);
  }

  const partitions = new Map<
    string,
    {
      partitionKey: string | null;
      latest: WorkflowAssetSnapshotRecord | null;
      materializationCount: number;
      stale: WorkflowAssetStalePartitionRecord | null;
      parameters: WorkflowAssetPartitionParametersRecord | null;
    }
  >();

  for (const row of rows) {
    const snapshot = mapWorkflowAssetSnapshotRow(row);
    const { raw, normalized } = normalizePartitionKeyValue(row.partition_key);
    const existing = partitions.get(normalized);
    if (existing) {
      existing.materializationCount += 1;
      continue;
    }

    partitions.set(normalized, {
      partitionKey: raw,
      latest: snapshot,
      materializationCount: 1,
      stale: staleByNormalized.get(normalized) ?? null,
      parameters: parametersByNormalized.get(normalized) ?? null
    });
  }

  for (const record of staleRecords) {
    if (!partitions.has(record.partitionKeyNormalized)) {
      partitions.set(record.partitionKeyNormalized, {
        partitionKey: record.partitionKey,
        latest: null,
        materializationCount: 0,
        stale: record,
        parameters: parametersByNormalized.get(record.partitionKeyNormalized) ?? null
      });
    }
  }

  for (const [normalized, record] of parametersByNormalized) {
    if (!partitions.has(normalized)) {
      partitions.set(normalized, {
        partitionKey: record.partitionKey,
        latest: null,
        materializationCount: 0,
        stale: staleByNormalized.get(normalized) ?? null,
        parameters: record
      });
    }
  }

  return Array.from(partitions.values()).map((entry) => ({
    assetId,
    partitionKey: entry.partitionKey,
    latest: entry.latest,
    materializationCount: entry.materializationCount,
    isStale: Boolean(entry.stale),
    staleMetadata: entry.stale
      ? {
          requestedAt: entry.stale.requestedAt,
          requestedBy: entry.stale.requestedBy,
          note: entry.stale.note ?? null
        }
      : null,
    parameters: entry.parameters ? entry.parameters.parameters : null,
    parametersSource: entry.parameters ? entry.parameters.source : null,
    parametersCapturedAt: entry.parameters ? entry.parameters.capturedAt : null,
    parametersUpdatedAt: entry.parameters ? entry.parameters.updatedAt : null
  } satisfies WorkflowAssetPartitionSummary));
}

export async function listWorkflowAssetDeclarations(
  workflowDefinitionId: string
): Promise<WorkflowAssetDeclarationRecord[]> {
  return useConnection((client) =>
    fetchWorkflowAssetDeclarationsByDefinitionId(client, workflowDefinitionId)
  );
}

export async function listWorkflowAssetDeclarationsBySlug(
  slug: string
): Promise<WorkflowAssetDeclarationRecord[]> {
  return useConnection((client) => fetchWorkflowAssetDeclarationsBySlug(client, slug));
}

export async function listLatestWorkflowAssetSnapshots(
  workflowDefinitionId: string
): Promise<WorkflowAssetSnapshotRecord[]> {
  return useConnection((client) =>
    fetchLatestWorkflowAssetSnapshots(client, workflowDefinitionId)
  );
}

export async function listWorkflowAssetHistory(
  workflowDefinitionId: string,
  assetId: string,
  { limit = 10, partitionKey }: { limit?: number; partitionKey?: string | null } = {}
): Promise<WorkflowAssetSnapshotRecord[]> {
  const normalizedLimit = Math.max(1, Math.min(limit, 100));
  return useConnection((client) =>
    fetchWorkflowAssetHistory(client, workflowDefinitionId, assetId, normalizedLimit, partitionKey)
  );
}

export async function listWorkflowAssetPartitions(
  workflowDefinitionId: string,
  assetId: string
): Promise<WorkflowAssetPartitionSummary[]> {
  return useConnection((client) => fetchWorkflowAssetPartitions(client, workflowDefinitionId, assetId));
}

export async function listWorkflowAssetStalePartitions(
  workflowDefinitionId: string
): Promise<WorkflowAssetStalePartitionRecord[]> {
  return useConnection((client) => fetchWorkflowAssetStalePartitions(client, workflowDefinitionId));
}

export async function markWorkflowAssetPartitionStale(
  workflowDefinitionId: string,
  assetId: string,
  partitionKey: string | null,
  options: { requestedBy?: string | null; note?: string | null } = {}
): Promise<void> {
  const { raw, normalized } = normalizePartitionKeyValue(partitionKey);
  const requestedBy = options.requestedBy ?? null;
  const note = typeof options.note === 'string' && options.note.trim().length > 0 ? options.note.trim().slice(0, 500) : null;

  await useConnection((client) =>
    client.query(
      `INSERT INTO workflow_asset_stale_partitions (
         workflow_definition_id,
         asset_id,
         partition_key,
         partition_key_normalized,
         requested_at,
         requested_by,
         note
       ) VALUES (
         $1,
         $2,
         $3,
         $4,
         NOW(),
         $5,
         $6
       )
       ON CONFLICT (workflow_definition_id, asset_id, partition_key_normalized)
       DO UPDATE
         SET requested_at = NOW(),
             requested_by = EXCLUDED.requested_by,
             note = EXCLUDED.note`,
      [workflowDefinitionId, assetId, raw, normalized, requestedBy, note]
    )
  );
}

export async function clearWorkflowAssetPartitionStale(
  workflowDefinitionId: string,
  assetId: string,
  partitionKey: string | null
): Promise<void> {
  const { normalized } = normalizePartitionKeyValue(partitionKey);
  await useConnection((client) =>
    client.query(
      `DELETE FROM workflow_asset_stale_partitions
        WHERE workflow_definition_id = $1
          AND asset_id = $2
          AND partition_key_normalized = $3`,
      [workflowDefinitionId, assetId, normalized]
    )
  );
}

export async function getWorkflowAssetPartitionParameters(
  workflowDefinitionId: string,
  assetId: string,
  partitionKey: string | null
): Promise<WorkflowAssetPartitionParametersRecord | null> {
  return useConnection((client) =>
    fetchWorkflowAssetPartitionParametersByKey(client, workflowDefinitionId, assetId, partitionKey)
  );
}

export async function setWorkflowAssetPartitionParameters(
  workflowDefinitionId: string,
  assetId: string,
  partitionKey: string | null,
  parameters: JsonValue,
  source: 'manual' | 'workflow-run' | 'system' = 'manual'
): Promise<void> {
  await useConnection((client) =>
    upsertWorkflowAssetPartitionParameters(client, {
      workflowDefinitionId,
      assetId,
      partitionKey,
      parameters,
      source
    })
  );
}

export async function removeWorkflowAssetPartitionParameters(
  workflowDefinitionId: string,
  assetId: string,
  partitionKey: string | null
): Promise<void> {
  await useConnection((client) =>
    deleteWorkflowAssetPartitionParameters(client, workflowDefinitionId, assetId, partitionKey)
  );
}

export async function listWorkflowRunProducedAssets(
  workflowRunId: string
): Promise<WorkflowRunStepAssetRecord[]> {
  const trimmed = workflowRunId?.trim() ?? '';
  if (!trimmed) {
    return [];
  }
  const { rows } = await useConnection((client) =>
    client.query<WorkflowRunStepAssetRow>(
      `SELECT *
         FROM workflow_run_step_assets
        WHERE workflow_run_id = $1
        ORDER BY created_at ASC, id ASC`,
      [trimmed]
    )
  );
  return rows.map(mapWorkflowRunStepAssetRow);
}

export type WorkflowRunListFilters = {
  statuses?: string[];
  workflowSlugs?: string[];
  triggerTypes?: string[];
  partition?: string;
  search?: string;
  from?: string;
  to?: string;
};

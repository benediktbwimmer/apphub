import { mapWorkflowAssetDeclarationRow, mapWorkflowRunStepAssetRow, mapWorkflowAssetSnapshotRow, mapWorkflowAssetStalePartitionRow, mapWorkflowAssetPartitionParametersRow } from '../../db/rowMappers';
import { WorkflowAssetDeclarationRow, WorkflowRunStepAssetRow, WorkflowAssetSnapshotRow, WorkflowAssetStalePartitionRow, WorkflowAssetPartitionParametersRow } from '../../db/rowTypes';
import type {
  JsonValue,
  WorkflowStepDefinition,
  WorkflowAssetDeclaration,
  WorkflowAssetDeclarationRecord,
  WorkflowAssetDirection,
  WorkflowRunStepAssetRecord,
  WorkflowAssetSnapshotRecord,
  WorkflowAssetPartitionSummary,
  WorkflowAssetStalePartitionRecord,
  WorkflowAssetPartitionParametersRecord,
  WorkflowAssetAutoMaterialize
} from '../../db/types';
import { useConnection, useTransaction } from '../../db/utils';
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';

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

type AssetDeclarationRowInput = {
  stepId: string;
  direction: WorkflowAssetDirection;
  asset: WorkflowAssetDeclaration;
};

export type WorkflowAssetPartitionKeyFilter =
  | { type: 'raw'; value: string | null }
  | { type: 'window'; value: string };

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

function normalizeWindowSegment(value: string): string {
  return value.replace(/[:\s]+/g, '-');
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
  slug: string,
  options: { moduleIds?: string[] | null } = {}
): Promise<WorkflowAssetDeclarationRecord[]> {
  const moduleIds = normalizeModuleIds(options.moduleIds ?? null);
  const params: unknown[] = [slug];
  let moduleClause = '';

  if (moduleIds && moduleIds.length > 0) {
    params.push(moduleIds);
    moduleClause = `
      AND EXISTS (
        SELECT 1
          FROM module_resource_contexts mrc
         WHERE mrc.resource_type = 'workflow-definition'
           AND mrc.resource_id = defs.id
           AND mrc.module_id = ANY($${params.length}::text[])
      )`;
  }

  const { rows } = await client.query<WorkflowAssetDeclarationRow>(
    `SELECT declarations.*
       FROM workflow_asset_declarations declarations
       INNER JOIN workflow_definitions defs ON defs.id = declarations.workflow_definition_id
       WHERE defs.slug = $1${moduleClause}
       ORDER BY declarations.step_id, declarations.direction, declarations.asset_id`,
    params
  );
  return rows.map(mapWorkflowAssetDeclarationRow);
}

async function fetchLatestWorkflowAssetSnapshots(
  client: PoolClient,
  workflowDefinitionId: string,
  options: { moduleIds?: string[] | null } = {}
): Promise<WorkflowAssetSnapshotRecord[]> {
  const moduleIds = normalizeModuleIds(options.moduleIds ?? null);
  const params: unknown[] = [workflowDefinitionId];
  let moduleClause = '';

  if (moduleIds && moduleIds.length > 0) {
    params.push(moduleIds);
    moduleClause = `
        AND EXISTS (
          SELECT 1
            FROM module_resource_contexts mrc
           WHERE mrc.resource_type = 'workflow-run'
             AND mrc.resource_id = run.id
             AND mrc.module_id = ANY($${params.length}::text[])
        )`;
  }

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
        ${moduleClause}
       ORDER BY asset.asset_id,
                COALESCE(asset.partition_key, ''),
                asset.produced_at DESC,
                asset.created_at DESC,
                asset.id DESC`,
    params
  );
  return rows.map(mapWorkflowAssetSnapshotRow);
}

async function fetchWorkflowAssetHistory(
  client: PoolClient,
  workflowDefinitionId: string,
  assetId: string,
  limit: number,
  partitionKey?: string | null,
  options: { moduleIds?: string[] | null } = {}
): Promise<WorkflowAssetSnapshotRecord[]> {
  const params: unknown[] = [workflowDefinitionId, assetId];
  let partitionClause = '';

  if (partitionKey) {
    params.push(partitionKey);
    partitionClause = ' AND asset.partition_key = $3';
  }

  params.push(limit);
  const limitIndex = params.length;

  const moduleIds = normalizeModuleIds(options.moduleIds ?? null);
  let moduleClause = '';
  if (moduleIds && moduleIds.length > 0) {
    params.push(moduleIds);
    moduleClause = `
        AND EXISTS (
          SELECT 1
            FROM module_resource_contexts mrc
           WHERE mrc.resource_type = 'workflow-run'
             AND mrc.resource_id = run.id
             AND mrc.module_id = ANY($${params.length}::text[])
        )`;
  }

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
        ${moduleClause}
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
  assetId: string,
  options: { partitionKey?: string | null; normalizedPartitionKeys?: string[] } = {}
): Promise<WorkflowAssetStalePartitionRecord[]> {
  const params: unknown[] = [workflowDefinitionId, assetId];
  let partitionClause = '';
  if (options.normalizedPartitionKeys && options.normalizedPartitionKeys.length > 0) {
    params.push(options.normalizedPartitionKeys);
    partitionClause = `
        AND partition_key_normalized = ANY($${params.length}::text[])`;
  } else if (Object.prototype.hasOwnProperty.call(options, 'partitionKey')) {
    const { normalized } = normalizePartitionKeyValue(options.partitionKey ?? null);
    params.push(normalized);
    partitionClause = `
        AND partition_key_normalized = $${params.length}`;
  }
  const { rows } = await client.query<WorkflowAssetStalePartitionRow>(
    `SELECT *
       FROM workflow_asset_stale_partitions
      WHERE workflow_definition_id = $1
        AND asset_id = $2${partitionClause}
      ORDER BY requested_at DESC`,
    params
  );
  return rows.map(mapWorkflowAssetStalePartitionRow);
}

async function fetchWorkflowAssetPartitionParameters(
  client: PoolClient,
  workflowDefinitionId: string,
  assetId: string,
  options: { partitionKey?: string | null; normalizedPartitionKeys?: string[] } = {}
): Promise<WorkflowAssetPartitionParametersRecord[]> {
  const params: unknown[] = [workflowDefinitionId, assetId];
  let partitionClause = '';
  if (options.normalizedPartitionKeys && options.normalizedPartitionKeys.length > 0) {
    params.push(options.normalizedPartitionKeys);
    partitionClause = `
        AND partition_key_normalized = ANY($${params.length}::text[])`;
  } else if (Object.prototype.hasOwnProperty.call(options, 'partitionKey')) {
    const { normalized } = normalizePartitionKeyValue(options.partitionKey ?? null);
    params.push(normalized);
    partitionClause = `
        AND partition_key_normalized = $${params.length}`;
  }
  const { rows } = await client.query<WorkflowAssetPartitionParametersRow>(
    `SELECT *
       FROM workflow_asset_partition_parameters
      WHERE workflow_definition_id = $1
        AND asset_id = $2${partitionClause}
      ORDER BY updated_at DESC`,
    params
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
  assetId: string,
  options: {
    moduleIds?: string[] | null;
    partitionKeyFilter?: WorkflowAssetPartitionKeyFilter;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ partitions: WorkflowAssetPartitionSummary[]; totalCount: number }> {
  const moduleIds = normalizeModuleIds(options.moduleIds ?? null);
  const params: unknown[] = [workflowDefinitionId, assetId];
  let moduleClause = '';
  let partitionClause = '';
  const partitionFilter = options.partitionKeyFilter;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  if (moduleIds && moduleIds.length > 0) {
    params.push(moduleIds);
    moduleClause = `
        AND EXISTS (
          SELECT 1
            FROM module_resource_contexts mrc
           WHERE mrc.resource_type = 'workflow-run'
             AND mrc.resource_id = run.id
             AND mrc.module_id = ANY($${params.length}::text[])
        )`;
  }

  if (partitionFilter) {
    if (partitionFilter.type === 'raw') {
      if (partitionFilter.value === null) {
        partitionClause = `
        AND asset.partition_key IS NULL`;
      } else {
        params.push(partitionFilter.value);
        partitionClause = `
        AND asset.partition_key = $${params.length}`;
      }
    } else if (partitionFilter.type === 'window') {
      const normalizedWindow = normalizeWindowSegment(partitionFilter.value);
      params.push(`window=${normalizedWindow}`);
      partitionClause = `
        AND asset.partition_key LIKE '%' || $${params.length} || '%'`;
    }
  }

  const countResult = await client.query<{ total: string }>(
    `SELECT COUNT(*) AS total
       FROM (
         SELECT 1
           FROM workflow_run_step_assets asset
           JOIN workflow_run_steps step ON step.id = asset.workflow_run_step_id
           JOIN workflow_runs run ON run.id = asset.workflow_run_id
          WHERE asset.workflow_definition_id = $1
            AND asset.asset_id = $2${partitionClause}
            ${moduleClause}
          GROUP BY COALESCE(asset.partition_key, '')
       ) partition_groups`,
    params
  );
  const totalCount = Number(countResult.rows[0]?.total ?? 0);

  const dataParams = [...params];
  dataParams.push(offset);
  const offsetParamIndex = dataParams.length;
  dataParams.push(limit);
  const limitParamIndex = dataParams.length;

  const { rows } = await client.query<
    WorkflowAssetSnapshotRow & {
      partition_key_normalized: string;
      materialization_count: string | null;
    }
  >(
    `WITH ranked AS (
        SELECT asset.*,
               step.status AS step_status,
               run.status AS run_status,
               run.started_at AS run_started_at,
               run.completed_at AS run_completed_at,
               COALESCE(asset.partition_key, '') AS partition_key_normalized,
               ROW_NUMBER() OVER (
                 PARTITION BY COALESCE(asset.partition_key, '')
                 ORDER BY asset.produced_at DESC NULLS LAST,
                          asset.created_at DESC,
                          asset.id DESC
               ) AS partition_rank,
               COUNT(*) OVER (PARTITION BY COALESCE(asset.partition_key, '')) AS materialization_count
          FROM workflow_run_step_assets asset
          JOIN workflow_run_steps step ON step.id = asset.workflow_run_step_id
          JOIN workflow_runs run ON run.id = asset.workflow_run_id
         WHERE asset.workflow_definition_id = $1
           AND asset.asset_id = $2${partitionClause}
           ${moduleClause}
       )
       SELECT ranked.*
         FROM ranked
        WHERE partition_rank = 1
        ORDER BY ranked.produced_at DESC NULLS LAST,
                 ranked.partition_key_normalized,
                 ranked.created_at DESC
        OFFSET $${offsetParamIndex}
        LIMIT $${limitParamIndex}`,
    dataParams
  );
  const normalizedKeys = rows.map((row) => row.partition_key_normalized);
  const staleRecords = await fetchWorkflowAssetStalePartitionsForAsset(
    client,
    workflowDefinitionId,
    assetId,
    partitionFilter && partitionFilter.type === 'raw'
      ? { partitionKey: partitionFilter.value ?? null }
      : { normalizedPartitionKeys: normalizedKeys }
  );
  const parameterRecords = await fetchWorkflowAssetPartitionParameters(
    client,
    workflowDefinitionId,
    assetId,
    partitionFilter && partitionFilter.type === 'raw'
      ? { partitionKey: partitionFilter.value ?? null }
      : { normalizedPartitionKeys: normalizedKeys }
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
    const normalized = row.partition_key_normalized ?? '';
    partitions.set(normalized, {
      partitionKey: row.partition_key,
      latest: snapshot,
      materializationCount: Number(row.materialization_count ?? '1'),
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

  const partitionSummaries = Array.from(partitions.values()).map((entry) => ({
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

  return {
    partitions: partitionSummaries,
    totalCount
  };
}

export async function listWorkflowAssetDeclarations(
  workflowDefinitionId: string
): Promise<WorkflowAssetDeclarationRecord[]> {
  return useConnection((client) =>
    fetchWorkflowAssetDeclarationsByDefinitionId(client, workflowDefinitionId)
  );
}

export async function listWorkflowAssetDeclarationsBySlug(
  slug: string,
  options: { moduleIds?: string[] | null } = {}
): Promise<WorkflowAssetDeclarationRecord[]> {
  return useConnection((client) => fetchWorkflowAssetDeclarationsBySlug(client, slug, options));
}

function applyAutoMaterializeUpdates(
  current: WorkflowAssetAutoMaterialize | null,
  updates: Partial<WorkflowAssetAutoMaterialize>
): WorkflowAssetAutoMaterialize | null {
  const next: WorkflowAssetAutoMaterialize = { ...(current ?? {}) };

  if (Object.prototype.hasOwnProperty.call(updates, 'enabled')) {
    const value = updates.enabled;
    if (typeof value === 'boolean') {
      next.enabled = value;
    } else if (value === null) {
      delete next.enabled;
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'onUpstreamUpdate')) {
    const value = updates.onUpstreamUpdate;
    if (typeof value === 'boolean') {
      next.onUpstreamUpdate = value;
    } else if (value === null) {
      delete next.onUpstreamUpdate;
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'priority')) {
    const value = updates.priority;
    if (typeof value === 'number' && Number.isFinite(value)) {
      next.priority = Math.trunc(value);
    } else if (value === null) {
      delete next.priority;
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'parameterDefaults')) {
    const value = updates.parameterDefaults;
    if (value === undefined) {
      delete next.parameterDefaults;
    } else {
      next.parameterDefaults = value ?? null;
    }
  }

  const sanitized: WorkflowAssetAutoMaterialize = {};
  if (typeof next.enabled === 'boolean') {
    sanitized.enabled = next.enabled;
  }
  if (typeof next.onUpstreamUpdate === 'boolean') {
    sanitized.onUpstreamUpdate = next.onUpstreamUpdate;
  }
  if (typeof next.priority === 'number' && Number.isFinite(next.priority)) {
    sanitized.priority = Math.trunc(next.priority);
  }
  if (Object.prototype.hasOwnProperty.call(next, 'parameterDefaults')) {
    sanitized.parameterDefaults = next.parameterDefaults ?? null;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function serializeAutoMaterialize(value: WorkflowAssetAutoMaterialize | null): string | null {
  if (!value) {
    return null;
  }
  return JSON.stringify(value);
}

export async function updateWorkflowAssetAutoMaterialize(
  options: {
    workflowDefinitionId: string;
    stepId: string;
    assetId: string;
    updates: Partial<WorkflowAssetAutoMaterialize>;
  }
): Promise<WorkflowAssetDeclarationRecord | null> {
  const { workflowDefinitionId, stepId, assetId, updates } = options;

  let record: WorkflowAssetDeclarationRecord | null = null;

  await useTransaction(async (client) => {
    const existingRows = await client.query<WorkflowAssetDeclarationRow>(
      `SELECT *
         FROM workflow_asset_declarations
        WHERE workflow_definition_id = $1
          AND step_id = $2
          AND direction = 'produces'
          AND asset_id = $3
        FOR UPDATE`,
      [workflowDefinitionId, stepId, assetId]
    );

    if (existingRows.rows.length === 0) {
      record = null;
      return;
    }

    const existing = mapWorkflowAssetDeclarationRow(existingRows.rows[0]);
    const nextAutoMaterialize = applyAutoMaterializeUpdates(existing.autoMaterialize, updates);
    const serialized = serializeAutoMaterialize(nextAutoMaterialize);

    const updatedRows = await client.query<WorkflowAssetDeclarationRow>(
      `UPDATE workflow_asset_declarations
          SET auto_materialize = $1::jsonb,
              updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [serialized, existing.id]
    );

    if (updatedRows.rows.length === 0) {
      record = null;
      return;
    }

    record = mapWorkflowAssetDeclarationRow(updatedRows.rows[0]);
  });

  return record;
}

export async function listLatestWorkflowAssetSnapshots(
  workflowDefinitionId: string,
  options: { moduleIds?: string[] | null } = {}
): Promise<WorkflowAssetSnapshotRecord[]> {
  return useConnection((client) =>
    fetchLatestWorkflowAssetSnapshots(client, workflowDefinitionId, options)
  );
}

export async function listWorkflowAssetHistory(
  workflowDefinitionId: string,
  assetId: string,
  {
    limit = 10,
    partitionKey,
    moduleIds
  }: { limit?: number; partitionKey?: string | null; moduleIds?: string[] | null } = {}
): Promise<WorkflowAssetSnapshotRecord[]> {
  const normalizedLimit = Math.max(1, Math.min(limit, 100));
  return useConnection((client) =>
    fetchWorkflowAssetHistory(client, workflowDefinitionId, assetId, normalizedLimit, partitionKey, {
      moduleIds
    })
  );
}

export async function listWorkflowAssetPartitions(
  workflowDefinitionId: string,
  assetId: string,
  options: {
    moduleIds?: string[] | null;
    partitionKeyFilter?: WorkflowAssetPartitionKeyFilter;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ partitions: WorkflowAssetPartitionSummary[]; totalCount: number }> {
  return useConnection((client) => fetchWorkflowAssetPartitions(client, workflowDefinitionId, assetId, options));
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
  moduleIds?: string[];
};

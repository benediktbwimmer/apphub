import { randomUUID } from 'node:crypto';
import { parseExpression, type ParserOptions } from 'cron-parser';
import type { PoolClient } from 'pg';
import { emitApphubEvent } from '../events';
import {
  type WorkflowDefinitionCreateInput,
  type WorkflowDefinitionRecord,
  type WorkflowDefinitionUpdateInput,
  type WorkflowRunCreateInput,
  type WorkflowRunRecord,
  type WorkflowRunWithDefinition,
  type WorkflowRunStatus,
  type WorkflowRunUpdateInput,
  type WorkflowRunStepCreateInput,
  type WorkflowRunStepRecord,
  type WorkflowRunStepUpdateInput,
  type WorkflowRunStepStatus,
  type WorkflowDagMetadata,
  type JsonValue,
  type WorkflowTriggerDefinition,
  type WorkflowScheduleWindow,
  type WorkflowScheduleMetadataUpdateInput,
  type WorkflowStepDefinition,
  type WorkflowAssetDeclaration,
  type WorkflowAssetDeclarationRecord,
  type WorkflowAssetDirection,
  type WorkflowRunStepAssetRecord,
  type WorkflowRunStepAssetInput,
  type WorkflowAssetSnapshotRecord,
  type WorkflowAssetPartitionSummary,
  type WorkflowExecutionHistoryRecord,
  type WorkflowExecutionHistoryEventInput,
  type WorkflowAssetStalePartitionRecord,
  type WorkflowAssetPartitionParametersRecord
} from './types';
import {
  mapWorkflowDefinitionRow,
  mapWorkflowRunRow,
  mapWorkflowRunStepRow,
  mapWorkflowAssetDeclarationRow,
  mapWorkflowRunStepAssetRow,
  mapWorkflowAssetSnapshotRow,
  mapWorkflowExecutionHistoryRow,
  mapWorkflowAssetStalePartitionRow,
  mapWorkflowAssetPartitionParametersRow
} from './rowMappers';
import type {
  WorkflowDefinitionRow,
  WorkflowRunRow,
  WorkflowRunStepRow,
  WorkflowAssetDeclarationRow,
  WorkflowRunStepAssetRow,
  WorkflowAssetSnapshotRow,
  WorkflowExecutionHistoryRow,
  WorkflowAssetStalePartitionRow,
  WorkflowAssetPartitionParametersRow
} from './rowTypes';
import { useConnection, useTransaction } from './utils';

type AnalyticsTimeRange = {
  from: Date;
  to: Date;
};

type WorkflowRunStatusCounts = Record<string, number>;

export type WorkflowRunStats = {
  workflowId: string;
  slug: string;
  range: AnalyticsTimeRange;
  totalRuns: number;
  statusCounts: WorkflowRunStatusCounts;
  successRate: number;
  failureRate: number;
  averageDurationMs: number | null;
  failureCategories: { category: string; count: number }[];
};

export type WorkflowRunMetricsPoint = {
  bucketStart: string;
  bucketEnd: string;
  totalRuns: number;
  statusCounts: WorkflowRunStatusCounts;
  averageDurationMs: number | null;
  rollingSuccessCount: number;
};

export type WorkflowRunMetrics = {
  workflowId: string;
  slug: string;
  range: AnalyticsTimeRange;
  bucketInterval: string;
  series: WorkflowRunMetricsPoint[];
};

type AnalyticsOptions = {
  from?: Date;
  to?: Date;
};

type MetricsOptions = AnalyticsOptions & {
  bucketInterval?: string;
};

type AssetDeclarationRowInput = {
  stepId: string;
  direction: WorkflowAssetDirection;
  asset: WorkflowAssetDeclaration;
};

function normalizePartitionKeyValue(
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

function normalizeTimeRange({ from, to }: AnalyticsOptions): AnalyticsTimeRange {
  const resolvedTo = to ?? new Date();
  const resolvedFrom = from ?? new Date(resolvedTo.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (resolvedFrom.getTime() >= resolvedTo.getTime()) {
    return {
      from: new Date(resolvedTo.getTime() - 60 * 60 * 1000),
      to: resolvedTo
    } satisfies AnalyticsTimeRange;
  }
  return { from: resolvedFrom, to: resolvedTo } satisfies AnalyticsTimeRange;
}

function resolveBucketInterval(range: AnalyticsTimeRange, bucketInterval?: string): string {
  if (bucketInterval) {
    return bucketInterval;
  }
  const durationMs = range.to.getTime() - range.from.getTime();
  const hourMs = 60 * 60 * 1000;
  if (durationMs <= 24 * hourMs) {
    return '15 minutes';
  }
  if (durationMs <= 7 * 24 * hourMs) {
    return '1 hour';
  }
  return '1 day';
}

function normalizeStepRetryCount(
  value: number | null | undefined,
  fallback: number,
  attempt: number
): number {
  const baseline = Math.max(0, Math.floor(attempt) - 1, Math.floor(fallback));
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    return baseline;
  }
  return Math.floor(value);
}

function resolveStepFailureReason(
  status: WorkflowRunStepStatus,
  provided: string | null | undefined,
  existing: string | null
): string | null {
  if (provided !== undefined) {
    return provided ?? null;
  }
  switch (status) {
    case 'succeeded':
      return null;
    case 'failed':
      return existing ?? 'error';
    case 'skipped':
      return existing ?? 'skipped';
    case 'running':
    case 'pending':
    default:
      return existing ?? null;
  }
}

const MANUAL_TRIGGER: WorkflowTriggerDefinition = { type: 'manual' };

type ScheduleMetadataState = {
  scheduleNextRunAt: string | null;
  scheduleCatchupCursor: string | null;
  scheduleLastWindow: WorkflowScheduleWindow | null;
};

function parseScheduleDate(value?: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function findScheduleTrigger(triggers: WorkflowTriggerDefinition[]): WorkflowTriggerDefinition | null {
  for (const trigger of triggers) {
    if (trigger.type && trigger.type.toLowerCase() === 'schedule' && trigger.schedule) {
      return trigger;
    }
  }
  return null;
}

function computeNextScheduleOccurrence(
  schedule: WorkflowTriggerDefinition['schedule'],
  from: Date,
  { inclusive = false }: { inclusive?: boolean } = {}
): Date | null {
  if (!schedule) {
    return null;
  }

  const options: ParserOptions = {};
  if (schedule.timezone) {
    options.tz = schedule.timezone;
  }

  const startWindow = parseScheduleDate(schedule.startWindow);
  const endWindow = parseScheduleDate(schedule.endWindow);

  if (endWindow && from.getTime() > endWindow.getTime()) {
    return null;
  }

  let reference = from;
  if (startWindow && reference.getTime() < startWindow.getTime()) {
    reference = startWindow;
  }

  const currentDate = inclusive ? new Date(reference.getTime() - 1) : reference;

  try {
    const interval = parseExpression(schedule.cron, {
      ...options,
      currentDate
    });
    const next = interval.next().toDate();
    if (endWindow && next.getTime() > endWindow.getTime()) {
      return null;
    }
    return next;
  } catch {
    return null;
  }
}

function computeInitialScheduleMetadata(
  triggers: WorkflowTriggerDefinition[],
  { now = new Date() }: { now?: Date } = {}
): ScheduleMetadataState {
  const scheduleTrigger = findScheduleTrigger(triggers);
  if (!scheduleTrigger || !scheduleTrigger.schedule) {
    return {
      scheduleNextRunAt: null,
      scheduleCatchupCursor: null,
      scheduleLastWindow: null
    } satisfies ScheduleMetadataState;
  }

  const nextOccurrence = computeNextScheduleOccurrence(scheduleTrigger.schedule, now, { inclusive: true });
  if (!nextOccurrence) {
    return {
      scheduleNextRunAt: null,
      scheduleCatchupCursor: null,
      scheduleLastWindow: null
    } satisfies ScheduleMetadataState;
  }

  const nextIso = nextOccurrence.toISOString();
  return {
    scheduleNextRunAt: nextIso,
    scheduleCatchupCursor: nextIso,
    scheduleLastWindow: null
  } satisfies ScheduleMetadataState;
}

function serializeScheduleWindow(window: WorkflowScheduleWindow | null | undefined): string | null {
  if (!window) {
    return null;
  }
  const payload: WorkflowScheduleWindow = {
    start: window.start ?? null,
    end: window.end ?? null
  };
  if (!payload.start && !payload.end) {
    return null;
  }
  return JSON.stringify(payload);
}

function serializeJson(value: JsonValue | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value);
}

function reuseJsonColumn(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function normalizeWorkflowRunStatus(status?: WorkflowRunStatus | null): WorkflowRunStatus {
  if (!status) {
    return 'pending';
  }
  if (status === 'running' || status === 'succeeded' || status === 'failed' || status === 'canceled') {
    return status;
  }
  return 'pending';
}

type WorkflowContextState = {
  steps: Record<string, Record<string, JsonValue | null>>;
  shared: Record<string, JsonValue | null>;
  lastUpdatedAt?: string;
};

function parseWorkflowContext(value: unknown): WorkflowContextState {
  const context: WorkflowContextState = {
    steps: {},
    shared: {}
  };

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const stepsValue = record.steps;
    if (stepsValue && typeof stepsValue === 'object' && !Array.isArray(stepsValue)) {
      for (const [stepId, stepRaw] of Object.entries(stepsValue)) {
        if (!stepRaw || typeof stepRaw !== 'object' || Array.isArray(stepRaw)) {
          continue;
        }
        const stepRecord: Record<string, JsonValue | null> = {};
        for (const [key, entry] of Object.entries(stepRaw as Record<string, unknown>)) {
          stepRecord[key] = (entry ?? null) as JsonValue | null;
        }
        context.steps[stepId] = stepRecord;
      }
    }

    const sharedValue = record.shared;
    if (sharedValue && typeof sharedValue === 'object' && !Array.isArray(sharedValue)) {
      for (const [key, entry] of Object.entries(sharedValue as Record<string, unknown>)) {
        context.shared[key] = (entry ?? null) as JsonValue | null;
      }
    }

    if (typeof record.lastUpdatedAt === 'string') {
      context.lastUpdatedAt = record.lastUpdatedAt;
    }
  }

  return context;
}

function serializeWorkflowContext(context: WorkflowContextState): JsonValue {
  const payload: Record<string, JsonValue> = {
    steps: context.steps as unknown as JsonValue,
    lastUpdatedAt: (context.lastUpdatedAt ?? new Date().toISOString()) as unknown as JsonValue
  };
  if (Object.keys(context.shared).length > 0) {
    payload.shared = context.shared as unknown as JsonValue;
  }
  return payload as unknown as JsonValue;
}

function applyWorkflowContextPatch(
  base: WorkflowContextState,
  patch: NonNullable<WorkflowRunUpdateInput['contextPatch']>
): WorkflowContextState {
  const next: WorkflowContextState = {
    steps: { ...base.steps },
    shared: { ...base.shared },
    lastUpdatedAt: patch.lastUpdatedAt ?? new Date().toISOString()
  };

  if (patch.steps) {
    for (const [stepId, stepPatch] of Object.entries(patch.steps)) {
      const existing = next.steps[stepId] ?? {};
      next.steps[stepId] = {
        ...existing,
        ...stepPatch
      };
    }
  }

  if (patch.shared) {
    for (const [key, value] of Object.entries(patch.shared)) {
      if (value === undefined) {
        continue;
      }
      next.shared[key] = (value ?? null) as JsonValue | null;
    }
  }

  return next;
}

function emitWorkflowDefinitionEvent(definition: WorkflowDefinitionRecord | null) {
  if (!definition) {
    return;
  }
  emitApphubEvent({ type: 'workflow.definition.updated', data: { workflow: definition } });
}

function emitWorkflowRunEvents(run: WorkflowRunRecord | null, { forceUpdatedEvent = true } = {}) {
  if (!run) {
    return;
  }
  if (forceUpdatedEvent) {
    emitApphubEvent({ type: 'workflow.run.updated', data: { run } });
  }
  const statusEvent = `workflow.run.${run.status}` as const;
  emitApphubEvent({ type: statusEvent, data: { run } });
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

async function replaceWorkflowAssetDeclarations(
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

async function fetchWorkflowRunStepAssets(
  client: PoolClient,
  runStepIds: string[]
): Promise<Map<string, WorkflowRunStepAssetRecord[]>> {
  if (runStepIds.length === 0) {
    return new Map();
  }

  const { rows } = await client.query<WorkflowRunStepAssetRow>(
    `SELECT *
       FROM workflow_run_step_assets
       WHERE workflow_run_step_id = ANY($1::text[])
       ORDER BY produced_at DESC`,
    [runStepIds]
  );

  const assetsByStepId = new Map<string, WorkflowRunStepAssetRecord[]>();
  for (const row of rows) {
    const record = mapWorkflowRunStepAssetRow(row);
    const existing = assetsByStepId.get(row.workflow_run_step_id);
    if (existing) {
      existing.push(record);
    } else {
      assetsByStepId.set(row.workflow_run_step_id, [record]);
    }
  }
  return assetsByStepId;
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

async function upsertWorkflowAssetPartitionParameters(
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

async function fetchWorkflowDefinitionById(
  client: PoolClient,
  id: string
): Promise<WorkflowDefinitionRecord | null> {
  const { rows } = await client.query<WorkflowDefinitionRow>(
    'SELECT * FROM workflow_definitions WHERE id = $1',
    [id]
  );
  if (rows.length === 0) {
    return null;
  }
  return mapWorkflowDefinitionRow(rows[0]);
}

async function fetchWorkflowDefinitionBySlug(
  client: PoolClient,
  slug: string
): Promise<WorkflowDefinitionRecord | null> {
  const { rows } = await client.query<WorkflowDefinitionRow>(
    'SELECT * FROM workflow_definitions WHERE slug = $1',
    [slug]
  );
  if (rows.length === 0) {
    return null;
  }
  return mapWorkflowDefinitionRow(rows[0]);
}

async function fetchWorkflowRunById(
  client: PoolClient,
  id: string
): Promise<WorkflowRunRecord | null> {
  const { rows } = await client.query<WorkflowRunRow>('SELECT * FROM workflow_runs WHERE id = $1', [id]);
  if (rows.length === 0) {
    return null;
  }
  return mapWorkflowRunRow(rows[0]);
}

export async function listWorkflowDefinitions(): Promise<WorkflowDefinitionRecord[]> {
  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowDefinitionRow>(
      'SELECT * FROM workflow_definitions ORDER BY slug ASC'
    );
    return rows.map(mapWorkflowDefinitionRow);
  });
}

export async function getWorkflowDefinitionBySlug(slug: string): Promise<WorkflowDefinitionRecord | null> {
  return useConnection((client) => fetchWorkflowDefinitionBySlug(client, slug));
}

export async function getWorkflowDefinitionById(id: string): Promise<WorkflowDefinitionRecord | null> {
  return useConnection((client) => fetchWorkflowDefinitionById(client, id));
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

export async function createWorkflowDefinition(
  input: WorkflowDefinitionCreateInput
): Promise<WorkflowDefinitionRecord> {
  const id = randomUUID();
  const version = input.version ?? 1;
  const description = input.description ?? null;
  const steps = Array.isArray(input.steps) ? input.steps : [];
  const triggers = Array.isArray(input.triggers) && input.triggers.length > 0 ? input.triggers : [MANUAL_TRIGGER];
  const parametersSchema = input.parametersSchema ?? {};
  const defaultParameters = input.defaultParameters ?? {};
  const outputSchema = input.outputSchema ?? {};
  const metadata = input.metadata ?? {};
  const dag: WorkflowDagMetadata = input.dag ?? {
    adjacency: {},
    roots: [],
    topologicalOrder: [],
    edges: 0
  };

  const stepsJson = JSON.stringify(steps);
  const triggersJson = JSON.stringify(triggers);
  const parametersSchemaJson = JSON.stringify(parametersSchema);
  const defaultParametersJson = JSON.stringify(defaultParameters);
  const outputSchemaJson = JSON.stringify(outputSchema);
  const metadataJson = JSON.stringify(metadata);
  const dagJson = JSON.stringify(dag);

  const scheduleMetadata = computeInitialScheduleMetadata(triggers);
  const scheduleNextRunAt = scheduleMetadata.scheduleNextRunAt;
  const scheduleLastWindowJson = serializeScheduleWindow(scheduleMetadata.scheduleLastWindow);
  const scheduleCatchupCursor = scheduleMetadata.scheduleCatchupCursor;

  let definition: WorkflowDefinitionRecord | null = null;

  await useTransaction(async (client) => {
    try {
      const { rows } = await client.query<WorkflowDefinitionRow>(
        `INSERT INTO workflow_definitions (
           id,
           slug,
           name,
           version,
           description,
           steps,
           triggers,
           parameters_schema,
           default_parameters,
           output_schema,
           metadata,
           dag,
           schedule_next_run_at,
           schedule_last_materialized_window,
           schedule_catchup_cursor,
           created_at,
           updated_at
         ) VALUES (
           $1,
           $2,
           $3,
           $4,
           $5,
           $6::jsonb,
           $7::jsonb,
           $8::jsonb,
           $9::jsonb,
           $10::jsonb,
           $11::jsonb,
           $12::jsonb,
           $13,
           $14::jsonb,
           $15,
           NOW(),
           NOW()
         )
         RETURNING *`,
        [
          id,
          input.slug,
          input.name,
          version,
          description,
          stepsJson,
          triggersJson,
          parametersSchemaJson,
          defaultParametersJson,
          outputSchemaJson,
          metadataJson,
          dagJson,
          scheduleNextRunAt,
          scheduleLastWindowJson,
          scheduleCatchupCursor
        ]
      );
      if (rows.length === 0) {
        throw new Error('failed to insert workflow definition');
      }
      definition = mapWorkflowDefinitionRow(rows[0]);

      await replaceWorkflowAssetDeclarations(client, id, steps);
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code?: string }).code === '23505') {
        throw new Error(`Workflow definition with slug "${input.slug}" already exists`);
      }
      throw err;
    }
  });

  if (!definition) {
    throw new Error('failed to create workflow definition');
  }

  emitWorkflowDefinitionEvent(definition);
  return definition;
}

export async function updateWorkflowDefinition(
  slug: string,
  updates: WorkflowDefinitionUpdateInput
): Promise<WorkflowDefinitionRecord | null> {
  let definition: WorkflowDefinitionRecord | null = null;

  await useTransaction(async (client) => {
    const existing = await fetchWorkflowDefinitionBySlug(client, slug);
    if (!existing) {
      return;
    }

    const hasDescription = Object.prototype.hasOwnProperty.call(updates, 'description');
    const hasTriggers = Object.prototype.hasOwnProperty.call(updates, 'triggers');
    const hasDefaultParameters = Object.prototype.hasOwnProperty.call(updates, 'defaultParameters');
    const hasOutputSchema = Object.prototype.hasOwnProperty.call(updates, 'outputSchema');
    const hasMetadata = Object.prototype.hasOwnProperty.call(updates, 'metadata');
    const hasDag = Object.prototype.hasOwnProperty.call(updates, 'dag');

    const nextSteps = updates.steps ?? existing.steps;
    const triggerCandidates = hasTriggers ? updates.triggers ?? [] : existing.triggers;
    const nextTriggers = hasTriggers
      ? triggerCandidates.length > 0
        ? triggerCandidates
        : [MANUAL_TRIGGER]
      : triggerCandidates;
    const nextParametersSchema = updates.parametersSchema ?? existing.parametersSchema;
    const nextDefaultParameters = hasDefaultParameters
      ? updates.defaultParameters ?? null
      : existing.defaultParameters;
    const nextOutputSchema = hasOutputSchema ? updates.outputSchema ?? {} : existing.outputSchema;
    const nextMetadata = hasMetadata ? updates.metadata ?? null : existing.metadata;
    const nextDescription = hasDescription ? updates.description ?? null : existing.description;
    const nextDag = hasDag ? updates.dag ?? existing.dag : existing.dag;

    const stepsJson = JSON.stringify(nextSteps);
    const triggersJson = JSON.stringify(nextTriggers);
    const parametersSchemaJson = JSON.stringify(nextParametersSchema ?? {});
    const defaultParametersJson = JSON.stringify(nextDefaultParameters ?? null);
    const outputSchemaJson = JSON.stringify(nextOutputSchema ?? {});
    const metadataJson = JSON.stringify(nextMetadata ?? null);
    const dagJson = JSON.stringify(nextDag ?? {
      adjacency: {},
      roots: [],
      topologicalOrder: [],
      edges: 0
    });

    const nextScheduleState = hasTriggers
      ? computeInitialScheduleMetadata(nextTriggers)
      : {
          scheduleNextRunAt: existing.scheduleNextRunAt,
          scheduleCatchupCursor: existing.scheduleCatchupCursor,
          scheduleLastWindow: existing.scheduleLastMaterializedWindow
        } satisfies ScheduleMetadataState;

    const scheduleNextRunAt = nextScheduleState.scheduleNextRunAt;
    const scheduleCatchupCursor = nextScheduleState.scheduleCatchupCursor;
    const scheduleLastWindowJson = serializeScheduleWindow(nextScheduleState.scheduleLastWindow);

    const { rows } = await client.query<WorkflowDefinitionRow>(
      `UPDATE workflow_definitions
       SET name = $2,
           version = $3,
           description = $4,
           steps = $5::jsonb,
           triggers = $6::jsonb,
           parameters_schema = $7::jsonb,
           default_parameters = $8::jsonb,
           output_schema = $9::jsonb,
           metadata = $10::jsonb,
           dag = $11::jsonb,
           schedule_next_run_at = $12,
           schedule_last_materialized_window = $13::jsonb,
           schedule_catchup_cursor = $14,
           updated_at = NOW()
       WHERE slug = $1
       RETURNING *`,
      [
        slug,
        updates.name ?? existing.name,
        updates.version ?? existing.version,
        nextDescription,
        stepsJson,
        triggersJson,
        parametersSchemaJson,
        defaultParametersJson,
        outputSchemaJson,
        metadataJson,
        dagJson,
        scheduleNextRunAt,
       scheduleLastWindowJson,
       scheduleCatchupCursor
      ]
    );
    if (rows.length === 0) {
      return;
    }

    await replaceWorkflowAssetDeclarations(client, existing.id, nextSteps);

    definition = mapWorkflowDefinitionRow(rows[0]);
  });

  if (definition) {
    emitWorkflowDefinitionEvent(definition);
  }

  return definition;
}

export async function listDueWorkflowSchedules({
  limit = 10,
  now = new Date()
}: {
  limit?: number;
  now?: Date;
} = {}): Promise<WorkflowDefinitionRecord[]> {
  const boundedLimit = Math.min(Math.max(limit, 1), 100);
  const cutoff = now.toISOString();

  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowDefinitionRow>(
      `SELECT *
       FROM workflow_definitions
       WHERE schedule_next_run_at IS NOT NULL
         AND schedule_next_run_at <= $1
       ORDER BY schedule_next_run_at ASC
       LIMIT $2`,
      [cutoff, boundedLimit]
    );
    return rows.map(mapWorkflowDefinitionRow);
  });
}

export async function updateWorkflowScheduleMetadata(
  workflowDefinitionId: string,
  updates: WorkflowScheduleMetadataUpdateInput
): Promise<WorkflowDefinitionRecord | null> {
  let definition: WorkflowDefinitionRecord | null = null;

  await useTransaction(async (client) => {
    const existing = await fetchWorkflowDefinitionById(client, workflowDefinitionId);
    if (!existing) {
      return;
    }

    const hasNextRun = Object.prototype.hasOwnProperty.call(updates, 'scheduleNextRunAt');
    const hasLastWindow = Object.prototype.hasOwnProperty.call(updates, 'scheduleLastMaterializedWindow');
    const hasCatchupCursor = Object.prototype.hasOwnProperty.call(updates, 'scheduleCatchupCursor');

    const sets: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    if (hasNextRun) {
      sets.push(`schedule_next_run_at = $${index}`);
      values.push(updates.scheduleNextRunAt ?? null);
      index += 1;
    }

    if (hasLastWindow) {
      sets.push(`schedule_last_materialized_window = $${index}::jsonb`);
      values.push(serializeScheduleWindow(updates.scheduleLastMaterializedWindow ?? null));
      index += 1;
    }

    if (hasCatchupCursor) {
      sets.push(`schedule_catchup_cursor = $${index}`);
      values.push(updates.scheduleCatchupCursor ?? null);
      index += 1;
    }

    if (sets.length === 0) {
      definition = existing;
      return;
    }

    sets.push(`updated_at = NOW()`);
    values.push(workflowDefinitionId);

    const { rows } = await client.query<WorkflowDefinitionRow>(
      `UPDATE workflow_definitions
       SET ${sets.join(', ')}
       WHERE id = $${index}
       RETURNING *`,
      values
    );

    if (rows.length === 0) {
      return;
    }

    definition = mapWorkflowDefinitionRow(rows[0]);
  });

  if (definition) {
    emitWorkflowDefinitionEvent(definition);
  }

  return definition;
}

export async function createWorkflowRun(
  workflowDefinitionId: string,
  input: WorkflowRunCreateInput = {}
): Promise<WorkflowRunRecord> {
  const id = randomUUID();
  const status = normalizeWorkflowRunStatus(input.status);
  const parameters = input.parameters ?? {};
  const context = input.context ?? {};
  const currentStepId = input.currentStepId ?? null;
  const currentStepIndex = input.currentStepIndex ?? null;
  const triggeredBy = input.triggeredBy ?? null;
  const trigger = input.trigger ?? MANUAL_TRIGGER;
  const partitionKey =
    typeof input.partitionKey === 'string' && input.partitionKey.trim().length > 0
      ? input.partitionKey.trim()
      : null;

  let run: WorkflowRunRecord | null = null;

  await useTransaction(async (client) => {
    const { rows } = await client.query<WorkflowRunRow>(
      `INSERT INTO workflow_runs (
         id,
         workflow_definition_id,
         status,
         parameters,
         context,
         error_message,
         current_step_id,
         current_step_index,
         metrics,
         triggered_by,
         trigger,
         partition_key,
         started_at,
         completed_at,
         duration_ms,
         created_at,
         updated_at
       ) VALUES (
         $1,
         $2,
         $3,
         $4::jsonb,
         $5::jsonb,
         NULL,
         $6,
         $7,
         NULL,
         $8,
         $9::jsonb,
         $10,
         NULL,
         NULL,
         NULL,
         NOW(),
         NOW()
       )
       RETURNING *`,
      [
        id,
        workflowDefinitionId,
        status,
        parameters,
        context,
        currentStepId,
        currentStepIndex,
        triggeredBy,
        trigger,
        partitionKey
      ]
    );
    if (rows.length === 0) {
      throw new Error('failed to insert workflow run');
    }
    run = mapWorkflowRunRow(rows[0]);
  });

  if (!run) {
    throw new Error('failed to create workflow run');
  }

  emitWorkflowRunEvents(run);
  return run;
}

export async function getWorkflowRunById(id: string): Promise<WorkflowRunRecord | null> {
  return useConnection((client) => fetchWorkflowRunById(client, id));
}

export async function listWorkflowRunsForDefinition(
  workflowDefinitionId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<WorkflowRunRecord[]> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const offset = Math.max(options.offset ?? 0, 0);

  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowRunRow>(
      `SELECT *
       FROM workflow_runs
       WHERE workflow_definition_id = $1
       ORDER BY created_at DESC
       LIMIT $2
       OFFSET $3`,
      [workflowDefinitionId, limit, offset]
    );
    return rows.map(mapWorkflowRunRow);
  });
}

type WorkflowRunWithDefinitionRow = WorkflowRunRow & {
  workflow_slug: string;
  workflow_name: string;
  workflow_version: number;
};

export async function listWorkflowRuns(
  options: { limit?: number; offset?: number } = {}
): Promise<{ items: WorkflowRunWithDefinition[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const offset = Math.max(options.offset ?? 0, 0);
  const queryLimit = limit + 1;

  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowRunWithDefinitionRow>(
      `SELECT wr.*, wd.slug AS workflow_slug, wd.name AS workflow_name, wd.version AS workflow_version
       FROM workflow_runs wr
       INNER JOIN workflow_definitions wd ON wd.id = wr.workflow_definition_id
       ORDER BY wr.created_at DESC
       LIMIT $1 OFFSET $2`,
      [queryLimit, offset]
    );

    const mapped = rows.map((row) => ({
      run: mapWorkflowRunRow(row),
      workflow: {
        id: row.workflow_definition_id,
        slug: row.workflow_slug,
        name: row.workflow_name,
        version: row.workflow_version
      }
    } satisfies WorkflowRunWithDefinition));

    const hasMore = mapped.length > limit;
    const items = hasMore ? mapped.slice(0, limit) : mapped;
    return { items, hasMore };
  });
}

export async function updateWorkflowRun(
  runId: string,
  updates: WorkflowRunUpdateInput
): Promise<WorkflowRunRecord | null> {
  let updated: WorkflowRunRecord | null = null;
  let emitEvents = false;

  await useTransaction(async (client) => {
    const { rows } = await client.query<WorkflowRunRow>(
      'SELECT * FROM workflow_runs WHERE id = $1 FOR UPDATE',
      [runId]
    );
    if (rows.length === 0) {
      return;
    }
    const existing = rows[0];

    const nextStatus = normalizeWorkflowRunStatus(updates.status ?? (existing.status as WorkflowRunStatus));
    const nextParameters = updates.parameters ?? existing.parameters ?? {};

    const existingContextRaw = (existing.context ?? {}) as JsonValue;
    let contextChanged = false;
    let nextContext: JsonValue;
    if (updates.contextPatch) {
      const merged = applyWorkflowContextPatch(parseWorkflowContext(existingContextRaw), updates.contextPatch);
      nextContext = serializeWorkflowContext(merged);
      contextChanged = true;
    } else if (updates.context !== undefined) {
      nextContext = (updates.context ?? {}) as JsonValue;
      contextChanged = JSON.stringify(existingContextRaw ?? {}) !== JSON.stringify(nextContext ?? {});
    } else {
      nextContext = existingContextRaw;
    }
    const nextErrorMessage = 'errorMessage' in updates ? updates.errorMessage ?? null : existing.error_message;
    const nextCurrentStepId = updates.currentStepId ?? existing.current_step_id ?? null;
    const nextCurrentStepIndex =
      updates.currentStepIndex !== undefined ? updates.currentStepIndex : existing.current_step_index ?? null;
    const nextMetrics = updates.metrics ?? existing.metrics ?? null;
    const nextTriggeredBy = updates.triggeredBy ?? existing.triggered_by ?? null;
    const nextTrigger = updates.trigger ?? existing.trigger ?? MANUAL_TRIGGER;
    const nextStartedAt = updates.startedAt ?? existing.started_at ?? null;
    const nextCompletedAt = updates.completedAt ?? existing.completed_at ?? null;
    const nextDurationMs =
      updates.durationMs !== undefined ? updates.durationMs : existing.duration_ms ?? null;
    const nextOutput = updates.output !== undefined ? updates.output ?? null : existing.output ?? null;
    let nextPartitionKey = existing.partition_key ?? null;
    if (Object.prototype.hasOwnProperty.call(updates, 'partitionKey')) {
      const rawPartition = updates.partitionKey;
      if (typeof rawPartition === 'string' && rawPartition.trim().length > 0) {
        nextPartitionKey = rawPartition.trim();
      } else {
        nextPartitionKey = null;
      }
    }

    const { rows: updatedRows } = await client.query<WorkflowRunRow>(
      `UPDATE workflow_runs
       SET status = $2,
           parameters = $3::jsonb,
           context = $4::jsonb,
           output = $5::jsonb,
           error_message = $6,
           current_step_id = $7,
           current_step_index = $8,
           metrics = $9::jsonb,
           triggered_by = $10,
           trigger = $11::jsonb,
           partition_key = $12,
           started_at = $13,
           completed_at = $14,
           duration_ms = $15,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        runId,
        nextStatus,
        nextParameters,
        nextContext,
        nextOutput,
        nextErrorMessage,
        nextCurrentStepId,
        nextCurrentStepIndex,
        nextMetrics,
        nextTriggeredBy,
        nextTrigger,
        nextPartitionKey,
        nextStartedAt,
        nextCompletedAt,
        nextDurationMs
      ]
    );
    if (updatedRows.length === 0) {
      return;
    }
    updated = mapWorkflowRunRow(updatedRows[0]);
    emitEvents =
      updated.status !== existing.status ||
      contextChanged ||
      JSON.stringify(existing.parameters ?? {}) !== JSON.stringify(updated.parameters ?? {}) ||
      JSON.stringify(existing.metrics ?? {}) !== JSON.stringify(updated.metrics ?? {}) ||
      existing.current_step_id !== updated.currentStepId ||
      existing.current_step_index !== updated.currentStepIndex ||
      existing.partition_key !== updated.partitionKey ||
      existing.error_message !== updated.errorMessage ||
      JSON.stringify(existing.output ?? null) !== JSON.stringify(updated.output ?? null);
  });

  if (updated && emitEvents) {
    emitWorkflowRunEvents(updated, { forceUpdatedEvent: true });
  }

  return updated;
}

export async function createWorkflowRunStep(
  workflowRunId: string,
  input: WorkflowRunStepCreateInput
): Promise<WorkflowRunStepRecord> {
  const id = randomUUID();
  const status = input.status ?? 'pending';
  const attempt = input.attempt ?? 1;
  const retryCount = normalizeStepRetryCount(input.retryCount, Math.max(attempt - 1, 0), attempt);
  const lastHeartbeatAt = input.lastHeartbeatAt ?? input.startedAt ?? null;
  const failureReason = resolveStepFailureReason(status, input.failureReason, null);

  let step: WorkflowRunStepRecord | null = null;

  await useTransaction(async (client) => {
    const { rows } = await client.query<WorkflowRunStepRow>(
      `INSERT INTO workflow_run_steps (
         id,
         workflow_run_id,
         step_id,
         status,
         attempt,
         job_run_id,
         input,
         output,
         error_message,
         logs_url,
         metrics,
         context,
         started_at,
         completed_at,
         parent_step_id,
         fanout_index,
         template_step_id,
         last_heartbeat_at,
         retry_count,
         failure_reason,
         created_at,
         updated_at
       ) VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7::jsonb,
         $8::jsonb,
         $9,
         $10,
         $11::jsonb,
         $12::jsonb,
       $13,
       $14,
       $15,
       $16,
        $17,
        $18,
        $19,
        $20,
        NOW(),
        NOW()
      )
      RETURNING *`,
      [
        id,
        workflowRunId,
        input.stepId,
        status,
        attempt,
        input.jobRunId ?? null,
        serializeJson(input.input),
        serializeJson(input.output),
        input.errorMessage ?? null,
        input.logsUrl ?? null,
        serializeJson(input.metrics),
        serializeJson(input.context),
        input.startedAt ?? null,
        input.completedAt ?? null,
        input.parentStepId ?? null,
        input.fanoutIndex ?? null,
        input.templateStepId ?? null,
        lastHeartbeatAt,
        retryCount,
        failureReason
      ]
    );
    if (rows.length === 0) {
      throw new Error('failed to insert workflow run step');
    }
    step = mapWorkflowRunStepRow(rows[0]);
  });

  if (!step) {
    throw new Error('failed to create workflow run step');
  }
  return step;
}

export async function listWorkflowRunSteps(
  workflowRunId: string
): Promise<WorkflowRunStepRecord[]> {
  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowRunStepRow>(
      `SELECT *
       FROM workflow_run_steps
       WHERE workflow_run_id = $1
       ORDER BY created_at ASC`,
      [workflowRunId]
    );
    const assets = await fetchWorkflowRunStepAssets(
      client,
      rows.map((row) => row.id)
    );
    return rows.map((row) => mapWorkflowRunStepRow(row, assets.get(row.id) ?? []));
  });
}

export async function getWorkflowRunStepById(stepId: string): Promise<WorkflowRunStepRecord | null> {
  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowRunStepRow>(
      'SELECT * FROM workflow_run_steps WHERE id = $1',
      [stepId]
    );
    if (rows.length === 0) {
      return null;
    }
    const assets = await fetchWorkflowRunStepAssets(client, [stepId]);
    return mapWorkflowRunStepRow(rows[0], assets.get(stepId) ?? []);
  });
}

export async function getWorkflowRunStep(
  workflowRunId: string,
  stepId: string
): Promise<WorkflowRunStepRecord | null> {
  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowRunStepRow>(
      'SELECT * FROM workflow_run_steps WHERE workflow_run_id = $1 AND step_id = $2 ORDER BY created_at DESC LIMIT 1',
      [workflowRunId, stepId]
    );
    if (rows.length === 0) {
      return null;
    }
    const assets = await fetchWorkflowRunStepAssets(client, [rows[0].id]);
    return mapWorkflowRunStepRow(rows[0], assets.get(rows[0].id) ?? []);
  });
}

export async function recordWorkflowRunStepAssets(
  workflowDefinitionId: string,
  workflowRunId: string,
  workflowRunStepId: string,
  stepId: string,
  assets: WorkflowRunStepAssetInput[]
): Promise<WorkflowRunStepAssetRecord[]> {
  return useTransaction(async (client) => {
    await client.query('DELETE FROM workflow_run_step_assets WHERE workflow_run_step_id = $1', [
      workflowRunStepId
    ]);

    if (assets.length === 0) {
      return [];
    }

    const now = new Date().toISOString();
    const values: string[] = [];
    const params: unknown[] = [];
    let index = 1;

    for (const asset of assets) {
      const id = randomUUID();
      const producedAt = asset.producedAt ?? now;
      values.push(
        `($${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++})`
      );
      params.push(
        id,
        workflowDefinitionId,
        workflowRunId,
        workflowRunStepId,
        stepId,
        asset.assetId,
        asset.payload ?? null,
        asset.schema ?? null,
        asset.freshness ?? null,
        asset.partitionKey ?? null,
        producedAt
      );
    }

    const { rows } = await client.query<WorkflowRunStepAssetRow>(
      `INSERT INTO workflow_run_step_assets (
         id,
         workflow_definition_id,
         workflow_run_id,
         workflow_run_step_id,
         step_id,
         asset_id,
         payload,
         asset_schema,
         freshness,
         partition_key,
         produced_at
       )
       VALUES ${values.join(', ')}
      RETURNING *`,
      params
    );

    const runRecord = await fetchWorkflowRunById(client, workflowRunId);
    if (runRecord) {
      const seenPartitions = new Set<string>();
      for (const row of rows) {
        const partitionKey = row.partition_key ?? runRecord.partitionKey ?? null;
        const { normalized } = normalizePartitionKeyValue(partitionKey);
        if (seenPartitions.has(normalized)) {
          continue;
        }
        seenPartitions.add(normalized);
        await upsertWorkflowAssetPartitionParameters(client, {
          workflowDefinitionId,
          assetId: row.asset_id,
          partitionKey,
          parameters: runRecord.parameters,
          source: 'workflow-run'
        });
      }
    }

    return rows.map(mapWorkflowRunStepAssetRow);
  });
}

export type WorkflowStaleStepRef = {
  workflowRunId: string;
  workflowRunStepId: string;
};

export async function findStaleWorkflowRunSteps(
  cutoffIso: string,
  limit = 50
): Promise<WorkflowStaleStepRef[]> {
  const targetLimit = Math.max(1, Math.min(limit, 200));
  return useConnection(async (client) => {
    const { rows } = await client.query<{
      workflow_run_id: string;
      workflow_run_step_id: string;
    }>(
      `SELECT wrs.workflow_run_id, wrs.id AS workflow_run_step_id
       FROM workflow_run_steps wrs
       JOIN workflow_runs wr ON wr.id = wrs.workflow_run_id
       WHERE wrs.status = 'running'
         AND wr.status = 'running'
         AND (
           (wrs.last_heartbeat_at IS NOT NULL AND wrs.last_heartbeat_at < $1)
           OR (wrs.last_heartbeat_at IS NULL AND (wrs.started_at IS NULL OR wrs.started_at < $1))
         )
       ORDER BY wrs.updated_at ASC
       LIMIT $2`,
      [cutoffIso, targetLimit]
    );
    return rows.map((row) => ({
      workflowRunId: row.workflow_run_id,
      workflowRunStepId: row.workflow_run_step_id
    }));
  });
}

export async function appendWorkflowExecutionHistory(
  input: WorkflowExecutionHistoryEventInput
): Promise<WorkflowExecutionHistoryRecord> {
  const normalizedPayload =
    input.eventPayload === undefined ? ({} as JsonValue) : (input.eventPayload as JsonValue);
  const serializedPayload =
    normalizedPayload === null ? 'null' : serializeJson(normalizedPayload) ?? '{}';

  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowExecutionHistoryRow>(
      `INSERT INTO workflow_execution_history (
         workflow_run_id,
         workflow_run_step_id,
         step_id,
         event_type,
         event_payload
       ) VALUES (
         $1,
         $2,
         $3,
         $4,
         $5::jsonb
       )
       RETURNING *`,
      [
        input.workflowRunId,
        input.workflowRunStepId ?? null,
        input.stepId ?? null,
        input.eventType,
        serializedPayload
      ]
    );

    if (rows.length === 0) {
      throw new Error('failed to append workflow execution history');
    }

    return mapWorkflowExecutionHistoryRow(rows[0]);
  });
}

export async function updateWorkflowRunStep(
  stepId: string,
  updates: WorkflowRunStepUpdateInput
): Promise<WorkflowRunStepRecord | null> {
  let updated: WorkflowRunStepRecord | null = null;

  await useTransaction(async (client) => {
    const { rows } = await client.query<WorkflowRunStepRow>(
      'SELECT * FROM workflow_run_steps WHERE id = $1 FOR UPDATE',
      [stepId]
    );
    if (rows.length === 0) {
      return;
    }
    const existing = rows[0];

    const nextStatus = updates.status ?? existing.status;
    const nextAttempt = updates.attempt ?? existing.attempt;
    const nextJobRunId = updates.jobRunId ?? existing.job_run_id ?? null;
    const inputProvided = Object.prototype.hasOwnProperty.call(updates, 'input');
    const outputProvided = Object.prototype.hasOwnProperty.call(updates, 'output');
    const metricsProvided = Object.prototype.hasOwnProperty.call(updates, 'metrics');
    const contextProvided = Object.prototype.hasOwnProperty.call(updates, 'context');

    const nextInput = inputProvided ? serializeJson(updates.input) : reuseJsonColumn(existing.input);
    const nextOutput = outputProvided ? serializeJson(updates.output) : reuseJsonColumn(existing.output);
    const nextErrorMessage = 'errorMessage' in updates ? updates.errorMessage ?? null : existing.error_message;
    const nextLogsUrl = 'logsUrl' in updates ? updates.logsUrl ?? null : existing.logs_url;
    const nextMetrics = metricsProvided ? serializeJson(updates.metrics) : reuseJsonColumn(existing.metrics);
    const nextContext = contextProvided ? serializeJson(updates.context) : reuseJsonColumn(existing.context);
    const nextStartedAt = updates.startedAt ?? existing.started_at ?? null;
    const nextCompletedAt = updates.completedAt ?? existing.completed_at ?? null;
    const nextParentStepId =
      'parentStepId' in updates ? updates.parentStepId ?? null : existing.parent_step_id ?? null;
    const nextFanoutIndex =
      'fanoutIndex' in updates ? updates.fanoutIndex ?? null : existing.fanout_index ?? null;
    const nextTemplateStepId =
      'templateStepId' in updates ? updates.templateStepId ?? null : existing.template_step_id ?? null;
    const nextLastHeartbeatAt = Object.prototype.hasOwnProperty.call(updates, 'lastHeartbeatAt')
      ? updates.lastHeartbeatAt ?? null
      : existing.last_heartbeat_at ?? null;
    const nextRetryCount = normalizeStepRetryCount(
      updates.retryCount,
      existing.retry_count ?? 0,
      nextAttempt ?? 1
    );
    const nextFailureReason = resolveStepFailureReason(
      nextStatus as WorkflowRunStepStatus,
      updates.failureReason,
      existing.failure_reason ?? null
    );

    const { rows: updatedRows } = await client.query<WorkflowRunStepRow>(
      `UPDATE workflow_run_steps
       SET status = $2,
           attempt = $3,
           job_run_id = $4,
           input = $5::jsonb,
           output = $6::jsonb,
           error_message = $7,
           logs_url = $8,
           metrics = $9::jsonb,
           context = $10::jsonb,
           started_at = $11,
           completed_at = $12,
           parent_step_id = $13,
           fanout_index = $14,
           template_step_id = $15,
           last_heartbeat_at = $16,
           retry_count = $17,
           failure_reason = $18,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        stepId,
        nextStatus,
        nextAttempt,
        nextJobRunId,
        nextInput,
        nextOutput,
        nextErrorMessage,
        nextLogsUrl,
        nextMetrics,
        nextContext,
        nextStartedAt,
        nextCompletedAt,
        nextParentStepId,
        nextFanoutIndex,
        nextTemplateStepId,
        nextLastHeartbeatAt,
        nextRetryCount,
        nextFailureReason
      ]
    );
    if (updatedRows.length === 0) {
      return;
    }
    const assets = await fetchWorkflowRunStepAssets(client, [stepId]);
    updated = mapWorkflowRunStepRow(updatedRows[0], assets.get(stepId) ?? []);
  });

  return updated;
}

async function fetchWorkflowDefinitionBySlugOrThrow(client: PoolClient, slug: string) {
  const definition = await fetchWorkflowDefinitionBySlug(client, slug);
  if (!definition) {
    throw new Error(`Workflow with slug ${slug} not found`);
  }
  return definition;
}

export async function getWorkflowRunStatsBySlug(
  slug: string,
  options: AnalyticsOptions = {}
): Promise<WorkflowRunStats> {
  return useConnection(async (client) => {
    const definition = await fetchWorkflowDefinitionBySlugOrThrow(client, slug);
    const range = normalizeTimeRange(options);

    const { rows: statusRows } = await client.query<{ status: string | null; count: string }>(
      `SELECT status, COUNT(*)::bigint AS count
         FROM workflow_runs
        WHERE workflow_definition_id = $1
          AND created_at >= $2
          AND created_at < $3
        GROUP BY status`,
      [definition.id, range.from.toISOString(), range.to.toISOString()]
    );

    const statusCounts: WorkflowRunStatusCounts = {};
    let totalRuns = 0;
    for (const row of statusRows) {
      const status = (row.status ?? 'unknown').toLowerCase();
      const count = Number(row.count ?? 0);
      totalRuns += Number.isFinite(count) ? count : 0;
      statusCounts[status] = Number.isFinite(count) ? count : 0;
    }

    const { rows: averageRows } = await client.query<{ avg: string | null }>(
      `SELECT AVG(duration_ms)::numeric AS avg
         FROM workflow_runs
        WHERE workflow_definition_id = $1
          AND duration_ms IS NOT NULL
          AND created_at >= $2
          AND created_at < $3`,
      [definition.id, range.from.toISOString(), range.to.toISOString()]
    );

    const averageDurationMs = (() => {
      const raw = averageRows[0]?.avg;
      if (!raw) {
        return null;
      }
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    })();

    const { rows: failureRows } = await client.query<{
      category: string | null;
      count: string;
    }>(
      `SELECT
         COALESCE(NULLIF(TRIM(SPLIT_PART(error_message, ':', 1)), ''), 'unknown') AS category,
         COUNT(*)::bigint AS count
       FROM workflow_runs
      WHERE workflow_definition_id = $1
        AND status = 'failed'
        AND created_at >= $2
        AND created_at < $3
      GROUP BY category
      ORDER BY count DESC
      LIMIT 20`,
      [definition.id, range.from.toISOString(), range.to.toISOString()]
    );

    const failureCategories = failureRows.map((row) => ({
      category: (row.category ?? 'unknown').toLowerCase(),
      count: Number(row.count ?? 0)
    }));

    const successCount = statusCounts.succeeded ?? 0;
    const failureCount = statusCounts.failed ?? 0;
    const successRate = totalRuns === 0 ? 0 : successCount / totalRuns;
    const failureRate = totalRuns === 0 ? 0 : failureCount / totalRuns;

    return {
      workflowId: definition.id,
      slug: definition.slug,
      range,
      totalRuns,
      statusCounts,
      successRate,
      failureRate,
      averageDurationMs,
      failureCategories
    } satisfies WorkflowRunStats;
  });
}

export async function getWorkflowRunMetricsBySlug(
  slug: string,
  options: MetricsOptions = {}
): Promise<WorkflowRunMetrics> {
  return useConnection(async (client) => {
    const definition = await fetchWorkflowDefinitionBySlugOrThrow(client, slug);
    const range = normalizeTimeRange(options);
    const bucketInterval = resolveBucketInterval(range, options.bucketInterval);

    const { rows } = await client.query<{
      bucket_start: Date;
      bucket_end: Date;
      total_runs: string;
      succeeded: string;
      failed: string;
      running: string;
      canceled: string;
      avg_duration_ms: string | null;
    }>(
      `WITH bucket_series AS (
         SELECT generate_series($2::timestamptz, $3::timestamptz, $4::interval) AS bucket_start
       ),
       run_source AS (
         SELECT created_at, status, duration_ms
           FROM workflow_runs
          WHERE workflow_definition_id = $1
            AND created_at >= $2
            AND created_at < $3
       )
       SELECT
         bucket_start,
         bucket_start + $4::interval AS bucket_end,
         COUNT(run_source.*)::bigint AS total_runs,
         COUNT(*) FILTER (WHERE run_source.status = 'succeeded')::bigint AS succeeded,
         COUNT(*) FILTER (WHERE run_source.status = 'failed')::bigint AS failed,
         COUNT(*) FILTER (WHERE run_source.status = 'running')::bigint AS running,
         COUNT(*) FILTER (WHERE run_source.status = 'canceled')::bigint AS canceled,
         AVG(run_source.duration_ms)::numeric AS avg_duration_ms
       FROM bucket_series
       LEFT JOIN run_source
         ON run_source.created_at >= bucket_start
        AND run_source.created_at < bucket_start + $4::interval
       GROUP BY bucket_start
       ORDER BY bucket_start`,
      [
        definition.id,
        range.from.toISOString(),
        range.to.toISOString(),
        bucketInterval
      ]
    );

    const series: WorkflowRunMetricsPoint[] = [];
    let rollingSuccessCount = 0;

    for (const row of rows) {
      const bucketStartIso = row.bucket_start.toISOString();
      const bucketEndIso = row.bucket_end.toISOString();
      const succeeded = Number(row.succeeded ?? 0);
      rollingSuccessCount += Number.isFinite(succeeded) ? succeeded : 0;
      const failed = Number(row.failed ?? 0);
      const running = Number(row.running ?? 0);
      const canceled = Number(row.canceled ?? 0);
      const totalRuns = Number(row.total_runs ?? 0);
      const avgDuration = row.avg_duration_ms ? Number(row.avg_duration_ms) : null;

      const statusCounts: WorkflowRunStatusCounts = {
        succeeded: Number.isFinite(succeeded) ? succeeded : 0,
        failed: Number.isFinite(failed) ? failed : 0,
        running: Number.isFinite(running) ? running : 0,
        canceled: Number.isFinite(canceled) ? canceled : 0
      };

      series.push({
        bucketStart: bucketStartIso,
        bucketEnd: bucketEndIso,
        totalRuns: Number.isFinite(totalRuns) ? totalRuns : 0,
        statusCounts,
        averageDurationMs: avgDuration && Number.isFinite(avgDuration) ? avgDuration : null,
        rollingSuccessCount
      });
    }

    return {
      workflowId: definition.id,
      slug: definition.slug,
      range,
      bucketInterval,
      series
    } satisfies WorkflowRunMetrics;
  });
}

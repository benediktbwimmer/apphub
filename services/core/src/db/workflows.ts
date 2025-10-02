import { randomUUID } from 'node:crypto';
import { parseCronExpression, type ParserOptions } from '../workflows/cronParser';
import type { PoolClient } from 'pg';
import { emitApphubEvent } from '../events';
import {
  type WorkflowDefinitionCreateInput,
  type WorkflowDefinitionRecord,
  type WorkflowDefinitionUpdateInput,
  type WorkflowRunCreateInput,
  type WorkflowRunRecord,
  type WorkflowRunRetrySummary,
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
  type WorkflowScheduleRecord,
  type WorkflowScheduleCreateInput,
  type WorkflowScheduleUpdateInput,
  type WorkflowScheduleWithDefinition,
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
  type WorkflowAssetPartitionParametersRecord,
  type WorkflowEventTriggerPredicate,
  type WorkflowEventTriggerRecord,
  type WorkflowEventTriggerCreateInput,
  type WorkflowEventTriggerUpdateInput,
  type WorkflowEventTriggerListOptions,
  type WorkflowTriggerDeliveryRecord,
  type WorkflowTriggerDeliveryInsert,
  type WorkflowTriggerDeliveryUpdateInput,
  type WorkflowTriggerDeliveryListOptions
} from './types';
import {
  mapWorkflowDefinitionRow,
  mapWorkflowScheduleRow,
  mapWorkflowRunRow,
  mapWorkflowRunStepRow,
  mapWorkflowAssetDeclarationRow,
  mapWorkflowRunStepAssetRow,
  mapWorkflowAssetSnapshotRow,
  mapWorkflowExecutionHistoryRow,
  mapWorkflowAssetStalePartitionRow,
  mapWorkflowAssetPartitionParametersRow,
  mapWorkflowEventTriggerRow,
  mapWorkflowTriggerDeliveryRow
} from './rowMappers';
import { computeRunKeyColumns } from '../workflows/runKey';
import type {
  WorkflowDefinitionRow,
  WorkflowScheduleRow,
  WorkflowRunRow,
  WorkflowRunStepRow,
  WorkflowAssetDeclarationRow,
  WorkflowRunStepAssetRow,
  WorkflowAssetSnapshotRow,
  WorkflowExecutionHistoryRow,
  WorkflowAssetStalePartitionRow,
  WorkflowAssetPartitionParametersRow,
  WorkflowEventTriggerRow,
  WorkflowTriggerDeliveryRow,
  WorkflowActivityRow
} from './rowTypes';
import {
  normalizeWorkflowEventTriggerCreate,
  normalizeWorkflowEventTriggerUpdate,
  serializeTriggerPredicates
} from '../workflows/eventTriggerValidation';
import { assertNoTemplateIssues, validateTriggerTemplates } from '../workflows/liquidTemplateValidation';
import { useConnection, useTransaction } from './utils';

const RUN_KEY_UNIQUE_INDEX = 'idx_workflow_runs_active_run_key';

export function isRunKeyConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const pgError = error as { code?: string; constraint?: string; message?: string };
  if (pgError.code !== '23505') {
    return false;
  }
  if (pgError.constraint === RUN_KEY_UNIQUE_INDEX) {
    return true;
  }
  return (pgError.message ?? '').includes(RUN_KEY_UNIQUE_INDEX);
}

type AnalyticsTimeRange = {
  from: Date;
  to: Date;
};

type WorkflowRunStatusCounts = Record<string, number>;

const EMPTY_RETRY_SUMMARY: WorkflowRunRetrySummary = {
  pendingSteps: 0,
  nextAttemptAt: null,
  overdueSteps: 0
};

function cloneRetrySummary(summary: WorkflowRunRetrySummary): WorkflowRunRetrySummary {
  return {
    pendingSteps: summary.pendingSteps,
    nextAttemptAt: summary.nextAttemptAt,
    overdueSteps: summary.overdueSteps
  } satisfies WorkflowRunRetrySummary;
}

async function collectWorkflowRunRetrySummaries(
  runIds: readonly string[]
): Promise<Map<string, WorkflowRunRetrySummary>> {
  if (runIds.length === 0) {
    return new Map();
  }

  const { rows } = await useConnection((client) =>
    client.query<{
      workflow_run_id: string;
      pending_steps: string | null;
      next_attempt_at: string | null;
      overdue_steps: string | null;
    }>(
      `SELECT workflow_run_id,
              COUNT(*) FILTER (WHERE retry_state = 'scheduled')::bigint AS pending_steps,
              MIN(next_attempt_at) FILTER (WHERE retry_state = 'scheduled') AS next_attempt_at,
              COUNT(*) FILTER (WHERE retry_state = 'scheduled' AND next_attempt_at <= NOW())::bigint AS overdue_steps
         FROM workflow_run_steps
        WHERE workflow_run_id = ANY($1::text[])
        GROUP BY workflow_run_id`,
      [runIds]
    )
  );

  const summaries = new Map<string, WorkflowRunRetrySummary>();
  for (const row of rows) {
    const pending = Number(row.pending_steps ?? 0);
    const overdue = Number(row.overdue_steps ?? 0);
    summaries.set(row.workflow_run_id, {
      pendingSteps: Number.isFinite(pending) && pending > 0 ? pending : 0,
      nextAttemptAt: row.next_attempt_at ?? null,
      overdueSteps: Number.isFinite(overdue) && overdue > 0 ? overdue : 0
    });
  }
  return summaries;
}

async function attachWorkflowRunRetrySummaries(runs: WorkflowRunRecord[]): Promise<void> {
  if (runs.length === 0) {
    return;
  }
  const summaries = await collectWorkflowRunRetrySummaries(runs.map((run) => run.id));
  for (const run of runs) {
    const summary = summaries.get(run.id);
    run.retrySummary = summary ? summary : cloneRetrySummary(EMPTY_RETRY_SUMMARY);
  }
}

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
type ScheduleRuntimeState = {
  nextRunAt: string | null;
  catchupCursor: string | null;
  lastWindow: WorkflowScheduleWindow | null;
};

type ScheduleConfigInput = {
  cron: string;
  timezone?: string | null;
  startWindow?: string | null;
  endWindow?: string | null;
  catchUp?: boolean;
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

function computeNextScheduleOccurrence(
  schedule: ScheduleConfigInput | null | undefined,
  from: Date,
  { inclusive = false }: { inclusive?: boolean } = {}
): Date | null {
  if (!schedule) {
    return null;
  }
  const cron = schedule.cron?.trim();
  if (!cron) {
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
    const interval = parseCronExpression(cron, {
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

function computeInitialScheduleState(
  schedule: ScheduleConfigInput | null | undefined,
  { now = new Date() }: { now?: Date } = {}
): ScheduleRuntimeState {
  if (!schedule) {
    return {
      nextRunAt: null,
      catchupCursor: null,
      lastWindow: null
    } satisfies ScheduleRuntimeState;
  }

  const nextOccurrence = computeNextScheduleOccurrence(schedule, now, { inclusive: true });
  if (!nextOccurrence) {
    return {
      nextRunAt: null,
      catchupCursor: null,
      lastWindow: null
    } satisfies ScheduleRuntimeState;
  }

  const nextIso = nextOccurrence.toISOString();
  return {
    nextRunAt: nextIso,
    catchupCursor: nextIso,
    lastWindow: null
  } satisfies ScheduleRuntimeState;
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
  const definition = mapWorkflowDefinitionRow(rows[0]);
  await attachSchedulesToDefinitions(client, [definition]);
  await attachEventTriggersToDefinitions(client, [definition]);
  return definition;
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
  const definition = mapWorkflowDefinitionRow(rows[0]);
  await attachSchedulesToDefinitions(client, [definition]);
  return definition;
}

async function fetchWorkflowSchedulesByDefinitionIds(
  client: PoolClient,
  definitionIds: readonly string[]
): Promise<Map<string, WorkflowScheduleRecord[]>> {
  if (definitionIds.length === 0) {
    return new Map();
  }

  const { rows } = await client.query<WorkflowScheduleRow>(
    `SELECT *
       FROM workflow_schedules
      WHERE workflow_definition_id = ANY($1::text[])
      ORDER BY workflow_definition_id ASC, created_at ASC, id ASC`,
    [definitionIds]
  );

  const schedulesByDefinition = new Map<string, WorkflowScheduleRecord[]>();
  for (const row of rows) {
    const schedule = mapWorkflowScheduleRow(row);
    const list = schedulesByDefinition.get(schedule.workflowDefinitionId);
    if (list) {
      list.push(schedule);
    } else {
      schedulesByDefinition.set(schedule.workflowDefinitionId, [schedule]);
    }
  }

  return schedulesByDefinition;
}

async function attachSchedulesToDefinitions(
  client: PoolClient,
  definitions: WorkflowDefinitionRecord[]
): Promise<void> {
  if (definitions.length === 0) {
    return;
  }

  const ids = definitions.map((definition) => definition.id);
  const schedules = await fetchWorkflowSchedulesByDefinitionIds(client, ids);
  for (const definition of definitions) {
    definition.schedules = schedules.get(definition.id) ?? [];
  }
}

async function fetchWorkflowEventTriggersByDefinitionIds(
  client: PoolClient,
  definitionIds: readonly string[]
): Promise<Map<string, WorkflowEventTriggerRecord[]>> {
  if (definitionIds.length === 0) {
    return new Map();
  }

  const { rows } = await client.query<WorkflowEventTriggerRow>(
    `SELECT *
       FROM workflow_event_triggers
      WHERE workflow_definition_id = ANY($1::text[])
      ORDER BY workflow_definition_id ASC, created_at ASC, id ASC`,
    [definitionIds]
  );

  const triggersByDefinition = new Map<string, WorkflowEventTriggerRecord[]>();
  for (const row of rows) {
    const trigger = mapWorkflowEventTriggerRow(row);
    const list = triggersByDefinition.get(trigger.workflowDefinitionId);
    if (list) {
      list.push(trigger);
    } else {
      triggersByDefinition.set(trigger.workflowDefinitionId, [trigger]);
    }
  }

  return triggersByDefinition;
}

async function attachEventTriggersToDefinitions(
  client: PoolClient,
  definitions: WorkflowDefinitionRecord[]
): Promise<void> {
  if (definitions.length === 0) {
    return;
  }

  const ids = definitions.map((definition) => definition.id);
  const triggers = await fetchWorkflowEventTriggersByDefinitionIds(client, ids);
  for (const definition of definitions) {
    definition.eventTriggers = triggers.get(definition.id) ?? [];
  }
}

async function fetchWorkflowDefinitionsByIds(
  client: PoolClient,
  ids: readonly string[]
): Promise<Map<string, WorkflowDefinitionRecord>> {
  if (ids.length === 0) {
    return new Map();
  }

  const { rows } = await client.query<WorkflowDefinitionRow>(
    `SELECT *
       FROM workflow_definitions
      WHERE id = ANY($1::text[])`,
    [ids]
  );

  const definitions = rows.map(mapWorkflowDefinitionRow);
  await attachSchedulesToDefinitions(client, definitions);
  await attachEventTriggersToDefinitions(client, definitions);

  const map = new Map<string, WorkflowDefinitionRecord>();
  for (const definition of definitions) {
    map.set(definition.id, definition);
  }
  return map;
}

async function fetchWorkflowScheduleById(
  client: PoolClient,
  id: string
): Promise<WorkflowScheduleRecord | null> {
  const { rows } = await client.query<WorkflowScheduleRow>(
    'SELECT * FROM workflow_schedules WHERE id = $1',
    [id]
  );
  if (rows.length === 0) {
    return null;
  }
  return mapWorkflowScheduleRow(rows[0]);
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
    const definitions = rows.map(mapWorkflowDefinitionRow);
    await attachSchedulesToDefinitions(client, definitions);
    await attachEventTriggersToDefinitions(client, definitions);
    return definitions;
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
          dagJson
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
        dagJson
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
} = {}): Promise<WorkflowScheduleWithDefinition[]> {
  const boundedLimit = Math.min(Math.max(limit, 1), 100);
  const cutoff = now.toISOString();

  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowScheduleRow>(
      `SELECT *
         FROM workflow_schedules
        WHERE is_active = TRUE
          AND next_run_at IS NOT NULL
          AND next_run_at <= $1
        ORDER BY next_run_at ASC
        LIMIT $2`,
      [cutoff, boundedLimit]
    );

    const schedules = rows.map(mapWorkflowScheduleRow);
    const definitionIds = Array.from(new Set(schedules.map((schedule) => schedule.workflowDefinitionId)));
    const definitions = await fetchWorkflowDefinitionsByIds(client, definitionIds);

    const results: WorkflowScheduleWithDefinition[] = [];
    for (const schedule of schedules) {
      const workflow = definitions.get(schedule.workflowDefinitionId);
      if (!workflow) {
        continue;
      }
      results.push({ schedule, workflow });
    }
    return results;
  });
}

export async function listWorkflowSchedulesWithWorkflow(): Promise<WorkflowScheduleWithDefinition[]> {
  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowScheduleRow>(
      `SELECT *
         FROM workflow_schedules
        ORDER BY is_active DESC,
                 CASE WHEN next_run_at IS NULL THEN 1 ELSE 0 END,
                 next_run_at ASC NULLS LAST,
                 created_at ASC`
    );

    const schedules = rows.map(mapWorkflowScheduleRow);
    const definitionIds = Array.from(new Set(schedules.map((schedule) => schedule.workflowDefinitionId)));
    const definitions = await fetchWorkflowDefinitionsByIds(client, definitionIds);

    const results: WorkflowScheduleWithDefinition[] = [];
    for (const schedule of schedules) {
      const workflow = definitions.get(schedule.workflowDefinitionId);
      if (!workflow) {
        continue;
      }
      results.push({ schedule, workflow });
    }
    return results;
  });
}

export async function listWorkflowSchedulesForDefinition(
  workflowDefinitionId: string
): Promise<WorkflowScheduleRecord[]> {
  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowScheduleRow>(
      `SELECT *
         FROM workflow_schedules
        WHERE workflow_definition_id = $1
        ORDER BY created_at ASC`,
      [workflowDefinitionId]
    );
    return rows.map(mapWorkflowScheduleRow);
  });
}

export async function getWorkflowScheduleWithWorkflow(
  scheduleId: string
): Promise<WorkflowScheduleWithDefinition | null> {
  return useConnection(async (client) => {
    const schedule = await fetchWorkflowScheduleById(client, scheduleId);
    if (!schedule) {
      return null;
    }
    const definitions = await fetchWorkflowDefinitionsByIds(client, [schedule.workflowDefinitionId]);
    const workflow = definitions.get(schedule.workflowDefinitionId);
    if (!workflow) {
      return null;
    }
    return { schedule, workflow } satisfies WorkflowScheduleWithDefinition;
  });
}

export async function createWorkflowSchedule(
  input: WorkflowScheduleCreateInput
): Promise<WorkflowScheduleRecord> {
  const id = randomUUID();
  const cron = input.cron.trim();
  if (cron.length === 0) {
    throw new Error('Cron expression is required');
  }

  const name = typeof input.name === 'string' ? input.name.trim() || null : null;
  const description = typeof input.description === 'string' ? input.description.trim() || null : null;
  const timezone = typeof input.timezone === 'string' ? input.timezone.trim() || null : null;
  const startWindow = input.startWindow ?? null;
  const endWindow = input.endWindow ?? null;
  const catchUp = input.catchUp ?? true;
  const parameters = input.parameters ?? null;
  const isActive = input.isActive ?? true;

  const runtime = computeInitialScheduleState({ cron, timezone, startWindow, endWindow, catchUp });
  const parametersJson = serializeJson(parameters);
  const lastWindowJson = serializeScheduleWindow(runtime.lastWindow);

  let schedule: WorkflowScheduleRecord | null = null;
  let definition: WorkflowDefinitionRecord | null = null;

  await useTransaction(async (client) => {
    const existingDefinition = await fetchWorkflowDefinitionById(client, input.workflowDefinitionId);
    if (!existingDefinition) {
      throw new Error(`Workflow definition ${input.workflowDefinitionId} not found`);
    }

    const { rows } = await client.query<WorkflowScheduleRow>(
      `INSERT INTO workflow_schedules (
         id,
         workflow_definition_id,
         name,
         description,
         cron,
         timezone,
         parameters,
         start_window,
         end_window,
         catch_up,
         next_run_at,
         last_materialized_window,
         catchup_cursor,
         is_active,
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
         $8,
         $9,
         $10,
         $11,
         $12::jsonb,
         $13,
         $14,
         NOW(),
         NOW()
       )
       RETURNING *`,
      [
        id,
        input.workflowDefinitionId,
        name,
        description,
        cron,
        timezone,
        parametersJson,
        startWindow,
        endWindow,
        catchUp,
        isActive ? runtime.nextRunAt : null,
        lastWindowJson,
        isActive ? runtime.catchupCursor : null,
        isActive
      ]
    );

    if (rows.length === 0) {
      throw new Error('Failed to create workflow schedule');
    }

    schedule = mapWorkflowScheduleRow(rows[0]);
    definition = await fetchWorkflowDefinitionById(client, input.workflowDefinitionId);
  });

  if (!schedule) {
    throw new Error('Failed to create workflow schedule');
  }

  if (definition) {
    emitWorkflowDefinitionEvent(definition);
  }

  return schedule;
}

export async function updateWorkflowSchedule(
  scheduleId: string,
  updates: WorkflowScheduleUpdateInput
): Promise<WorkflowScheduleRecord | null> {
  let schedule: WorkflowScheduleRecord | null = null;
  let definition: WorkflowDefinitionRecord | null = null;

  await useTransaction(async (client) => {
    const { rows } = await client.query<WorkflowScheduleRow>(
      'SELECT * FROM workflow_schedules WHERE id = $1 FOR UPDATE',
      [scheduleId]
    );
    if (rows.length === 0) {
      schedule = null;
      return;
    }

    const existing = mapWorkflowScheduleRow(rows[0]);

    const nextName =
      updates.name === undefined ? existing.name : typeof updates.name === 'string' ? updates.name.trim() || null : null;
    const nextDescription =
      updates.description === undefined
        ? existing.description
        : typeof updates.description === 'string'
          ? updates.description.trim() || null
          : null;
    const nextCron = updates.cron === undefined ? existing.cron : updates.cron.trim();
    if (!nextCron) {
      throw new Error('Cron expression is required');
    }
    const nextTimezone =
      updates.timezone === undefined
        ? existing.timezone
        : typeof updates.timezone === 'string'
          ? updates.timezone.trim() || null
          : null;
    const nextStartWindow = updates.startWindow === undefined ? existing.startWindow : updates.startWindow ?? null;
    const nextEndWindow = updates.endWindow === undefined ? existing.endWindow : updates.endWindow ?? null;
    const nextCatchUp = updates.catchUp === undefined ? existing.catchUp : Boolean(updates.catchUp);
    const nextIsActive = updates.isActive === undefined ? existing.isActive : Boolean(updates.isActive);
    const nextParametersValue =
      updates.parameters === undefined ? existing.parameters : (updates.parameters ?? null);
    const nextParametersJson = serializeJson(nextParametersValue);

    const configurationChanged =
      nextCron !== existing.cron ||
      nextTimezone !== existing.timezone ||
      nextStartWindow !== existing.startWindow ||
      nextEndWindow !== existing.endWindow ||
      nextCatchUp !== existing.catchUp;

    const reactivated = nextIsActive && !existing.isActive;

    let nextRunAt = existing.nextRunAt;
    let catchupCursor = existing.catchupCursor;
    let lastWindowJson = serializeScheduleWindow(existing.lastMaterializedWindow);

    if (configurationChanged || reactivated) {
      const runtime = computeInitialScheduleState({
        cron: nextCron,
        timezone: nextTimezone ?? undefined,
        startWindow: nextStartWindow ?? undefined,
        endWindow: nextEndWindow ?? undefined,
        catchUp: nextCatchUp
      });
      nextRunAt = runtime.nextRunAt;
      catchupCursor = runtime.catchupCursor;
      lastWindowJson = serializeScheduleWindow(runtime.lastWindow);
    }

    if (!nextIsActive) {
      nextRunAt = null;
      catchupCursor = null;
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    if (updates.name !== undefined) {
      sets.push(`name = $${index}`);
      values.push(nextName);
      index += 1;
    }
    if (updates.description !== undefined) {
      sets.push(`description = $${index}`);
      values.push(nextDescription);
      index += 1;
    }
    if (updates.cron !== undefined) {
      sets.push(`cron = $${index}`);
      values.push(nextCron);
      index += 1;
    }
    if (updates.timezone !== undefined) {
      sets.push(`timezone = $${index}`);
      values.push(nextTimezone);
      index += 1;
    }
    if (updates.parameters !== undefined) {
      sets.push(`parameters = $${index}::jsonb`);
      values.push(nextParametersJson);
      index += 1;
    }
    if (updates.startWindow !== undefined) {
      sets.push(`start_window = $${index}`);
      values.push(nextStartWindow);
      index += 1;
    }
    if (updates.endWindow !== undefined) {
      sets.push(`end_window = $${index}`);
      values.push(nextEndWindow);
      index += 1;
    }
    if (updates.catchUp !== undefined) {
      sets.push(`catch_up = $${index}`);
      values.push(nextCatchUp);
      index += 1;
    }
    if (updates.isActive !== undefined) {
      sets.push(`is_active = $${index}`);
      values.push(nextIsActive);
      index += 1;
    }

    if (configurationChanged || reactivated || !nextIsActive) {
      sets.push(`next_run_at = $${index}`);
      values.push(nextRunAt);
      index += 1;

      sets.push(`catchup_cursor = $${index}`);
      values.push(catchupCursor);
      index += 1;

      sets.push(`last_materialized_window = $${index}::jsonb`);
      values.push(lastWindowJson);
      index += 1;
    }

    if (sets.length === 0) {
      schedule = existing;
      definition = await fetchWorkflowDefinitionById(client, existing.workflowDefinitionId);
      return;
    }

    sets.push(`updated_at = NOW()`);
    values.push(scheduleId);

    const updated = await client.query<WorkflowScheduleRow>(
      `UPDATE workflow_schedules
          SET ${sets.join(', ')}
        WHERE id = $${index}
        RETURNING *`,
      values
    );

    if (updated.rows.length === 0) {
      schedule = null;
      return;
    }

    schedule = mapWorkflowScheduleRow(updated.rows[0]);
    definition = await fetchWorkflowDefinitionById(client, schedule.workflowDefinitionId);
  });

  if (definition) {
    emitWorkflowDefinitionEvent(definition);
  }

  return schedule;
}

function serializeTriggerJson(value: JsonValue | null): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

export async function createWorkflowEventTrigger(
  input: WorkflowEventTriggerCreateInput
): Promise<WorkflowEventTriggerRecord> {
  const normalized = normalizeWorkflowEventTriggerCreate(input);
  const templateIssues = await validateTriggerTemplates(
    {
      parameterTemplate: normalized.parameterTemplate,
      idempotencyKeyExpression: normalized.idempotencyKeyExpression,
      runKeyTemplate: normalized.runKeyTemplate
    },
    {
      trigger: {
        workflowDefinitionId: input.workflowDefinitionId,
        name: normalized.name,
        description: normalized.description,
        eventType: normalized.eventType,
        eventSource: normalized.eventSource ?? null,
        predicates: normalized.predicates,
        parameterTemplate: normalized.parameterTemplate,
        runKeyTemplate: normalized.runKeyTemplate,
        idempotencyKeyExpression: normalized.idempotencyKeyExpression,
        metadata: normalized.metadata,
        throttleWindowMs: normalized.throttleWindowMs,
        throttleCount: normalized.throttleCount,
        maxConcurrency: normalized.maxConcurrency,
        status: normalized.status
      }
    }
  );
  assertNoTemplateIssues(templateIssues);
  const id = randomUUID();
  const predicateJson = serializeTriggerPredicates(normalized.predicates);
  const parameterTemplateJson = serializeJson(normalized.parameterTemplate);
  const metadataJson = serializeJson(normalized.metadata);

  let trigger: WorkflowEventTriggerRecord | null = null;
  let definition: WorkflowDefinitionRecord | null = null;

  await useTransaction(async (client) => {
    const existingDefinition = await fetchWorkflowDefinitionById(client, input.workflowDefinitionId);
    if (!existingDefinition) {
      throw new Error(`Workflow definition ${input.workflowDefinitionId} not found`);
    }
    definition = existingDefinition;

    const { rows } = await client.query<WorkflowEventTriggerRow>(
      `INSERT INTO workflow_event_triggers (
         id,
         workflow_definition_id,
         version,
         status,
         name,
         description,
         event_type,
         event_source,
         predicates,
         parameter_template,
         run_key_template,
         throttle_window_ms,
         throttle_count,
         max_concurrency,
         idempotency_key_expression,
         metadata,
         created_at,
         updated_at,
         created_by,
         updated_by
       ) VALUES (
         $1,
         $2,
         1,
         $3,
         $4,
         $5,
         $6,
         $7,
         $8::jsonb,
         $9::jsonb,
         $10,
         $11,
         $12,
         $13,
         $14,
         $15::jsonb,
         NOW(),
         NOW(),
         $16,
         $16
       )
       RETURNING *`,
      [
        id,
        input.workflowDefinitionId,
        normalized.status,
        normalized.name,
        normalized.description,
        normalized.eventType,
        normalized.eventSource,
        predicateJson,
        parameterTemplateJson,
        normalized.runKeyTemplate,
        normalized.throttleWindowMs,
        normalized.throttleCount,
        normalized.maxConcurrency,
        normalized.idempotencyKeyExpression,
        metadataJson,
        normalized.createdBy ?? null
      ]
    );

    if (rows.length === 0) {
      throw new Error('Failed to create workflow event trigger');
    }

    trigger = mapWorkflowEventTriggerRow(rows[0]);
  });

  if (!trigger) {
    throw new Error('Failed to create workflow event trigger');
  }

  if (definition) {
    emitWorkflowDefinitionEvent(definition);
  }

  return trigger;
}

function predicatesEqual(a: WorkflowEventTriggerPredicate[], b: WorkflowEventTriggerPredicate[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      return false;
    }
  }
  return true;
}

function jsonValuesEqual(a: JsonValue | null, b: JsonValue | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export async function updateWorkflowEventTrigger(
  triggerId: string,
  updates: WorkflowEventTriggerUpdateInput
): Promise<WorkflowEventTriggerRecord | null> {
  const normalized = normalizeWorkflowEventTriggerUpdate(updates);
  let trigger: WorkflowEventTriggerRecord | null = null;
  let definition: WorkflowDefinitionRecord | null = null;
  let mutated = false;

  await useTransaction(async (client) => {
    const { rows } = await client.query<WorkflowEventTriggerRow>(
      'SELECT * FROM workflow_event_triggers WHERE id = $1 FOR UPDATE',
      [triggerId]
    );
    if (rows.length === 0) {
      trigger = null;
      return;
    }

    const existing = mapWorkflowEventTriggerRow(rows[0]);

    const nextParameterTemplate =
      normalized.parameterTemplate !== undefined
        ? normalized.parameterTemplate
        : existing.parameterTemplate;
    const nextIdempotencyExpression =
      normalized.idempotencyKeyExpression !== undefined
        ? normalized.idempotencyKeyExpression
        : existing.idempotencyKeyExpression;
    const nextRunKeyTemplate =
      normalized.runKeyTemplate !== undefined ? normalized.runKeyTemplate : existing.runKeyTemplate;

    const templateIssues = await validateTriggerTemplates(
      {
        parameterTemplate: nextParameterTemplate ?? null,
        idempotencyKeyExpression: nextIdempotencyExpression ?? null,
        runKeyTemplate: nextRunKeyTemplate ?? null
      },
      {
        trigger: {
          ...existing,
          ...normalized,
          parameterTemplate: nextParameterTemplate ?? null,
          runKeyTemplate: nextRunKeyTemplate ?? null,
          idempotencyKeyExpression: nextIdempotencyExpression ?? null,
          predicates: normalized.predicates ?? existing.predicates,
          throttleWindowMs: normalized.throttleWindowMs ?? existing.throttleWindowMs,
          throttleCount: normalized.throttleCount ?? existing.throttleCount,
          maxConcurrency: normalized.maxConcurrency ?? existing.maxConcurrency,
          status: normalized.status ?? existing.status,
          metadata: normalized.metadata ?? existing.metadata
        }
      }
    );
    assertNoTemplateIssues(templateIssues);

    const sets: string[] = [];
    const values: unknown[] = [];
    let index = 1;
    let versionShouldIncrement = false;

    if (normalized.name !== undefined) {
      sets.push(`name = $${index}`);
      values.push(normalized.name);
      if (existing.name !== normalized.name) {
        versionShouldIncrement = true;
      }
      index += 1;
    }

    if (normalized.description !== undefined) {
      sets.push(`description = $${index}`);
      values.push(normalized.description);
      if (existing.description !== normalized.description) {
        versionShouldIncrement = true;
      }
      index += 1;
    }

    if (normalized.eventType !== undefined) {
      sets.push(`event_type = $${index}`);
      values.push(normalized.eventType);
      if (existing.eventType !== normalized.eventType) {
        versionShouldIncrement = true;
      }
      index += 1;
    }

    if (normalized.eventSource !== undefined) {
      sets.push(`event_source = $${index}`);
      values.push(normalized.eventSource);
      if (existing.eventSource !== normalized.eventSource) {
        versionShouldIncrement = true;
      }
      index += 1;
    }

    if (normalized.predicates !== undefined) {
      const serialized = serializeTriggerPredicates(normalized.predicates);
      sets.push(`predicates = $${index}::jsonb`);
      values.push(serialized);
      if (!predicatesEqual(existing.predicates, normalized.predicates)) {
        versionShouldIncrement = true;
      }
      index += 1;
    }

    if (normalized.parameterTemplate !== undefined) {
      sets.push(`parameter_template = $${index}::jsonb`);
      values.push(serializeTriggerJson(normalized.parameterTemplate));
      if (!jsonValuesEqual(existing.parameterTemplate, normalized.parameterTemplate ?? null)) {
        versionShouldIncrement = true;
      }
      index += 1;
    }

    if (normalized.runKeyTemplate !== undefined) {
      sets.push(`run_key_template = $${index}`);
      values.push(normalized.runKeyTemplate);
      if (existing.runKeyTemplate !== normalized.runKeyTemplate) {
        versionShouldIncrement = true;
      }
      index += 1;
    }

    if (normalized.throttleWindowMs !== undefined) {
      sets.push(`throttle_window_ms = $${index}`);
      values.push(normalized.throttleWindowMs);
      if (existing.throttleWindowMs !== normalized.throttleWindowMs) {
        versionShouldIncrement = true;
      }
      index += 1;
    }

    if (normalized.throttleCount !== undefined) {
      sets.push(`throttle_count = $${index}`);
      values.push(normalized.throttleCount);
      if (existing.throttleCount !== normalized.throttleCount) {
        versionShouldIncrement = true;
      }
      index += 1;
    }

    if (normalized.maxConcurrency !== undefined) {
      sets.push(`max_concurrency = $${index}`);
      values.push(normalized.maxConcurrency);
      if (existing.maxConcurrency !== normalized.maxConcurrency) {
        versionShouldIncrement = true;
      }
      index += 1;
    }

    if (normalized.idempotencyKeyExpression !== undefined) {
      sets.push(`idempotency_key_expression = $${index}`);
      values.push(normalized.idempotencyKeyExpression);
      if (existing.idempotencyKeyExpression !== normalized.idempotencyKeyExpression) {
        versionShouldIncrement = true;
      }
      index += 1;
    }

    if (normalized.metadata !== undefined) {
      sets.push(`metadata = $${index}::jsonb`);
      values.push(serializeTriggerJson(normalized.metadata));
      if (!jsonValuesEqual(existing.metadata, normalized.metadata ?? null)) {
        versionShouldIncrement = true;
      }
      index += 1;
    }

    if (normalized.status !== undefined) {
      sets.push(`status = $${index}`);
      values.push(normalized.status);
      if (existing.status !== normalized.status) {
        versionShouldIncrement = true;
      }
      index += 1;
    }

    if (normalized.updatedBy !== undefined) {
      sets.push(`updated_by = $${index}`);
      values.push(normalized.updatedBy);
      index += 1;
    }

    if (versionShouldIncrement) {
      sets.push('version = version + 1');
    }

    sets.push('updated_at = NOW()');

    if (sets.length === 1 && sets[0] === 'updated_at = NOW()') {
      // No-op update; return the existing row.
      trigger = existing;
      definition = await fetchWorkflowDefinitionById(client, existing.workflowDefinitionId);
      return;
    }

    const query = `UPDATE workflow_event_triggers SET ${sets.join(', ')} WHERE id = $${index} RETURNING *`;
    values.push(triggerId);

    const updated = await client.query<WorkflowEventTriggerRow>(query, values);
    if (updated.rows.length === 0) {
      trigger = existing;
      definition = await fetchWorkflowDefinitionById(client, existing.workflowDefinitionId);
      return;
    }
    trigger = mapWorkflowEventTriggerRow(updated.rows[0]);
    mutated = true;
    definition = await fetchWorkflowDefinitionById(client, existing.workflowDefinitionId);
  });

  if (mutated && definition) {
    emitWorkflowDefinitionEvent(definition);
  }

  return trigger;
}

export async function deleteWorkflowEventTrigger(triggerId: string): Promise<boolean> {
  let deleted = false;
  let definition: WorkflowDefinitionRecord | null = null;

  await useTransaction(async (client) => {
    const existing = await client.query<WorkflowEventTriggerRow>(
      'SELECT * FROM workflow_event_triggers WHERE id = $1 FOR UPDATE',
      [triggerId]
    );

    if (existing.rows.length === 0) {
      return;
    }

    const trigger = mapWorkflowEventTriggerRow(existing.rows[0]);

    await client.query('DELETE FROM workflow_event_triggers WHERE id = $1', [triggerId]);
    deleted = true;

    definition = await fetchWorkflowDefinitionById(client, trigger.workflowDefinitionId);
  });

  if (definition) {
    emitWorkflowDefinitionEvent(definition);
  }

  return deleted;
}

export async function getWorkflowEventTriggerById(
  triggerId: string
): Promise<WorkflowEventTriggerRecord | null> {
  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowEventTriggerRow>(
      'SELECT * FROM workflow_event_triggers WHERE id = $1',
      [triggerId]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapWorkflowEventTriggerRow(rows[0]);
  });
}

export async function listWorkflowEventTriggers(
  options: WorkflowEventTriggerListOptions = {}
): Promise<WorkflowEventTriggerRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let index = 1;

  if (options.workflowDefinitionId) {
    conditions.push(`workflow_definition_id = $${index}`);
    params.push(options.workflowDefinitionId);
    index += 1;
  }

  if (options.status) {
    conditions.push(`status = $${index}`);
    params.push(options.status);
    index += 1;
  }

  if (options.eventType) {
    conditions.push(`event_type = $${index}`);
    params.push(options.eventType);
    index += 1;
  }

  if (options.eventSource) {
    conditions.push(`event_source = $${index}`);
    params.push(options.eventSource);
    index += 1;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `SELECT * FROM workflow_event_triggers ${whereClause} ORDER BY created_at DESC`;

  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowEventTriggerRow>(query, params);
    return rows.map(mapWorkflowEventTriggerRow);
  });
}

export async function listWorkflowEventTriggersForEvent(
  eventType: string,
  eventSource: string | null
): Promise<WorkflowEventTriggerRecord[]> {
  const conditions = ['status = $1', 'event_type = $2'];
  const params: unknown[] = ['active', eventType];
  let index = 3;

  if (eventSource) {
    conditions.push(`(event_source = $${index} OR event_source IS NULL)`);
    params.push(eventSource);
    index += 1;
  } else {
    conditions.push('event_source IS NULL');
  }

  const query = `SELECT * FROM workflow_event_triggers WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC`;

  const { rows } = await useConnection((client) => client.query<WorkflowEventTriggerRow>(query, params));
  return rows.map(mapWorkflowEventTriggerRow);
}

export async function createWorkflowTriggerDelivery(
  input: WorkflowTriggerDeliveryInsert
): Promise<WorkflowTriggerDeliveryRecord> {
  const id = randomUUID();
  const attempts = input.attempts ?? 0;

  const { rows } = await useConnection((client) =>
    client.query<WorkflowTriggerDeliveryRow>(
      `INSERT INTO workflow_trigger_deliveries (
         id,
         trigger_id,
         workflow_definition_id,
         event_id,
         status,
         attempts,
         last_error,
         workflow_run_id,
         dedupe_key,
         next_attempt_at,
         throttled_until,
         retry_state,
         retry_attempts,
         retry_metadata,
         created_at,
         updated_at
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
         $14::jsonb,
         NOW(),
         NOW()
       )
       RETURNING *`,
      [
        id,
        input.triggerId,
        input.workflowDefinitionId,
        input.eventId,
        input.status,
        attempts,
        input.lastError ?? null,
        input.workflowRunId ?? null,
        input.dedupeKey ?? null,
        input.nextAttemptAt ?? null,
        input.throttledUntil ?? null,
        input.retryState ?? 'pending',
        input.retryAttempts ?? 0,
        serializeJson(input.retryMetadata)
      ]
    )
  );

  if (rows.length === 0) {
    throw new Error('Failed to create workflow trigger delivery');
  }

  return mapWorkflowTriggerDeliveryRow(rows[0]);
}

export async function updateWorkflowTriggerDelivery(
  deliveryId: string,
  updates: WorkflowTriggerDeliveryUpdateInput
): Promise<WorkflowTriggerDeliveryRecord | null> {
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    return getWorkflowTriggerDeliveryById(deliveryId);
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  if (updates.status !== undefined) {
    sets.push(`status = $${index}`);
    values.push(updates.status);
    index += 1;
  }
  if (updates.attempts !== undefined) {
    sets.push(`attempts = $${index}`);
    values.push(updates.attempts);
    index += 1;
  }
  if (updates.lastError !== undefined) {
    sets.push(`last_error = $${index}`);
    values.push(updates.lastError);
    index += 1;
  }
  if (updates.workflowRunId !== undefined) {
    sets.push(`workflow_run_id = $${index}`);
    values.push(updates.workflowRunId);
    index += 1;
  }
  if (updates.dedupeKey !== undefined) {
    sets.push(`dedupe_key = $${index}`);
    values.push(updates.dedupeKey);
    index += 1;
  }
  if (updates.nextAttemptAt !== undefined) {
    sets.push(`next_attempt_at = $${index}`);
    values.push(updates.nextAttemptAt);
    index += 1;
  }
  if (updates.throttledUntil !== undefined) {
    sets.push(`throttled_until = $${index}`);
    values.push(updates.throttledUntil);
    index += 1;
  }
  if (updates.retryState !== undefined) {
    sets.push(`retry_state = $${index}`);
    values.push(updates.retryState);
    index += 1;
  }
  if (updates.retryAttempts !== undefined) {
    sets.push(`retry_attempts = $${index}`);
    values.push(updates.retryAttempts);
    index += 1;
  }
  if (updates.retryMetadata !== undefined) {
    sets.push(`retry_metadata = $${index}::jsonb`);
    values.push(serializeJson(updates.retryMetadata));
    index += 1;
  }

  if (sets.length === 0) {
    return getWorkflowTriggerDeliveryById(deliveryId);
  }

  sets.push('updated_at = NOW()');

  const query = `UPDATE workflow_trigger_deliveries SET ${sets.join(', ')} WHERE id = $${index} RETURNING *`;
  values.push(deliveryId);

  const { rows } = await useConnection((client) => client.query<WorkflowTriggerDeliveryRow>(query, values));
  if (rows.length === 0) {
    return null;
  }
  return mapWorkflowTriggerDeliveryRow(rows[0]);
}

export async function getWorkflowTriggerDeliveryById(
  deliveryId: string
): Promise<WorkflowTriggerDeliveryRecord | null> {
  const { rows } = await useConnection((client) =>
    client.query<WorkflowTriggerDeliveryRow>('SELECT * FROM workflow_trigger_deliveries WHERE id = $1', [deliveryId])
  );
  if (rows.length === 0) {
    return null;
  }
  return mapWorkflowTriggerDeliveryRow(rows[0]);
}

export async function listWorkflowTriggerDeliveries(
  options: WorkflowTriggerDeliveryListOptions = {}
): Promise<WorkflowTriggerDeliveryRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let index = 1;

  if (options.triggerId) {
    conditions.push(`trigger_id = $${index}`);
    params.push(options.triggerId);
    index += 1;
  }

  if (options.eventId) {
    conditions.push(`event_id = $${index}`);
    params.push(options.eventId);
    index += 1;
  }

  if (options.status) {
    conditions.push(`status = $${index}`);
    params.push(options.status);
    index += 1;
  }

  if (options.dedupeKey) {
    conditions.push(`dedupe_key = $${index}`);
    params.push(options.dedupeKey);
    index += 1;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const query = `SELECT * FROM workflow_trigger_deliveries ${whereClause} ORDER BY created_at DESC LIMIT ${limit}`;

  const { rows } = await useConnection((client) => client.query<WorkflowTriggerDeliveryRow>(query, params));
  return rows.map(mapWorkflowTriggerDeliveryRow);
}

export async function listScheduledWorkflowTriggerDeliveries(
  limit = 200
): Promise<WorkflowTriggerDeliveryRecord[]> {
  const bounded = Math.max(1, Math.min(limit, 500));
  const { rows } = await useConnection((client) =>
    client.query<WorkflowTriggerDeliveryRow>(
      `SELECT *
         FROM workflow_trigger_deliveries
        WHERE retry_state = 'scheduled'
        ORDER BY next_attempt_at ASC NULLS LAST
        LIMIT $1`,
      [bounded]
    )
  );
  return rows.map(mapWorkflowTriggerDeliveryRow);
}

export async function listWorkflowTriggerDeliveriesForWorkflow(
  workflowDefinitionId: string,
  options: { from: string; to: string; limit?: number; statuses?: string[] }
): Promise<WorkflowTriggerDeliveryRecord[]> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const params: unknown[] = [workflowDefinitionId, options.from, options.to];
  let paramIndex = 4;
  let statusClause = '';

  if (options.statuses && options.statuses.length > 0) {
    statusClause = ` AND status = ANY($${paramIndex}::text[])`;
    params.push(options.statuses);
    paramIndex += 1;
  }

  params.push(limit);

  const query = `SELECT *
                   FROM workflow_trigger_deliveries
                  WHERE workflow_definition_id = $1
                    AND created_at >= $2
                    AND created_at <= $3${statusClause}
                  ORDER BY created_at DESC
                  LIMIT $${paramIndex}`;

  const { rows } = await useConnection((client) => client.query<WorkflowTriggerDeliveryRow>(query, params));
  return rows.map(mapWorkflowTriggerDeliveryRow);
}

export async function countRecentWorkflowTriggerDeliveries(
  triggerId: string,
  sinceIso: string,
  excludeDeliveryId?: string | null
): Promise<number> {
  const params: unknown[] = [triggerId, sinceIso];
  let query = `SELECT COUNT(*)::text AS count
                 FROM workflow_trigger_deliveries
                WHERE trigger_id = $1
                  AND created_at >= $2
                  AND status IN ('pending', 'matched', 'launched')`;

  if (excludeDeliveryId) {
    query += ' AND id <> $3';
    params.push(excludeDeliveryId);
  }

  const { rows } = await useConnection((client) =>
    client.query<{ count: string }>(query, params)
  );
  return rows.length > 0 ? Number.parseInt(rows[0].count, 10) : 0;
}

export async function countActiveWorkflowTriggerDeliveries(triggerId: string): Promise<number> {
  const { rows } = await useConnection((client) =>
    client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM workflow_trigger_deliveries
        WHERE trigger_id = $1
          AND status IN ('pending', 'matched', 'launched')`,
      [triggerId]
    )
  );
  return rows.length > 0 ? Number.parseInt(rows[0].count, 10) : 0;
}

export async function findWorkflowTriggerDeliveryByDedupeKey(
  triggerId: string,
  dedupeKey: string
): Promise<WorkflowTriggerDeliveryRecord | null> {
  const { rows } = await useConnection((client) =>
    client.query<WorkflowTriggerDeliveryRow>(
      `SELECT *
         FROM workflow_trigger_deliveries
        WHERE trigger_id = $1
          AND dedupe_key = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [triggerId, dedupeKey]
    )
  );
  if (rows.length === 0) {
    return null;
  }
  return mapWorkflowTriggerDeliveryRow(rows[0]);
}

export async function deleteWorkflowSchedule(scheduleId: string): Promise<boolean> {
  let deleted = false;
  let definition: WorkflowDefinitionRecord | null = null;

  await useTransaction(async (client) => {
    const schedule = await fetchWorkflowScheduleById(client, scheduleId);
    if (!schedule) {
      return;
    }

    await client.query('DELETE FROM workflow_schedules WHERE id = $1', [scheduleId]);
    deleted = true;

    definition = await fetchWorkflowDefinitionById(client, schedule.workflowDefinitionId);
  });

  if (definition) {
    emitWorkflowDefinitionEvent(definition);
  }

  return deleted;
}

export async function updateWorkflowScheduleRuntimeMetadata(
  scheduleId: string,
  updates: {
    nextRunAt?: string | null;
    catchupCursor?: string | null;
    lastWindow?: WorkflowScheduleWindow | null;
  },
  options: {
    client?: PoolClient;
    expectedUpdatedAt?: string | null;
  } = {}
): Promise<WorkflowScheduleRecord | null> {
  let schedule: WorkflowScheduleRecord | null = null;

  const runUpdate = async (client: PoolClient) => {
    const hasNextRun = Object.prototype.hasOwnProperty.call(updates, 'nextRunAt');
    const hasCatchupCursor = Object.prototype.hasOwnProperty.call(updates, 'catchupCursor');
    const hasLastWindow = Object.prototype.hasOwnProperty.call(updates, 'lastWindow');

    const sets: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    if (hasNextRun) {
      sets.push(`next_run_at = $${index}`);
      values.push(updates.nextRunAt ?? null);
      index += 1;
    }

    if (hasCatchupCursor) {
      sets.push(`catchup_cursor = $${index}`);
      values.push(updates.catchupCursor ?? null);
      index += 1;
    }

    if (hasLastWindow) {
      sets.push(`last_materialized_window = $${index}::jsonb`);
      values.push(serializeScheduleWindow(updates.lastWindow ?? null));
      index += 1;
    }

    if (sets.length === 0) {
      schedule = await fetchWorkflowScheduleById(client, scheduleId);
      return;
    }

    sets.push(`updated_at = NOW()`);
    const where: string[] = [`id = $${index}`];
    values.push(scheduleId);

    if (options.expectedUpdatedAt) {
      index += 1;
      where.push(`updated_at = $${index}`);
      values.push(options.expectedUpdatedAt);
    }

    const whereClause = where.join(' AND ');

    const { rows } = await client.query<WorkflowScheduleRow>(
      `UPDATE workflow_schedules
          SET ${sets.join(', ')}
        WHERE ${whereClause}
        RETURNING *`,
      values
    );

    if (rows.length === 0) {
      schedule = null;
      return;
    }

    schedule = mapWorkflowScheduleRow(rows[0]);
  };

  if (options.client) {
    await runUpdate(options.client);
    return schedule;
  }

  await useTransaction(async (client) => {
    await runUpdate(client);
  });

  return schedule;
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
  const { runKey, runKeyNormalized } = computeRunKeyColumns(input.runKey ?? null);

  let run: WorkflowRunRecord | null = null;

  async function insertRun(client: PoolClient): Promise<WorkflowRunRecord> {
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
         run_key,
         run_key_normalized,
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
         $11,
         $12,
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
        partitionKey,
        runKey,
        runKeyNormalized
      ]
    );
    if (rows.length === 0) {
      throw new Error('failed to insert workflow run');
    }
    return mapWorkflowRunRow(rows[0]);
  }

  await useTransaction(async (client) => {
    run = await insertRun(client);
  });

  if (!run) {
    throw new Error('failed to create workflow run');
  }

  emitWorkflowRunEvents(run);
  return run;
}


export async function getWorkflowRunById(id: string): Promise<WorkflowRunRecord | null> {
  const run = await useConnection((client) => fetchWorkflowRunById(client, id));
  if (!run) {
    return null;
  }
  await attachWorkflowRunRetrySummaries([run]);
  return run;
}

export async function getActiveWorkflowRunByKey(
  workflowDefinitionId: string,
  runKeyNormalized: string
): Promise<WorkflowRunRecord | null> {
  if (!runKeyNormalized) {
    return null;
  }

  const { rows } = await useConnection((client) =>
    client.query<WorkflowRunRow>(
      `SELECT *
         FROM workflow_runs
        WHERE workflow_definition_id = $1
          AND run_key_normalized = $2
          AND status IN ('pending', 'running')
        ORDER BY created_at DESC
        LIMIT 1`,
      [workflowDefinitionId, runKeyNormalized]
    )
  );

  if (rows.length === 0) {
    return null;
  }

  const run = mapWorkflowRunRow(rows[0]);
  await attachWorkflowRunRetrySummaries([run]);
  return run;
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
    const runs = rows.map(mapWorkflowRunRow);
    await attachWorkflowRunRetrySummaries(runs);
    return runs;
  });
}

export async function listUnstartedWorkflowRuns(
  limit: number,
  olderThanIso: string
): Promise<WorkflowRunRecord[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 200));

  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowRunRow>(
      `SELECT *
         FROM workflow_runs
        WHERE status = 'pending'
          AND started_at IS NULL
          AND current_step_id IS NULL
          AND updated_at <= $2
        ORDER BY updated_at ASC
        LIMIT $1`,
      [boundedLimit, olderThanIso]
    );
    if (rows.length === 0) {
      return [];
    }
    const runs = rows.map(mapWorkflowRunRow);
    await attachWorkflowRunRetrySummaries(runs);
    return runs;
  });
}

export async function listWorkflowRunsInRange(
  workflowDefinitionId: string,
  options: { from: string; to: string; limit?: number }
): Promise<WorkflowRunRecord[]> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);

  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowRunRow>(
      `SELECT *
         FROM workflow_runs
        WHERE workflow_definition_id = $1
          AND created_at >= $2
          AND created_at <= $3
        ORDER BY created_at DESC
        LIMIT $4`,
      [workflowDefinitionId, options.from, options.to, limit]
    );
    const runs = rows.map(mapWorkflowRunRow);
    await attachWorkflowRunRetrySummaries(runs);
    return runs;
  });
}

export async function listWorkflowAutoRunsForDefinition(
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
         AND trigger ->> 'type' = 'auto-materialize'
       ORDER BY created_at DESC
       LIMIT $2
       OFFSET $3`,
      [workflowDefinitionId, limit, offset]
    );
    const runs = rows.map(mapWorkflowRunRow);
    await attachWorkflowRunRetrySummaries(runs);
    return runs;
  });
}

type WorkflowRunWithDefinitionRow = WorkflowRunRow & {
  workflow_slug: string;
  workflow_name: string;
  workflow_version: number;
};

type WorkflowRunListFilters = {
  statuses?: string[];
  workflowSlugs?: string[];
  triggerTypes?: string[];
  partition?: string;
  search?: string;
  from?: string;
  to?: string;
};

export type WorkflowActivityTriggerSummary = {
  id: string | null;
  name: string | null;
  eventType: string | null;
  eventSource: string | null;
  status: string | null;
};

export type WorkflowActivityEntry = {
  kind: 'run' | 'delivery';
  id: string;
  status: string;
  occurredAt: string;
  workflow: {
    id: string;
    slug: string;
    name: string;
    version: number;
  };
  run: WorkflowRunRecord | null;
  delivery: WorkflowTriggerDeliveryRecord | null;
  linkedRun: WorkflowRunRecord | null;
  trigger: WorkflowActivityTriggerSummary | null;
};

type WorkflowActivityListFilters = {
  statuses?: string[];
  workflowSlugs?: string[];
  triggerTypes?: string[];
  triggerIds?: string[];
  kinds?: ('run' | 'delivery')[];
  search?: string;
  from?: string;
  to?: string;
};

export async function listWorkflowRuns(
  options: { limit?: number; offset?: number; filters?: WorkflowRunListFilters } = {}
): Promise<{ items: WorkflowRunWithDefinition[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const offset = Math.max(options.offset ?? 0, 0);
  const queryLimit = limit + 1;
  const filters = options.filters ?? {};

  return useConnection(async (client) => {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (Array.isArray(filters.statuses) && filters.statuses.length > 0) {
      const normalized = Array.from(
        new Set(filters.statuses.map((status) => status.trim().toLowerCase()).filter((status) => status.length > 0))
      );
      if (normalized.length > 0) {
        params.push(normalized);
        conditions.push(`wr.status = ANY($${params.length}::text[])`);
      }
    }

    if (Array.isArray(filters.workflowSlugs) && filters.workflowSlugs.length > 0) {
      const slugs = Array.from(
        new Set(filters.workflowSlugs.map((slug) => slug.trim()).filter((slug) => slug.length > 0))
      );
      if (slugs.length > 0) {
        params.push(slugs);
        conditions.push(`wd.slug = ANY($${params.length}::text[])`);
      }
    }

    if (Array.isArray(filters.triggerTypes) && filters.triggerTypes.length > 0) {
      const triggerTypes = Array.from(
        new Set(filters.triggerTypes.map((type) => type.trim().toLowerCase()).filter((type) => type.length > 0))
      );
      if (triggerTypes.length > 0) {
        params.push(triggerTypes);
        conditions.push(`LOWER(COALESCE(wr.trigger ->> 'type', 'manual')) = ANY($${params.length}::text[])`);
      }
    }

    if (typeof filters.partition === 'string' && filters.partition.trim().length > 0) {
      params.push(`%${filters.partition.trim()}%`);
      conditions.push(`wr.partition_key ILIKE $${params.length}`);
    }

    if (typeof filters.search === 'string' && filters.search.trim().length > 0) {
      const term = `%${filters.search.trim().replace(/[%_]/g, '\\$&')}%`;
      params.push(term);
      params.push(term);
      params.push(term);
      params.push(term);
      params.push(term);
      conditions.push(
        `(
           wr.id ILIKE $${params.length - 4}
           OR wd.slug ILIKE $${params.length - 3}
           OR wd.name ILIKE $${params.length - 2}
           OR COALESCE(wr.triggered_by, '') ILIKE $${params.length - 1}
           OR COALESCE(wr.partition_key, '') ILIKE $${params.length}
         )`
      );
    }

    if (typeof filters.from === 'string' && filters.from.trim().length > 0) {
      const parsed = new Date(filters.from);
      if (!Number.isNaN(parsed.getTime())) {
        params.push(parsed.toISOString());
        conditions.push(`wr.created_at >= $${params.length}`);
      }
    }

    if (typeof filters.to === 'string' && filters.to.trim().length > 0) {
      const parsed = new Date(filters.to);
      if (!Number.isNaN(parsed.getTime())) {
        params.push(parsed.toISOString());
        conditions.push(`wr.created_at <= $${params.length}`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(queryLimit);
    params.push(offset);

    const { rows } = await client.query<WorkflowRunWithDefinitionRow>(
      `SELECT wr.*, wd.slug AS workflow_slug, wd.name AS workflow_name, wd.version AS workflow_version
       FROM workflow_runs wr
       INNER JOIN workflow_definitions wd ON wd.id = wr.workflow_definition_id
       ${whereClause}
       ORDER BY wr.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
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

    await attachWorkflowRunRetrySummaries(mapped.map((entry) => entry.run));

    const hasMore = mapped.length > limit;
    const items = hasMore ? mapped.slice(0, limit) : mapped;
    return { items, hasMore };
  });
}

export async function listWorkflowActivity(
  options: { limit?: number; offset?: number; filters?: WorkflowActivityListFilters } = {}
): Promise<{ items: WorkflowActivityEntry[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const queryLimit = limit + 1;
  const filters = options.filters ?? {};

  const params: unknown[] = [];
  const addParam = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const runConditions: string[] = [];
  const deliveryConditions: string[] = [];
  const outerConditions: string[] = [];

  const normalizeArray = (values: string[] | undefined) =>
    Array.from(
      new Set((values ?? []).map((value) => value.trim()).filter((value) => value.length > 0))
    );

  const statuses = normalizeArray(filters.statuses?.map((status) => status.toLowerCase()))
    .map((status) => status.toLowerCase())
    .filter((status) => status.length > 0);
  if (statuses.length > 0) {
    const placeholder = addParam(statuses);
    runConditions.push(`LOWER(wr.status) = ANY(${placeholder}::text[])`);
    deliveryConditions.push(`LOWER(wtd.status) = ANY(${placeholder}::text[])`);
  }

  const workflowSlugs = normalizeArray(filters.workflowSlugs);
  if (workflowSlugs.length > 0) {
    const placeholder = addParam(workflowSlugs);
    runConditions.push(`wd.slug = ANY(${placeholder}::text[])`);
    deliveryConditions.push(`wd.slug = ANY(${placeholder}::text[])`);
  }

  const triggerTypes = normalizeArray(filters.triggerTypes?.map((type) => type.toLowerCase()));
  if (triggerTypes.length > 0) {
    const placeholder = addParam(triggerTypes);
    runConditions.push(`LOWER(COALESCE(wr.trigger ->> 'type', 'manual')) = ANY(${placeholder}::text[])`);
  }

  const triggerIds = normalizeArray(filters.triggerIds);
  if (triggerIds.length > 0) {
    const placeholder = addParam(triggerIds);
    deliveryConditions.push(`wtd.trigger_id = ANY(${placeholder}::text[])`);
  }

  if (typeof filters.from === 'string' && filters.from.trim().length > 0) {
    const placeholder = addParam(filters.from);
    runConditions.push(`wr.created_at >= ${placeholder}`);
    deliveryConditions.push(`COALESCE(wtd.updated_at, wtd.created_at) >= ${placeholder}`);
  }

  if (typeof filters.to === 'string' && filters.to.trim().length > 0) {
    const placeholder = addParam(filters.to);
    runConditions.push(`wr.created_at <= ${placeholder}`);
    deliveryConditions.push(`COALESCE(wtd.updated_at, wtd.created_at) <= ${placeholder}`);
  }

  const kinds = normalizeArray(filters.kinds?.map((kind) => kind.toLowerCase()))
    .map((kind) => (kind === 'delivery' ? 'delivery' : kind === 'run' ? 'run' : ''))
    .filter((kind): kind is 'run' | 'delivery' => kind === 'run' || kind === 'delivery');
  if (kinds.length > 0) {
    const placeholder = addParam(kinds);
    outerConditions.push(`activity.kind = ANY(${placeholder}::text[])`);
  }

  if (typeof filters.search === 'string' && filters.search.trim().length > 0) {
    const term = `%${filters.search.trim().replace(/[%_]/g, '\\$&')}%`;
    const placeholder = addParam(term);
    outerConditions.push(
      `(
         activity.workflow_slug ILIKE ${placeholder}
         OR activity.workflow_name ILIKE ${placeholder}
         OR activity.entry_id ILIKE ${placeholder}
         OR (activity.run_data ->> 'run_key') ILIKE ${placeholder}
         OR (activity.run_data ->> 'triggered_by') ILIKE ${placeholder}
         OR (activity.delivery_data ->> 'event_id') ILIKE ${placeholder}
         OR (activity.delivery_data ->> 'dedupe_key') ILIKE ${placeholder}
         OR (activity.trigger_data ->> 'name') ILIKE ${placeholder}
         OR (activity.trigger_data ->> 'eventType') ILIKE ${placeholder}
       )`
    );
  }

  const runWhereClause = runConditions.length > 0 ? `WHERE ${runConditions.join(' AND ')}` : '';
  const deliveryWhereClause =
    deliveryConditions.length > 0 ? `WHERE ${deliveryConditions.join(' AND ')}` : '';
  const outerWhereClause = outerConditions.length > 0 ? `WHERE ${outerConditions.join(' AND ')}` : '';

  const limitPlaceholder = addParam(queryLimit);
  const offsetPlaceholder = addParam(offset);

  const query = `
    SELECT *
      FROM (
        SELECT
          'run'::text AS kind,
          wr.id AS entry_id,
          wr.workflow_definition_id,
          wd.slug AS workflow_slug,
          wd.name AS workflow_name,
          wd.version AS workflow_version,
          wr.status AS status,
          wr.created_at AS occurred_at,
          NULL::text AS trigger_id,
          to_jsonb(wr) AS run_data,
          NULL::jsonb AS linked_run_data,
          NULL::jsonb AS delivery_data,
          NULL::jsonb AS trigger_data
        FROM workflow_runs wr
        INNER JOIN workflow_definitions wd ON wd.id = wr.workflow_definition_id
        ${runWhereClause}
      UNION ALL
        SELECT
          'delivery'::text AS kind,
          wtd.id AS entry_id,
          wtd.workflow_definition_id,
          wd.slug AS workflow_slug,
          wd.name AS workflow_name,
          wd.version AS workflow_version,
          wtd.status AS status,
          COALESCE(wtd.updated_at, wtd.created_at) AS occurred_at,
          wtd.trigger_id AS trigger_id,
          NULL::jsonb AS run_data,
          to_jsonb(wr_linked) AS linked_run_data,
          to_jsonb(wtd) AS delivery_data,
          CASE
            WHEN wet.id IS NULL THEN NULL
            ELSE jsonb_build_object(
              'id', wet.id,
              'name', wet.name,
              'eventType', wet.event_type,
              'eventSource', wet.event_source,
              'status', wet.status
            )
          END AS trigger_data
        FROM workflow_trigger_deliveries wtd
        INNER JOIN workflow_definitions wd ON wd.id = wtd.workflow_definition_id
        LEFT JOIN workflow_event_triggers wet ON wet.id = wtd.trigger_id
        LEFT JOIN workflow_runs wr_linked ON wr_linked.id = wtd.workflow_run_id
        ${deliveryWhereClause}
      ) AS activity
      ${outerWhereClause}
      ORDER BY activity.occurred_at DESC, activity.entry_id DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`;

  const { rows } = await useConnection((client) => client.query<WorkflowActivityRow>(query, params));

  const runMap = new Map<string, WorkflowRunRecord>();
  const entries = rows.map((row) => {
    const baseWorkflow = {
      id: row.workflow_definition_id,
      slug: row.workflow_slug,
      name: row.workflow_name,
      version: row.workflow_version
    };

    let run: WorkflowRunRecord | null = null;
    if (row.kind === 'run' && row.run_data) {
      const mappedRun = mapWorkflowRunRow(row.run_data);
      const existing = runMap.get(mappedRun.id);
      if (existing) {
        run = existing;
      } else {
        runMap.set(mappedRun.id, mappedRun);
        run = mappedRun;
      }
    }

    let linkedRun: WorkflowRunRecord | null = null;
    if (row.kind === 'delivery' && row.linked_run_data) {
      const mappedLinkedRun = mapWorkflowRunRow(row.linked_run_data);
      const existing = runMap.get(mappedLinkedRun.id);
      if (existing) {
        linkedRun = existing;
      } else {
        runMap.set(mappedLinkedRun.id, mappedLinkedRun);
        linkedRun = mappedLinkedRun;
      }
    }

    const delivery = row.kind === 'delivery' && row.delivery_data ? mapWorkflowTriggerDeliveryRow(row.delivery_data) : null;

    const trigger: WorkflowActivityTriggerSummary | null = row.trigger_data
      ? {
          id: typeof row.trigger_data.id === 'string' ? row.trigger_data.id : null,
          name: typeof row.trigger_data.name === 'string' ? row.trigger_data.name : null,
          eventType: typeof row.trigger_data.eventType === 'string' ? row.trigger_data.eventType : null,
          eventSource: typeof row.trigger_data.eventSource === 'string' ? row.trigger_data.eventSource : null,
          status: typeof row.trigger_data.status === 'string' ? row.trigger_data.status : null
        }
      : null;

    return {
      kind: row.kind === 'delivery' ? 'delivery' : 'run',
      id: row.entry_id,
      status: row.status,
      occurredAt: row.occurred_at,
      workflow: baseWorkflow,
      run,
      delivery,
      linkedRun,
      trigger
    } satisfies WorkflowActivityEntry;
  });

  if (runMap.size > 0) {
    await attachWorkflowRunRetrySummaries(Array.from(runMap.values()));
  }

  const hasMore = entries.length > limit;
  const items = hasMore ? entries.slice(0, limit) : entries;

  return { items, hasMore };
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
    let nextRunKey = existing.run_key ?? null;
    let nextRunKeyNormalized = existing.run_key_normalized ?? null;
    if (Object.prototype.hasOwnProperty.call(updates, 'runKey')) {
      const columns = computeRunKeyColumns(updates.runKey ?? null);
      nextRunKey = columns.runKey;
      nextRunKeyNormalized = columns.runKeyNormalized;
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
           run_key = $13,
           run_key_normalized = $14,
           started_at = $15,
           completed_at = $16,
           duration_ms = $17,
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
        nextRunKey,
        nextRunKeyNormalized,
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
      existing.run_key !== updated.runKey ||
      existing.error_message !== updated.errorMessage ||
      JSON.stringify(existing.output ?? null) !== JSON.stringify(updated.output ?? null);
  });

  if (updated) {
    await attachWorkflowRunRetrySummaries([updated]);
  }

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

export async function listScheduledWorkflowRunSteps(limit = 200): Promise<WorkflowRunStepRecord[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 500));
  const { rows } = await useConnection((client) =>
    client.query<WorkflowRunStepRow>(
      `SELECT *
         FROM workflow_run_steps
        WHERE retry_state = 'scheduled'
        ORDER BY next_attempt_at ASC NULLS LAST
        LIMIT $1`,
      [boundedLimit]
    )
  );
  const assets = await useConnection((client) =>
    fetchWorkflowRunStepAssets(
      client,
      rows.map((row) => row.id)
    )
  );
  return rows.map((row) => mapWorkflowRunStepRow(row, assets.get(row.id) ?? []));
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

export async function getWorkflowRunStepByJobRunId(jobRunId: string): Promise<WorkflowRunStepRecord | null> {
  const trimmed = jobRunId.trim();
  if (!trimmed) {
    return null;
  }

  const { rows } = await useConnection((client) =>
    client.query<WorkflowRunStepRow>(
      `SELECT *
         FROM workflow_run_steps
        WHERE job_run_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [trimmed]
    )
  );

  if (rows.length === 0) {
    return null;
  }

  return mapWorkflowRunStepRow(rows[0]);
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
    const nextNextAttemptAt = Object.prototype.hasOwnProperty.call(updates, 'nextAttemptAt')
      ? updates.nextAttemptAt ?? null
      : existing.next_attempt_at ?? null;
    const nextRetryState = updates.retryState ?? existing.retry_state ?? 'pending';
    const nextRetryAttempts = updates.retryAttempts ?? existing.retry_attempts ?? 0;
    const nextRetryMetadata =
      updates.retryMetadata !== undefined
        ? serializeJson(updates.retryMetadata)
        : reuseJsonColumn(existing.retry_metadata);

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
           next_attempt_at = $19,
           retry_state = $20,
           retry_attempts = $21,
           retry_metadata = $22::jsonb,
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
        nextFailureReason,
        nextNextAttemptAt,
        nextRetryState,
        nextRetryAttempts,
        nextRetryMetadata
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

import { mapWorkflowRunRow, mapWorkflowRunStepRow, mapWorkflowRunStepAssetRow, mapWorkflowExecutionHistoryRow, mapWorkflowTriggerDeliveryRow } from '../../db/rowMappers';
import { WorkflowRunRow, WorkflowRunStepRow, WorkflowRunStepAssetRow, WorkflowExecutionHistoryRow, WorkflowActivityRow } from '../../db/rowTypes';
import type {
  WorkflowRunCreateInput,
  WorkflowRunRecord,
  WorkflowRunRetrySummary,
  WorkflowRunWithDefinition,
  WorkflowRunStatus,
  WorkflowRunUpdateInput,
  WorkflowRunStepCreateInput,
  WorkflowRunStepRecord,
  WorkflowRunStepUpdateInput,
  WorkflowRunStepStatus,
  JsonValue,
  WorkflowRunStepAssetRecord,
  WorkflowRunStepAssetInput,
  WorkflowExecutionHistoryRecord,
  WorkflowExecutionHistoryEventInput,
  WorkflowTriggerDeliveryRecord,
  ModuleResourceContextRecord
} from '../../db/types';
import { useConnection, useTransaction } from '../../db/utils';
import { emitApphubEvent } from '../../events';
import { mirrorWorkflowRunLifecycle } from '../../streaming/workflowMirror';
import { computeRunKeyColumns } from '../runKey';
import { WorkflowRunListFilters, normalizePartitionKeyValue, upsertWorkflowAssetPartitionParameters } from './assetsRepository';
import { MANUAL_TRIGGER } from './definitionsRepository';
import { serializeJson, reuseJsonColumn } from './shared';
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import {
  deleteModuleAssignmentsForResource,
  listModuleAssignmentsForResource,
  upsertModuleResourceContext
} from '../../db/moduleResourceContexts';

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

export type WorkflowRunStatusCounts = Record<string, number>;

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

export type WorkflowActivityListFilters = {
  statuses?: string[];
  workflowSlugs?: string[];
  triggerTypes?: string[];
  triggerIds?: string[];
  kinds?: ('run' | 'delivery')[];
  search?: string;
  from?: string;
  to?: string;
  moduleIds?: string[];
  moduleWorkflowDefinitionIds?: string[];
  moduleWorkflowDefinitionSlugs?: string[];
  moduleWorkflowRunIds?: string[];
};

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

const TERMINAL_WORKFLOW_RUN_STATUSES: ReadonlySet<WorkflowRunStatus> = new Set([
  'succeeded',
  'failed',
  'canceled'
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseAssignmentMetadata(assignment: ModuleResourceContextRecord): Record<string, unknown> | null {
  if (!assignment.metadata) {
    return null;
  }
  if (isPlainObject(assignment.metadata)) {
    return assignment.metadata as Record<string, unknown>;
  }
  return null;
}

function selectLatestAssignment(
  assignments: ModuleResourceContextRecord[]
): ModuleResourceContextRecord | null {
  if (assignments.length === 0) {
    return null;
  }
  return assignments.reduce((latest, current) => {
    const latestTime = Date.parse(latest.updatedAt);
    const currentTime = Date.parse(current.updatedAt);
    if (Number.isNaN(latestTime) || currentTime > latestTime) {
      return current;
    }
    return latest;
  }, assignments[0]);
}

async function resolveWorkflowDefinitionAssignment(
  workflowDefinitionId: string
): Promise<ModuleResourceContextRecord | null> {
  const assignments = await listModuleAssignmentsForResource('workflow-definition', workflowDefinitionId);
  return selectLatestAssignment(assignments);
}

function buildWorkflowRunModuleContextMetadata(
  run: WorkflowRunRecord,
  definitionAssignment: ModuleResourceContextRecord | null
): JsonValue {
  const metadata: Record<string, JsonValue> = {
    workflowDefinitionId: run.workflowDefinitionId,
    status: run.status,
    runKey: run.runKey ?? null,
    runKeyNormalized: run.runKeyNormalized ?? null,
    partitionKey: run.partitionKey ?? null,
    triggeredBy: run.triggeredBy ?? null,
    trigger: run.trigger ?? null,
    startedAt: run.startedAt ?? null,
    completedAt: run.completedAt ?? null,
    durationMs: run.durationMs ?? null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  } satisfies Record<string, JsonValue>;

  const assignmentMetadata = definitionAssignment ? parseAssignmentMetadata(definitionAssignment) : null;
  if (assignmentMetadata) {
    if (typeof assignmentMetadata.slug === 'string') {
      metadata.workflowSlug = assignmentMetadata.slug;
    }
    if (typeof assignmentMetadata.name === 'string') {
      metadata.workflowName = assignmentMetadata.name;
    }
    if (assignmentMetadata.version !== undefined) {
      metadata.workflowVersion = assignmentMetadata.version as JsonValue;
    }
  }

  return metadata;
}

async function syncWorkflowRunModuleContext(run: WorkflowRunRecord): Promise<void> {
  if (TERMINAL_WORKFLOW_RUN_STATUSES.has(run.status)) {
    await deleteModuleAssignmentsForResource('workflow-run', run.id);
    return;
  }

  const assignment = await resolveWorkflowDefinitionAssignment(run.workflowDefinitionId);

  if (!assignment) {
    await deleteModuleAssignmentsForResource('workflow-run', run.id);
    return;
  }

  const assignmentMetadata = parseAssignmentMetadata(assignment);
  const workflowSlug = assignmentMetadata && typeof assignmentMetadata.slug === 'string' ? assignmentMetadata.slug : null;
  const workflowName = assignmentMetadata && typeof assignmentMetadata.name === 'string' ? assignmentMetadata.name : null;

  try {
    await upsertModuleResourceContext({
      moduleId: assignment.moduleId,
      moduleVersion: assignment.moduleVersion ?? null,
      resourceType: 'workflow-run',
      resourceId: run.id,
      resourceSlug: workflowSlug,
      resourceName: workflowName,
      resourceVersion: run.runKey ?? run.id,
      metadata: buildWorkflowRunModuleContextMetadata(run, assignment)
    });
  } catch (err) {
    console.warn('[workflows] failed to sync workflow run module context', {
      workflowRunId: run.id,
      moduleId: assignment.moduleId,
      error: err instanceof Error ? err.message : String(err)
    });
  }
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

function emitWorkflowRunEvents(run: WorkflowRunRecord | null, { forceUpdatedEvent = true } = {}) {
  if (!run) {
    return;
  }
  if (forceUpdatedEvent) {
    emitApphubEvent({ type: 'workflow.run.updated', data: { run } });
    mirrorWorkflowRunLifecycle('workflow.run.updated', run);
  }
  const statusEvent = `workflow.run.${run.status}` as const;
  emitApphubEvent({ type: statusEvent, data: { run } });
  mirrorWorkflowRunLifecycle(statusEvent, run);
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
  let reusedExistingRun = false;

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
    if (runKeyNormalized) {
      const existing = await client.query<WorkflowRunRow>(
        `SELECT *
           FROM workflow_runs
          WHERE workflow_definition_id = $1
            AND run_key_normalized = $2
            AND status IN ('pending', 'running')
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE`,
        [workflowDefinitionId, runKeyNormalized]
      );
      if (existing.rows.length > 0) {
        run = mapWorkflowRunRow(existing.rows[0]);
        reusedExistingRun = true;
        return;
      }
    }
    run = await insertRun(client);
  });

  if (!run) {
    throw new Error('failed to create workflow run');
  }

  await syncWorkflowRunModuleContext(run);

  if (!reusedExistingRun) {
    emitWorkflowRunEvents(run);
  }

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

export async function listWorkflowRunExecutionHistory(
  workflowRunId: string
): Promise<WorkflowExecutionHistoryRecord[]> {
  const trimmed = workflowRunId?.trim() ?? '';
  if (!trimmed) {
    return [];
  }
  const { rows } = await useConnection((client) =>
    client.query<WorkflowExecutionHistoryRow>(
      `SELECT *
         FROM workflow_execution_history
        WHERE workflow_run_id = $1
        ORDER BY created_at ASC, id ASC`,
      [trimmed]
    )
  );
  return rows.map(mapWorkflowExecutionHistoryRow);
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
  options: { limit?: number; offset?: number; moduleIds?: string[] | null } = {}
): Promise<WorkflowRunRecord[]> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const offset = Math.max(options.offset ?? 0, 0);
  const moduleIds = Array.isArray(options.moduleIds)
    ? Array.from(new Set(options.moduleIds.map((id) => id.trim()).filter((id) => id.length > 0)))
    : null;

  return useConnection(async (client) => {
    const params: unknown[] = [workflowDefinitionId, limit, offset];
    const moduleFilterClause = moduleIds && moduleIds.length > 0
      ? `AND EXISTS (
          SELECT 1
            FROM module_resource_contexts mrc
           WHERE mrc.resource_type = 'workflow-run'
             AND mrc.resource_id = workflow_runs.id
             AND mrc.module_id = ANY($4::text[])
        )`
      : '';

    if (moduleIds && moduleIds.length > 0) {
      params.push(moduleIds);
    }

    const { rows } = await client.query<WorkflowRunRow>(
      `SELECT *
       FROM workflow_runs
       WHERE workflow_definition_id = $1
         AND trigger ->> 'type' = 'auto-materialize'
         ${moduleFilterClause}
       ORDER BY created_at DESC
       LIMIT $2
       OFFSET $3`,
      params
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

    const moduleIds = Array.isArray(filters.moduleIds)
      ? Array.from(new Set(filters.moduleIds.map((id) => id.trim()).filter((id) => id.length > 0)))
      : [];

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
      const searchableColumns = [
        'wr.id',
        'wd.slug',
        'wd.name',
        "COALESCE(wr.triggered_by, '')",
        "COALESCE(wr.partition_key, '')",
        "COALESCE(wr.run_key, '')"
      ];
      const searchFragments: string[] = [];
      for (const column of searchableColumns) {
        params.push(term);
        searchFragments.push(`${column} ILIKE $${params.length}`);
      }
      conditions.push(`(${searchFragments.join(' OR ')})`);
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

    if (moduleIds.length > 0) {
      const moduleParamIndex = params.push(moduleIds);
      const loweredModuleIds = moduleIds.map((id) => id.toLowerCase());
      const slugEqualsIndex = params.push(loweredModuleIds);
      const slugPatternIndex = params.push(loweredModuleIds.map((id) => `${id}-%`));
      conditions.push(`(
        LOWER(wd.slug) = ANY($${slugEqualsIndex}::text[])
        OR LOWER(wd.slug) LIKE ANY($${slugPatternIndex}::text[])
        OR EXISTS (
          SELECT 1
            FROM module_resource_contexts mrc
           WHERE mrc.resource_type = 'workflow-definition'
             AND mrc.resource_id = wd.id
             AND mrc.module_id = ANY($${moduleParamIndex}::text[])
        )
        OR EXISTS (
          SELECT 1
            FROM module_resource_contexts mrc
           WHERE mrc.resource_type = 'workflow-run'
             AND mrc.resource_id = wr.id
             AND mrc.module_id = ANY($${moduleParamIndex}::text[])
        )
      )`);
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

  const moduleWorkflowDefinitionIds = normalizeArray(filters.moduleWorkflowDefinitionIds);
  const moduleWorkflowDefinitionSlugs = normalizeArray(filters.moduleWorkflowDefinitionSlugs);
  const moduleWorkflowRunIds = normalizeArray(filters.moduleWorkflowRunIds);
  const moduleIds = normalizeArray(filters.moduleIds);

  const moduleRunConditionParts: string[] = [];
  const moduleDeliveryConditionParts: string[] = [];

  if (moduleWorkflowDefinitionIds.length > 0) {
    const placeholder = addParam(moduleWorkflowDefinitionIds);
    moduleRunConditionParts.push(`wr.workflow_definition_id = ANY(${placeholder}::text[])`);
    moduleDeliveryConditionParts.push(`wtd.workflow_definition_id = ANY(${placeholder}::text[])`);
  }

  if (moduleWorkflowDefinitionSlugs.length > 0) {
    const placeholder = addParam(moduleWorkflowDefinitionSlugs);
    moduleRunConditionParts.push(`wd.slug = ANY(${placeholder}::text[])`);
    moduleDeliveryConditionParts.push(`wd.slug = ANY(${placeholder}::text[])`);
  }

  if (moduleWorkflowRunIds.length > 0) {
    const placeholder = addParam(moduleWorkflowRunIds);
    moduleRunConditionParts.push(`wr.id = ANY(${placeholder}::text[])`);
    moduleDeliveryConditionParts.push(`wtd.workflow_run_id = ANY(${placeholder}::text[])`);
  }

  if (
    moduleIds.length > 0 &&
    moduleRunConditionParts.length === 0 &&
    moduleDeliveryConditionParts.length === 0
  ) {
    const modulePlaceholder = addParam(moduleIds);
    const loweredModuleIds = moduleIds.map((id) => id.toLowerCase());
    const slugEqualsPlaceholder = addParam(loweredModuleIds);
    const slugPatternPlaceholder = addParam(loweredModuleIds.map((id) => `${id}-%`));

    moduleRunConditionParts.push(`(
      LOWER(wd.slug) = ANY(${slugEqualsPlaceholder}::text[])
      OR LOWER(wd.slug) LIKE ANY(${slugPatternPlaceholder}::text[])
      OR EXISTS (
        SELECT 1
          FROM module_resource_contexts mrc
         WHERE mrc.resource_type = 'workflow-definition'
           AND mrc.resource_id = wd.id
           AND mrc.module_id = ANY(${modulePlaceholder}::text[])
      )
      OR EXISTS (
        SELECT 1
          FROM module_resource_contexts mrc
         WHERE mrc.resource_type = 'workflow-run'
           AND mrc.resource_id = wr.id
           AND mrc.module_id = ANY(${modulePlaceholder}::text[])
      )
    )`);

    moduleDeliveryConditionParts.push(`(
      LOWER(wd.slug) = ANY(${slugEqualsPlaceholder}::text[])
      OR LOWER(wd.slug) LIKE ANY(${slugPatternPlaceholder}::text[])
      OR EXISTS (
        SELECT 1
          FROM module_resource_contexts mrc
         WHERE mrc.resource_type = 'workflow-definition'
           AND mrc.resource_id = wd.id
           AND mrc.module_id = ANY(${modulePlaceholder}::text[])
      )
      OR EXISTS (
        SELECT 1
          FROM module_resource_contexts mrc
         WHERE mrc.resource_type = 'workflow-run'
           AND mrc.resource_id = wtd.workflow_run_id
           AND mrc.module_id = ANY(${modulePlaceholder}::text[])
      )
    )`);
  }

  if (moduleRunConditionParts.length > 0) {
    runConditions.push(`(${moduleRunConditionParts.join(' OR ')})`);
  }

  if (moduleDeliveryConditionParts.length > 0) {
    deliveryConditions.push(`(${moduleDeliveryConditionParts.join(' OR ')})`);
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

  let kinds = normalizeArray(filters.kinds?.map((kind) => kind.toLowerCase()))
    .map((kind) => (kind === 'delivery' ? 'delivery' : kind === 'run' ? 'run' : ''))
    .filter((kind): kind is 'run' | 'delivery' => kind === 'run' || kind === 'delivery');
  if (kinds.length > 0) {
    kinds = Array.from(new Set(kinds));
  }
  let includeRuns = kinds.length === 0 || kinds.includes('run');
  let includeDeliveries = kinds.includes('delivery');
  if (!includeRuns && !includeDeliveries) {
    includeRuns = true;
    includeDeliveries = true;
  }

  const searchTerm =
    typeof filters.search === 'string' && filters.search.trim().length > 0
      ? `%${filters.search.trim().replace(/[%_]/g, '\\$&')}%`
      : null;
  const sourceLimit = Math.max(offset + queryLimit, queryLimit);
  const unionParts: string[] = [];

  if (includeRuns) {
    if (searchTerm) {
      const placeholder = addParam(searchTerm);
      runConditions.push(
        `(
           wd.slug ILIKE ${placeholder}
           OR wd.name ILIKE ${placeholder}
           OR wr.id ILIKE ${placeholder}
           OR COALESCE(wr.run_key, '') ILIKE ${placeholder}
           OR COALESCE(wr.triggered_by, '') ILIKE ${placeholder}
         )`
      );
    }
    const runScopedWhere =
      runConditions.length > 0 ? `WHERE ${runConditions.join(' AND ')}` : '';
    const runLimitPlaceholder = addParam(sourceLimit);
    unionParts.push(`
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
      ${runScopedWhere}
      ORDER BY wr.created_at DESC, wr.id DESC
      LIMIT ${runLimitPlaceholder}
    `);
  }

  if (includeDeliveries) {
    if (searchTerm) {
      const placeholder = addParam(searchTerm);
      deliveryConditions.push(
        `(
           wd.slug ILIKE ${placeholder}
           OR wd.name ILIKE ${placeholder}
           OR wtd.id ILIKE ${placeholder}
           OR wtd.event_id ILIKE ${placeholder}
           OR COALESCE(wtd.dedupe_key, '') ILIKE ${placeholder}
           OR COALESCE(wtd.trigger_id, '') ILIKE ${placeholder}
           OR COALESCE(wet.name, '') ILIKE ${placeholder}
           OR COALESCE(wet.event_type, '') ILIKE ${placeholder}
           OR COALESCE(wet.event_source, '') ILIKE ${placeholder}
           OR COALESCE(wr_linked.run_key, '') ILIKE ${placeholder}
         )`
      );
    }
    const deliveryScopedWhere =
      deliveryConditions.length > 0 ? `WHERE ${deliveryConditions.join(' AND ')}` : '';
    const deliveryLimitPlaceholder = addParam(sourceLimit);
    unionParts.push(`
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
      ${deliveryScopedWhere}
      ORDER BY COALESCE(wtd.updated_at, wtd.created_at) DESC, wtd.id DESC
      LIMIT ${deliveryLimitPlaceholder}
    `);
  }

  if (unionParts.length === 0) {
    return { items: [], hasMore: false };
  }

  const limitPlaceholder = addParam(queryLimit);
  const offsetPlaceholder = addParam(offset);
  const query = `
    SELECT *
      FROM (${unionParts.map((part) => `(${part})`).join(' UNION ALL ')}) AS activity
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

type WorkflowRunInternalUpdateResult = {
  record: WorkflowRunRecord | null;
  emitEvents: boolean;
};

async function updateWorkflowRunInternal(
  client: PoolClient,
  runId: string,
  updates: WorkflowRunUpdateInput
): Promise<WorkflowRunInternalUpdateResult> {
  let emitEvents = false;
  let updated: WorkflowRunRecord | null = null;

  const { rows } = await client.query<WorkflowRunRow>(
    'SELECT * FROM workflow_runs WHERE id = $1 FOR UPDATE',
    [runId]
  );
  if (rows.length === 0) {
    return { record: null, emitEvents: false };
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
    return { record: null, emitEvents: false };
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

  return { record: updated, emitEvents };
}

export async function updateWorkflowRun(
  runId: string,
  updates: WorkflowRunUpdateInput
): Promise<WorkflowRunRecord | null> {
  const { record, emitEvents } = await useTransaction((client) =>
    updateWorkflowRunInternal(client, runId, updates)
  );

  if (record) {
    await attachWorkflowRunRetrySummaries([record]);
    await syncWorkflowRunModuleContext(record);
  }

  if (record && emitEvents) {
    emitWorkflowRunEvents(record, { forceUpdatedEvent: true });
  }

  return record;
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
         resolution_error,
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
        $21,
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
        failureReason,
        input.resolutionError ?? false
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

async function updateWorkflowRunStepInternal(
  client: PoolClient,
  stepId: string,
  updates: WorkflowRunStepUpdateInput,
  expectedRunId?: string
): Promise<WorkflowRunStepRecord | null> {
  const { rows } = await client.query<WorkflowRunStepRow>(
    'SELECT * FROM workflow_run_steps WHERE id = $1 FOR UPDATE',
    [stepId]
  );
  if (rows.length === 0) {
    return null;
  }
  const existing = rows[0];
  if (expectedRunId && existing.workflow_run_id !== expectedRunId) {
    return null;
  }

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
  const nextResolutionError = Object.prototype.hasOwnProperty.call(updates, 'resolutionError')
    ? Boolean(updates.resolutionError)
    : Boolean(existing.resolution_error);

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
           resolution_error = $23,
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
      nextRetryMetadata,
      nextResolutionError
    ]
  );
  if (updatedRows.length === 0) {
    return null;
  }
  const assets = await fetchWorkflowRunStepAssets(client, [stepId]);
  return mapWorkflowRunStepRow(updatedRows[0], assets.get(stepId) ?? []);
}

export async function updateWorkflowRunStep(
  stepId: string,
  updates: WorkflowRunStepUpdateInput
): Promise<WorkflowRunStepRecord | null> {
  return useTransaction((client) => updateWorkflowRunStepInternal(client, stepId, updates));
}

export type WorkflowRunStepUpdateSpec = {
  stepId: string;
  updates: WorkflowRunStepUpdateInput;
};

export class WorkflowRunStepUpdateError extends Error {
  readonly stepId: string;
  readonly originalError: unknown;

  constructor(stepId: string, originalError: unknown) {
    super(`failed to update workflow run step ${stepId}`);
    this.name = 'WorkflowRunStepUpdateError';
    this.stepId = stepId;
    this.originalError = originalError;
  }
}

type WorkflowRunAndStepsUpdateResult = {
  run: WorkflowRunRecord | null;
  steps: WorkflowRunStepRecord[];
  emitEvents: boolean;
};

export async function updateWorkflowRunAndSteps(
  runId: string,
  runUpdates: WorkflowRunUpdateInput,
  stepUpdates: WorkflowRunStepUpdateSpec[]
): Promise<{ run: WorkflowRunRecord | null; steps: WorkflowRunStepRecord[] }> {
  const result = await useTransaction(async (client) => {
    const { record, emitEvents } = await updateWorkflowRunInternal(client, runId, runUpdates);
    if (!record) {
      return { run: null, steps: [], emitEvents: false };
    }

    const updatedSteps: WorkflowRunStepRecord[] = [];
    for (const entry of stepUpdates) {
      try {
        const updatedStep = await updateWorkflowRunStepInternal(client, entry.stepId, entry.updates, runId);
        if (!updatedStep) {
          throw new Error('workflow run step not found');
        }
        updatedSteps.push(updatedStep);
      } catch (err) {
        throw new WorkflowRunStepUpdateError(entry.stepId, err);
      }
    }

    return { run: record, steps: updatedSteps, emitEvents };
  });

  const { run, steps, emitEvents } = result;
  if (run) {
    await attachWorkflowRunRetrySummaries([run]);
    await syncWorkflowRunModuleContext(run);
    if (emitEvents) {
      emitWorkflowRunEvents(run, { forceUpdatedEvent: true });
    }
  }

  return { run, steps };
}

export async function backfillWorkflowRunModuleContextsForDefinition(
  workflowDefinitionId: string
): Promise<number> {
  const batchSize = 200;
  let offset = 0;
  let processed = 0;

  while (true) {
    const rows = await useConnection((client) =>
      client
        .query<WorkflowRunRow>(
          `SELECT *
             FROM workflow_runs
            WHERE workflow_definition_id = $1
            ORDER BY created_at ASC, id ASC
            LIMIT $2
            OFFSET $3`,
          [workflowDefinitionId, batchSize, offset]
        )
        .then((result) => result.rows)
    );

    if (rows.length === 0) {
      break;
    }

    const runs = rows.map(mapWorkflowRunRow);
    for (const run of runs) {
      await syncWorkflowRunModuleContext(run);
    }

    processed += rows.length;
    offset += rows.length;
  }

  return processed;
}

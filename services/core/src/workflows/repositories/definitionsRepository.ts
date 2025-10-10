import { mapWorkflowDefinitionRow, mapWorkflowScheduleRow, mapWorkflowEventTriggerRow, mapWorkflowTriggerDeliveryRow } from '../../db/rowMappers';
import { WorkflowDefinitionRow, WorkflowScheduleRow, WorkflowEventTriggerRow, WorkflowTriggerDeliveryRow } from '../../db/rowTypes';
import type { WorkflowDefinitionCreateInput, WorkflowDefinitionRecord, WorkflowDefinitionUpdateInput, WorkflowDagMetadata, WorkflowTriggerDefinition, WorkflowScheduleWindow, WorkflowScheduleRecord, WorkflowScheduleCreateInput, WorkflowScheduleUpdateInput, WorkflowScheduleWithDefinition, WorkflowEventTriggerPredicate, WorkflowEventTriggerRecord, WorkflowEventTriggerCreateInput, WorkflowEventTriggerUpdateInput, WorkflowEventTriggerListOptions, WorkflowTriggerDeliveryRecord, WorkflowTriggerDeliveryInsert, WorkflowTriggerDeliveryUpdateInput, WorkflowTriggerDeliveryListOptions } from '../../db/types';
import { useConnection, useTransaction } from '../../db/utils';
import { emitApphubEvent } from '../../events';
import { parseCronExpression, type ParserOptions } from '../cronParser';
import { normalizeWorkflowEventTriggerCreate, normalizeWorkflowEventTriggerUpdate, serializeTriggerPredicates } from '../eventTriggerValidation';
import { assertNoTemplateIssues, validateTriggerTemplates } from '../liquidTemplateValidation';
import { replaceWorkflowAssetDeclarations } from './assetsRepository';
import { serializeJson, serializeTriggerJson, jsonValuesEqual } from './shared';
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';

export const MANUAL_TRIGGER: WorkflowTriggerDefinition = { type: 'manual' };

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

function emitWorkflowDefinitionEvent(definition: WorkflowDefinitionRecord | null) {
  if (!definition) {
    return;
  }
  emitApphubEvent({ type: 'workflow.definition.updated', data: { workflow: definition } });
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
  slug: string,
  options: { moduleIds?: string[] | null } = {}
): Promise<WorkflowDefinitionRecord | null> {
  const moduleIds = Array.isArray(options.moduleIds)
    ? Array.from(new Set(options.moduleIds.map((id) => id.trim()).filter((id) => id.length > 0)))
    : null;

  const params: unknown[] = [slug];
  let query = 'SELECT * FROM workflow_definitions WHERE slug = $1';

  if (moduleIds && moduleIds.length > 0) {
    params.push(moduleIds);
    query += `
      AND EXISTS (
        SELECT 1
          FROM module_resource_contexts mrc
         WHERE mrc.resource_type = 'workflow-definition'
           AND mrc.resource_id = workflow_definitions.id
           AND mrc.module_id = ANY($${params.length}::text[])
      )`;
  }

  const { rows } = await client.query<WorkflowDefinitionRow>(query, params);
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
  ids: readonly string[],
  options: { moduleIds?: string[] | null } = {}
): Promise<Map<string, WorkflowDefinitionRecord>> {
  if (ids.length === 0) {
    return new Map();
  }

  const moduleIds = Array.isArray(options.moduleIds)
    ? Array.from(new Set(options.moduleIds.map((id) => id.trim()).filter((id) => id.length > 0)))
    : null;

  const params: unknown[] = [ids];
  let whereClause = 'WHERE id = ANY($1::text[])';

  if (moduleIds && moduleIds.length > 0) {
    params.push(moduleIds);
    whereClause += `
      AND EXISTS (
        SELECT 1
          FROM module_resource_contexts mrc
         WHERE mrc.resource_type = 'workflow-definition'
           AND mrc.resource_id = workflow_definitions.id
           AND mrc.module_id = ANY($${params.length}::text[])
      )`;
  }

  const { rows } = await client.query<WorkflowDefinitionRow>(
    `SELECT *
       FROM workflow_definitions
      ${whereClause}`,
    params
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

export async function listWorkflowDefinitions(options: { moduleIds?: string[] | null } = {}): Promise<WorkflowDefinitionRecord[]> {
  const moduleIds = Array.isArray(options.moduleIds)
    ? Array.from(new Set(options.moduleIds.map((id) => id.trim()).filter((id) => id.length > 0)))
    : null;

  return useConnection(async (client) => {
    const params: Array<string[] | string> = [];
    const conditions: string[] = [];

    if (moduleIds && moduleIds.length > 0) {
      const paramIndex = params.push(moduleIds);
      conditions.push(`EXISTS (
        SELECT 1
          FROM module_resource_contexts mrc
         WHERE mrc.resource_type = 'workflow-definition'
           AND mrc.resource_id = workflow_definitions.id
           AND mrc.module_id = ANY($${paramIndex}::text[])
      )`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await client.query<WorkflowDefinitionRow>(
      `SELECT * FROM workflow_definitions ${whereClause} ORDER BY slug ASC`,
      params
    );
    const definitions = rows.map(mapWorkflowDefinitionRow);
    await attachSchedulesToDefinitions(client, definitions);
    await attachEventTriggersToDefinitions(client, definitions);
    return definitions;
  });
}

export async function getWorkflowDefinitionBySlug(
  slug: string,
  options: { moduleIds?: string[] | null } = {}
): Promise<WorkflowDefinitionRecord | null> {
  return useConnection((client) => fetchWorkflowDefinitionBySlug(client, slug, options));
}

export async function getWorkflowDefinitionById(id: string): Promise<WorkflowDefinitionRecord | null> {
  return useConnection((client) => fetchWorkflowDefinitionById(client, id));
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

export async function listWorkflowSchedulesWithWorkflow(options: { moduleIds?: string[] | null } = {}): Promise<WorkflowScheduleWithDefinition[]> {
  const moduleIds = Array.isArray(options.moduleIds)
    ? Array.from(new Set(options.moduleIds.map((id) => id.trim()).filter((id) => id.length > 0)))
    : null;

  return useConnection(async (client) => {
    const params: unknown[] = [];
    let whereClause = '';

    if (moduleIds && moduleIds.length > 0) {
      params.push(moduleIds);
      whereClause = `WHERE EXISTS (
        SELECT 1
          FROM module_resource_contexts mrc
         WHERE mrc.resource_type = 'workflow-definition'
           AND mrc.resource_id = workflow_schedules.workflow_definition_id
           AND mrc.module_id = ANY($${params.length}::text[])
      )`;
    }

    const { rows } = await client.query<WorkflowScheduleRow>(
      `SELECT *
         FROM workflow_schedules
        ${whereClause}
        ORDER BY is_active DESC,
                 CASE WHEN next_run_at IS NULL THEN 1 ELSE 0 END,
                 next_run_at ASC NULLS LAST,
                 created_at ASC`,
      params
    );

    const schedules = rows.map(mapWorkflowScheduleRow);
    const definitionIds = Array.from(new Set(schedules.map((schedule) => schedule.workflowDefinitionId)));
    const definitions = await fetchWorkflowDefinitionsByIds(client, definitionIds, { moduleIds });

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

export async function fetchWorkflowDefinitionBySlugOrThrow(
  client: PoolClient,
  slug: string,
  options: { moduleIds?: string[] | null } = {}
) {
  const definition = await fetchWorkflowDefinitionBySlug(client, slug, options);
  if (!definition) {
    throw new Error(`Workflow with slug ${slug} not found`);
  }
  return definition;
}

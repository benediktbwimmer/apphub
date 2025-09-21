import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { emitApphubEvent } from '../events';
import {
  type WorkflowDefinitionCreateInput,
  type WorkflowDefinitionRecord,
  type WorkflowDefinitionUpdateInput,
  type WorkflowRunCreateInput,
  type WorkflowRunRecord,
  type WorkflowRunStatus,
  type WorkflowRunUpdateInput,
  type WorkflowRunStepCreateInput,
  type WorkflowRunStepRecord,
  type WorkflowRunStepUpdateInput
} from './types';
import {
  mapWorkflowDefinitionRow,
  mapWorkflowRunRow,
  mapWorkflowRunStepRow
} from './rowMappers';
import type {
  WorkflowDefinitionRow,
  WorkflowRunRow,
  WorkflowRunStepRow
} from './rowTypes';
import { useConnection, useTransaction } from './utils';

const MANUAL_TRIGGER: Record<string, unknown> = { type: 'manual' };

function normalizeWorkflowRunStatus(status?: WorkflowRunStatus | null): WorkflowRunStatus {
  if (!status) {
    return 'pending';
  }
  if (status === 'running' || status === 'succeeded' || status === 'failed' || status === 'canceled') {
    return status;
  }
  return 'pending';
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
  const metadata = input.metadata ?? {};

  const stepsJson = JSON.stringify(steps);
  const triggersJson = JSON.stringify(triggers);
  const parametersSchemaJson = JSON.stringify(parametersSchema);
  const defaultParametersJson = JSON.stringify(defaultParameters);
  const metadataJson = JSON.stringify(metadata);

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
           metadata,
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
          metadataJson
        ]
      );
      if (rows.length === 0) {
        throw new Error('failed to insert workflow definition');
      }
      definition = mapWorkflowDefinitionRow(rows[0]);
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
    const hasMetadata = Object.prototype.hasOwnProperty.call(updates, 'metadata');

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
    const nextMetadata = hasMetadata ? updates.metadata ?? null : existing.metadata;
    const nextDescription = hasDescription ? updates.description ?? null : existing.description;

    const stepsJson = JSON.stringify(nextSteps);
    const triggersJson = JSON.stringify(nextTriggers);
    const parametersSchemaJson = JSON.stringify(nextParametersSchema ?? {});
    const defaultParametersJson = JSON.stringify(nextDefaultParameters ?? null);
    const metadataJson = JSON.stringify(nextMetadata ?? null);

    const { rows } = await client.query<WorkflowDefinitionRow>(
      `UPDATE workflow_definitions
       SET name = $2,
           version = $3,
           description = $4,
           steps = $5::jsonb,
           triggers = $6::jsonb,
           parameters_schema = $7::jsonb,
           default_parameters = $8::jsonb,
           metadata = $9::jsonb,
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
        metadataJson
      ]
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
        trigger
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
    const nextContext = updates.context ?? existing.context ?? {};
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

    const { rows: updatedRows } = await client.query<WorkflowRunRow>(
      `UPDATE workflow_runs
       SET status = $2,
           parameters = $3::jsonb,
           context = $4::jsonb,
           error_message = $5,
           current_step_id = $6,
           current_step_index = $7,
           metrics = $8::jsonb,
           triggered_by = $9,
           trigger = $10::jsonb,
           started_at = $11,
           completed_at = $12,
           duration_ms = $13,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        runId,
        nextStatus,
        nextParameters,
        nextContext,
        nextErrorMessage,
        nextCurrentStepId,
        nextCurrentStepIndex,
        nextMetrics,
        nextTriggeredBy,
        nextTrigger,
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
      JSON.stringify(existing.context ?? {}) !== JSON.stringify(updated.context ?? {}) ||
      JSON.stringify(existing.parameters ?? {}) !== JSON.stringify(updated.parameters ?? {}) ||
      JSON.stringify(existing.metrics ?? {}) !== JSON.stringify(updated.metrics ?? {}) ||
      existing.current_step_id !== updated.currentStepId ||
      existing.current_step_index !== updated.currentStepIndex ||
      existing.error_message !== updated.errorMessage;
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
        input.input ?? null,
        input.output ?? null,
        input.errorMessage ?? null,
        input.logsUrl ?? null,
        input.metrics ?? null,
        input.context ?? null,
        input.startedAt ?? null,
        input.completedAt ?? null
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
    return rows.map(mapWorkflowRunStepRow);
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
    return mapWorkflowRunStepRow(rows[0]);
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
    return mapWorkflowRunStepRow(rows[0]);
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
    const nextInput = updates.input ?? existing.input ?? null;
    const nextOutput = updates.output ?? existing.output ?? null;
    const nextErrorMessage = 'errorMessage' in updates ? updates.errorMessage ?? null : existing.error_message;
    const nextLogsUrl = 'logsUrl' in updates ? updates.logsUrl ?? null : existing.logs_url;
    const nextMetrics = updates.metrics ?? existing.metrics ?? null;
    const nextContext = updates.context ?? existing.context ?? null;
    const nextStartedAt = updates.startedAt ?? existing.started_at ?? null;
    const nextCompletedAt = updates.completedAt ?? existing.completed_at ?? null;

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
        nextCompletedAt
      ]
    );
    if (updatedRows.length === 0) {
      return;
    }
    updated = mapWorkflowRunStepRow(updatedRows[0]);
  });

  return updated;
}

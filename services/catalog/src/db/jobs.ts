import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { useConnection, useTransaction } from './utils';
import {
  type JobDefinitionCreateInput,
  type JobDefinitionRecord,
  type JobRunCompletionInput,
  type JobRunCreateInput,
  type JobRunRecord,
  type JobRunStatus,
  type JobRetryPolicy,
  type JsonValue
} from './types';
import { mapJobDefinitionRow, mapJobRunRow } from './rowMappers';
import type { JobDefinitionRow, JobRunRow } from './rowTypes';
import { emitApphubEvent } from '../events';

function normalizeAttempt(value?: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 1) {
    return 1;
  }
  return Math.floor(value);
}

async function fetchJobDefinitionById(
  client: PoolClient,
  id: string
): Promise<JobDefinitionRecord | null> {
  const { rows } = await client.query<JobDefinitionRow>('SELECT * FROM job_definitions WHERE id = $1', [id]);
  if (rows.length === 0) {
    return null;
  }
  return mapJobDefinitionRow(rows[0]);
}

async function fetchJobDefinitionBySlug(
  client: PoolClient,
  slug: string
): Promise<JobDefinitionRecord | null> {
  const { rows } = await client.query<JobDefinitionRow>('SELECT * FROM job_definitions WHERE slug = $1', [slug]);
  if (rows.length === 0) {
    return null;
  }
  return mapJobDefinitionRow(rows[0]);
}

async function fetchJobRunById(client: PoolClient, id: string): Promise<JobRunRecord | null> {
  const { rows } = await client.query<JobRunRow>('SELECT * FROM job_runs WHERE id = $1', [id]);
  if (rows.length === 0) {
    return null;
  }
  return mapJobRunRow(rows[0]);
}

function emitJobDefinitionEvent(definition: JobDefinitionRecord | null) {
  if (!definition) {
    return;
  }
  emitApphubEvent({ type: 'job.definition.updated', data: { job: definition } });
}

function emitJobRunEvents(run: JobRunRecord | null, { forceUpdatedEvent = true } = {}) {
  if (!run) {
    return;
  }
  if (forceUpdatedEvent) {
    emitApphubEvent({ type: 'job.run.updated', data: { run } });
  }
  const statusEvent = `job.run.${run.status}` as const;
  emitApphubEvent({ type: statusEvent, data: { run } });
}

export async function listJobDefinitions(): Promise<JobDefinitionRecord[]> {
  return useConnection(async (client) => {
    const { rows } = await client.query<JobDefinitionRow>(
      'SELECT * FROM job_definitions ORDER BY slug ASC'
    );
    return rows.map(mapJobDefinitionRow);
  });
}

export async function getJobDefinitionById(id: string): Promise<JobDefinitionRecord | null> {
  return useConnection((client) => fetchJobDefinitionById(client, id));
}

export async function getJobDefinitionBySlug(slug: string): Promise<JobDefinitionRecord | null> {
  return useConnection((client) => fetchJobDefinitionBySlug(client, slug));
}

export async function createJobDefinition(
  input: JobDefinitionCreateInput
): Promise<JobDefinitionRecord> {
  const id = randomUUID();
  const version = input.version ?? 1;
  const parametersSchema = (input.parametersSchema ?? {}) as JsonValue;
  const defaultParameters = (input.defaultParameters ?? {}) as JsonValue;
  const retryPolicy = input.retryPolicy ?? {};
  const metadata = input.metadata ?? {};

  let definition: JobDefinitionRecord | null = null;

  await useTransaction(async (client) => {
    try {
      const { rows } = await client.query<JobDefinitionRow>(
        `INSERT INTO job_definitions (
           id,
           slug,
           name,
           version,
           type,
           entry_point,
           parameters_schema,
           default_parameters,
           timeout_ms,
           retry_policy,
           metadata,
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
           $10::jsonb,
           $11::jsonb,
           NOW(),
           NOW()
         )
         RETURNING *`,
        [
          id,
          input.slug,
          input.name,
          version,
          input.type,
          input.entryPoint,
          parametersSchema,
          defaultParameters,
          input.timeoutMs ?? null,
          retryPolicy,
          metadata
        ]
      );
      if (rows.length === 0) {
        throw new Error('failed to insert job definition');
      }
      definition = mapJobDefinitionRow(rows[0]);
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code?: string }).code === '23505') {
        throw new Error(`Job definition with slug "${input.slug}" already exists`);
      }
      throw err;
    }
  });

  if (!definition) {
    throw new Error('failed to create job definition');
  }

  emitJobDefinitionEvent(definition);
  return definition;
}

export async function upsertJobDefinition(
  input: JobDefinitionCreateInput
): Promise<JobDefinitionRecord> {
  const parametersSchema = (input.parametersSchema ?? {}) as JsonValue;
  const defaultParameters = (input.defaultParameters ?? {}) as JsonValue;

  let definition: JobDefinitionRecord | null = null;

  await useTransaction(async (client) => {
    const existing = await fetchJobDefinitionBySlug(client, input.slug);
    if (!existing) {
      const newId = randomUUID();
      const metadata = input.metadata ?? {};
      const retryPolicy = input.retryPolicy ?? {};
      const { rows } = await client.query<JobDefinitionRow>(
        `INSERT INTO job_definitions (
           id,
           slug,
           name,
           version,
           type,
           entry_point,
           parameters_schema,
           default_parameters,
           timeout_ms,
           retry_policy,
           metadata,
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
           $10::jsonb,
           $11::jsonb,
           NOW(),
           NOW()
         )
         RETURNING *`,
        [
          newId,
          input.slug,
          input.name,
          input.version ?? 1,
          input.type,
          input.entryPoint,
          parametersSchema,
          defaultParameters,
          input.timeoutMs ?? null,
          retryPolicy,
          metadata
        ]
      );
      if (rows.length === 0) {
        throw new Error('failed to insert job definition');
      }
      definition = mapJobDefinitionRow(rows[0]);
      return;
    }

    const nextMetadata = input.metadata ?? existing.metadata ?? {};
    const nextRetryPolicy = input.retryPolicy ?? existing.retryPolicy ?? {};
    const { rows } = await client.query<JobDefinitionRow>(
      `UPDATE job_definitions
       SET name = $2,
           version = $3,
           type = $4,
           entry_point = $5,
           parameters_schema = $6::jsonb,
           default_parameters = $7::jsonb,
           timeout_ms = $8,
           retry_policy = $9::jsonb,
           metadata = $10::jsonb,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        existing.id,
        input.name,
        input.version ?? existing.version,
        input.type,
        input.entryPoint,
        parametersSchema,
        defaultParameters,
        input.timeoutMs ?? existing.timeoutMs ?? null,
        nextRetryPolicy,
        nextMetadata
      ]
    );
    if (rows.length === 0) {
      throw new Error('failed to update job definition');
    }
    definition = mapJobDefinitionRow(rows[0]);
  });

  if (!definition) {
    throw new Error('failed to upsert job definition');
  }

  emitJobDefinitionEvent(definition);
  return definition;
}

export async function listJobRunsForDefinition(
  jobDefinitionId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<JobRunRecord[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 25, 200));
  const offset = Math.max(0, options.offset ?? 0);

  return useConnection(async (client) => {
    const { rows } = await client.query<JobRunRow>(
      `SELECT *
       FROM job_runs
       WHERE job_definition_id = $1
       ORDER BY scheduled_at DESC, created_at DESC
       LIMIT $2 OFFSET $3`,
      [jobDefinitionId, limit, offset]
    );
    return rows.map(mapJobRunRow);
  });
}

export async function getJobRunById(runId: string): Promise<JobRunRecord | null> {
  return useConnection((client) => fetchJobRunById(client, runId));
}

export async function createJobRun(
  jobDefinitionId: string,
  input: JobRunCreateInput = {}
): Promise<JobRunRecord> {
  const id = randomUUID();
  const attempt = normalizeAttempt(input.attempt);
  const maxAttempts = input.maxAttempts ?? null;
  const scheduledAt = input.scheduledAt ?? new Date().toISOString();

  let run: JobRunRecord | null = null;

  await useTransaction(async (client) => {
    const { rows } = await client.query<JobRunRow>(
      `INSERT INTO job_runs (
         id,
         job_definition_id,
         status,
         parameters,
         result,
         error_message,
         logs_url,
         metrics,
         context,
         timeout_ms,
         attempt,
         max_attempts,
         duration_ms,
         scheduled_at,
         started_at,
         completed_at,
         created_at,
         updated_at
       ) VALUES (
         $1,
         $2,
         'pending',
         $3::jsonb,
         NULL,
         NULL,
         NULL,
         NULL,
         $4::jsonb,
         $5,
         $6,
         $7,
         NULL,
         $8,
         NULL,
         NULL,
         NOW(),
         NOW()
       )
       RETURNING *`,
      [
        id,
        jobDefinitionId,
        input.parameters ?? {},
        input.context ?? null,
        input.timeoutMs ?? null,
        attempt,
        maxAttempts,
        scheduledAt
      ]
    );
    if (rows.length === 0) {
      throw new Error('failed to insert job run');
    }
    run = mapJobRunRow(rows[0]);
  });

  if (!run) {
    throw new Error('failed to create job run');
  }

  emitJobRunEvents(run);
  return run;
}

export async function startJobRun(
  runId: string,
  options: { startedAt?: string } = {}
): Promise<JobRunRecord | null> {
  let changed = false;
  const startedAt = options.startedAt ?? new Date().toISOString();

  const row = await useTransaction(async (client) => {
    const { rows } = await client.query<JobRunRow>(
      'SELECT * FROM job_runs WHERE id = $1 FOR UPDATE',
      [runId]
    );
    if (rows.length === 0) {
      return null;
    }
    const existingRow = rows[0];
    if (existingRow.status === 'running') {
      if (!existingRow.started_at) {
        const { rows: updated } = await client.query<JobRunRow>(
          `UPDATE job_runs
           SET started_at = $2,
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [runId, startedAt]
        );
        if (updated.length > 0) {
          changed = true;
          return updated[0];
        }
      }
      return existingRow;
    }
    if (existingRow.status !== 'pending') {
      return existingRow;
    }
    const { rows: updatedRows } = await client.query<JobRunRow>(
      `UPDATE job_runs
       SET status = 'running',
           started_at = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [runId, startedAt]
    );
    if (updatedRows.length === 0) {
      return existingRow;
    }
    changed = true;
    return updatedRows[0];
  });

  if (!row) {
    return null;
  }

  const run = mapJobRunRow(row);
  if (changed) {
    emitJobRunEvents(run);
  }
  return run;
}

function computeDurationMs(startedAt: string | null, completedAt: string): number | null {
  if (!startedAt) {
    return null;
  }
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (Number.isNaN(started) || Number.isNaN(completed)) {
    return null;
  }
  return Math.max(completed - started, 0);
}

export async function completeJobRun(
  runId: string,
  status: Extract<JobRunStatus, 'succeeded' | 'failed' | 'canceled' | 'expired'>,
  extra: JobRunCompletionInput = {}
): Promise<JobRunRecord | null> {
  let changed = false;

  const row = await useTransaction(async (client) => {
    const { rows } = await client.query<JobRunRow>(
      'SELECT * FROM job_runs WHERE id = $1 FOR UPDATE',
      [runId]
    );
    if (rows.length === 0) {
      return null;
    }

    const existingRow = rows[0];
    const existing = mapJobRunRow(existingRow);

    const noChanges =
      existing.status === status &&
      extra.result === undefined &&
      extra.errorMessage === undefined &&
      extra.logsUrl === undefined &&
      extra.metrics === undefined &&
      extra.context === undefined &&
      extra.completedAt === undefined &&
      extra.durationMs === undefined;

    if (noChanges && existing.completedAt) {
      return existingRow;
    }

    const completedAt = extra.completedAt ?? existing.completedAt ?? new Date().toISOString();
    const durationMs =
      extra.durationMs ?? computeDurationMs(existing.startedAt, completedAt) ?? existing.durationMs;

    const result = extra.result === undefined ? existing.result : extra.result;
    const errorMessage = extra.errorMessage === undefined ? existing.errorMessage : extra.errorMessage;
    const logsUrl = extra.logsUrl === undefined ? existing.logsUrl : extra.logsUrl;
    const metrics = extra.metrics === undefined ? existing.metrics : extra.metrics;
    const context = extra.context === undefined ? existing.context : extra.context;

    const { rows: updatedRows } = await client.query<JobRunRow>(
      `UPDATE job_runs
       SET status = $2,
           result = $3::jsonb,
           error_message = $4,
           logs_url = $5,
           metrics = $6::jsonb,
           context = $7::jsonb,
           duration_ms = $8,
           completed_at = $9,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        runId,
        status,
        result ?? null,
        errorMessage ?? null,
        logsUrl ?? null,
        metrics ?? null,
        context ?? null,
        durationMs,
        completedAt
      ]
    );

    if (updatedRows.length === 0) {
      return existingRow;
    }

    changed = true;
    return updatedRows[0];
  });

  if (!row) {
    return null;
  }

  const run = mapJobRunRow(row);
  if (changed) {
    emitJobRunEvents(run);
  }
  return run;
}

export async function updateJobRun(
  runId: string,
  updates: {
    parameters?: JsonValue;
    logsUrl?: string | null;
    metrics?: JsonValue | null;
    context?: JsonValue | null;
    timeoutMs?: number | null;
  }
): Promise<JobRunRecord | null> {
  const hasUpdates =
    Object.prototype.hasOwnProperty.call(updates, 'parameters') ||
    Object.prototype.hasOwnProperty.call(updates, 'logsUrl') ||
    Object.prototype.hasOwnProperty.call(updates, 'metrics') ||
    Object.prototype.hasOwnProperty.call(updates, 'context') ||
    Object.prototype.hasOwnProperty.call(updates, 'timeoutMs');

  if (!hasUpdates) {
    return getJobRunById(runId);
  }

  let changed = false;

  const row = await useTransaction(async (client) => {
    const { rows } = await client.query<JobRunRow>(
      'SELECT * FROM job_runs WHERE id = $1 FOR UPDATE',
      [runId]
    );
    if (rows.length === 0) {
      return null;
    }
    const existingRow = rows[0];
    const existing = mapJobRunRow(existingRow);

    const parameters =
      updates.parameters === undefined ? existing.parameters : (updates.parameters as JsonValue);
    const logsUrl = updates.logsUrl === undefined ? existing.logsUrl : updates.logsUrl;
    const metrics = updates.metrics === undefined ? existing.metrics : updates.metrics;
    const context = updates.context === undefined ? existing.context : updates.context;
    const timeoutMs = updates.timeoutMs === undefined ? existing.timeoutMs : updates.timeoutMs;

    const nextIsSame =
      parameters === existing.parameters &&
      logsUrl === existing.logsUrl &&
      metrics === existing.metrics &&
      context === existing.context &&
      timeoutMs === existing.timeoutMs;

    if (nextIsSame) {
      return existingRow;
    }

    const { rows: updatedRows } = await client.query<JobRunRow>(
      `UPDATE job_runs
       SET parameters = $2::jsonb,
           logs_url = $3,
           metrics = $4::jsonb,
           context = $5::jsonb,
           timeout_ms = $6,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [runId, parameters, logsUrl ?? null, metrics ?? null, context ?? null, timeoutMs]
    );

    if (updatedRows.length === 0) {
      return existingRow;
    }

    changed = true;
    return updatedRows[0];
  });

  if (!row) {
    return null;
  }

  const run = mapJobRunRow(row);
  if (changed) {
    emitJobRunEvents(run, { forceUpdatedEvent: true });
  }
  return run;
}

export async function getOrCreateJobDefinition(
  slug: string,
  payload: JobDefinitionCreateInput
): Promise<JobDefinitionRecord> {
  const existing = await getJobDefinitionBySlug(slug);
  if (existing) {
    return existing;
  }
  return upsertJobDefinition({ ...payload, slug });
}

export function resolveRetryPolicy(
  definition: JobDefinitionRecord
): JobRetryPolicy | null {
  return definition.retryPolicy ?? null;
}

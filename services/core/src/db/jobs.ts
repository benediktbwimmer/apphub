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
  type JobRunWithDefinition,
  type JobRuntime,
  type JobType,
  type JobRetryPolicy,
  type JsonValue,
  type ModuleTargetBinding
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

function normalizeRetryCount(value: number | null | undefined, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    return Math.max(0, Math.floor(fallback));
  }
  return Math.floor(value);
}

function normalizeStringField(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildModuleBindingFromValues(values: {
  moduleId?: string | null;
  moduleVersion?: string | null;
  moduleArtifactId?: string | null;
  moduleTargetName?: string | null;
  moduleTargetVersion?: string | null;
  moduleTargetFingerprint?: string | null;
}): ModuleTargetBinding | null {
  const moduleId = normalizeStringField(values.moduleId ?? null);
  const moduleVersion = normalizeStringField(values.moduleVersion ?? null);
  const targetName = normalizeStringField(values.moduleTargetName ?? null);
  const targetVersion = normalizeStringField(values.moduleTargetVersion ?? null);
  if (!moduleId || !moduleVersion || !targetName || !targetVersion) {
    return null;
  }
  return {
    moduleId,
    moduleVersion,
    moduleArtifactId: normalizeStringField(values.moduleArtifactId ?? null),
    targetName,
    targetVersion,
    targetFingerprint: normalizeStringField(values.moduleTargetFingerprint ?? null)
  } satisfies ModuleTargetBinding;
}

function resolveFailureReason(
  status: JobRunStatus,
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
    case 'expired':
      return existing ?? 'timeout';
    case 'canceled':
      return existing ?? 'canceled';
    default:
      return existing ?? null;
  }
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

export async function getJobDefinitionsBySlugs(
  slugs: string[]
): Promise<Map<string, JobDefinitionRecord>> {
  const unique = Array.from(
    new Set(slugs.map((slug) => slug.trim()).filter((slug) => slug.length > 0))
  );
  if (unique.length === 0) {
    return new Map();
  }
  return useConnection(async (client) => {
    const { rows } = await client.query<JobDefinitionRow>(
      'SELECT * FROM job_definitions WHERE slug = ANY($1)',
      [unique]
    );
    const map = new Map<string, JobDefinitionRecord>();
    for (const row of rows) {
      const record = mapJobDefinitionRow(row);
      map.set(record.slug.toLowerCase(), record);
    }
    return map;
  });
}

export async function createJobDefinition(
  input: JobDefinitionCreateInput
): Promise<JobDefinitionRecord> {
  const id = randomUUID();
  const version = input.version ?? 1;
  const runtime = input.runtime ?? 'node';
  const parametersSchema =
    input.parametersSchema === undefined ? ({} as JsonValue) : (input.parametersSchema as JsonValue);
  const defaultParameters =
    input.defaultParameters === undefined ? ({} as JsonValue) : (input.defaultParameters as JsonValue);
  const outputSchema =
    input.outputSchema === undefined ? ({} as JsonValue) : (input.outputSchema as JsonValue);
  const retryPolicy = input.retryPolicy ?? {};
  const metadata = input.metadata ?? {};
  const binding = input.moduleBinding ?? null;
  const moduleId = binding?.moduleId ?? null;
  const moduleVersion = binding?.moduleVersion ?? null;
  const moduleArtifactId = binding?.moduleArtifactId ?? null;
  const moduleTargetName = binding?.targetName ?? null;
  const moduleTargetVersion = binding?.targetVersion ?? null;
  const moduleTargetFingerprint = binding?.targetFingerprint ?? null;

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
           runtime,
           entry_point,
           parameters_schema,
           default_parameters,
           output_schema,
           timeout_ms,
           retry_policy,
           metadata,
           module_id,
           module_version,
           module_artifact_id,
           module_target_name,
           module_target_version,
           module_target_fingerprint,
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
           $8::jsonb,
           $9::jsonb,
           $10::jsonb,
           $11,
           $12::jsonb,
           $13::jsonb,
           $14,
           $15,
           $16,
           $17,
           $18,
           $19,
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
          runtime,
          input.entryPoint,
          parametersSchema,
          defaultParameters,
          outputSchema,
          input.timeoutMs ?? null,
          retryPolicy,
          metadata,
          moduleId,
          moduleVersion,
          moduleArtifactId,
          moduleTargetName,
          moduleTargetVersion,
          moduleTargetFingerprint
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
  const parametersSchema =
    input.parametersSchema === undefined ? ({} as JsonValue) : (input.parametersSchema as JsonValue);
  const defaultParameters =
    input.defaultParameters === undefined ? ({} as JsonValue) : (input.defaultParameters as JsonValue);
  const providedBinding = input.moduleBinding;

  let definition: JobDefinitionRecord | null = null;

  await useTransaction(async (client) => {
    const existing = await fetchJobDefinitionBySlug(client, input.slug);
    if (!existing) {
      const newId = randomUUID();
      const metadata = input.metadata ?? {};
      const retryPolicy = input.retryPolicy ?? {};
      const runtime = input.runtime ?? 'node';
      const outputSchema =
        input.outputSchema === undefined ? ({} as JsonValue) : (input.outputSchema as JsonValue);
      const binding = providedBinding ?? null;
      const { rows } = await client.query<JobDefinitionRow>(
        `INSERT INTO job_definitions (
           id,
           slug,
           name,
           version,
           type,
           runtime,
           entry_point,
           parameters_schema,
           default_parameters,
           output_schema,
           timeout_ms,
           retry_policy,
           metadata,
            module_id,
            module_version,
            module_artifact_id,
            module_target_name,
            module_target_version,
            module_target_fingerprint,
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
           $8::jsonb,
           $9::jsonb,
           $10::jsonb,
           $11,
           $12::jsonb,
           $13::jsonb,
            $14,
            $15,
            $16,
            $17,
            $18,
            $19,
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
          runtime,
          input.entryPoint,
          parametersSchema,
          defaultParameters,
          outputSchema,
          input.timeoutMs ?? null,
          retryPolicy,
          metadata,
          binding?.moduleId ?? null,
          binding?.moduleVersion ?? null,
          binding?.moduleArtifactId ?? null,
          binding?.targetName ?? null,
          binding?.targetVersion ?? null,
          binding?.targetFingerprint ?? null
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
    const nextOutputSchema = (input.outputSchema ?? existing.outputSchema ?? {}) as JsonValue;
    const nextRuntime = input.runtime ?? existing.runtime;
    const nextBinding = providedBinding === undefined ? existing.moduleBinding : providedBinding;
    const { rows } = await client.query<JobDefinitionRow>(
      `UPDATE job_definitions
       SET name = $2,
           version = $3,
           type = $4,
           runtime = $5,
           entry_point = $6,
           parameters_schema = $7::jsonb,
           default_parameters = $8::jsonb,
           output_schema = $9::jsonb,
           timeout_ms = $10,
           retry_policy = $11::jsonb,
           metadata = $12::jsonb,
           module_id = $13,
           module_version = $14,
           module_artifact_id = $15,
           module_target_name = $16,
           module_target_version = $17,
           module_target_fingerprint = $18,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        existing.id,
        input.name,
        input.version ?? existing.version,
        input.type,
        nextRuntime,
        input.entryPoint,
        parametersSchema,
        defaultParameters,
        nextOutputSchema,
        input.timeoutMs ?? existing.timeoutMs ?? null,
        nextRetryPolicy,
        nextMetadata,
        nextBinding?.moduleId ?? null,
        nextBinding?.moduleVersion ?? null,
        nextBinding?.moduleArtifactId ?? null,
        nextBinding?.targetName ?? null,
        nextBinding?.targetVersion ?? null,
        nextBinding?.targetFingerprint ?? null
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

type JobRunWithDefinitionRow = JobRunRow & {
  job_slug: string;
  job_name: string;
  job_type: string;
  job_runtime: string;
  job_version: number;
  job_module_id: string | null;
  job_module_version: string | null;
  job_module_artifact_id: string | null;
  job_module_target_name: string | null;
  job_module_target_version: string | null;
  job_module_target_fingerprint: string | null;
};

type JobRunListFilters = {
  statuses?: string[];
  jobSlugs?: string[];
  runtimes?: string[];
  search?: string;
};

export async function listJobRuns(
  options: { limit?: number; offset?: number; filters?: JobRunListFilters } = {}
): Promise<{ items: JobRunWithDefinition[]; hasMore: boolean }> {
  const limit = Math.max(1, Math.min(options.limit ?? 25, 50));
  const offset = Math.max(0, options.offset ?? 0);
  const queryLimit = limit + 1;
  const filters = options.filters ?? {};

  return useConnection(async (client) => {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (Array.isArray(filters.statuses) && filters.statuses.length > 0) {
      const statuses = Array.from(
        new Set(filters.statuses.map((status) => status.trim().toLowerCase()).filter((status) => status.length > 0))
      );
      if (statuses.length > 0) {
        params.push(statuses);
        conditions.push(`LOWER(jr.status) = ANY($${params.length}::text[])`);
      }
    }

    if (Array.isArray(filters.jobSlugs) && filters.jobSlugs.length > 0) {
      const slugs = Array.from(
        new Set(filters.jobSlugs.map((slug) => slug.trim()).filter((slug) => slug.length > 0))
      );
      if (slugs.length > 0) {
        params.push(slugs);
        conditions.push(`jd.slug = ANY($${params.length}::text[])`);
      }
    }

    if (Array.isArray(filters.runtimes) && filters.runtimes.length > 0) {
      const runtimes = Array.from(
        new Set(filters.runtimes.map((runtime) => runtime.trim().toLowerCase()).filter((runtime) => runtime.length > 0))
      );
      if (runtimes.length > 0) {
        params.push(runtimes);
        conditions.push(`LOWER(jd.runtime) = ANY($${params.length}::text[])`);
      }
    }

    if (typeof filters.search === 'string' && filters.search.trim().length > 0) {
      const term = `%${filters.search.trim().replace(/[%_]/g, '\\$&')}%`;
      params.push(term);
      params.push(term);
      params.push(term);
      conditions.push(
        `(
           jr.id ILIKE $${params.length - 2}
           OR jd.slug ILIKE $${params.length - 1}
           OR jd.name ILIKE $${params.length}
         )`
      );
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(queryLimit);
    params.push(offset);

    const { rows } = await client.query<JobRunWithDefinitionRow>(
      `SELECT jr.*,
              jd.slug AS job_slug,
              jd.name AS job_name,
              jd.type AS job_type,
              jd.runtime AS job_runtime,
              jd.version AS job_version,
              jd.module_id AS job_module_id,
              jd.module_version AS job_module_version,
              jd.module_artifact_id AS job_module_artifact_id,
              jd.module_target_name AS job_module_target_name,
              jd.module_target_version AS job_module_target_version,
              jd.module_target_fingerprint AS job_module_target_fingerprint
       FROM job_runs jr
       INNER JOIN job_definitions jd ON jd.id = jr.job_definition_id
       ${whereClause}
       ORDER BY jr.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const mapped = rows.map((row) => {
      const run = mapJobRunRow(row);
      let runtime: JobRuntime;
      if (row.job_runtime === 'python') {
        runtime = 'python';
      } else if (row.job_runtime === 'docker') {
        runtime = 'docker';
      } else if (row.job_runtime === 'module') {
        runtime = 'module';
      } else {
        runtime = 'node';
      }
      const type: JobType =
        row.job_type === 'service-triggered'
          ? 'service-triggered'
          : row.job_type === 'manual'
            ? 'manual'
            : 'batch';
      return {
        run,
        job: {
          id: row.job_definition_id,
          slug: row.job_slug,
          name: row.job_name,
          version: row.job_version,
          type,
          runtime,
          moduleBinding: buildModuleBindingFromValues({
            moduleId: row.job_module_id,
            moduleVersion: row.job_module_version,
            moduleArtifactId: row.job_module_artifact_id,
            moduleTargetName: row.job_module_target_name,
            moduleTargetVersion: row.job_module_target_version,
            moduleTargetFingerprint: row.job_module_target_fingerprint
          })
        }
      } satisfies JobRunWithDefinition;
    });

    const hasMore = mapped.length > limit;
    const items = hasMore ? mapped.slice(0, limit) : mapped;
    return { items, hasMore };
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
  const computedRetryCount = Math.max(0, attempt - 1);
  const retryCount = normalizeRetryCount(input.retryCount, computedRetryCount);
  const lastHeartbeatAt = input.lastHeartbeatAt ?? null;
  const failureReason = input.failureReason ?? null;
  const binding = input.moduleBinding ?? null;

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
         retry_count,
         last_heartbeat_at,
         failure_reason,
         module_id,
         module_version,
         module_artifact_id,
         module_target_name,
         module_target_version,
         module_target_fingerprint,
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
         $9,
         $10,
         $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
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
        scheduledAt,
        retryCount,
        lastHeartbeatAt,
        failureReason,
        binding?.moduleId ?? null,
        binding?.moduleVersion ?? null,
        binding?.moduleArtifactId ?? null,
        binding?.targetName ?? null,
        binding?.targetVersion ?? null,
        binding?.targetFingerprint ?? null
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
               last_heartbeat_at = NOW(),
               failure_reason = NULL,
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
           last_heartbeat_at = NOW(),
           failure_reason = NULL,
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
      extra.durationMs === undefined &&
      extra.failureReason === undefined &&
      extra.retryCount === undefined;

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
    const failureReason = resolveFailureReason(status, extra.failureReason, existing.failureReason);
    const retryCount = normalizeRetryCount(extra.retryCount, existing.retryCount);

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
           retry_count = $10,
           failure_reason = $11,
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
        completedAt,
        retryCount,
        failureReason ?? null
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
    heartbeatAt?: string | null;
    retryCount?: number;
    failureReason?: string | null;
  }
): Promise<JobRunRecord | null> {
  const hasUpdates =
    Object.prototype.hasOwnProperty.call(updates, 'parameters') ||
    Object.prototype.hasOwnProperty.call(updates, 'logsUrl') ||
    Object.prototype.hasOwnProperty.call(updates, 'metrics') ||
    Object.prototype.hasOwnProperty.call(updates, 'context') ||
    Object.prototype.hasOwnProperty.call(updates, 'timeoutMs') ||
    Object.prototype.hasOwnProperty.call(updates, 'heartbeatAt') ||
    Object.prototype.hasOwnProperty.call(updates, 'retryCount') ||
    Object.prototype.hasOwnProperty.call(updates, 'failureReason');

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
    const heartbeatAt =
      updates.heartbeatAt === undefined ? existing.lastHeartbeatAt : updates.heartbeatAt ?? null;
    const retryCount = normalizeRetryCount(updates.retryCount, existing.retryCount);
    const failureReason =
      updates.failureReason === undefined ? existing.failureReason : updates.failureReason ?? null;

    const nextIsSame =
      parameters === existing.parameters &&
      logsUrl === existing.logsUrl &&
      metrics === existing.metrics &&
      context === existing.context &&
      timeoutMs === existing.timeoutMs &&
      heartbeatAt === existing.lastHeartbeatAt &&
      retryCount === existing.retryCount &&
      failureReason === existing.failureReason;

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
           last_heartbeat_at = $7,
           retry_count = $8,
           failure_reason = $9,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        runId,
        parameters,
        logsUrl ?? null,
        metrics ?? null,
        context ?? null,
        timeoutMs,
        heartbeatAt,
        retryCount,
        failureReason
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

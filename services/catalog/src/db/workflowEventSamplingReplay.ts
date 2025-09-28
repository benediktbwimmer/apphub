import { useConnection } from './utils';
import type { WorkflowEventRecord } from './types';
import type { WorkflowEventRow } from './rowTypes';
import { mapWorkflowEventRow } from './rowMappers';

export type EventSamplingReplayStatus = 'succeeded' | 'failed' | 'skipped';

export type EventSamplingReplayState = {
  status: EventSamplingReplayStatus;
  attempts: number;
  updatedAt: string;
};

export type EventSamplingReplayCandidate = {
  event: WorkflowEventRecord;
  state: EventSamplingReplayState | null;
};

type ReplayQueryOptions = {
  from?: string;
  to?: string;
  limit?: number;
  includeProcessed?: boolean;
};

const WORKFLOW_METADATA_KEY = '__apphubWorkflow';
const DEFAULT_REPLAY_LIMIT = 100;
const MAX_REPLAY_LIMIT = 500;

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? NaN)) {
    return DEFAULT_REPLAY_LIMIT;
  }
  const normalized = Math.floor(Number(limit));
  if (Number.isNaN(normalized) || normalized <= 0) {
    return DEFAULT_REPLAY_LIMIT;
  }
  return Math.min(normalized, MAX_REPLAY_LIMIT);
}

function normalizeIsoTimestamp(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

export async function listEventSamplingReplayCandidates(
  options: ReplayQueryOptions = {}
): Promise<EventSamplingReplayCandidate[]> {
  const fromIso = normalizeIsoTimestamp(options.from);
  const toIso = normalizeIsoTimestamp(options.to);
  const includeProcessed = options.includeProcessed ?? false;
  const limit = normalizeLimit(options.limit);

  const conditions: string[] = [
    `(events.metadata IS NULL OR NOT (events.metadata ? '${WORKFLOW_METADATA_KEY}'))`,
    `COALESCE(btrim(events.correlation_id), '') <> ''`
  ];
  const params: Array<string | number> = [];
  let index = 1;

  if (fromIso) {
    conditions.push(`events.occurred_at >= $${index}`);
    params.push(fromIso);
    index += 1;
  }

  if (toIso) {
    conditions.push(`events.occurred_at <= $${index}`);
    params.push(toIso);
    index += 1;
  }

  if (!includeProcessed) {
    conditions.push(`(state.event_id IS NULL OR state.status <> 'succeeded')`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit);

  const query = `SELECT
      events.*,
      state.status AS replay_status,
      state.attempts AS replay_attempts,
      state.updated_at AS replay_updated_at
    FROM workflow_events AS events
    LEFT JOIN workflow_event_sampling_replay_state AS state
      ON state.event_id = events.id
    ${whereClause}
    ORDER BY events.occurred_at ASC, events.id ASC
    LIMIT $${index}`;

  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowEventRow & {
      replay_status: EventSamplingReplayStatus | null;
      replay_attempts: number | null;
      replay_updated_at: string | null;
    }>(query, params);

    return rows.map((row) => {
      const event = mapWorkflowEventRow(row);
      const status = row.replay_status ?? null;
      const attempts = row.replay_attempts ?? null;
      const updatedAt = row.replay_updated_at ?? null;

      const state: EventSamplingReplayState | null =
        status && attempts && updatedAt
          ? {
              status,
              attempts,
              updatedAt
            }
          : null;

      return { event, state } satisfies EventSamplingReplayCandidate;
    });
  });
}

type ReplayResultInput = {
  eventId: string;
  status: EventSamplingReplayStatus;
  workflowDefinitionId?: string | null;
  workflowRunId?: string | null;
  workflowRunStepId?: string | null;
  jobRunId?: string | null;
  jobSlug?: string | null;
  error?: string | null;
};

function sanitizeNullable(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function recordEventSamplingReplayResult(input: ReplayResultInput): Promise<void> {
  const eventId = sanitizeNullable(input.eventId);
  if (!eventId) {
    return;
  }

  const workflowDefinitionId = sanitizeNullable(input.workflowDefinitionId ?? null);
  const workflowRunId = sanitizeNullable(input.workflowRunId ?? null);
  const workflowRunStepId = sanitizeNullable(input.workflowRunStepId ?? null);
  const jobRunId = sanitizeNullable(input.jobRunId ?? null);
  const jobSlug = sanitizeNullable(input.jobSlug ?? null);
  const lastError = sanitizeNullable(input.error ?? null);

  await useConnection(async (client) => {
    await client.query(
      `INSERT INTO workflow_event_sampling_replay_state (
         event_id,
         status,
         attempts,
         workflow_definition_id,
         workflow_run_id,
         workflow_run_step_id,
         job_run_id,
         job_slug,
         last_error,
         processed_at,
         updated_at
       ) VALUES (
         $1,
         $2,
         1,
         $3,
         $4,
         $5,
         $6,
         $7,
         $8,
         NOW(),
         NOW()
       )
       ON CONFLICT (event_id)
       DO UPDATE SET
         status = EXCLUDED.status,
         attempts = workflow_event_sampling_replay_state.attempts + 1,
         workflow_definition_id = EXCLUDED.workflow_definition_id,
         workflow_run_id = EXCLUDED.workflow_run_id,
         workflow_run_step_id = EXCLUDED.workflow_run_step_id,
         job_run_id = EXCLUDED.job_run_id,
         job_slug = EXCLUDED.job_slug,
         last_error = EXCLUDED.last_error,
         processed_at = COALESCE(workflow_event_sampling_replay_state.processed_at, NOW()),
         updated_at = NOW()`,
      [
        eventId,
        input.status,
        workflowDefinitionId,
        workflowRunId,
        workflowRunStepId,
        jobRunId,
        jobSlug,
        lastError
      ]
    );
  });
}

export type EventSamplingReplayMetrics = {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  lastProcessedAt: string | null;
  lastFailure: {
    eventId: string;
    attempts: number;
    error: string | null;
    updatedAt: string;
  } | null;
};

export async function getEventSamplingReplayMetrics(): Promise<EventSamplingReplayMetrics> {
  return useConnection(async (client) => {
    const summaryResult = await client.query<{
      total: string | null;
      succeeded: string | null;
      failed: string | null;
      skipped: string | null;
    }>(
      `SELECT
         COUNT(*)::bigint AS total,
         COUNT(*) FILTER (WHERE status = 'succeeded')::bigint AS succeeded,
         COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed,
         COUNT(*) FILTER (WHERE status = 'skipped')::bigint AS skipped
       FROM workflow_event_sampling_replay_state`
    );

    const summaryRow = summaryResult.rows[0] ?? {
      total: '0',
      succeeded: '0',
      failed: '0',
      skipped: '0'
    };

    const lastProcessedResult = await client.query<{ updated_at: string }>(
      `SELECT updated_at
         FROM workflow_event_sampling_replay_state
        ORDER BY updated_at DESC
        LIMIT 1`
    );

    const lastFailureResult = await client.query<{
      event_id: string;
      attempts: number | null;
      last_error: string | null;
      updated_at: string;
    }>(
      `SELECT event_id, attempts, last_error, updated_at
         FROM workflow_event_sampling_replay_state
        WHERE status = 'failed'
        ORDER BY updated_at DESC
        LIMIT 1`
    );

    const metrics: EventSamplingReplayMetrics = {
      total: Number(summaryRow.total ?? 0),
      succeeded: Number(summaryRow.succeeded ?? 0),
      failed: Number(summaryRow.failed ?? 0),
      skipped: Number(summaryRow.skipped ?? 0),
      lastProcessedAt: lastProcessedResult.rows[0]?.updated_at ?? null,
      lastFailure: null
    };

    const failureRow = lastFailureResult.rows[0];
    if (failureRow) {
      metrics.lastFailure = {
        eventId: failureRow.event_id,
        attempts: failureRow.attempts ?? 0,
        error: failureRow.last_error ?? null,
        updatedAt: failureRow.updated_at
      };
    }

    return metrics;
  });
}

export async function countPendingEventSamplingReplays(
  options: ReplayQueryOptions = {}
): Promise<number> {
  const fromIso = normalizeIsoTimestamp(options.from);
  const toIso = normalizeIsoTimestamp(options.to);
  const includeProcessed = options.includeProcessed ?? false;

  const conditions: string[] = [
    `(events.metadata IS NULL OR NOT (events.metadata ? '${WORKFLOW_METADATA_KEY}'))`,
    `COALESCE(btrim(events.correlation_id), '') <> ''`
  ];
  const params: string[] = [];
  let index = 1;

  if (fromIso) {
    conditions.push(`events.occurred_at >= $${index}`);
    params.push(fromIso);
    index += 1;
  }

  if (toIso) {
    conditions.push(`events.occurred_at <= $${index}`);
    params.push(toIso);
    index += 1;
  }

  if (!includeProcessed) {
    conditions.push(`(state.event_id IS NULL OR state.status <> 'succeeded')`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const query = `SELECT COUNT(*)::bigint AS total
    FROM workflow_events AS events
    LEFT JOIN workflow_event_sampling_replay_state AS state
      ON state.event_id = events.id
    ${whereClause}`;

  return useConnection(async (client) => {
    const { rows } = await client.query<{ total: string | null }>(query, params);
    const value = Number(rows[0]?.total ?? 0);
    return Number.isFinite(value) ? value : 0;
  });
}

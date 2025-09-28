import type { JsonValue, RetryState } from './db/types';
import { useConnection } from './db/utils';

export type EventRetryBacklogEntry = {
  eventId: string;
  source: string;
  eventType: string | null;
  eventSource: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  overdue: boolean;
  retryState: RetryState;
  lastError: string | null;
  metadata: JsonValue | null;
  createdAt: string;
  updatedAt: string;
};

export type TriggerRetryBacklogEntry = {
  deliveryId: string;
  triggerId: string;
  workflowDefinitionId: string;
  workflowSlug: string | null;
  triggerName: string | null;
  eventType: string | null;
  eventSource: string | null;
  attempts: number;
  retryAttempts: number;
  nextAttemptAt: string | null;
  overdue: boolean;
  retryState: RetryState;
  lastError: string | null;
  workflowRunId: string | null;
  dedupeKey: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowStepRetryBacklogEntry = {
  workflowRunStepId: string;
  workflowRunId: string;
  workflowDefinitionId: string;
  workflowSlug: string | null;
  stepId: string;
  status: string;
  attempt: number;
  retryAttempts: number;
  nextAttemptAt: string | null;
  overdue: boolean;
  retryState: RetryState;
  retryCount: number;
  retryMetadata: JsonValue | null;
  errorMessage: string | null;
  updatedAt: string;
};

export type RetryBacklogSummary = {
  total: number;
  overdue: number;
  nextAttemptAt: string | null;
};

export type RetryBacklogSnapshot = {
  events: {
    summary: RetryBacklogSummary;
    entries: EventRetryBacklogEntry[];
  };
  triggers: {
    summary: RetryBacklogSummary;
    entries: TriggerRetryBacklogEntry[];
  };
  workflowSteps: {
    summary: RetryBacklogSummary;
    entries: WorkflowStepRetryBacklogEntry[];
  };
};

function normalizeSummaryRow(row: {
  total?: string | null;
  overdue?: string | null;
  next_attempt_at?: string | null;
}): RetryBacklogSummary {
  const total = Number(row.total ?? 0);
  const overdue = Number(row.overdue ?? 0);
  return {
    total: Number.isFinite(total) && total > 0 ? total : 0,
    overdue: Number.isFinite(overdue) && overdue > 0 ? overdue : 0,
    nextAttemptAt: row.next_attempt_at ?? null
  } satisfies RetryBacklogSummary;
}

function coerceRetryState(value: unknown): RetryState {
  if (value === 'cancelled' || value === 'scheduled' || value === 'pending') {
    return value;
  }
  return 'pending';
}

function isOverdue(nextAttemptAt: string | null): boolean {
  if (!nextAttemptAt) {
    return false;
  }
  const ts = Date.parse(nextAttemptAt);
  if (Number.isNaN(ts)) {
    return false;
  }
  return ts <= Date.now();
}

export async function getRetryBacklogSnapshot(
  options: { eventLimit?: number; triggerLimit?: number; stepLimit?: number } = {}
): Promise<RetryBacklogSnapshot> {
  const eventLimit = Math.max(1, Math.min(options.eventLimit ?? 50, 200));
  const triggerLimit = Math.max(1, Math.min(options.triggerLimit ?? 50, 200));
  const stepLimit = Math.max(1, Math.min(options.stepLimit ?? 50, 200));

  return useConnection(async (client) => {
    const [eventSummaryResult, eventRowsResult] = await Promise.all([
      client.query<{ total: string; overdue: string; next_attempt_at: string | null }>(
        `SELECT
           COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE next_attempt_at <= NOW())::bigint AS overdue,
           MIN(next_attempt_at) AS next_attempt_at
         FROM event_ingress_retries
        WHERE retry_state = 'scheduled'`
      ),
      client.query<{
        event_id: string;
        source: string;
        attempts: number;
        next_attempt_at: string | null;
        retry_state: string;
        last_error: string | null;
        metadata: JsonValue | null;
        created_at: string;
        updated_at: string;
        event_type: string | null;
        event_source: string | null;
      }>(
        `SELECT r.event_id,
                r.source,
                r.attempts,
                r.next_attempt_at,
                r.retry_state,
                r.last_error,
                r.metadata,
                r.created_at,
                r.updated_at,
                e.type AS event_type,
                e.source AS event_source
           FROM event_ingress_retries r
           LEFT JOIN workflow_events e ON e.id = r.event_id
          WHERE r.retry_state = 'scheduled'
          ORDER BY r.next_attempt_at ASC NULLS LAST
          LIMIT $1`,
        [eventLimit]
      )
    ]);

    const eventEntries: EventRetryBacklogEntry[] = eventRowsResult.rows.map((row) => ({
      eventId: row.event_id,
      source: row.source,
      eventType: row.event_type,
      eventSource: row.event_source,
      attempts: Number(row.attempts ?? 0),
      nextAttemptAt: row.next_attempt_at,
      overdue: isOverdue(row.next_attempt_at),
      retryState: coerceRetryState(row.retry_state),
      lastError: row.last_error,
      metadata: (row.metadata as JsonValue | null) ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    const [triggerSummaryResult, triggerRowsResult] = await Promise.all([
      client.query<{ total: string; overdue: string; next_attempt_at: string | null }>(
        `SELECT
           COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE next_attempt_at <= NOW())::bigint AS overdue,
           MIN(next_attempt_at) AS next_attempt_at
         FROM workflow_trigger_deliveries
        WHERE retry_state = 'scheduled'`
      ),
      client.query<{
        id: string;
        trigger_id: string;
        workflow_definition_id: string;
        next_attempt_at: string | null;
        retry_state: string;
        retry_attempts: number;
        attempts: number;
        last_error: string | null;
        workflow_run_id: string | null;
        dedupe_key: string | null;
        created_at: string;
        updated_at: string;
        trigger_name: string | null;
        trigger_event_type: string | null;
        trigger_event_source: string | null;
        workflow_slug: string | null;
      }>(
        `SELECT d.id,
                d.trigger_id,
                d.workflow_definition_id,
                d.next_attempt_at,
                d.retry_state,
                d.retry_attempts,
                d.attempts,
                d.last_error,
                d.workflow_run_id,
                d.dedupe_key,
                d.created_at,
                d.updated_at,
                t.name AS trigger_name,
                t.event_type AS trigger_event_type,
                t.event_source AS trigger_event_source,
                wd.slug AS workflow_slug
           FROM workflow_trigger_deliveries d
           LEFT JOIN workflow_event_triggers t ON t.id = d.trigger_id
           LEFT JOIN workflow_definitions wd ON wd.id = d.workflow_definition_id
          WHERE d.retry_state = 'scheduled'
          ORDER BY d.next_attempt_at ASC NULLS LAST
          LIMIT $1`,
        [triggerLimit]
      )
    ]);

    const triggerEntries: TriggerRetryBacklogEntry[] = triggerRowsResult.rows.map((row) => ({
      deliveryId: row.id,
      triggerId: row.trigger_id,
      workflowDefinitionId: row.workflow_definition_id,
      workflowSlug: row.workflow_slug,
      triggerName: row.trigger_name,
      eventType: row.trigger_event_type,
      eventSource: row.trigger_event_source,
      attempts: Number(row.attempts ?? 0),
      retryAttempts: Number(row.retry_attempts ?? 0),
      nextAttemptAt: row.next_attempt_at,
      overdue: isOverdue(row.next_attempt_at),
      retryState: coerceRetryState(row.retry_state),
      lastError: row.last_error,
      workflowRunId: row.workflow_run_id,
      dedupeKey: row.dedupe_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    const [stepSummaryResult, stepRowsResult] = await Promise.all([
      client.query<{ total: string; overdue: string; next_attempt_at: string | null }>(
        `SELECT
           COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE next_attempt_at <= NOW())::bigint AS overdue,
           MIN(next_attempt_at) AS next_attempt_at
         FROM workflow_run_steps
        WHERE retry_state = 'scheduled'`
      ),
      client.query<{
        id: string;
        workflow_run_id: string;
        workflow_definition_id: string;
        step_id: string;
        status: string;
        attempt: number;
        retry_attempts: number;
        retry_state: string;
        retry_count: number;
        retry_metadata: JsonValue | null;
        next_attempt_at: string | null;
        error_message: string | null;
        updated_at: string;
        workflow_slug: string | null;
      }>(
        `SELECT s.id,
                s.workflow_run_id,
                s.workflow_definition_id,
                s.step_id,
                s.status,
                s.attempt,
                s.retry_attempts,
                s.retry_state,
                s.retry_count,
                s.retry_metadata,
                s.next_attempt_at,
                s.error_message,
                s.updated_at,
                wd.slug AS workflow_slug
           FROM workflow_run_steps s
           LEFT JOIN workflow_definitions wd ON wd.id = s.workflow_definition_id
          WHERE s.retry_state = 'scheduled'
          ORDER BY s.next_attempt_at ASC NULLS LAST
          LIMIT $1`,
        [stepLimit]
      )
    ]);

    const stepEntries: WorkflowStepRetryBacklogEntry[] = stepRowsResult.rows.map((row) => ({
      workflowRunStepId: row.id,
      workflowRunId: row.workflow_run_id,
      workflowDefinitionId: row.workflow_definition_id,
      workflowSlug: row.workflow_slug,
      stepId: row.step_id,
      status: row.status,
      attempt: Number(row.attempt ?? 0),
      retryAttempts: Number(row.retry_attempts ?? 0),
      nextAttemptAt: row.next_attempt_at,
      overdue: isOverdue(row.next_attempt_at),
      retryState: coerceRetryState(row.retry_state),
      retryCount: Number(row.retry_count ?? 0),
      retryMetadata: (row.retry_metadata as JsonValue | null) ?? null,
      errorMessage: row.error_message,
      updatedAt: row.updated_at
    }));

    return {
      events: {
        summary: normalizeSummaryRow(eventSummaryResult.rows[0] ?? {}),
        entries: eventEntries
      },
      triggers: {
        summary: normalizeSummaryRow(triggerSummaryResult.rows[0] ?? {}),
        entries: triggerEntries
      },
      workflowSteps: {
        summary: normalizeSummaryRow(stepSummaryResult.rows[0] ?? {}),
        entries: stepEntries
      }
    } satisfies RetryBacklogSnapshot;
  });
}

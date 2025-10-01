import type { EventEnvelope } from '@apphub/event-bus';
import { withConnection } from './db/client';
import type { WorkflowEventTriggerRecord } from './db/types';

export type TriggerMetricStatus =
  | 'filtered'
  | 'matched'
  | 'launched'
  | 'throttled'
  | 'skipped'
  | 'failed'
  | 'paused';

const STATUS_COLUMN_MAP: Record<TriggerMetricStatus, string> = {
  filtered: 'count_filtered',
  matched: 'count_matched',
  launched: 'count_launched',
  throttled: 'count_throttled',
  skipped: 'count_skipped',
  failed: 'count_failed',
  paused: 'count_paused'
};

export async function recordEventIngress(
  envelope: EventEnvelope,
  options: {
    throttled?: boolean;
    dropped?: boolean;
  } = {}
): Promise<void> {
  const source = (envelope.source ?? 'unknown').trim() || 'unknown';
  const now = new Date();
  const occurredAt = Date.parse(envelope.occurredAt);
  const lagValid = !Number.isNaN(occurredAt);
  const lagMs = lagValid ? Math.max(0, now.getTime() - occurredAt) : 0;
  const throttledIncrement = options.throttled ? 1 : 0;
  const droppedIncrement = options.dropped ? 1 : 0;

  await withConnection(async (client) => {
    await client.query(
      `INSERT INTO event_scheduler_source_metrics (
         source,
         total,
         throttled,
         dropped,
         failures,
         total_lag_ms,
         last_lag_ms,
         max_lag_ms,
         last_event_at
       )
       VALUES ($1, 1, $2, $3, 0, $4, $5, $6, $7)
       ON CONFLICT (source)
       DO UPDATE SET
         total = event_scheduler_source_metrics.total + 1,
         throttled = event_scheduler_source_metrics.throttled + $2,
         dropped = event_scheduler_source_metrics.dropped + $3,
         total_lag_ms = event_scheduler_source_metrics.total_lag_ms + CASE WHEN $8 THEN $4 ELSE 0 END,
         last_lag_ms = $5,
         max_lag_ms = CASE
           WHEN $8 THEN GREATEST(event_scheduler_source_metrics.max_lag_ms, $5)
           ELSE event_scheduler_source_metrics.max_lag_ms
         END,
         last_event_at = $7;`,
      [
        source,
        throttledIncrement,
        droppedIncrement,
        lagValid ? lagMs : 0,
        lagMs,
        lagValid ? lagMs : 0,
        now.toISOString(),
        lagValid
      ]
    );
  });
}

export async function recordEventIngressFailure(source: string): Promise<void> {
  const normalized = (source ?? 'unknown').trim() || 'unknown';
  await withConnection(async (client) => {
    await client.query(
      `INSERT INTO event_scheduler_source_metrics (
         source,
         total,
         throttled,
         dropped,
         failures,
         total_lag_ms,
         last_lag_ms,
         max_lag_ms,
         last_event_at
       )
       VALUES ($1, 0, 0, 0, 1, 0, 0, 0, NOW())
       ON CONFLICT (source)
       DO UPDATE SET
         failures = event_scheduler_source_metrics.failures + 1,
         last_event_at = NOW();`,
      [normalized]
    );
  });
}

export async function recordTriggerEvaluation(
  trigger: WorkflowEventTriggerRecord,
  status: TriggerMetricStatus,
  options: { error?: string } = {}
): Promise<void> {
  const column = STATUS_COLUMN_MAP[status];
  const increments: Record<TriggerMetricStatus, number> = {
    filtered: status === 'filtered' ? 1 : 0,
    matched: status === 'matched' ? 1 : 0,
    launched: status === 'launched' ? 1 : 0,
    throttled: status === 'throttled' ? 1 : 0,
    skipped: status === 'skipped' ? 1 : 0,
    failed: status === 'failed' ? 1 : 0,
    paused: status === 'paused' ? 1 : 0
  };

  let nextErrorValue: string | null = null;
  let shouldSetError = false;
  let shouldClearError = false;

  if (typeof options.error === 'string' && options.error.trim().length > 0) {
    nextErrorValue = options.error;
    shouldSetError = true;
  } else if (status === 'failed') {
    nextErrorValue = 'unknown error';
    shouldSetError = true;
  } else if (status === 'launched') {
    shouldClearError = true;
  }

  await withConnection(async (client) => {
    await client.query(
      `INSERT INTO event_scheduler_trigger_metrics (
         trigger_id,
         workflow_definition_id,
         count_filtered,
         count_matched,
         count_launched,
         count_throttled,
         count_skipped,
         count_failed,
         count_paused,
         last_status,
         last_updated_at,
         last_error
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)
       ON CONFLICT (trigger_id)
       DO UPDATE SET
         count_filtered = event_scheduler_trigger_metrics.count_filtered + $3,
         count_matched = event_scheduler_trigger_metrics.count_matched + $4,
         count_launched = event_scheduler_trigger_metrics.count_launched + $5,
         count_throttled = event_scheduler_trigger_metrics.count_throttled + $6,
         count_skipped = event_scheduler_trigger_metrics.count_skipped + $7,
         count_failed = event_scheduler_trigger_metrics.count_failed + $8,
         count_paused = event_scheduler_trigger_metrics.count_paused + $9,
         last_status = $10,
         last_updated_at = NOW(),
         last_error = CASE
           WHEN $12 THEN $11
           WHEN $13 THEN NULL
           ELSE event_scheduler_trigger_metrics.last_error
         END;`,
      [
        trigger.id,
        trigger.workflowDefinitionId,
        increments.filtered,
        increments.matched,
        increments.launched,
        increments.throttled,
        increments.skipped,
        increments.failed,
        increments.paused,
        status,
        shouldSetError ? nextErrorValue : shouldClearError ? null : null,
        shouldSetError,
        shouldClearError
      ]
    );
  });
}

export async function getEventSchedulerMetricsSnapshot(): Promise<{
  generatedAt: string;
  sources: Array<{
    source: string;
    total: number;
    throttled: number;
    dropped: number;
    failures: number;
    averageLagMs: number | null;
    lastLagMs: number;
    maxLagMs: number;
    lastEventAt: string | null;
  }>;
  triggers: Array<{
    triggerId: string;
    workflowDefinitionId: string;
    counts: Record<TriggerMetricStatus, number>;
    lastStatus: TriggerMetricStatus | null;
    lastUpdatedAt: string | null;
    lastError: string | null;
  }>;
}> {
  const nowIso = new Date().toISOString();

  const sources = await withConnection(async (client) => {
    const { rows } = await client.query<{
      source: string;
      total: string;
      throttled: string;
      dropped: string;
      failures: string;
      total_lag_ms: string;
      last_lag_ms: string;
      max_lag_ms: string;
      last_event_at: string | null;
    }>('SELECT * FROM event_scheduler_source_metrics ORDER BY source');

    return rows.map((row) => {
      const total = Number(row.total);
      const totalLag = Number(row.total_lag_ms);
      return {
        source: row.source,
        total,
        throttled: Number(row.throttled),
        dropped: Number(row.dropped),
        failures: Number(row.failures),
        averageLagMs: total > 0 ? Math.round(totalLag / total) : null,
        lastLagMs: Number(row.last_lag_ms),
        maxLagMs: Number(row.max_lag_ms),
        lastEventAt: row.last_event_at
      };
    });
  });

  const triggers = await withConnection(async (client) => {
    const { rows } = await client.query<{
      trigger_id: string;
      workflow_definition_id: string;
      count_filtered: string;
      count_matched: string;
      count_launched: string;
      count_throttled: string;
      count_skipped: string;
      count_failed: string;
      count_paused: string;
      last_status: TriggerMetricStatus | null;
      last_updated_at: string | null;
      last_error: string | null;
    }>('SELECT * FROM event_scheduler_trigger_metrics ORDER BY trigger_id');

    return rows.map((row) => ({
      triggerId: row.trigger_id,
      workflowDefinitionId: row.workflow_definition_id,
      counts: {
        filtered: Number(row.count_filtered),
        matched: Number(row.count_matched),
        launched: Number(row.count_launched),
        throttled: Number(row.count_throttled),
        skipped: Number(row.count_skipped),
        failed: Number(row.count_failed),
        paused: Number(row.count_paused)
      } satisfies Record<TriggerMetricStatus, number>,
      lastStatus: row.last_status ?? null,
      lastUpdatedAt: row.last_updated_at,
      lastError: row.last_error
    }));
  });

  return {
    generatedAt: nowIso,
    sources,
    triggers
  };
}

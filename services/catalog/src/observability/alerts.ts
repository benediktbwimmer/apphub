import { getPool } from '../db/client';
import type { WorkflowRunRecord } from '../db/types';
import type { RetryBacklogSnapshot } from '../retryBacklog';
import { logger } from './logger';

const DEFAULT_THRESHOLD = Number(process.env.WORKFLOW_FAILURE_ALERT_THRESHOLD ?? 3);
const DEFAULT_WINDOW_MINUTES = Number(process.env.WORKFLOW_FAILURE_ALERT_WINDOW_MINUTES ?? 15);
const ALERT_WEBHOOK_URL = process.env.WORKFLOW_ALERT_WEBHOOK_URL?.trim() || '';
const ALERT_WEBHOOK_TOKEN = process.env.WORKFLOW_ALERT_WEBHOOK_TOKEN?.trim() || '';

const RETRY_BACKLOG_ALERT_THRESHOLD = Number(process.env.RETRY_BACKLOG_ALERT_THRESHOLD ?? 25);
const RETRY_BACKLOG_ALERT_WINDOW_MINUTES = Number(process.env.RETRY_BACKLOG_ALERT_WINDOW_MINUTES ?? 10);

const lastAlertByWorkflow = new Map<string, number>();
const lastRetryAlertByCategory = new Map<string, number>();

async function queryFailureCount(workflowDefinitionId: string, windowMinutes: number): Promise<number> {
  const pool = getPool();
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::bigint AS count
       FROM workflow_runs
      WHERE workflow_definition_id = $1
        AND status = 'failed'
        AND created_at >= NOW() - ($2::int * INTERVAL '1 minute')`,
    [workflowDefinitionId, windowMinutes]
  );
  return Number(rows[0]?.count ?? 0);
}

async function sendAlertWebhook(eventType: string, payload: Record<string, unknown>): Promise<void> {
  if (!ALERT_WEBHOOK_URL) {
    return;
  }
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(ALERT_WEBHOOK_TOKEN ? { authorization: `Bearer ${ALERT_WEBHOOK_TOKEN}` } : {})
      },
      body: JSON.stringify({ event: eventType, data: payload })
    });
  } catch (err) {
    logger.error('Failed to deliver workflow alert webhook', {
      error: err instanceof Error ? err.message : 'unknown error'
    });
  }
}

export async function handleWorkflowFailureAlert(run: WorkflowRunRecord): Promise<void> {
  const threshold = Number.isFinite(DEFAULT_THRESHOLD) ? DEFAULT_THRESHOLD : 3;
  const windowMinutes = Number.isFinite(DEFAULT_WINDOW_MINUTES) ? DEFAULT_WINDOW_MINUTES : 15;
  if (threshold <= 0) {
    return;
  }

  const failureCount = await queryFailureCount(run.workflowDefinitionId, windowMinutes);
  if (failureCount < threshold) {
    return;
  }

  const now = Date.now();
  const windowMs = windowMinutes * 60_000;
  const lastAlertAt = lastAlertByWorkflow.get(run.workflowDefinitionId) ?? 0;
  if (now - lastAlertAt < windowMs) {
    return;
  }
  lastAlertByWorkflow.set(run.workflowDefinitionId, now);

  const payload = {
    workflowDefinitionId: run.workflowDefinitionId,
    workflowRunId: run.id,
    workflowRunKey: run.runKey ?? null,
    failureCount,
    windowMinutes,
    triggeredBy: run.triggeredBy,
    errorMessage: run.errorMessage,
    occurredAt: new Date().toISOString()
  } as const;

  logger.warn('Workflow failure threshold reached', payload);
  await sendAlertWebhook('workflow.failure.streak', payload);
}

export async function handleRetryBacklogAlerts(snapshot: RetryBacklogSnapshot): Promise<void> {
  const threshold = Number.isFinite(RETRY_BACKLOG_ALERT_THRESHOLD) ? RETRY_BACKLOG_ALERT_THRESHOLD : 25;
  const windowMinutes = Number.isFinite(RETRY_BACKLOG_ALERT_WINDOW_MINUTES)
    ? RETRY_BACKLOG_ALERT_WINDOW_MINUTES
    : 10;
  const windowMs = windowMinutes * 60_000;

  const categories: Array<{ key: string; label: string; summary: RetryBacklogSnapshot['events']['summary'] }> = [
    { key: 'events', label: 'event-ingress', summary: snapshot.events.summary },
    { key: 'triggers', label: 'event-trigger-delivery', summary: snapshot.triggers.summary },
    { key: 'workflowSteps', label: 'workflow-step', summary: snapshot.workflowSteps.summary }
  ];

  for (const category of categories) {
    if (category.summary.total < threshold && category.summary.overdue === 0) {
      continue;
    }

    const now = Date.now();
    const lastAlertAt = lastRetryAlertByCategory.get(category.key) ?? 0;
    if (now - lastAlertAt < windowMs) {
      continue;
    }
    lastRetryAlertByCategory.set(category.key, now);

    const payload = {
      category: category.label,
      total: category.summary.total,
      overdue: category.summary.overdue,
      oldestScheduled: category.summary.nextAttemptAt,
      occurredAt: new Date(now).toISOString()
    } as const;

    logger.warn('Retry backlog threshold exceeded', payload);
    await sendAlertWebhook('retry.backlog.threshold', payload);
  }
}

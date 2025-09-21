import { getPool } from '../db/client';
import type { WorkflowRunRecord } from '../db/types';
import { logger } from './logger';

const DEFAULT_THRESHOLD = Number(process.env.WORKFLOW_FAILURE_ALERT_THRESHOLD ?? 3);
const DEFAULT_WINDOW_MINUTES = Number(process.env.WORKFLOW_FAILURE_ALERT_WINDOW_MINUTES ?? 15);
const ALERT_WEBHOOK_URL = process.env.WORKFLOW_ALERT_WEBHOOK_URL?.trim() || '';
const ALERT_WEBHOOK_TOKEN = process.env.WORKFLOW_ALERT_WEBHOOK_TOKEN?.trim() || '';

const lastAlertByWorkflow = new Map<string, number>();

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

async function sendAlertWebhook(payload: Record<string, unknown>): Promise<void> {
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
      body: JSON.stringify({ event: 'workflow.failure.streak', data: payload })
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
    failureCount,
    windowMinutes,
    triggeredBy: run.triggeredBy,
    errorMessage: run.errorMessage,
    occurredAt: new Date().toISOString()
  } as const;

  logger.warn('Workflow failure threshold reached', payload);
  await sendAlertWebhook(payload);
}

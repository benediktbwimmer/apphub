import { getPool } from '../db/client';
import { getRetryBacklogSnapshot, type RetryBacklogSummary } from '../retryBacklog';
import { handleRetryBacklogAlerts } from './alerts';

export type RunMetrics = {
  jobs: {
    total: number;
    statusCounts: Record<string, number>;
    averageDurationMs: number | null;
    failureRate: number;
  };
  workflows: {
    total: number;
    statusCounts: Record<string, number>;
    averageDurationMs: number | null;
    failureRate: number;
  };
  retries: {
    events: RetryBacklogSummary;
    triggers: RetryBacklogSummary;
    workflowSteps: RetryBacklogSummary;
  };
  generatedAt: string;
};

async function fetchStatusCounts(table: string): Promise<{ total: number; status: Record<string, number> }> {
  const pool = getPool();
  const { rows } = await pool.query<{ status: string; count: string }>(
    `SELECT status, COUNT(*)::bigint AS count FROM ${table} GROUP BY status`
  );
  let total = 0;
  const statusCounts: Record<string, number> = {};
  for (const row of rows) {
    const count = Number(row.count ?? 0);
    total += count;
    statusCounts[row.status ?? 'unknown'] = count;
  }
  return { total, status: statusCounts };
}

async function fetchAverageDuration(table: string): Promise<number | null> {
  const pool = getPool();
  const { rows } = await pool.query<{ avg: string | null }>(
    `SELECT AVG(duration_ms)::numeric AS avg FROM ${table} WHERE duration_ms IS NOT NULL`
  );
  if (!rows[0]?.avg) {
    return null;
  }
  const value = Number(rows[0].avg);
  return Number.isFinite(value) ? value : null;
}

function calculateFailureRate(statusCounts: Record<string, number>, total: number): number {
  if (total === 0) {
    return 0;
  }
  const failures = statusCounts.failed ?? 0;
  return failures / total;
}

export async function computeRunMetrics(): Promise<RunMetrics> {
  const [{ total: jobTotal, status: jobStatus }, { total: workflowTotal, status: workflowStatus }] =
    await Promise.all([fetchStatusCounts('job_runs'), fetchStatusCounts('workflow_runs')]);

  const [jobAvg, workflowAvg] = await Promise.all([
    fetchAverageDuration('job_runs'),
    fetchAverageDuration('workflow_runs')
  ]);

  const retrySnapshot = await getRetryBacklogSnapshot({ eventLimit: 1, triggerLimit: 1, stepLimit: 1 });
  await handleRetryBacklogAlerts(retrySnapshot);

  return {
    jobs: {
      total: jobTotal,
      statusCounts: jobStatus,
      averageDurationMs: jobAvg,
      failureRate: calculateFailureRate(jobStatus, jobTotal)
    },
    workflows: {
      total: workflowTotal,
      statusCounts: workflowStatus,
      averageDurationMs: workflowAvg,
      failureRate: calculateFailureRate(workflowStatus, workflowTotal)
    },
    retries: {
      events: retrySnapshot.events.summary,
      triggers: retrySnapshot.triggers.summary,
      workflowSteps: retrySnapshot.workflowSteps.summary
    },
    generatedAt: new Date().toISOString()
  } satisfies RunMetrics;
}

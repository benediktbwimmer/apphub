import type { WorkflowRunRecord, WorkflowTriggerDeliveryRecord } from '../../db/types';
import { useConnection } from '../../db/utils';
import { fetchWorkflowDefinitionBySlugOrThrow } from './definitionsRepository';
import { WorkflowRunStatusCounts, WorkflowActivityEntry, WorkflowActivityListFilters, WorkflowActivityTriggerSummary } from './runsRepository';

type AnalyticsTimeRange = {
  from: Date;
  to: Date;
};

export type WorkflowRunStats = {
  workflowId: string;
  slug: string;
  range: AnalyticsTimeRange;
  totalRuns: number;
  statusCounts: WorkflowRunStatusCounts;
  successRate: number;
  failureRate: number;
  averageDurationMs: number | null;
  failureCategories: { category: string; count: number }[];
};

export type WorkflowRunMetricsPoint = {
  bucketStart: string;
  bucketEnd: string;
  totalRuns: number;
  statusCounts: WorkflowRunStatusCounts;
  averageDurationMs: number | null;
  rollingSuccessCount: number;
};

export type WorkflowRunMetrics = {
  workflowId: string;
  slug: string;
  range: AnalyticsTimeRange;
  bucketInterval: string;
  series: WorkflowRunMetricsPoint[];
};

type AnalyticsOptions = {
  from?: Date;
  to?: Date;
};

type MetricsOptions = AnalyticsOptions & {
  bucketInterval?: string;
};

function normalizeTimeRange({ from, to }: AnalyticsOptions): AnalyticsTimeRange {
  const resolvedTo = to ?? new Date();
  const resolvedFrom = from ?? new Date(resolvedTo.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (resolvedFrom.getTime() >= resolvedTo.getTime()) {
    return {
      from: new Date(resolvedTo.getTime() - 60 * 60 * 1000),
      to: resolvedTo
    } satisfies AnalyticsTimeRange;
  }
  return { from: resolvedFrom, to: resolvedTo } satisfies AnalyticsTimeRange;
}

function resolveBucketInterval(range: AnalyticsTimeRange, bucketInterval?: string): string {
  if (bucketInterval) {
    return bucketInterval;
  }
  const durationMs = range.to.getTime() - range.from.getTime();
  const hourMs = 60 * 60 * 1000;
  if (durationMs <= 24 * hourMs) {
    return '15 minutes';
  }
  if (durationMs <= 7 * 24 * hourMs) {
    return '1 hour';
  }
  return '1 day';
}

export async function getWorkflowRunStatsBySlug(
  slug: string,
  options: AnalyticsOptions & { moduleIds?: string[] | null } = {}
): Promise<WorkflowRunStats> {
  return useConnection(async (client) => {
    const normalizedModuleIds = Array.isArray(options.moduleIds)
      ? Array.from(new Set(options.moduleIds.map((id) => id.trim()).filter((id) => id.length > 0)))
      : null;

    const definition = await fetchWorkflowDefinitionBySlugOrThrow(client, slug, {
      moduleIds: normalizedModuleIds
    });
    const range = normalizeTimeRange(options);

    const moduleFilterClause = normalizedModuleIds && normalizedModuleIds.length > 0
      ? `AND EXISTS (
          SELECT 1
            FROM module_resource_contexts mrc
           WHERE mrc.resource_type = 'workflow-run'
             AND mrc.resource_id = workflow_runs.id
             AND mrc.module_id = ANY($4::text[])
        )`
      : '';

    const { rows: statusRows } = await client.query<{ status: string | null; count: string }>(
      `SELECT status, COUNT(*)::bigint AS count
         FROM workflow_runs
        WHERE workflow_definition_id = $1
          AND created_at >= $2
          AND created_at < $3
          ${moduleFilterClause}
        GROUP BY status`,
      normalizedModuleIds && normalizedModuleIds.length > 0
        ? [definition.id, range.from.toISOString(), range.to.toISOString(), normalizedModuleIds]
        : [definition.id, range.from.toISOString(), range.to.toISOString()]
    );

    const statusCounts: WorkflowRunStatusCounts = {};
    let totalRuns = 0;
    for (const row of statusRows) {
      const status = (row.status ?? 'unknown').toLowerCase();
      const count = Number(row.count ?? 0);
      totalRuns += Number.isFinite(count) ? count : 0;
      statusCounts[status] = Number.isFinite(count) ? count : 0;
    }

    const { rows: averageRows } = await client.query<{ avg: string | null }>(
      `SELECT AVG(duration_ms)::numeric AS avg
         FROM workflow_runs
        WHERE workflow_definition_id = $1
          AND duration_ms IS NOT NULL
          AND created_at >= $2
          AND created_at < $3
          ${moduleFilterClause}`,
      normalizedModuleIds && normalizedModuleIds.length > 0
        ? [definition.id, range.from.toISOString(), range.to.toISOString(), normalizedModuleIds]
        : [definition.id, range.from.toISOString(), range.to.toISOString()]
    );

    const averageDurationMs = (() => {
      const raw = averageRows[0]?.avg;
      if (!raw) {
        return null;
      }
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    })();

    const { rows: failureRows } = await client.query<{
      category: string | null;
      count: string;
    }>(
      `SELECT
         COALESCE(NULLIF(TRIM(SPLIT_PART(error_message, ':', 1)), ''), 'unknown') AS category,
         COUNT(*)::bigint AS count
       FROM workflow_runs
      WHERE workflow_definition_id = $1
        AND status = 'failed'
        AND created_at >= $2
        AND created_at < $3
        ${moduleFilterClause}
      GROUP BY category
      ORDER BY count DESC
      LIMIT 20`,
      normalizedModuleIds && normalizedModuleIds.length > 0
        ? [definition.id, range.from.toISOString(), range.to.toISOString(), normalizedModuleIds]
        : [definition.id, range.from.toISOString(), range.to.toISOString()]
    );

    const failureCategories = failureRows.map((row) => ({
      category: (row.category ?? 'unknown').toLowerCase(),
      count: Number(row.count ?? 0)
    }));

    const successCount = statusCounts.succeeded ?? 0;
    const failureCount = statusCounts.failed ?? 0;
    const successRate = totalRuns === 0 ? 0 : successCount / totalRuns;
    const failureRate = totalRuns === 0 ? 0 : failureCount / totalRuns;

    return {
      workflowId: definition.id,
      slug: definition.slug,
      range,
      totalRuns,
      statusCounts,
      successRate,
      failureRate,
      averageDurationMs,
      failureCategories
    } satisfies WorkflowRunStats;
  });
}

export async function getWorkflowRunMetricsBySlug(
  slug: string,
  options: MetricsOptions & { moduleIds?: string[] | null } = {}
): Promise<WorkflowRunMetrics> {
  return useConnection(async (client) => {
    const normalizedModuleIds = Array.isArray(options.moduleIds)
      ? Array.from(new Set(options.moduleIds.map((id) => id.trim()).filter((id) => id.length > 0)))
      : null;

    const definition = await fetchWorkflowDefinitionBySlugOrThrow(client, slug, {
      moduleIds: normalizedModuleIds
    });
    const range = normalizeTimeRange(options);
    const bucketInterval = resolveBucketInterval(range, options.bucketInterval);

    const moduleFilterClause = normalizedModuleIds && normalizedModuleIds.length > 0
      ? `AND EXISTS (
            SELECT 1
              FROM module_resource_contexts mrc
             WHERE mrc.resource_type = 'workflow-run'
               AND mrc.resource_id = run_source.run_id
               AND mrc.module_id = ANY($5::text[])
          )`
      : '';

    const { rows } = await client.query<{
      bucket_start: Date;
      bucket_end: Date;
      total_runs: string;
      succeeded: string;
      failed: string;
      running: string;
      canceled: string;
      avg_duration_ms: string | null;
    }>(
      `WITH bucket_series AS (
         SELECT generate_series($2::timestamptz, $3::timestamptz, $4::interval) AS bucket_start
       ),
       run_source AS (
         SELECT id AS run_id, created_at, status, duration_ms
           FROM workflow_runs
          WHERE workflow_definition_id = $1
            AND created_at >= $2
            AND created_at < $3
            ${moduleFilterClause}
       )
       SELECT
         bucket_start,
         bucket_start + $4::interval AS bucket_end,
         COUNT(run_source.*)::bigint AS total_runs,
         COUNT(*) FILTER (WHERE run_source.status = 'succeeded')::bigint AS succeeded,
         COUNT(*) FILTER (WHERE run_source.status = 'failed')::bigint AS failed,
         COUNT(*) FILTER (WHERE run_source.status = 'running')::bigint AS running,
         COUNT(*) FILTER (WHERE run_source.status = 'canceled')::bigint AS canceled,
         AVG(run_source.duration_ms)::numeric AS avg_duration_ms
       FROM bucket_series
       LEFT JOIN run_source
         ON run_source.created_at >= bucket_start
        AND run_source.created_at < bucket_start + $4::interval
       GROUP BY bucket_start
       ORDER BY bucket_start`,
      normalizedModuleIds && normalizedModuleIds.length > 0
        ? [definition.id, range.from.toISOString(), range.to.toISOString(), bucketInterval, normalizedModuleIds]
        : [definition.id, range.from.toISOString(), range.to.toISOString(), bucketInterval]
    );

    const series: WorkflowRunMetricsPoint[] = [];
    let rollingSuccessCount = 0;

    for (const row of rows) {
      const bucketStartIso = row.bucket_start.toISOString();
      const bucketEndIso = row.bucket_end.toISOString();
      const succeeded = Number(row.succeeded ?? 0);
      rollingSuccessCount += Number.isFinite(succeeded) ? succeeded : 0;
      const failed = Number(row.failed ?? 0);
      const running = Number(row.running ?? 0);
      const canceled = Number(row.canceled ?? 0);
      const totalRuns = Number(row.total_runs ?? 0);
      const avgDuration = row.avg_duration_ms ? Number(row.avg_duration_ms) : null;

      const statusCounts: WorkflowRunStatusCounts = {
        succeeded: Number.isFinite(succeeded) ? succeeded : 0,
        failed: Number.isFinite(failed) ? failed : 0,
        running: Number.isFinite(running) ? running : 0,
        canceled: Number.isFinite(canceled) ? canceled : 0
      };

      series.push({
        bucketStart: bucketStartIso,
        bucketEnd: bucketEndIso,
        totalRuns: Number.isFinite(totalRuns) ? totalRuns : 0,
        statusCounts,
        averageDurationMs: avgDuration && Number.isFinite(avgDuration) ? avgDuration : null,
        rollingSuccessCount
      });
    }

    return {
      workflowId: definition.id,
      slug: definition.slug,
      range,
      bucketInterval,
      series
    } satisfies WorkflowRunMetrics;
  });
}

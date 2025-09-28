import { useConnection } from './utils';
import type {
  WorkflowEventProducerSampleRecord,
  WorkflowEventProducerSampleSummary,
  WorkflowEventProducerSamplingSnapshot,
  WorkflowEventProducerSampleUpsert
} from './types';
import { mapWorkflowEventProducerSampleRow } from './rowMappers';
import type { WorkflowEventProducerSampleRow } from './rowTypes';

const DEFAULT_SAMPLE_TTL_MS = resolveTtl(process.env.EVENT_SAMPLING_TTL_MS, 30 * 24 * 60 * 60 * 1000);

function resolveTtl(source: string | undefined, fallback: number): number {
  if (!source) {
    return fallback;
  }
  const parsed = Number(source);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed >= 0 ? Math.floor(parsed) : fallback;
}

function normalizeTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return new Date().toISOString();
  }
  return new Date(parsed).toISOString();
}

function resolveExpiresAt(observedAt: string, ttlMs?: number | null): string | null {
  const ttlCandidate = ttlMs ?? DEFAULT_SAMPLE_TTL_MS;
  if (!Number.isFinite(ttlCandidate) || ttlCandidate <= 0) {
    return null;
  }
  const parsedObserved = Date.parse(observedAt);
  if (Number.isNaN(parsedObserved)) {
    return null;
  }
  return new Date(parsedObserved + ttlCandidate).toISOString();
}

function clampPositive(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value ?? NaN)) {
    return fallback;
  }
  const normalized = Math.floor(Number(value));
  if (Number.isNaN(normalized) || normalized <= 0) {
    return fallback;
  }
  return Math.min(normalized, max);
}

function parseBigInt(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  const parsed = typeof value === 'string' ? Number(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function upsertWorkflowEventProducerSample(
  sample: WorkflowEventProducerSampleUpsert
): Promise<WorkflowEventProducerSampleRecord> {
  const observedAt = normalizeTimestamp(sample.observedAt);
  const expiresAt = resolveExpiresAt(observedAt, sample.ttlMs);

  const { rows } = await useConnection((client) =>
    client.query<WorkflowEventProducerSampleRow>(
      `INSERT INTO workflow_event_producer_samples (
         workflow_definition_id,
         workflow_run_step_id,
         job_slug,
         event_type,
         event_source,
         sample_count,
         first_seen_at,
         last_seen_at,
         expires_at
       ) VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         1,
         $6,
         $6,
         $7
       )
       ON CONFLICT (workflow_definition_id, workflow_run_step_id, job_slug, event_type, event_source)
       DO UPDATE SET
         sample_count = workflow_event_producer_samples.sample_count + 1,
         last_seen_at = GREATEST(workflow_event_producer_samples.last_seen_at, EXCLUDED.last_seen_at),
         expires_at = CASE
           WHEN EXCLUDED.expires_at IS NULL THEN workflow_event_producer_samples.expires_at
           WHEN workflow_event_producer_samples.expires_at IS NULL THEN EXCLUDED.expires_at
           WHEN EXCLUDED.expires_at > workflow_event_producer_samples.expires_at THEN EXCLUDED.expires_at
           ELSE workflow_event_producer_samples.expires_at
         END
       RETURNING *`,
      [
        sample.workflowDefinitionId,
        sample.workflowRunStepId,
        sample.jobSlug,
        sample.eventType,
        sample.eventSource,
        observedAt,
        expiresAt
      ]
    )
  );

  if (rows.length === 0) {
    throw new Error('Failed to upsert workflow event producer sample');
  }

  return mapWorkflowEventProducerSampleRow(rows[0]);
}

export async function getWorkflowEventProducerSamplingSnapshot(options: {
  perJobLimit?: number;
  staleBefore?: string | null;
  staleLimit?: number;
} = {}): Promise<WorkflowEventProducerSamplingSnapshot> {
  const perJobLimit = clampPositive(options.perJobLimit, 25, 200);
  const staleLimit = clampPositive(options.staleLimit, 25, 200);
  const staleBeforeIso = options.staleBefore ? normalizeTimestamp(options.staleBefore) : null;

  return useConnection(async (client) => {
    const totalsPromise = client.query<{ total_samples: string | null; row_count: string | null }>(
      `SELECT
         COALESCE(SUM(sample_count), 0)::bigint AS total_samples,
         COUNT(*)::bigint AS row_count
       FROM workflow_event_producer_samples`
    );

    const perJobPromise = client.query<{
      job_slug: string;
      event_type: string;
      event_source: string;
      sample_count: string | null;
      distinct_edges: string | null;
      workflow_definition_ids: string[];
      last_seen_at: string;
    }>(
      `SELECT
         job_slug,
         event_type,
         event_source,
         SUM(sample_count)::bigint AS sample_count,
         COUNT(*)::bigint AS distinct_edges,
         ARRAY_AGG(DISTINCT workflow_definition_id) AS workflow_definition_ids,
         MAX(last_seen_at) AS last_seen_at
       FROM workflow_event_producer_samples
       GROUP BY job_slug, event_type, event_source
       ORDER BY SUM(sample_count) DESC, job_slug ASC, event_type ASC
       LIMIT $1`,
      [perJobLimit]
    );

    const stalePromise = staleBeforeIso
      ? client.query<WorkflowEventProducerSampleRow>(
          `SELECT *
             FROM workflow_event_producer_samples
            WHERE last_seen_at < $1
            ORDER BY last_seen_at ASC
            LIMIT $2`,
          [staleBeforeIso, staleLimit]
        )
      : Promise.resolve({ rows: [] as WorkflowEventProducerSampleRow[] });

    const [totalsResult, perJobResult, staleResult] = await Promise.all([
      totalsPromise,
      perJobPromise,
      stalePromise
    ]);

    const totalsRow = totalsResult.rows[0] ?? { total_samples: '0', row_count: '0' };
    const totals = {
      rows: parseBigInt(totalsRow.row_count),
      sampleCount: parseBigInt(totalsRow.total_samples)
    };

    const perJob: WorkflowEventProducerSampleSummary[] = perJobResult.rows.map((row) => ({
      jobSlug: row.job_slug,
      eventType: row.event_type,
      eventSource: row.event_source,
      sampleCount: parseBigInt(row.sample_count),
      distinctWorkflows: parseBigInt(row.distinct_edges),
      workflowDefinitionIds: Array.from(new Set(row.workflow_definition_ids ?? [])).filter(
        (id) => typeof id === 'string' && id.trim().length > 0
      ),
      lastSeenAt: row.last_seen_at
    }));

    const stale = staleResult.rows.map(mapWorkflowEventProducerSampleRow);

    return {
      totals,
      perJob,
      stale,
      staleBefore: staleBeforeIso,
      generatedAt: new Date().toISOString()
    } satisfies WorkflowEventProducerSamplingSnapshot;
  });
}

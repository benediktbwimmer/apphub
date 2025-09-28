import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

export interface MetricsOptions {
  enabled: boolean;
  collectDefaultMetrics: boolean;
  prefix: string;
}

export interface IngestionMetricsInput {
  datasetSlug: string;
  mode: 'inline' | 'queued';
  result: 'success' | 'failure';
  durationSeconds?: number;
}

export interface IngestionJobMetricsInput {
  datasetSlug: string;
  result: 'success' | 'failure';
  durationSeconds?: number;
}

type QueueState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused';

export type IngestionQueueCounts = Partial<Record<QueueState, number>>;

export interface QueryMetricsInput {
  datasetSlug: string;
  mode: 'raw' | 'downsampled';
  result: 'success' | 'failure';
  durationSeconds?: number;
  rowCount?: number;
  remotePartitions?: number;
  cacheEnabled?: boolean;
}

export interface LifecycleMetricsInput {
  datasetId: string | null;
  status: 'started' | 'completed' | 'failed' | 'skipped';
  durationSeconds?: number;
}

export interface LifecycleOperationMetricsInput {
  operation: string;
  status: 'completed' | 'failed' | 'skipped';
  partitions?: number;
  bytes?: number;
}

export type ManifestCacheHitSource = 'memory' | 'redis';
export type ManifestCacheMissReason = 'disabled' | 'index' | 'entry' | 'stale' | 'error';
export type ManifestCacheEvictionReason = 'invalidate' | 'rebuild';

export type LifecycleQueueCounts = Partial<Record<QueueState, number>>;

export interface HttpMetricInput {
  method: string;
  route: string;
  statusCode: number;
  durationSeconds?: number;
}

export type RuntimeCacheResource = 'context' | 'connection';
export type RuntimeCacheEvent = 'hit' | 'miss' | 'invalidated' | 'expired';

interface MetricsState {
  enabled: boolean;
  registry: Registry;
  prefix: string;
  ingestRequestsTotal: Counter<string> | null;
  ingestDurationSeconds: Histogram<string> | null;
  ingestQueueJobs: Gauge<string> | null;
  ingestJobsTotal: Counter<string> | null;
  ingestJobDurationSeconds: Histogram<string> | null;
  queryRequestsTotal: Counter<string> | null;
  queryDurationSeconds: Histogram<string> | null;
  queryRowCount: Histogram<string> | null;
  queryRemotePartitions: Counter<string> | null;
  manifestCacheHitsTotal: Counter<string> | null;
  manifestCacheMissesTotal: Counter<string> | null;
  manifestCacheEvictionsTotal: Counter<string> | null;
  lifecycleJobsTotal: Counter<string> | null;
  lifecycleDurationSeconds: Histogram<string> | null;
  lifecycleOperationsTotal: Counter<string> | null;
  lifecycleQueueJobs: Gauge<string> | null;
  httpRequestsTotal: Counter<string> | null;
  httpRequestDurationSeconds: Histogram<string> | null;
  runtimeCacheEventsTotal: Counter<string> | null;
  runtimeCacheRebuildDurationSeconds: Histogram<string> | null;
}

const INGESTION_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];
const QUERY_BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5];
const QUERY_ROWS_BUCKETS = [1, 10, 100, 1_000, 10_000, 100_000];
const LIFECYCLE_BUCKETS = [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];
const HTTP_BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5];

let metricsState: MetricsState | null = null;

export function setupMetrics(options: MetricsOptions): MetricsState {
  if (metricsState) {
    return metricsState;
  }

  const registry = new Registry();
  const enabled = options.enabled;
  const prefix = options.prefix.endsWith('_') ? options.prefix : `${options.prefix}_`;

  const registerMetrics = enabled ? [registry] : undefined;

  const ingestRequestsTotal = enabled
    ? new Counter({
        name: `${prefix}ingest_requests_total`,
        help: 'Total ingestion requests grouped by dataset, result, and mode',
        labelNames: ['dataset', 'result', 'mode'],
        registers: registerMetrics
      })
    : null;

  const ingestDurationSeconds = enabled
    ? new Histogram({
        name: `${prefix}ingest_duration_seconds`,
        help: 'Latency of ingestion requests in seconds',
        labelNames: ['dataset', 'mode'],
        buckets: INGESTION_BUCKETS,
        registers: registerMetrics
      })
    : null;

  const ingestQueueJobs = enabled
    ? new Gauge({
        name: `${prefix}ingest_queue_jobs`,
        help: 'Current ingestion queue depth by state',
        labelNames: ['state'],
        registers: registerMetrics
      })
    : null;

  const ingestJobsTotal = enabled
    ? new Counter({
        name: `${prefix}ingest_jobs_total`,
        help: 'Ingestion job outcomes grouped by dataset and result',
        labelNames: ['dataset', 'result'],
        registers: registerMetrics
      })
    : null;

  const ingestJobDurationSeconds = enabled
    ? new Histogram({
        name: `${prefix}ingest_job_duration_seconds`,
        help: 'Duration of ingestion job processing in seconds',
        labelNames: ['dataset'],
        buckets: INGESTION_BUCKETS,
        registers: registerMetrics
      })
    : null;

  const queryRequestsTotal = enabled
    ? new Counter({
        name: `${prefix}query_requests_total`,
        help: 'Total query requests grouped by dataset, mode, and result',
        labelNames: ['dataset', 'mode', 'result'],
        registers: registerMetrics
      })
    : null;

  const queryDurationSeconds = enabled
    ? new Histogram({
        name: `${prefix}query_duration_seconds`,
        help: 'Duration of query execution in seconds',
        labelNames: ['dataset', 'mode'],
        buckets: QUERY_BUCKETS,
        registers: registerMetrics
      })
    : null;

  const queryRowCount = enabled
    ? new Histogram({
        name: `${prefix}query_row_count`,
        help: 'Result row counts for queries',
        labelNames: ['dataset', 'mode'],
        buckets: QUERY_ROWS_BUCKETS,
        registers: registerMetrics
      })
    : null;

  const queryRemotePartitions = enabled
    ? new Counter({
        name: `${prefix}query_remote_partitions_total`,
        help: 'Remote partition access counts grouped by dataset and cache configuration',
        labelNames: ['dataset', 'cache_enabled'],
        registers: registerMetrics
      })
    : null;

  const manifestCacheHitsTotal = enabled
    ? new Counter({
        name: `${prefix}manifest_cache_hits_total`,
        help: 'Manifest cache hits grouped by source',
        labelNames: ['source'],
        registers: registerMetrics
      })
    : null;

  const manifestCacheMissesTotal = enabled
    ? new Counter({
        name: `${prefix}manifest_cache_misses_total`,
        help: 'Manifest cache misses grouped by reason',
        labelNames: ['reason'],
        registers: registerMetrics
      })
    : null;

  const manifestCacheEvictionsTotal = enabled
    ? new Counter({
        name: `${prefix}manifest_cache_evictions_total`,
        help: 'Manifest cache eviction counts grouped by reason',
        labelNames: ['reason'],
        registers: registerMetrics
      })
    : null;

  const lifecycleJobsTotal = enabled
    ? new Counter({
        name: `${prefix}lifecycle_jobs_total`,
        help: 'Lifecycle job counts grouped by dataset and status',
        labelNames: ['dataset', 'status'],
        registers: registerMetrics
      })
    : null;

  const lifecycleDurationSeconds = enabled
    ? new Histogram({
        name: `${prefix}lifecycle_job_duration_seconds`,
        help: 'Lifecycle job duration in seconds grouped by status',
        labelNames: ['status'],
        buckets: LIFECYCLE_BUCKETS,
        registers: registerMetrics
      })
    : null;

  const lifecycleOperationsTotal = enabled
    ? new Counter({
        name: `${prefix}lifecycle_operations_total`,
        help: 'Lifecycle maintenance operations grouped by type and status',
        labelNames: ['operation', 'status'],
        registers: registerMetrics
      })
    : null;

  const lifecycleQueueJobs = enabled
    ? new Gauge({
        name: `${prefix}lifecycle_queue_jobs`,
        help: 'Lifecycle queue depth by state',
        labelNames: ['state'],
        registers: registerMetrics
      })
    : null;

  const httpRequestsTotal = enabled
    ? new Counter({
        name: `${prefix}http_requests_total`,
        help: 'HTTP request totals grouped by method, route, and status',
        labelNames: ['method', 'route', 'status'],
        registers: registerMetrics
      })
    : null;

  const httpRequestDurationSeconds = enabled
    ? new Histogram({
        name: `${prefix}http_request_duration_seconds`,
        help: 'HTTP request durations in seconds grouped by method and route',
        labelNames: ['method', 'route'],
        buckets: HTTP_BUCKETS,
        registers: registerMetrics
      })
    : null;

  const runtimeCacheEventsTotal = enabled
    ? new Counter({
        name: `${prefix}sql_runtime_cache_events_total`,
        help: 'SQL runtime cache events grouped by resource and event type',
        labelNames: ['resource', 'event'],
        registers: registerMetrics
      })
    : null;

  const runtimeCacheRebuildDurationSeconds = enabled
    ? new Histogram({
        name: `${prefix}sql_runtime_cache_rebuild_duration_seconds`,
        help: 'SQL runtime cache rebuild durations grouped by resource',
        labelNames: ['resource'],
        buckets: QUERY_BUCKETS,
        registers: registerMetrics
      })
    : null;

  if (enabled && options.collectDefaultMetrics) {
    collectDefaultMetrics({ register: registry, prefix });
  }

  metricsState = {
    enabled,
    registry,
    prefix,
    ingestRequestsTotal,
    ingestDurationSeconds,
    ingestQueueJobs,
    ingestJobsTotal,
    ingestJobDurationSeconds,
    queryRequestsTotal,
    queryDurationSeconds,
    queryRowCount,
    queryRemotePartitions,
    manifestCacheHitsTotal,
    manifestCacheMissesTotal,
    manifestCacheEvictionsTotal,
    lifecycleJobsTotal,
    lifecycleDurationSeconds,
    lifecycleOperationsTotal,
    lifecycleQueueJobs,
    httpRequestsTotal,
    httpRequestDurationSeconds,
    runtimeCacheEventsTotal,
    runtimeCacheRebuildDurationSeconds
  } satisfies MetricsState;

  return metricsState;
}

export function getMetrics(): MetricsState | null {
  return metricsState;
}

export function resetMetrics(): void {
  metricsState = null;
}

export function observeIngestion(input: IngestionMetricsInput): void {
  const state = metricsState;
  if (!state?.enabled || !state.ingestRequestsTotal) {
    return;
  }
  state.ingestRequestsTotal.labels(input.datasetSlug, input.result, input.mode).inc();
  if (input.durationSeconds !== undefined && state.ingestDurationSeconds) {
    state.ingestDurationSeconds.labels(input.datasetSlug, input.mode).observe(Math.max(input.durationSeconds, 0));
  }
}

export function updateIngestionQueueDepth(counts: IngestionQueueCounts): void {
  const state = metricsState;
  if (!state?.enabled || !state.ingestQueueJobs) {
    return;
  }
  setGaugeValues(state.ingestQueueJobs, counts);
}

export function observeIngestionJob(input: IngestionJobMetricsInput): void {
  const state = metricsState;
  if (!state?.enabled || !state.ingestJobsTotal) {
    return;
  }
  state.ingestJobsTotal.labels(input.datasetSlug, input.result).inc();
  if (input.durationSeconds !== undefined && state.ingestJobDurationSeconds) {
    state.ingestJobDurationSeconds.labels(input.datasetSlug).observe(Math.max(input.durationSeconds, 0));
  }
}

export function observeQuery(input: QueryMetricsInput): void {
  const state = metricsState;
  if (!state?.enabled || !state.queryRequestsTotal) {
    return;
  }
  state.queryRequestsTotal.labels(input.datasetSlug, input.mode, input.result).inc();
  if (input.durationSeconds !== undefined && state.queryDurationSeconds) {
    state.queryDurationSeconds.labels(input.datasetSlug, input.mode).observe(Math.max(input.durationSeconds, 0));
  }
  if (input.rowCount !== undefined && state.queryRowCount) {
    state.queryRowCount.labels(input.datasetSlug, input.mode).observe(Math.max(input.rowCount, 0));
  }
  if (state.queryRemotePartitions && input.remotePartitions && input.remotePartitions > 0) {
    const cacheFlag = input.cacheEnabled ? 'true' : 'false';
    state.queryRemotePartitions.labels(input.datasetSlug, cacheFlag).inc(input.remotePartitions);
  }
}

export function recordManifestCacheHit(source: ManifestCacheHitSource): void {
  const state = metricsState;
  if (!state?.enabled || !state.manifestCacheHitsTotal) {
    return;
  }
  state.manifestCacheHitsTotal.labels(source).inc();
}

export function recordManifestCacheMiss(reason: ManifestCacheMissReason): void {
  const state = metricsState;
  if (!state?.enabled || !state.manifestCacheMissesTotal) {
    return;
  }
  state.manifestCacheMissesTotal.labels(reason).inc();
}

export function recordManifestCacheEviction(reason: ManifestCacheEvictionReason): void {
  const state = metricsState;
  if (!state?.enabled || !state.manifestCacheEvictionsTotal) {
    return;
  }
  state.manifestCacheEvictionsTotal.labels(reason).inc();
}

export function observeLifecycleJob(input: LifecycleMetricsInput): void {
  const state = metricsState;
  if (!state?.enabled || !state.lifecycleJobsTotal) {
    return;
  }
  const datasetLabel = input.datasetId ?? 'unknown';
  state.lifecycleJobsTotal.labels(datasetLabel, input.status).inc();
  if (input.durationSeconds !== undefined && state.lifecycleDurationSeconds) {
    state.lifecycleDurationSeconds.labels(input.status).observe(Math.max(input.durationSeconds, 0));
  }
}

export function observeLifecycleOperation(input: LifecycleOperationMetricsInput): void {
  const state = metricsState;
  if (!state?.enabled || !state.lifecycleOperationsTotal) {
    return;
  }
  state.lifecycleOperationsTotal.labels(input.operation, input.status).inc();
}

export function updateLifecycleQueueDepth(counts: LifecycleQueueCounts): void {
  const state = metricsState;
  if (!state?.enabled || !state.lifecycleQueueJobs) {
    return;
  }
  setGaugeValues(state.lifecycleQueueJobs, counts);
}

export function observeHttpRequest(input: HttpMetricInput): void {
  const state = metricsState;
  if (!state?.enabled || !state.httpRequestsTotal) {
    return;
  }
  const route = input.route || 'unknown';
  const method = input.method || 'UNKNOWN';
  const status = String(input.statusCode ?? 0);
  state.httpRequestsTotal.labels(method, route, status).inc();
  if (input.durationSeconds !== undefined && state.httpRequestDurationSeconds) {
    state.httpRequestDurationSeconds.labels(method, route).observe(Math.max(input.durationSeconds, 0));
  }
}

export function recordRuntimeCacheEvent(resource: RuntimeCacheResource, event: RuntimeCacheEvent): void {
  const state = metricsState;
  if (!state?.enabled || !state.runtimeCacheEventsTotal) {
    return;
  }
  state.runtimeCacheEventsTotal.labels(resource, event).inc();
}

export function observeRuntimeCacheRebuild(
  resource: RuntimeCacheResource,
  durationSeconds: number
): void {
  const state = metricsState;
  if (!state?.enabled || !state.runtimeCacheRebuildDurationSeconds) {
    return;
  }
  state.runtimeCacheRebuildDurationSeconds.labels(resource).observe(Math.max(durationSeconds, 0));
}

export function metricsEnabled(): boolean {
  return Boolean(metricsState?.enabled);
}

export function getMetricsRegistry(): Registry | null {
  return metricsState?.registry ?? null;
}

function setGaugeValues(
  gauge: Gauge<string>,
  counts: Partial<Record<QueueState, number>>
): void {
  const knownStates: QueueState[] = ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'];
  for (const state of knownStates) {
    const value = counts[state];
    if (typeof value === 'number' && Number.isFinite(value)) {
      gauge.labels(state).set(value);
    } else {
      gauge.labels(state).set(0);
    }
  }
}

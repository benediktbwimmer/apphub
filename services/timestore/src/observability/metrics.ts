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

export type PartitionBuildQueueCounts = Partial<Record<QueueState, number>>;

export interface PartitionBuildJobMetricsInput {
  datasetSlug: string;
  result: 'success' | 'failure';
  durationSeconds?: number;
  failureReason?: string;
}

export interface PartitionBuildRetryMetricsInput {
  datasetSlug: string;
  retries: number;
}

export interface QueryMetricsInput {
  datasetSlug: string;
  mode: 'raw' | 'downsampled';
  result: 'success' | 'failure';
  executionBackend: string;
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

export interface SchemaMigrationMetricsInput {
  datasetSlug: string;
  result: 'completed' | 'failed';
  durationSeconds?: number;
  partitions?: number;
}

export interface StreamingRecordMetricsInput {
  datasetSlug: string;
  connectorId: string;
  count?: number;
}

export interface StreamingFlushMetricsInput {
  datasetSlug: string;
  connectorId: string;
  rows: number;
  durationSeconds?: number;
  reason: 'max_rows' | 'timer' | 'shutdown' | 'manual';
}

export interface StreamingBacklogMetricsInput {
  datasetSlug: string;
  connectorId: string;
  lagSeconds: number;
  openWindows: number;
}

export type StreamingBatcherState = 'starting' | 'running' | 'stopped' | 'error';

export interface StreamingBatcherMetric {
  datasetSlug: string;
  connectorId: string;
  buffers: number;
  state: StreamingBatcherState;
}

export type StreamingHotBufferDatasetState = 'ready' | 'unavailable' | 'disabled';

export interface StreamingHotBufferDatasetMetric {
  datasetSlug: string;
  rows: number;
  watermarkEpochSeconds: number | null;
  latestEpochSeconds: number | null;
  state: StreamingHotBufferDatasetState;
  stalenessSeconds: number | null;
}

export interface StreamingHotBufferMetricsInput {
  enabled: boolean;
  datasets: StreamingHotBufferDatasetMetric[];
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
export type RuntimeCacheEvent = 'hit' | 'miss' | 'invalidated' | 'expired' | 'refresh';

interface MetricsState {
  enabled: boolean;
  registry: Registry;
  prefix: string;
  ingestRequestsTotal: Counter<string> | null;
  ingestDurationSeconds: Histogram<string> | null;
  ingestQueueJobs: Gauge<string> | null;
  ingestJobsTotal: Counter<string> | null;
  ingestJobDurationSeconds: Histogram<string> | null;
  stagingQueueDepth: Gauge<string> | null;
  stagingOldestAgeSeconds: Gauge<string> | null;
  stagingDiskUsageBytes: Gauge<string> | null;
  stagingFlushDurationSeconds: Histogram<string> | null;
  stagingFlushBatchesTotal: Counter<string> | null;
  stagingFlushRowsTotal: Counter<string> | null;
  stagingDroppedBatchesTotal: Counter<string> | null;
  stagingRetriedBatchesTotal: Counter<string> | null;
  partitionBuildQueueJobs: Gauge<string> | null;
  partitionBuildJobsTotal: Counter<string> | null;
  partitionBuildJobDurationSeconds: Histogram<string> | null;
  partitionBuildJobFailuresTotal: Counter<string> | null;
  partitionBuildJobRetriesTotal: Counter<string> | null;
  queryRequestsTotal: Counter<string> | null;
  queryDurationSeconds: Histogram<string> | null;
  queryRowCount: Histogram<string> | null;
  queryRemotePartitions: Counter<string> | null;
  queryPartitionDecisions: Counter<string> | null;
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
  runtimeDatasetRefreshTotal: Counter<string> | null;
  runtimeDatasetRefreshDurationSeconds: Histogram<string> | null;
  runtimeCacheStalenessSeconds: Gauge<string> | null;
  schemaMigrationRunsTotal: Counter<string> | null;
  schemaMigrationDurationSeconds: Histogram<string> | null;
  schemaMigrationPartitions: Histogram<string> | null;
  streamingRecordsTotal: Counter<string> | null;
  streamingFlushDurationSeconds: Histogram<string> | null;
  streamingFlushRows: Histogram<string> | null;
  streamingBacklogSeconds: Gauge<string> | null;
  streamingOpenWindows: Gauge<string> | null;
  streamingBatcherBuffers: Gauge<string> | null;
  streamingBatcherState: Gauge<string> | null;
  streamingHotBufferRows: Gauge<string> | null;
  streamingHotBufferLatestTimestamp: Gauge<string> | null;
  streamingHotBufferWatermark: Gauge<string> | null;
  streamingHotBufferStalenessSeconds: Gauge<string> | null;
  streamingHotBufferState: Gauge<string> | null;
  streamingHotBufferDatasetsTotal: Gauge<string> | null;
}

const INGESTION_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];
const STAGING_FLUSH_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60];
const QUERY_BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5];
const QUERY_ROWS_BUCKETS = [1, 10, 100, 1_000, 10_000, 100_000];
const LIFECYCLE_BUCKETS = [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];
const HTTP_BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5];
const SCHEMA_MIGRATION_PARTITION_BUCKETS = [1, 5, 10, 25, 50, 100, 250, 500, 1_000];
const STREAMING_FLUSH_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30];
const STREAMING_ROWS_BUCKETS = [1, 10, 50, 100, 250, 500, 1_000, 5_000, 10_000];

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

  const stagingQueueDepth = enabled
    ? new Gauge({
        name: `${prefix}staging_queue_depth`,
        help: 'Pending staging backlog grouped by dataset and metric',
        labelNames: ['dataset', 'metric'],
        registers: registerMetrics
      })
    : null;

  const stagingOldestAgeSeconds = enabled
    ? new Gauge({
        name: `${prefix}staging_oldest_age_seconds`,
        help: 'Age in seconds of the oldest staged batch per dataset',
        labelNames: ['dataset'],
        registers: registerMetrics
      })
    : null;

  const stagingDiskUsageBytes = enabled
    ? new Gauge({
        name: `${prefix}staging_disk_usage_bytes`,
        help: 'Bytes consumed by staging DuckDB files grouped by dataset and component',
        labelNames: ['dataset', 'component'],
        registers: registerMetrics
      })
    : null;

  const stagingFlushDurationSeconds = enabled
    ? new Histogram({
        name: `${prefix}staging_flush_duration_seconds`,
        help: 'Duration of staging flushes grouped by dataset and result',
        labelNames: ['dataset', 'result'],
        buckets: STAGING_FLUSH_BUCKETS,
        registers: registerMetrics
      })
    : null;

  const stagingFlushBatchesTotal = enabled
    ? new Counter({
        name: `${prefix}staging_flush_batches_total`,
        help: 'Batches drained from staging flushes grouped by dataset and result',
        labelNames: ['dataset', 'result'],
        registers: registerMetrics
      })
    : null;

  const stagingFlushRowsTotal = enabled
    ? new Counter({
        name: `${prefix}staging_flush_rows_total`,
        help: 'Rows drained from staging flushes grouped by dataset and result',
        labelNames: ['dataset', 'result'],
        registers: registerMetrics
      })
    : null;

  const stagingDroppedBatchesTotal = enabled
    ? new Counter({
        name: `${prefix}staging_dropped_batches_total`,
        help: 'Batches dropped from staging grouped by dataset and reason',
        labelNames: ['dataset', 'reason'],
        registers: registerMetrics
      })
    : null;

  const stagingRetriedBatchesTotal = enabled
    ? new Counter({
        name: `${prefix}staging_retried_batches_total`,
        help: 'Batches returned to staging for retry grouped by dataset and reason',
        labelNames: ['dataset', 'reason'],
        registers: registerMetrics
      })
    : null;

  const partitionBuildQueueJobs = enabled
    ? new Gauge({
        name: `${prefix}partition_build_queue_jobs`,
        help: 'Current partition build queue depth by state',
        labelNames: ['state'],
        registers: registerMetrics
      })
    : null;

  const partitionBuildJobsTotal = enabled
    ? new Counter({
        name: `${prefix}partition_build_jobs_total`,
        help: 'Partition build job outcomes grouped by dataset and result',
        labelNames: ['dataset', 'result'],
        registers: registerMetrics
      })
    : null;

  const partitionBuildJobDurationSeconds = enabled
    ? new Histogram({
        name: `${prefix}partition_build_job_duration_seconds`,
        help: 'Duration of partition build jobs in seconds',
        labelNames: ['dataset'],
        buckets: INGESTION_BUCKETS,
        registers: registerMetrics
      })
    : null;

  const partitionBuildJobFailuresTotal = enabled
    ? new Counter({
        name: `${prefix}partition_build_job_failures_total`,
        help: 'Partition build job failures grouped by dataset and reason',
        labelNames: ['dataset', 'reason'],
        registers: registerMetrics
      })
    : null;

  const partitionBuildJobRetriesTotal = enabled
    ? new Counter({
        name: `${prefix}partition_build_job_retries_total`,
        help: 'Partition build job retry attempts grouped by dataset',
        labelNames: ['dataset'],
        registers: registerMetrics
      })
    : null;

  const queryRequestsTotal = enabled
    ? new Counter({
        name: `${prefix}query_requests_total`,
        help: 'Total query requests grouped by dataset, backend, mode, and result',
        labelNames: ['dataset', 'backend', 'mode', 'result'],
        registers: registerMetrics
      })
    : null;

  const queryDurationSeconds = enabled
    ? new Histogram({
        name: `${prefix}query_duration_seconds`,
        help: 'Duration of query execution in seconds',
        labelNames: ['dataset', 'backend', 'mode'],
        buckets: QUERY_BUCKETS,
        registers: registerMetrics
      })
    : null;

  const queryRowCount = enabled
    ? new Histogram({
        name: `${prefix}query_row_count`,
        help: 'Result row counts for queries',
        labelNames: ['dataset', 'backend', 'mode'],
        buckets: QUERY_ROWS_BUCKETS,
        registers: registerMetrics
      })
    : null;

  const queryRemotePartitions = enabled
    ? new Counter({
        name: `${prefix}query_remote_partitions_total`,
        help: 'Remote partition access counts grouped by dataset, backend, and cache configuration',
        labelNames: ['dataset', 'backend', 'cache_enabled'],
        registers: registerMetrics
      })
    : null;

  const queryPartitionDecisions = enabled
    ? new Counter({
        name: `${prefix}query_partitions_total`,
        help: 'Query partition evaluation results grouped by dataset and decision',
        labelNames: ['dataset', 'decision'],
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

  const runtimeDatasetRefreshTotal = enabled
    ? new Counter({
        name: `${prefix}sql_runtime_dataset_refresh_total`,
        help: 'SQL runtime dataset refresh outcomes grouped by dataset, reason, and result',
        labelNames: ['dataset', 'reason', 'result'],
        registers: registerMetrics
      })
    : null;

  const runtimeDatasetRefreshDurationSeconds = enabled
    ? new Histogram({
        name: `${prefix}sql_runtime_dataset_refresh_duration_seconds`,
        help: 'SQL runtime dataset refresh durations grouped by dataset and reason',
        labelNames: ['dataset', 'reason'],
        buckets: QUERY_BUCKETS,
        registers: registerMetrics
      })
    : null;

  const runtimeCacheStalenessSeconds = enabled
    ? new Gauge({
        name: `${prefix}sql_runtime_cache_staleness_seconds`,
        help: 'SQL runtime cache staleness in seconds grouped by resource',
        labelNames: ['resource'],
        registers: registerMetrics
      })
    : null;

  const schemaMigrationRunsTotal = enabled
    ? new Counter({
        name: `${prefix}schema_migration_runs_total`,
        help: 'Schema migration execution outcomes grouped by dataset and result',
        labelNames: ['dataset', 'result'],
        registers: registerMetrics
      })
    : null;

  const schemaMigrationDurationSeconds = enabled
    ? new Histogram({
        name: `${prefix}schema_migration_duration_seconds`,
        help: 'Schema migration execution durations grouped by dataset',
        labelNames: ['dataset'],
        buckets: LIFECYCLE_BUCKETS,
        registers: registerMetrics
      })
    : null;

  const schemaMigrationPartitions = enabled
    ? new Histogram({
        name: `${prefix}schema_migration_partitions`,
        help: 'Schema migration partition counts grouped by dataset',
        labelNames: ['dataset'],
        buckets: SCHEMA_MIGRATION_PARTITION_BUCKETS,
        registers: registerMetrics
      })
    : null;

  const streamingRecordsTotal = enabled
    ? new Counter({
        name: `${prefix}streaming_records_total`,
        help: 'Streaming records processed grouped by dataset and connector',
        labelNames: ['dataset', 'connector'],
        registers: registerMetrics
      })
    : null;

  const streamingFlushDurationSeconds = enabled
    ? new Histogram({
        name: `${prefix}streaming_flush_duration_seconds`,
        help: 'Streaming micro-batcher flush durations grouped by dataset, connector, and reason',
        labelNames: ['dataset', 'connector', 'reason'],
        buckets: STREAMING_FLUSH_BUCKETS,
        registers: registerMetrics
      })
    : null;

  const streamingFlushRows = enabled
    ? new Histogram({
        name: `${prefix}streaming_flush_rows`,
        help: 'Rows emitted per streaming micro-batcher flush grouped by dataset and connector',
        labelNames: ['dataset', 'connector'],
        buckets: STREAMING_ROWS_BUCKETS,
        registers: registerMetrics
      })
    : null;

  const streamingBacklogSeconds = enabled
    ? new Gauge({
        name: `${prefix}streaming_backlog_seconds`,
        help: 'Lag between current time and the latest sealed streaming window',
        labelNames: ['dataset', 'connector'],
        registers: registerMetrics
      })
    : null;

  const streamingOpenWindows = enabled
    ? new Gauge({
        name: `${prefix}streaming_open_windows`,
        help: 'Open streaming windows awaiting flush grouped by dataset and connector',
        labelNames: ['dataset', 'connector'],
        registers: registerMetrics
      })
    : null;

  const streamingBatcherBuffers = enabled
    ? new Gauge({
        name: `${prefix}streaming_batcher_buffers`,
        help: 'Active window buffers currently managed by the streaming micro-batcher',
        labelNames: ['dataset', 'connector'],
        registers: registerMetrics
      })
    : null;

  const streamingBatcherState = enabled
    ? new Gauge({
        name: `${prefix}streaming_batcher_state`,
        help: 'State of streaming micro-batcher connectors (1 = active state)',
        labelNames: ['dataset', 'connector', 'state'],
        registers: registerMetrics
      })
    : null;

  const streamingHotBufferRows = enabled
    ? new Gauge({
        name: `${prefix}streaming_hot_buffer_rows`,
        help: 'Rows retained inside the streaming hot buffer per dataset',
        labelNames: ['dataset'],
        registers: registerMetrics
      })
    : null;

  const streamingHotBufferLatestTimestamp = enabled
    ? new Gauge({
        name: `${prefix}streaming_hot_buffer_latest_timestamp`,
        help: 'Latest streaming event timestamp observed by the hot buffer (epoch seconds)',
        labelNames: ['dataset'],
        registers: registerMetrics
      })
    : null;

  const streamingHotBufferWatermark = enabled
    ? new Gauge({
        name: `${prefix}streaming_hot_buffer_watermark`,
        help: 'Sealed watermark timestamp propagated to the hot buffer (epoch seconds)',
        labelNames: ['dataset'],
        registers: registerMetrics
      })
    : null;

  const streamingHotBufferStalenessSeconds = enabled
    ? new Gauge({
        name: `${prefix}streaming_hot_buffer_staleness_seconds`,
        help: 'Age of the newest streaming event retained in the hot buffer',
        labelNames: ['dataset'],
        registers: registerMetrics
      })
    : null;

  const streamingHotBufferState = enabled
    ? new Gauge({
        name: `${prefix}streaming_hot_buffer_state`,
        help: 'Hot buffer readiness (1 = dataset is currently in the labelled state)',
        labelNames: ['dataset', 'state'],
        registers: registerMetrics
      })
    : null;

  const streamingHotBufferDatasetsTotal = enabled
    ? new Gauge({
        name: `${prefix}streaming_hot_buffer_datasets`,
        help: 'Total datasets tracked by the hot buffer',
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
    stagingQueueDepth,
    stagingOldestAgeSeconds,
    stagingDiskUsageBytes,
    stagingFlushDurationSeconds,
    stagingFlushBatchesTotal,
    stagingFlushRowsTotal,
    stagingDroppedBatchesTotal,
    stagingRetriedBatchesTotal,
    partitionBuildQueueJobs,
    partitionBuildJobsTotal,
    partitionBuildJobDurationSeconds,
    partitionBuildJobFailuresTotal,
    partitionBuildJobRetriesTotal,
    queryRequestsTotal,
    queryDurationSeconds,
    queryRowCount,
    queryRemotePartitions,
    queryPartitionDecisions,
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
    runtimeCacheRebuildDurationSeconds,
    runtimeDatasetRefreshTotal,
    runtimeDatasetRefreshDurationSeconds,
    runtimeCacheStalenessSeconds,
    schemaMigrationRunsTotal,
    schemaMigrationDurationSeconds,
    schemaMigrationPartitions,
    streamingRecordsTotal,
    streamingFlushDurationSeconds,
    streamingFlushRows,
    streamingBacklogSeconds,
    streamingOpenWindows,
    streamingBatcherBuffers,
    streamingBatcherState,
    streamingHotBufferRows,
    streamingHotBufferLatestTimestamp,
    streamingHotBufferWatermark,
    streamingHotBufferStalenessSeconds,
    streamingHotBufferState,
    streamingHotBufferDatasetsTotal
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

export interface StagingSummaryMetricsInput {
  datasetSlug: string;
  pendingBatchCount: number;
  pendingRowCount: number;
  oldestStagedAt?: string | null;
  databaseSizeBytes: number;
  walSizeBytes: number;
  onDiskBytes: number;
}

export function setStagingSummaryMetrics(input: StagingSummaryMetricsInput): void {
  const state = metricsState;
  if (!state?.enabled) {
    return;
  }

  const dataset = input.datasetSlug;
  const batches = Math.max(0, input.pendingBatchCount);
  const rows = Math.max(0, input.pendingRowCount);

  if (state.stagingQueueDepth) {
    state.stagingQueueDepth.labels(dataset, 'batches').set(batches);
    state.stagingQueueDepth.labels(dataset, 'rows').set(rows);
  }

  if (state.stagingOldestAgeSeconds) {
    let ageSeconds = 0;
    if (input.oldestStagedAt) {
      const oldestTimestamp = new Date(input.oldestStagedAt).getTime();
      if (Number.isFinite(oldestTimestamp)) {
        ageSeconds = (Date.now() - oldestTimestamp) / 1_000;
        if (!Number.isFinite(ageSeconds) || ageSeconds < 0) {
          ageSeconds = 0;
        }
      }
    }
    state.stagingOldestAgeSeconds.labels(dataset).set(ageSeconds);
  }

  if (state.stagingDiskUsageBytes) {
    state.stagingDiskUsageBytes.labels(dataset, 'database').set(sanitizeMetricValue(input.databaseSizeBytes));
    state.stagingDiskUsageBytes.labels(dataset, 'wal').set(sanitizeMetricValue(input.walSizeBytes));
    state.stagingDiskUsageBytes.labels(dataset, 'total').set(sanitizeMetricValue(input.onDiskBytes));
  }
}

export type StagingFlushResult = 'success' | 'failure';

export interface StagingFlushMetricsInput {
  datasetSlug: string;
  result: StagingFlushResult;
  durationSeconds: number;
  batches: number;
  rows: number;
}

export function observeStagingFlush(input: StagingFlushMetricsInput): void {
  const state = metricsState;
  if (!state?.enabled) {
    return;
  }

  const dataset = input.datasetSlug;
  const result: StagingFlushResult = input.result === 'failure' ? 'failure' : 'success';
  const duration = sanitizeMetricValue(input.durationSeconds);
  const batches = Math.max(0, Math.floor(Number.isFinite(input.batches) ? input.batches : 0));
  const rows = Math.max(0, Math.floor(Number.isFinite(input.rows) ? input.rows : 0));

  if (state.stagingFlushDurationSeconds) {
    state.stagingFlushDurationSeconds.labels(dataset, result).observe(duration);
  }
  if (state.stagingFlushBatchesTotal) {
    state.stagingFlushBatchesTotal.labels(dataset, result).inc(batches);
  }
  if (state.stagingFlushRowsTotal) {
    state.stagingFlushRowsTotal.labels(dataset, result).inc(rows);
  }
}

export type StagingDropReason = 'queue_full' | 'size_limit' | 'flush_abort' | 'unknown';

export interface StagingDropMetricInput {
  datasetSlug: string;
  reason: StagingDropReason;
}

export function recordStagingDrop(input: StagingDropMetricInput): void {
  const state = metricsState;
  if (!state?.enabled || !state.stagingDroppedBatchesTotal) {
    return;
  }
  const reason = normalizeReason(input.reason);
  state.stagingDroppedBatchesTotal.labels(input.datasetSlug, reason).inc();
}

export interface StagingRetryMetricInput {
  datasetSlug: string;
  reason?: 'flush_abort' | 'manual';
  batches?: number;
}

export function recordStagingRetry(input: StagingRetryMetricInput): void {
  const state = metricsState;
  if (!state?.enabled || !state.stagingRetriedBatchesTotal) {
    return;
  }
  const reason = normalizeReason(input.reason ?? 'flush_abort');
  const batches = Math.max(1, Math.floor(Number.isFinite(input.batches ?? NaN) ? (input.batches ?? 1) : 1));
  state.stagingRetriedBatchesTotal.labels(input.datasetSlug, reason).inc(batches);
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

export function updatePartitionBuildQueueDepth(counts: PartitionBuildQueueCounts): void {
  const state = metricsState;
  if (!state?.enabled || !state.partitionBuildQueueJobs) {
    return;
  }
  setGaugeValues(state.partitionBuildQueueJobs, counts);
}

export function observePartitionBuildJob(input: PartitionBuildJobMetricsInput): void {
  const state = metricsState;
  if (!state?.enabled || !state.partitionBuildJobsTotal) {
    return;
  }
  state.partitionBuildJobsTotal.labels(input.datasetSlug, input.result).inc();
  if (input.durationSeconds !== undefined && state.partitionBuildJobDurationSeconds) {
    state.partitionBuildJobDurationSeconds.labels(input.datasetSlug).observe(Math.max(input.durationSeconds, 0));
  }
  if (input.result === 'failure' && state.partitionBuildJobFailuresTotal) {
    const reason = input.failureReason && input.failureReason.trim().length > 0
      ? input.failureReason.trim().slice(0, 120)
      : 'unknown';
    state.partitionBuildJobFailuresTotal.labels(input.datasetSlug, reason).inc();
  }
}

export function recordPartitionBuildRetries(input: PartitionBuildRetryMetricsInput): void {
  if (input.retries <= 0) {
    return;
  }
  const state = metricsState;
  if (!state?.enabled || !state.partitionBuildJobRetriesTotal) {
    return;
  }
  state.partitionBuildJobRetriesTotal.labels(input.datasetSlug).inc(input.retries);
}

export function observeQuery(input: QueryMetricsInput): void {
  const state = metricsState;
  if (!state?.enabled || !state.queryRequestsTotal) {
    return;
  }
  const backend = input.executionBackend && input.executionBackend.trim().length > 0
    ? input.executionBackend.trim()
    : 'unknown';
  state.queryRequestsTotal.labels(input.datasetSlug, backend, input.mode, input.result).inc();
  if (input.durationSeconds !== undefined && state.queryDurationSeconds) {
    state.queryDurationSeconds.labels(input.datasetSlug, backend, input.mode).observe(Math.max(input.durationSeconds, 0));
  }
  if (input.rowCount !== undefined && state.queryRowCount) {
    state.queryRowCount.labels(input.datasetSlug, backend, input.mode).observe(Math.max(input.rowCount, 0));
  }
  if (state.queryRemotePartitions && input.remotePartitions && input.remotePartitions > 0) {
    const cacheFlag = input.cacheEnabled ? 'true' : 'false';
    state.queryRemotePartitions.labels(input.datasetSlug, backend, cacheFlag).inc(input.remotePartitions);
  }
}

export function recordQueryPartitionSelection(
  datasetSlug: string,
  scanned: number,
  pruned: number
): void {
  const state = metricsState;
  if (!state?.enabled || !state.queryPartitionDecisions) {
    return;
  }
  if (scanned > 0) {
    state.queryPartitionDecisions.labels(datasetSlug, 'scanned').inc(scanned);
  }
  if (pruned > 0) {
    state.queryPartitionDecisions.labels(datasetSlug, 'pruned').inc(pruned);
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

export function recordRuntimeDatasetRefresh(
  dataset: string,
  reason: string | null,
  result: 'success' | 'failure'
): void {
  const state = metricsState;
  if (!state?.enabled || !state.runtimeDatasetRefreshTotal) {
    return;
  }
  const reasonLabel = reason && reason.length > 0 ? reason : 'unspecified';
  state.runtimeDatasetRefreshTotal.labels(dataset, reasonLabel, result).inc();
}

export function observeRuntimeDatasetRefreshDuration(
  dataset: string,
  reason: string | null,
  durationSeconds: number
): void {
  const state = metricsState;
  if (!state?.enabled || !state.runtimeDatasetRefreshDurationSeconds) {
    return;
  }
  const reasonLabel = reason && reason.length > 0 ? reason : 'unspecified';
  state.runtimeDatasetRefreshDurationSeconds.labels(dataset, reasonLabel).observe(Math.max(durationSeconds, 0));
}

export function setRuntimeCacheStaleness(
  resource: RuntimeCacheResource,
  stalenessSeconds: number
): void {
  const state = metricsState;
  if (!state?.enabled || !state.runtimeCacheStalenessSeconds) {
    return;
  }
  state.runtimeCacheStalenessSeconds.labels(resource).set(Math.max(stalenessSeconds, 0));
}

export function observeSchemaMigration(input: SchemaMigrationMetricsInput): void {
  const state = metricsState;
  if (!state?.enabled || !state.schemaMigrationRunsTotal) {
    return;
  }
  state.schemaMigrationRunsTotal.labels(input.datasetSlug, input.result).inc();
  if (typeof input.durationSeconds === 'number' && state.schemaMigrationDurationSeconds) {
    state.schemaMigrationDurationSeconds.labels(input.datasetSlug).observe(Math.max(input.durationSeconds, 0));
  }
  if (typeof input.partitions === 'number' && state.schemaMigrationPartitions) {
    state.schemaMigrationPartitions.labels(input.datasetSlug).observe(Math.max(input.partitions, 0));
  }
}

export function observeStreamingRecords(input: StreamingRecordMetricsInput): void {
  const state = metricsState;
  if (!state?.enabled || !state.streamingRecordsTotal) {
    return;
  }
  const count = typeof input.count === 'number' ? input.count : 1;
  if (count <= 0) {
    return;
  }
  state.streamingRecordsTotal.labels(input.datasetSlug, input.connectorId).inc(count);
}

export function observeStreamingFlush(input: StreamingFlushMetricsInput): void {
  const state = metricsState;
  if (!state?.enabled) {
    return;
  }
  if (state.streamingFlushRows) {
    state.streamingFlushRows.labels(input.datasetSlug, input.connectorId).observe(Math.max(input.rows, 0));
  }
  if (typeof input.durationSeconds === 'number' && state.streamingFlushDurationSeconds) {
    state.streamingFlushDurationSeconds
      .labels(input.datasetSlug, input.connectorId, input.reason)
      .observe(Math.max(input.durationSeconds, 0));
  }
}

export function updateStreamingBacklog(input: StreamingBacklogMetricsInput): void {
  const state = metricsState;
  if (!state?.enabled) {
    return;
  }
  const lagSeconds = Math.max(input.lagSeconds, 0);
  const openWindows = Math.max(input.openWindows, 0);
  if (state.streamingBacklogSeconds) {
    state.streamingBacklogSeconds.labels(input.datasetSlug, input.connectorId).set(lagSeconds);
  }
  if (state.streamingOpenWindows) {
    state.streamingOpenWindows.labels(input.datasetSlug, input.connectorId).set(openWindows);
  }
}

const BATCHER_STATES: StreamingBatcherState[] = ['starting', 'running', 'stopped', 'error'];

export function setStreamingBatcherMetrics(metrics: StreamingBatcherMetric[]): void {
  const state = metricsState;
  if (!state?.enabled) {
    return;
  }

  if (state.streamingBatcherBuffers) {
    state.streamingBatcherBuffers.reset();
  }
  if (state.streamingBatcherState) {
    state.streamingBatcherState.reset();
  }

  for (const metric of metrics) {
    const dataset = metric.datasetSlug;
    const connector = metric.connectorId;
    if (state.streamingBatcherBuffers) {
      state.streamingBatcherBuffers.labels(dataset, connector).set(Math.max(metric.buffers, 0));
    }
    if (state.streamingBatcherState) {
      for (const candidate of BATCHER_STATES) {
        const value = metric.state === candidate ? 1 : 0;
        state.streamingBatcherState.labels(dataset, connector, candidate).set(value);
      }
    }
  }
}

const HOT_BUFFER_STATES: StreamingHotBufferDatasetState[] = ['ready', 'unavailable', 'disabled'];

export function setStreamingHotBufferMetrics(snapshot: StreamingHotBufferMetricsInput): void {
  const state = metricsState;
  if (!state?.enabled) {
    return;
  }

  if (state.streamingHotBufferRows) {
    state.streamingHotBufferRows.reset();
  }
  if (state.streamingHotBufferLatestTimestamp) {
    state.streamingHotBufferLatestTimestamp.reset();
  }
  if (state.streamingHotBufferWatermark) {
    state.streamingHotBufferWatermark.reset();
  }
  if (state.streamingHotBufferStalenessSeconds) {
    state.streamingHotBufferStalenessSeconds.reset();
  }
  if (state.streamingHotBufferState) {
    state.streamingHotBufferState.reset();
  }

  if (state.streamingHotBufferDatasetsTotal) {
    const datasetCount = snapshot.enabled ? snapshot.datasets.length : 0;
    state.streamingHotBufferDatasetsTotal.set(datasetCount);
  }

  if (!snapshot.enabled) {
    return;
  }

  for (const metric of snapshot.datasets) {
    const dataset = metric.datasetSlug;
    if (state.streamingHotBufferRows) {
      state.streamingHotBufferRows.labels(dataset).set(Math.max(metric.rows, 0));
    }
    if (state.streamingHotBufferLatestTimestamp) {
      const latestSeconds = metric.latestEpochSeconds ?? 0;
      state.streamingHotBufferLatestTimestamp.labels(dataset).set(Math.max(latestSeconds, 0));
    }
    if (state.streamingHotBufferWatermark) {
      const watermarkSeconds = metric.watermarkEpochSeconds ?? 0;
      state.streamingHotBufferWatermark.labels(dataset).set(Math.max(watermarkSeconds, 0));
    }
    if (state.streamingHotBufferStalenessSeconds) {
      const staleness = metric.stalenessSeconds ?? 0;
      state.streamingHotBufferStalenessSeconds.labels(dataset).set(Math.max(staleness, 0));
    }
    if (state.streamingHotBufferState) {
      for (const candidate of HOT_BUFFER_STATES) {
        const value = metric.state === candidate ? 1 : 0;
        state.streamingHotBufferState.labels(dataset, candidate).set(value);
      }
    }
  }
}

export function metricsEnabled(): boolean {
  return Boolean(metricsState?.enabled);
}

export function getMetricsRegistry(): Registry | null {
  return metricsState?.registry ?? null;
}

function sanitizeMetricValue(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function normalizeReason(reason: string): string {
  if (!reason) {
    return 'unknown';
  }
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 64) : 'unknown';
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

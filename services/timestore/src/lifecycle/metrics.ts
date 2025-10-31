import type { LifecycleOperation } from './types';

interface OperationTotals {
  count: number;
  bytes: number;
  partitions: number;
}

interface CompactionChunkSample {
  chunkId: string;
  bytes: number;
  partitions: number;
  durationMs: number;
  attempts: number;
  completedAt: string;
}

interface CompactionChunkMetricInput {
  chunkId: string;
  bytes: number;
  partitions: number;
  durationMs: number;
  attempts: number;
}

export interface LifecycleMetricsSnapshot {
  jobsStarted: number;
  jobsCompleted: number;
  jobsFailed: number;
  jobsSkipped: number;
  lastRunAt: string | null;
  lastErrorAt: string | null;
  operationTotals: Record<LifecycleOperation, OperationTotals>;
  compactionChunks: CompactionChunkSample[];
}

const defaultOperationTotals = (): OperationTotals => ({ count: 0, bytes: 0, partitions: 0 });

const metricsState = {
  jobsStarted: 0,
  jobsCompleted: 0,
  jobsFailed: 0,
  jobsSkipped: 0,
  lastRunAt: null as string | null,
  lastErrorAt: null as string | null,
  operationTotals: {
    compaction: defaultOperationTotals(),
    retention: defaultOperationTotals(),
    postgres_migration: defaultOperationTotals()
  } satisfies Record<LifecycleOperation, OperationTotals>,
  compactionChunks: [] as CompactionChunkSample[]
};

export function recordJobStarted(): void {
  metricsState.jobsStarted += 1;
}

export function recordJobCompleted(): void {
  metricsState.jobsCompleted += 1;
  metricsState.lastRunAt = new Date().toISOString();
}

export function recordJobFailed(): void {
  metricsState.jobsFailed += 1;
  metricsState.lastErrorAt = new Date().toISOString();
}

export function recordJobSkipped(): void {
  metricsState.jobsSkipped += 1;
}

export function recordOperationTotals(
  operation: LifecycleOperation,
  { partitions, bytes }: { partitions: number; bytes: number }
): void {
  const totals = metricsState.operationTotals[operation];
  totals.count += 1;
  totals.partitions += partitions;
  totals.bytes += bytes;
}

export function recordCompactionChunk(metric: CompactionChunkMetricInput): void {
  metricsState.compactionChunks.push({
    chunkId: metric.chunkId,
    bytes: metric.bytes,
    partitions: metric.partitions,
    durationMs: metric.durationMs,
    attempts: metric.attempts,
    completedAt: new Date().toISOString()
  });
  if (metricsState.compactionChunks.length > 200) {
    metricsState.compactionChunks.splice(0, metricsState.compactionChunks.length - 200);
  }
}

export function captureLifecycleMetrics(): LifecycleMetricsSnapshot {
  return {
    jobsStarted: metricsState.jobsStarted,
    jobsCompleted: metricsState.jobsCompleted,
    jobsFailed: metricsState.jobsFailed,
    jobsSkipped: metricsState.jobsSkipped,
    lastRunAt: metricsState.lastRunAt,
    lastErrorAt: metricsState.lastErrorAt,
    operationTotals: {
      compaction: { ...metricsState.operationTotals.compaction },
      retention: { ...metricsState.operationTotals.retention },
      postgres_migration: { ...metricsState.operationTotals.postgres_migration }
    },
    compactionChunks: [...metricsState.compactionChunks]
  };
}

export function resetLifecycleMetrics(): void {
  metricsState.jobsStarted = 0;
  metricsState.jobsCompleted = 0;
  metricsState.jobsFailed = 0;
  metricsState.jobsSkipped = 0;
  metricsState.lastRunAt = null;
  metricsState.lastErrorAt = null;
  metricsState.operationTotals.compaction = defaultOperationTotals();
  metricsState.operationTotals.retention = defaultOperationTotals();
  metricsState.operationTotals.postgres_migration = defaultOperationTotals();
  metricsState.compactionChunks = [];
}

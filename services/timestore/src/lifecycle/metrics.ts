import type { LifecycleOperation } from './types';

interface OperationTotals {
  count: number;
  bytes: number;
  partitions: number;
}

export interface LifecycleMetricsSnapshot {
  jobsStarted: number;
  jobsCompleted: number;
  jobsFailed: number;
  jobsSkipped: number;
  lastRunAt: string | null;
  lastErrorAt: string | null;
  operationTotals: Record<LifecycleOperation, OperationTotals>;
  exportLatencyMs: number[];
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
    parquetExport: defaultOperationTotals()
  } satisfies Record<LifecycleOperation, OperationTotals>,
  exportLatencyMs: [] as number[]
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

export function recordExportLatency(durationMs: number): void {
  metricsState.exportLatencyMs.push(durationMs);
  if (metricsState.exportLatencyMs.length > 200) {
    metricsState.exportLatencyMs.splice(0, metricsState.exportLatencyMs.length - 200);
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
      parquetExport: { ...metricsState.operationTotals.parquetExport }
    },
    exportLatencyMs: [...metricsState.exportLatencyMs]
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
  metricsState.operationTotals.parquetExport = defaultOperationTotals();
  metricsState.exportLatencyMs = [];
}

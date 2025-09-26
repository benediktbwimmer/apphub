import { Counter, Gauge, Histogram, type Registry } from 'prom-client';
import type { ReconciliationReason } from './types';

type QueueState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused';
type JobOutcome = 'success' | 'failure' | 'skipped';

export interface ReconciliationMetrics {
  readonly enabled: boolean;
  recordQueueDepth(counts: Partial<Record<QueueState, number>>): void;
  recordJobResult(outcome: JobOutcome, reason: ReconciliationReason): void;
  observeDuration(outcome: JobOutcome, reason: ReconciliationReason, seconds: number): void;
}

export interface ReconciliationMetricsOptions {
  enabled: boolean;
  registry?: Registry | null;
  prefix?: string;
}

const DEFAULT_PREFIX = 'filestore_';
const DURATION_BUCKETS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];

export function createReconciliationMetrics(options: ReconciliationMetricsOptions): ReconciliationMetrics {
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const registers = options.enabled && options.registry ? [options.registry] : undefined;

  const queueDepth = options.enabled
    ? new Gauge({
        name: `${prefix}reconciliation_queue_depth`,
        help: 'Reconciliation queue depth grouped by BullMQ state',
        labelNames: ['state'],
        registers
      })
    : null;

  const jobResults = options.enabled
    ? new Counter({
        name: `${prefix}reconciliation_jobs_total`,
        help: 'Reconciliation job outcomes grouped by result and reason',
        labelNames: ['outcome', 'reason'],
        registers
      })
    : null;

  const jobDuration = options.enabled
    ? new Histogram({
        name: `${prefix}reconciliation_job_duration_seconds`,
        help: 'Reconciliation job duration in seconds grouped by outcome and reason',
        labelNames: ['outcome', 'reason'],
        buckets: DURATION_BUCKETS,
        registers
      })
    : null;

  return {
    enabled: options.enabled,
    recordQueueDepth(counts) {
      if (!queueDepth) {
        return;
      }
      const states: QueueState[] = ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'];
      for (const state of states) {
        const value = counts[state] ?? 0;
        queueDepth.labels(state).set(value);
      }
    },
    recordJobResult(outcome, reason) {
      jobResults?.labels(outcome, reason).inc();
    },
    observeDuration(outcome, reason, seconds) {
      jobDuration?.labels(outcome, reason).observe(seconds);
    }
  };
}

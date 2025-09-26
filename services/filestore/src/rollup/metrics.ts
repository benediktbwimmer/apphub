import { Counter, Gauge, Histogram, type Registry } from 'prom-client';
import type { RollupState } from '../db/rollups';

type CacheSource = 'local' | 'redis' | 'db';
type CacheMissSource = 'local' | 'redis';
type QueueState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused';
type RecalcReason = 'mutation' | 'manual' | 'pending-refresh';

export interface RollupMetrics {
  readonly enabled: boolean;
  recordCacheHit(source: CacheSource): void;
  recordCacheMiss(source: CacheMissSource): void;
  observeFreshness(state: RollupState, lastCalculatedAt: Date | null): void;
  updateQueueDepth(counts: Partial<Record<QueueState, number>>): void;
  recordRecalculation(reason: RecalcReason): void;
}

export interface RollupMetricsOptions {
  enabled: boolean;
  registry?: Registry | null;
  prefix?: string;
}

const DEFAULT_PREFIX = 'filestore_';
const FRESHNESS_BUCKETS = [5, 30, 60, 120, 300, 600, 1800, 3600, 21_600, 86_400];

export function createRollupMetrics(options: RollupMetricsOptions): RollupMetrics {
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const registers = options.enabled && options.registry ? [options.registry] : undefined;

  const cacheHits = options.enabled
    ? new Counter({
        name: `${prefix}rollup_cache_hits_total`,
        help: 'Rollup cache hits grouped by source',
        labelNames: ['source'],
        registers
      })
    : null;

  const cacheMisses = options.enabled
    ? new Counter({
        name: `${prefix}rollup_cache_misses_total`,
        help: 'Rollup cache misses grouped by tier',
        labelNames: ['source'],
        registers
      })
    : null;

  const queueDepth = options.enabled
    ? new Gauge({
        name: `${prefix}rollup_queue_depth`,
        help: 'Rollup queue depth grouped by BullMQ state',
        labelNames: ['state'],
        registers
      })
    : null;

  const freshness = options.enabled
    ? new Histogram({
        name: `${prefix}rollup_freshness_seconds`,
        help: 'Observed age of rollup summaries (seconds)',
        labelNames: ['state'],
        buckets: FRESHNESS_BUCKETS,
        registers
      })
    : null;

  const recalculations = options.enabled
    ? new Counter({
        name: `${prefix}rollup_recalculations_total`,
        help: 'Rollup recalculation executions grouped by reason',
        labelNames: ['reason'],
        registers
      })
    : null;

  return {
    enabled: options.enabled,
    recordCacheHit(source: CacheSource) {
      cacheHits?.labels(source).inc();
    },
    recordCacheMiss(source: CacheMissSource) {
      cacheMisses?.labels(source).inc();
    },
    observeFreshness(state: RollupState, lastCalculatedAt: Date | null) {
      if (!freshness) {
        return;
      }
      if (!lastCalculatedAt) {
        return;
      }
      const ageSeconds = (Date.now() - lastCalculatedAt.getTime()) / 1000;
      const safeAge = Number.isFinite(ageSeconds) && ageSeconds >= 0 ? ageSeconds : 0;
      freshness.labels(state).observe(safeAge);
    },
    updateQueueDepth(counts: Partial<Record<QueueState, number>>) {
      if (!queueDepth) {
        return;
      }
      const states: QueueState[] = ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'];
      for (const state of states) {
        const value = counts[state] ?? 0;
        queueDepth.labels(state).set(value);
      }
    },
    recordRecalculation(reason: RecalcReason) {
      recalculations?.labels(reason).inc();
    }
  };
}

import type { PoolClient } from 'pg';
import type { Registry } from 'prom-client';
import { loadServiceConfig, type ServiceConfig } from '../config/serviceConfig';
import { withConnection, withTransaction } from '../db/client';
import { getNodeById, type NodeRecord } from '../db/nodes';
import {
  applyRollupDelta,
  ensureRollup,
  getRollup,
  recalculateRollup,
  setRollupState,
  type RollupRecord
} from '../db/rollups';
import { createRollupCache, type RollupCache } from './cache';
import { createRollupMetrics, type RollupMetrics } from './metrics';
import { RollupQueue, type RollupJobPayload } from './queue';
import {
  createEmptyRollupPlan,
  rollupRecordToSummary,
  type AppliedRollupPlan,
  type RollupPlan,
  type RollupSummary
} from './types';

type InitializeOptions = {
  config?: ServiceConfig;
  registry?: Registry | null;
  metricsEnabled?: boolean;
};

type Contribution = {
  sizeBytes: number;
  fileCount: number;
  directoryCount: number;
  active: boolean;
};

const DEFAULT_MAX_CASCADE_DEPTH = 64;

class RollupManager {
  private readonly config: ServiceConfig;
  private readonly metrics: RollupMetrics;
  private readonly cache: RollupCache;
  private readonly queue: RollupQueue;
  private readonly readyPromise: Promise<void>;
  private destroyed = false;

  constructor(config: ServiceConfig, options: { registry?: Registry | null; metricsEnabled?: boolean }) {
    this.config = config;
    this.metrics = createRollupMetrics({
      enabled: options.metricsEnabled ?? config.metricsEnabled,
      registry: options.registry ?? null,
      prefix: 'filestore_'
    });

    this.cache = createRollupCache({
      ttlSeconds: config.rollups.cacheTtlSeconds,
      maxEntries: config.rollups.cacheMaxEntries,
      redisUrl: config.redis.url,
      keyPrefix: config.redis.keyPrefix,
      inlineMode: config.redis.inline,
      metrics: this.metrics
    });

    this.queue = new RollupQueue(
      {
        queueName: config.rollups.queueName,
        redisUrl: config.redis.url,
        inlineMode: config.redis.inline,
        metrics: this.metrics,
        keyPrefix: config.redis.keyPrefix,
        concurrency: config.rollups.queueConcurrency ?? 1
      },
      async (payload: RollupJobPayload) => {
        await this.processRollupJob(payload);
      }
    );

    this.readyPromise = this.queue.ensureReady();
  }

  getConfig(): ServiceConfig {
    return this.config;
  }

  async applyPlan(client: PoolClient, plan: RollupPlan): Promise<AppliedRollupPlan> {
    const updated = new Map<number, RollupRecord>();

    for (const nodeId of plan.ensure) {
      const record = await ensureRollup(client, nodeId);
      updated.set(nodeId, record);
    }

    for (const increment of plan.increments) {
      if (
        increment.sizeBytesDelta === 0 &&
        increment.fileCountDelta === 0 &&
        increment.directoryCountDelta === 0 &&
        increment.childCountDelta === 0 &&
        increment.markPending !== true
      ) {
        continue;
      }
      const record = await applyRollupDelta(client, increment.nodeId, {
        sizeBytesDelta: increment.sizeBytesDelta,
        fileCountDelta: increment.fileCountDelta,
        directoryCountDelta: increment.directoryCountDelta,
        childCountDelta: increment.childCountDelta,
        markPending: increment.markPending
      });
      updated.set(increment.nodeId, record);
    }

    for (const entry of plan.invalidate) {
      const record = await setRollupState(client, entry.nodeId, entry.state);
      updated.set(entry.nodeId, record);
    }

    return { updated };
  }

  async afterCommit(plan: RollupPlan, applied: AppliedRollupPlan): Promise<void> {
    if (this.destroyed) {
      return;
    }

    const updatedIds = new Set<number>();
    for (const record of applied.updated.values()) {
      updatedIds.add(record.nodeId);
      const summary = rollupRecordToSummary(record);
      await this.cache.set(summary);
      this.metrics.observeFreshness(record.state, summary.lastCalculatedAt);
    }

    for (const nodeId of plan.touchedNodeIds) {
      if (!updatedIds.has(nodeId)) {
        await this.cache.invalidate(nodeId, true);
      }
    }

    const jobs = this.selectJobs(plan);
    for (const job of jobs) {
      await this.queue.enqueue(job);
    }
  }

  async getSummary(nodeId: number): Promise<RollupSummary | null> {
    if (this.destroyed) {
      return null;
    }

    const cached = await this.cache.get(nodeId);
    if (cached) {
      this.metrics.observeFreshness(cached.state, cached.lastCalculatedAt);
      return cached;
    }

    const record = await withTransaction(async (client) => {
      const existing = await getRollup(client, nodeId);
      if (existing) {
        return existing;
      }
      return ensureRollup(client, nodeId);
    });

    this.metrics.recordCacheHit('db');
    const summary = rollupRecordToSummary(record);
    await this.cache.set(summary);
    this.metrics.observeFreshness(record.state, summary.lastCalculatedAt);
    return summary;
  }

  async shutdown(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    await this.queue.close();
    await this.cache.shutdown();
  }

  async ensureReady(): Promise<void> {
    await this.readyPromise;
  }

  private selectJobs(plan: RollupPlan): RollupJobPayload[] {
    const jobs: RollupJobPayload[] = [];
    const depthThreshold = this.config.rollups.recalcDepthThreshold;
    const childThreshold = this.config.rollups.recalcChildCountThreshold;
    for (const candidate of plan.scheduleCandidates) {
      const shouldSchedule =
        candidate.depth >= depthThreshold || Math.abs(candidate.childCountDelta) >= childThreshold;
      if (!shouldSchedule) {
        continue;
      }
      jobs.push({
        nodeId: candidate.nodeId,
        backendMountId: candidate.backendMountId,
        reason: candidate.reason,
        depth: candidate.depth
      });
    }
    return jobs;
  }

  private async processRollupJob(payload: RollupJobPayload): Promise<void> {
    if (this.destroyed) {
      return;
    }

    let currentNodeId: number | null = payload.nodeId;
    let depth = payload.depth ?? 0;
    const visited = new Set<number>();
    const maxDepth = this.config.rollups.maxCascadeDepth ?? DEFAULT_MAX_CASCADE_DEPTH;

    while (currentNodeId && !visited.has(currentNodeId) && depth <= maxDepth) {
      visited.add(currentNodeId);
      const result = await withTransaction(async (client) => recalculateRollup(client, currentNodeId!));
      if (!result) {
        break;
      }

      const summary = rollupRecordToSummary(result.record);
      await this.cache.set(summary);
      this.metrics.observeFreshness(result.record.state, summary.lastCalculatedAt);

      currentNodeId = result.parentId;
      depth += 1;
    }
  }
}

let managerInstance: RollupManager | null = null;
let managerPromise: Promise<RollupManager> | null = null;

export async function initializeRollupManager(options: InitializeOptions = {}): Promise<RollupManager> {
  if (managerInstance) {
    return managerInstance;
  }
  if (managerPromise) {
    return managerPromise;
  }

  managerPromise = (async () => {
    const config = options.config ?? loadServiceConfig();
    const manager = new RollupManager(config, {
      registry: options.registry ?? null,
      metricsEnabled: options.metricsEnabled ?? config.metricsEnabled
    });
    try {
      await manager.ensureReady();
      managerInstance = manager;
      return manager;
    } finally {
      managerPromise = null;
    }
  })();

  return managerPromise;
}

export function ensureRollupManager(): RollupManager {
  if (!managerInstance) {
    throw new Error('Rollup manager not initialised. Call initializeRollupManager() first.');
  }
  return managerInstance;
}

export async function shutdownRollupManager(): Promise<void> {
  if (!managerInstance) {
    return;
  }
  await managerInstance.shutdown();
  managerInstance = null;
  managerPromise = null;
}

export function resetRollupManagerForTests(): void {
  managerInstance = null;
}

export async function applyRollupPlanWithinTransaction(
  client: PoolClient,
  plan: RollupPlan
): Promise<AppliedRollupPlan> {
  const manager = ensureRollupManager();
  return manager.applyPlan(client, plan);
}

export async function finalizeRollupPlan(plan: RollupPlan, applied: AppliedRollupPlan): Promise<void> {
  if (
    plan.ensure.length === 0 &&
    plan.increments.length === 0 &&
    plan.invalidate.length === 0 &&
    plan.touchedNodeIds.length === 0 &&
    plan.scheduleCandidates.length === 0
  ) {
    return;
  }
  const manager = ensureRollupManager();
  await manager.afterCommit(plan, applied);
}

export async function getRollupSummary(nodeId: number): Promise<RollupSummary | null> {
  const manager = ensureRollupManager();
  return manager.getSummary(nodeId);
}

export function buildEmptyRollupPlan(): RollupPlan {
  return createEmptyRollupPlan();
}

export function computeContribution(node: NodeRecord | null): Contribution {
  if (!node || node.state !== 'active') {
    return { sizeBytes: 0, fileCount: 0, directoryCount: 0, active: false };
  }
  return {
    sizeBytes: node.kind === 'file' ? node.sizeBytes : 0,
    fileCount: node.kind === 'file' ? 1 : 0,
    directoryCount: node.kind === 'directory' ? 1 : 0,
    active: true
  };
}

export async function collectAncestorChain(
  client: PoolClient,
  start: NodeRecord | null
): Promise<NodeRecord[]> {
  const chain: NodeRecord[] = [];
  let current: NodeRecord | null = start;
  while (current) {
    chain.push(current);
    if (current.parentId === null) {
      break;
    }
    current = await getNodeById(client, current.parentId, { forUpdate: true });
  }
  return chain;
}

import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  subscribeToApphubEvents,
  type ApphubEvent
} from './events';
import { logger } from './observability/logger';
import {
  listWorkflowDefinitions,
  listLatestWorkflowAssetSnapshots,
  createWorkflowRun
} from './db/workflows';
import {
  type WorkflowDefinitionRecord,
  type WorkflowAssetDeclaration,
  type WorkflowRunRecord,
  type WorkflowAssetSnapshotRecord,
  type JsonValue
} from './db/types';
import {
  enqueueWorkflowRun,
  getQueueConnection,
  closeQueueConnection,
  isInlineQueueMode,
  ASSET_EVENT_QUEUE_NAME
} from './queue';
import {
  processAssetExpiryJob,
  ASSET_EXPIRY_JOB_NAME
} from './assets/assetEvents';
import {
  type AssetProducedEventData,
  type AssetExpiredEventData,
  type AssetExpiryJobData,
  type AssetAutoMaterializePolicy,
  type AssetExpiryReason
} from './assets/types';

const BASE_FAILURE_BACKOFF_MS = Math.max(
  30_000,
  Number(process.env.ASSET_MATERIALIZER_BASE_BACKOFF_MS ?? 120_000)
);
const MAX_FAILURE_BACKOFF_MS = Math.max(
  BASE_FAILURE_BACKOFF_MS,
  Number(process.env.ASSET_MATERIALIZER_MAX_BACKOFF_MS ?? 1_800_000)
);
const GRAPH_REFRESH_INTERVAL_MS = Math.max(
  0,
  Number(process.env.ASSET_MATERIALIZER_REFRESH_INTERVAL_MS ?? 600_000)
);

function nowMs(): number {
  return Date.now();
}

function normalizePartitionKeyValue(
  partitionKey: string | null | undefined
): { raw: string | null; normalized: string } {
  if (typeof partitionKey === 'string') {
    const trimmed = partitionKey.trim();
    if (trimmed.length > 0) {
      return { raw: trimmed, normalized: trimmed };
    }
  }
  return { raw: null, normalized: '' };
}

type WorkflowProducedAssetConfig = {
  assetId: string;
  policy: AssetAutoMaterializePolicy | null;
};

type WorkflowConfig = {
  id: string;
  slug: string;
  producedAssets: Map<string, WorkflowProducedAssetConfig>; // key: normalized asset id
  consumes: Set<string>; // normalized asset ids
  onUpstreamUpdate: boolean;
};

type AssetProductionRecord = {
  producedAt: string;
  workflowRunId: string;
  workflowSlug: string;
  partitionKey: string | null;
};

type FailureState = {
  failures: number;
  nextEligibleAt: number;
};

type AutoRunInfo = {
  workflowId: string;
  reason: 'upstream-update' | 'expiry';
  assetId: string;
  requestedAt: number;
  partitionKey: string | null;
  context?: Record<string, string>;
};

type UpstreamTriggerPayload = {
  reason: 'upstream-update';
  assetId: string;
  assetNormalizedId: string;
  producedAt: number;
  upstreamWorkflowId: string;
  upstreamRunId: string;
  partitionKey?: string | null;
};

type ExpiryTriggerPayload = {
  reason: 'expiry';
  assetId: string;
  assetNormalizedId: string;
  producedAt: number;
  expiryReason: AssetExpiryReason;
  partitionKey: string | null;
};

type AutoTriggerPayload = UpstreamTriggerPayload | ExpiryTriggerPayload;

export class AssetMaterializer {
  private workflowConfigs = new Map<string, WorkflowConfig>();
  private assetConsumers = new Map<string, Set<string>>();
  private latestAssets = new Map<string, Map<string, AssetProductionRecord>>();
  private autoRuns = new Map<string, AutoRunInfo>();
  private inFlight = new Map<string, Set<string>>();
  private failureState = new Map<string, FailureState>();
  private currentTask: Promise<void> = Promise.resolve();
  private unsubscribe: (() => void) | null = null;
  private queueWorker: Worker<AssetExpiryJobData> | null = null;
  private queueConnection: Redis | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private running = false;

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    logger.info('Asset materializer worker starting');
    await this.rebuildGraph();
    await this.hydrateLatestAssets();
    this.unsubscribe = subscribeToApphubEvents((event) => {
      this.queueTask(async () => {
        await this.handleEvent(event);
      });
    });
    if (!isInlineQueueMode()) {
      await this.startExpiryQueueWorker();
    }
    this.setupRefreshTimer();
    logger.info('Asset materializer worker ready');
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    try {
      await this.currentTask;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('Asset materializer pending task failed during shutdown', { error: message });
    }
    if (this.queueWorker) {
      try {
        await this.queueWorker.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown';
        logger.error('Failed to close asset expiry queue worker', { error: message });
      }
      this.queueWorker = null;
    }
    if (this.queueConnection) {
      try {
        await closeQueueConnection(this.queueConnection);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown';
        logger.error('Failed to close asset expiry queue connection', { error: message });
      }
      this.queueConnection = null;
    }
    logger.info('Asset materializer worker stopped');
  }

  private setupRefreshTimer(): void {
    if (GRAPH_REFRESH_INTERVAL_MS <= 0) {
      return;
    }
    this.refreshTimer = setInterval(() => {
      this.queueTask(async () => {
        await this.rebuildGraph();
      });
    }, GRAPH_REFRESH_INTERVAL_MS);
  }

  private queueTask(task: () => Promise<void>): void {
    this.currentTask = this.currentTask.then(task).catch((err) => {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('Asset materializer task failed', { error: message });
    });
  }

  private async handleEvent(event: ApphubEvent): Promise<void> {
    switch (event.type) {
      case 'workflow.definition.updated': {
        await this.rebuildGraph();
        await this.refreshLatestAssetsForWorkflow(event.data.workflow.id, event.data.workflow.slug);
        break;
      }
      case 'asset.produced': {
        await this.handleAssetProduced(event.data);
        break;
      }
      case 'asset.expired': {
        await this.handleAssetExpired(event.data);
        break;
      }
      case 'workflow.run.succeeded': {
        this.handleWorkflowRunLifecycle(event.data.run, 'succeeded');
        break;
      }
      case 'workflow.run.failed': {
        this.handleWorkflowRunLifecycle(event.data.run, 'failed');
        break;
      }
      case 'workflow.run.canceled': {
        this.handleWorkflowRunLifecycle(event.data.run, 'canceled');
        break;
      }
      default:
        break;
    }
  }

  private async handleAssetProduced(event: AssetProducedEventData): Promise<void> {
    const canonicalAssetId = this.canonicalAssetId(event.assetId);
    if (!canonicalAssetId) {
      return;
    }
    const assetKey = this.buildAssetKey(event.workflowDefinitionId, canonicalAssetId);
    const { raw, normalized } = normalizePartitionKeyValue(event.partitionKey ?? null);
    const partitionMap = this.latestAssets.get(assetKey) ?? new Map<string, AssetProductionRecord>();
    partitionMap.set(normalized, {
      producedAt: event.producedAt,
      workflowRunId: event.workflowRunId,
      workflowSlug: event.workflowSlug,
      partitionKey: raw
    });
    this.latestAssets.set(assetKey, partitionMap);

    if (!this.workflowConfigs.has(event.workflowDefinitionId)) {
      await this.rebuildGraph();
    }

    const normalizedAssetId = this.normalizeAssetId(canonicalAssetId);
    const consumerWorkflowIds = this.assetConsumers.get(normalizedAssetId);
    if (!consumerWorkflowIds || consumerWorkflowIds.size === 0) {
      return;
    }

    const producedAtMs = this.parseTimestamp(event.producedAt);

    for (const workflowId of consumerWorkflowIds) {
      if (workflowId === event.workflowDefinitionId) {
        continue;
      }
      await this.considerEnqueueWorkflow(workflowId, {
        reason: 'upstream-update',
        assetId: canonicalAssetId,
        assetNormalizedId: normalizedAssetId,
        producedAt: producedAtMs,
        upstreamWorkflowId: event.workflowDefinitionId,
        upstreamRunId: event.workflowRunId,
        partitionKey: raw
      });
    }
  }

  private async handleAssetExpired(event: AssetExpiredEventData): Promise<void> {
    const canonicalAssetId = this.canonicalAssetId(event.assetId);
    if (!canonicalAssetId) {
      return;
    }

    const assetKey = this.buildAssetKey(event.workflowDefinitionId, canonicalAssetId);
    const { raw, normalized } = normalizePartitionKeyValue(event.partitionKey ?? null);
    const partitionMap = this.latestAssets.get(assetKey);
    const latest = partitionMap?.get(normalized);
    const eventProducedAtMs = this.parseTimestamp(event.producedAt);
    if (latest) {
      const latestProducedAtMs = this.parseTimestamp(latest.producedAt);
      if (latestProducedAtMs > eventProducedAtMs) {
        return;
      }
    }

    if (!this.workflowConfigs.has(event.workflowDefinitionId)) {
      await this.rebuildGraph();
    }

    await this.considerEnqueueWorkflow(event.workflowDefinitionId, {
      reason: 'expiry',
      assetId: canonicalAssetId,
      assetNormalizedId: this.normalizeAssetId(canonicalAssetId),
      producedAt: eventProducedAtMs,
      expiryReason: event.reason,
      partitionKey: latest?.partitionKey ?? raw
    });
  }

  private handleWorkflowRunLifecycle(run: WorkflowRunRecord, status: 'succeeded' | 'failed' | 'canceled'): void {
    const tracked = this.autoRuns.get(run.id);
    const workflowId = tracked?.workflowId ?? run.workflowDefinitionId;
    const isAutoMaterialize = tracked !== undefined || this.isAutoTrigger(run);
    if (!isAutoMaterialize) {
      return;
    }

    this.autoRuns.delete(run.id);
    this.removeInFlight(workflowId, run.id);

    if (status === 'succeeded') {
      this.failureState.delete(workflowId);
      logger.info('Auto-materialize run succeeded', {
        workflowId,
        workflowSlug: this.workflowConfigs.get(workflowId)?.slug ?? 'unknown',
        runId: run.id
      });
      return;
    }

    const entry = this.failureState.get(workflowId) ?? { failures: 0, nextEligibleAt: 0 };
    entry.failures = Math.min(entry.failures + 1, 32);
    const delay = Math.min(
      MAX_FAILURE_BACKOFF_MS,
      BASE_FAILURE_BACKOFF_MS * Math.pow(2, Math.max(0, entry.failures - 1))
    );
    entry.nextEligibleAt = nowMs() + delay;
    this.failureState.set(workflowId, entry);

    logger.warn('Auto-materialize run failed', {
      workflowId,
      workflowSlug: this.workflowConfigs.get(workflowId)?.slug ?? 'unknown',
      runId: run.id,
      failures: entry.failures,
      backoffMs: delay,
      status
    });
  }

  private async startExpiryQueueWorker(): Promise<void> {
    let connection: Redis;
    try {
      connection = getQueueConnection();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('Failed to obtain Redis connection for asset expiry worker', { error: message });
      return;
    }

    const worker = new Worker<AssetExpiryJobData>(
      ASSET_EVENT_QUEUE_NAME,
      async (job) => {
        await processAssetExpiryJob(job.data);
      },
      {
        connection,
        concurrency: 1
      }
    );

    worker.on('failed', (job, err) => {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('Asset expiry job failed', {
        jobId: job?.id ?? 'unknown',
        error: message
      });
    });

    worker.on('completed', (job) => {
      logger.info('Asset expiry job processed', {
        jobId: job.id ?? 'unknown'
      });
    });

    try {
      await worker.waitUntilReady();
      logger.info('Asset expiry queue worker ready', {
        queue: ASSET_EVENT_QUEUE_NAME
      });
      this.queueWorker = worker;
      this.queueConnection = connection;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('Failed to initialise asset expiry queue worker', { error: message });
      try {
        await worker.close();
      } catch {
        // ignore
      }
      await closeQueueConnection(connection);
    }
  }

  private async rebuildGraph(): Promise<void> {
    try {
      const definitions = await listWorkflowDefinitions();
      const nextWorkflowConfigs = new Map<string, WorkflowConfig>();
      const nextAssetConsumers = new Map<string, Set<string>>();

      for (const definition of definitions) {
        const config = this.buildWorkflowConfig(definition);
        nextWorkflowConfigs.set(definition.id, config);
        for (const assetId of config.consumes) {
          const set = nextAssetConsumers.get(assetId) ?? new Set<string>();
          set.add(definition.id);
          nextAssetConsumers.set(assetId, set);
        }
      }

      this.workflowConfigs = nextWorkflowConfigs;
      this.assetConsumers = nextAssetConsumers;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('Failed to rebuild asset graph', { error: message });
      throw err;
    }
  }

  private async hydrateLatestAssets(): Promise<void> {
    for (const config of this.workflowConfigs.values()) {
      await this.refreshLatestAssetsForWorkflow(config.id, config.slug);
    }
  }

  private async refreshLatestAssetsForWorkflow(workflowId: string, workflowSlug: string): Promise<void> {
    try {
      const snapshots = await listLatestWorkflowAssetSnapshots(workflowId);
      this.applyAssetSnapshots(workflowId, workflowSlug, snapshots);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('Failed to refresh latest assets for workflow', {
        workflowId,
        error: message
      });
    }
  }

  private applyAssetSnapshots(
    workflowId: string,
    workflowSlug: string,
    snapshots: WorkflowAssetSnapshotRecord[]
  ): void {
    const accumulators = new Map<string, Map<string, AssetProductionRecord>>();

    for (const snapshot of snapshots) {
      const assetId = this.canonicalAssetId(snapshot.asset.assetId);
      if (!assetId) {
        continue;
      }
      const assetKey = this.buildAssetKey(workflowId, assetId);
      const { raw, normalized } = normalizePartitionKeyValue(snapshot.asset.partitionKey);
      const partitions = accumulators.get(assetKey) ?? new Map<string, AssetProductionRecord>();
      partitions.set(normalized, {
        producedAt: snapshot.asset.producedAt,
        workflowRunId: snapshot.workflowRunId,
        workflowSlug,
        partitionKey: raw
      });
      accumulators.set(assetKey, partitions);
    }

    for (const [assetKey, partitions] of accumulators) {
      this.latestAssets.set(assetKey, partitions);
    }
  }

  private buildWorkflowConfig(definition: WorkflowDefinitionRecord): WorkflowConfig {
    const producedAssets = new Map<string, WorkflowProducedAssetConfig>();
    const consumes = new Set<string>();
    let onUpstreamUpdate = false;

    const applyDeclarations = (
      produces: WorkflowAssetDeclaration[] | undefined,
      consumesList: WorkflowAssetDeclaration[] | undefined
    ) => {
      if (Array.isArray(produces)) {
        for (const declaration of produces) {
          if (!declaration || typeof declaration.assetId !== 'string') {
            continue;
          }
          const assetId = this.canonicalAssetId(declaration.assetId);
          if (!assetId) {
            continue;
          }
          const normalized = this.normalizeAssetId(assetId);
          if (!normalized) {
            continue;
          }
          const policy = this.parseAutoMaterializePolicy(declaration);
          if (policy?.onUpstreamUpdate) {
            onUpstreamUpdate = true;
          }
          producedAssets.set(normalized, {
            assetId,
            policy: policy ?? null
          });
        }
      }

      if (Array.isArray(consumesList)) {
        for (const declaration of consumesList) {
          if (!declaration || typeof declaration.assetId !== 'string') {
            continue;
          }
          const normalized = this.normalizeAssetId(declaration.assetId);
          if (!normalized) {
            continue;
          }
          consumes.add(normalized);
        }
      }
    };

    for (const step of definition.steps ?? []) {
      applyDeclarations(step.produces, step.consumes);
      if (step.type === 'fanout' && step.template) {
        applyDeclarations(step.template.produces, step.template.consumes);
      }
    }

    const config: WorkflowConfig = {
      id: definition.id,
      slug: definition.slug,
      producedAssets,
      consumes,
      onUpstreamUpdate
    };
    return config;
  }

  private parseAutoMaterializePolicy(
    declaration: WorkflowAssetDeclaration | null | undefined
  ): AssetAutoMaterializePolicy | null {
    if (!declaration) {
      return null;
    }
    const candidate = (declaration as unknown as { autoMaterialize?: unknown }).autoMaterialize;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return null;
    }
    const record = candidate as Record<string, unknown>;
    const policy: AssetAutoMaterializePolicy = {};
    if (typeof record.onUpstreamUpdate === 'boolean') {
      policy.onUpstreamUpdate = record.onUpstreamUpdate;
    }
    if (typeof record.priority === 'number' && Number.isFinite(record.priority)) {
      policy.priority = record.priority;
    }
    return Object.keys(policy).length > 0 ? policy : null;
  }

  private async considerEnqueueWorkflow(workflowId: string, payload: AutoTriggerPayload): Promise<void> {
    const config = this.workflowConfigs.get(workflowId);
    if (!config) {
      logger.warn('Workflow configuration missing for auto materialization', { workflowId });
      return;
    }

    if (payload.reason === 'upstream-update') {
      if (!config.onUpstreamUpdate) {
        return;
      }
      if (!config.consumes.has(payload.assetNormalizedId)) {
        return;
      }
      const latestMaterializedAt = this.getLatestMaterializedAt(workflowId);
      if (latestMaterializedAt !== null && latestMaterializedAt >= payload.producedAt) {
        return;
      }
    } else {
      const producedConfig = config.producedAssets.get(payload.assetNormalizedId);
      if (!producedConfig) {
        return;
      }
      const assetKey = this.buildAssetKey(workflowId, payload.assetId);
      const partitionMap = this.latestAssets.get(assetKey);
      if (partitionMap) {
        const { normalized } = normalizePartitionKeyValue(
          payload.partitionKey ?? null
        );
        const record = partitionMap.get(normalized);
        if (record) {
          const latestProducedAt = this.parseTimestamp(record.producedAt);
          if (latestProducedAt > payload.producedAt) {
            return;
          }
        }
      }
    }

    if (this.hasInFlight(workflowId)) {
      return;
    }

    const cooldown = this.failureState.get(workflowId);
    if (cooldown && cooldown.nextEligibleAt > nowMs()) {
      return;
    }

    try {
      await this.enqueueAutoRun(workflowId, config, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.error('Failed to enqueue auto-materialize run', {
        workflowId,
        workflowSlug: config.slug,
        error: message
      });
    }
  }

  private async enqueueAutoRun(
    workflowId: string,
    config: WorkflowConfig,
    payload: AutoTriggerPayload
  ): Promise<void> {
    const trigger = this.buildTriggerPayload(payload);
    const partitionKey = 'partitionKey' in payload ? payload.partitionKey ?? null : null;
    const run = await createWorkflowRun(workflowId, {
      triggeredBy: 'asset-materializer',
      trigger,
      partitionKey
    });

    this.trackAutoRun(workflowId, run.id, payload, partitionKey);

    try {
      await enqueueWorkflowRun(run.id);
      logger.info('Auto-materialize run enqueued', {
        workflowId,
        workflowSlug: config.slug,
        runId: run.id,
        reason: payload.reason,
        assetId: payload.assetId
      });
    } catch (err) {
      this.untrackAutoRun(workflowId, run.id);
      throw err;
    }
  }

  private trackAutoRun(
    workflowId: string,
    runId: string,
    payload: AutoTriggerPayload,
    partitionKey: string | null
  ): void {
    const set = this.inFlight.get(workflowId) ?? new Set<string>();
    set.add(runId);
    this.inFlight.set(workflowId, set);

    const context: Record<string, string> = {
      reason: payload.reason
    };
    if (payload.reason === 'upstream-update') {
      context.upstreamWorkflowId = payload.upstreamWorkflowId;
      context.upstreamRunId = payload.upstreamRunId;
    } else {
      context.expiryReason = payload.expiryReason;
    }
    if (partitionKey) {
      context.partitionKey = partitionKey;
    }

    this.autoRuns.set(runId, {
      workflowId,
      reason: payload.reason,
      assetId: payload.assetId,
      requestedAt: nowMs(),
      partitionKey,
      context
    });
  }

  private untrackAutoRun(workflowId: string, runId: string): void {
    this.autoRuns.delete(runId);
    this.removeInFlight(workflowId, runId);
  }

  private removeInFlight(workflowId: string, runId: string): void {
    const set = this.inFlight.get(workflowId);
    if (!set) {
      return;
    }
    set.delete(runId);
    if (set.size === 0) {
      this.inFlight.delete(workflowId);
    }
  }

  private hasInFlight(workflowId: string): boolean {
    const set = this.inFlight.get(workflowId);
    return Boolean(set && set.size > 0);
  }

  private buildTriggerPayload(payload: AutoTriggerPayload): JsonValue {
    const base: Record<string, JsonValue> = {
      type: 'auto-materialize',
      reason: payload.reason,
      assetId: payload.assetId
    };
    if ('partitionKey' in payload && payload.partitionKey) {
      base.partitionKey = payload.partitionKey;
    }
    if (payload.reason === 'upstream-update') {
      base.upstream = {
        assetId: payload.assetId,
        workflowId: payload.upstreamWorkflowId,
        runId: payload.upstreamRunId
      } as Record<string, JsonValue>;
      if (payload.partitionKey) {
        (base.upstream as Record<string, JsonValue>).partitionKey = payload.partitionKey;
      }
    } else {
      base.expiry = {
        reason: payload.expiryReason,
        partitionKey: payload.partitionKey ?? null
      } as Record<string, JsonValue>;
    }
    return base;
  }

  private getLatestMaterializedAt(workflowId: string): number | null {
    const config = this.workflowConfigs.get(workflowId);
    if (!config) {
      return null;
    }
    let latest: number | null = null;
    for (const produced of config.producedAssets.values()) {
      const assetKey = this.buildAssetKey(workflowId, produced.assetId);
      const partitionMap = this.latestAssets.get(assetKey);
      if (!partitionMap) {
        continue;
      }
      for (const record of partitionMap.values()) {
        const producedAt = this.parseTimestamp(record.producedAt);
        if (!Number.isFinite(producedAt)) {
          continue;
        }
        latest = latest === null ? producedAt : Math.max(latest, producedAt);
      }
    }
    return latest;
  }

  private parseTimestamp(value: string): number {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? nowMs() : parsed;
  }

  private canonicalAssetId(assetId: string | null | undefined): string {
    if (typeof assetId !== 'string') {
      return '';
    }
    return assetId.trim();
  }

  private normalizeAssetId(assetId: string | null | undefined): string {
    const canonical = this.canonicalAssetId(assetId);
    if (!canonical) {
      return '';
    }
    return canonical.toLowerCase();
  }

  private buildAssetKey(workflowId: string, assetId: string): string {
    return `${workflowId}:${assetId}`;
  }

  private isAutoTrigger(run: WorkflowRunRecord): boolean {
    const trigger = run.trigger;
    if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) {
      return false;
    }
    const type = (trigger as Record<string, unknown>).type;
    return typeof type === 'string' && type === 'auto-materialize';
  }
}

async function main(): Promise<void> {
  const materializer = new AssetMaterializer();
  try {
    await materializer.start();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    logger.error('Failed to start asset materializer worker', { error: message });
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    try {
      await materializer.stop();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

if (typeof require !== 'undefined' && require.main === module) {
  void main();
}

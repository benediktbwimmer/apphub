import { randomUUID } from 'node:crypto';
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
  createWorkflowRun,
  getWorkflowAssetPartitionParameters,
  getActiveWorkflowRunByKey,
  isRunKeyConflict
} from './db/workflows';
import {
  claimWorkflowAutoRun,
  attachWorkflowRunToClaim,
  releaseWorkflowAutoRun,
  cleanupStaleWorkflowRunClaims,
  getWorkflowAutoRunClaim,
  getFailureState as getFailureStateRecord,
  upsertFailureState,
  clearFailureState as clearFailureStateRecord
} from './db/assetMaterializer';
import { normalizeMeta } from './observability/meta';
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
import {
  canonicalAssetId as canonicalizeAssetId,
  normalizeAssetId as normalizeAssetIdentifier
} from './assets/identifiers';
import { buildRunKeyFromParts, computeRunKeyColumns } from './workflows/runKey';

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

function cloneJsonValue<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeParameterLayer(
  base: JsonValue | undefined,
  overlay: JsonValue | null | undefined
): JsonValue {
  if (overlay === undefined) {
    return base === undefined ? {} : cloneJsonValue(base);
  }
  if (overlay === null) {
    return null;
  }
  if (isJsonObject(overlay)) {
    const baseObject = isJsonObject(base) ? base : {};
    const result: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(baseObject)) {
      result[key] = cloneJsonValue(value);
    }
    for (const [key, value] of Object.entries(overlay)) {
      result[key] = mergeParameterLayer(baseObject[key], value);
    }
    return result;
  }
  return cloneJsonValue(overlay);
}

function startOfIntervalUTC(date: Date, granularity: 'minute' | 'hour' | 'day' | 'week' | 'month'): Date {
  const clone = new Date(date.getTime());
  switch (granularity) {
    case 'minute':
      clone.setUTCSeconds(0, 0);
      return clone;
    case 'hour':
      clone.setUTCMinutes(0, 0, 0);
      return clone;
    case 'day':
      clone.setUTCHours(0, 0, 0, 0);
      return clone;
    case 'week': {
      clone.setUTCHours(0, 0, 0, 0);
      const weekday = clone.getUTCDay();
      const offset = (weekday + 6) % 7; // Monday start
      clone.setUTCDate(clone.getUTCDate() - offset);
      return clone;
    }
    case 'month':
    default:
      clone.setUTCDate(1);
      clone.setUTCHours(0, 0, 0, 0);
      return clone;
  }
}

function addIntervalUTC(date: Date, granularity: 'minute' | 'hour' | 'day' | 'week' | 'month'): Date {
  const clone = new Date(date.getTime());
  switch (granularity) {
    case 'minute':
      clone.setUTCMinutes(clone.getUTCMinutes() + 1);
      break;
    case 'hour':
      clone.setUTCHours(clone.getUTCHours() + 1);
      break;
    case 'day':
      clone.setUTCDate(clone.getUTCDate() + 1);
      break;
    case 'week':
      clone.setUTCDate(clone.getUTCDate() + 7);
      break;
    case 'month':
    default:
      clone.setUTCMonth(clone.getUTCMonth() + 1);
      break;
  }
  return startOfIntervalUTC(clone, granularity);
}

function parseTimeWindowPartitionStart(
  partitioning: Extract<WorkflowAssetDeclaration['partitioning'], { type: 'timeWindow' }>,
  key: string
): Date | null {
  if (!key) {
    return null;
  }
  let parseTarget = key;
  const format = partitioning.format ?? null;
  if (format === 'YYYY-MM-DD') {
    parseTarget = `${key}T00:00:00Z`;
  } else if (format === 'YYYY-MM-DDTHH') {
    parseTarget = `${key}:00:00Z`;
  } else if (format === 'YYYY-MM-DDTHH:mm') {
    parseTarget = `${key}:00Z`;
  }
  const parsed = new Date(parseTarget);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return startOfIntervalUTC(parsed, partitioning.granularity);
}

function buildDerivedPartitionParameters(
  partitioning: WorkflowAssetDeclaration['partitioning'] | null,
  partitionKey: string | null
): JsonValue | null {
  if (!partitionKey) {
    return null;
  }
  const hints: Record<string, JsonValue> = {
    partitionKey
  };
  if (partitioning && partitioning.type === 'timeWindow') {
    const start = parseTimeWindowPartitionStart(partitioning, partitionKey);
    if (start) {
      const end = addIntervalUTC(start, partitioning.granularity);
      hints.windowStart = start.toISOString();
      hints.windowEnd = end.toISOString();
    }
  }
  return hints;
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
  parameterDefaults: JsonValue | null;
  partitioning: WorkflowAssetDeclaration['partitioning'] | null;
};

type WorkflowConfig = {
  id: string;
  slug: string;
  defaultParameters: JsonValue;
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
  private readonly instanceId = `${process.pid}:${randomUUID()}`;
  private workflowConfigs = new Map<string, WorkflowConfig>();
  private assetConsumers = new Map<string, Set<string>>();
  private latestAssets = new Map<string, Map<string, AssetProductionRecord>>();
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
    await cleanupStaleWorkflowRunClaims();
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
        await this.handleWorkflowRunLifecycle(event.data.run, 'succeeded');
        break;
      }
      case 'workflow.run.failed': {
        await this.handleWorkflowRunLifecycle(event.data.run, 'failed');
        break;
      }
      case 'workflow.run.canceled': {
        await this.handleWorkflowRunLifecycle(event.data.run, 'canceled');
        break;
      }
      default:
        break;
    }
  }

  private async handleAssetProduced(event: AssetProducedEventData): Promise<void> {
    const canonicalAssetId = canonicalizeAssetId(event.assetId);
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

    const normalizedAssetId = normalizeAssetIdentifier(canonicalAssetId);
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
    const canonicalAssetId = canonicalizeAssetId(event.assetId);
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
      assetNormalizedId: normalizeAssetIdentifier(canonicalAssetId),
      producedAt: eventProducedAtMs,
      expiryReason: event.reason,
      partitionKey: latest?.partitionKey ?? raw
    });
  }

  private async handleWorkflowRunLifecycle(
    run: WorkflowRunRecord,
    status: 'succeeded' | 'failed' | 'canceled'
  ): Promise<void> {
    if (!this.isAutoTrigger(run)) {
      return;
    }

    const workflowId = run.workflowDefinitionId;

    try {
      await releaseWorkflowAutoRun(workflowId, { workflowRunId: run.id });
    } catch (err) {
      logger.warn(
        'Failed to release auto-materialize claim',
        normalizeMeta({
          workflowId,
          workflowRunId: run.id,
          error: err instanceof Error ? err.message : String(err)
        })
      );
    }

    if (status === 'succeeded') {
      await clearFailureStateRecord(workflowId);
      logger.info('Auto-materialize run succeeded', {
        workflowId,
        workflowSlug: this.workflowConfigs.get(workflowId)?.slug ?? 'unknown',
        runId: run.id
      });
      return;
    }

    const existing = await getFailureStateRecord(workflowId);
    const failures = Math.min((existing?.failures ?? 0) + 1, 32);
    const delay = Math.min(
      MAX_FAILURE_BACKOFF_MS,
      BASE_FAILURE_BACKOFF_MS * Math.pow(2, Math.max(0, failures - 1))
    );
    const nextEligibleAt = new Date(nowMs() + delay);
    await upsertFailureState(workflowId, failures, nextEligibleAt);

    logger.warn('Auto-materialize run failed', {
      workflowId,
      workflowSlug: this.workflowConfigs.get(workflowId)?.slug ?? 'unknown',
      runId: run.id,
      failures,
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
      const assetId = canonicalizeAssetId(snapshot.asset.assetId);
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
          const assetId = canonicalizeAssetId(declaration.assetId);
          if (!assetId) {
            continue;
          }
          const normalized = normalizeAssetIdentifier(assetId);
          if (!normalized) {
            continue;
          }
          const policy = this.parseAutoMaterializePolicy(declaration);
          if (policy?.onUpstreamUpdate) {
            onUpstreamUpdate = true;
          }
          const parameterDefaults = declaration.autoMaterialize?.parameterDefaults ?? null;
          producedAssets.set(normalized, {
            assetId,
            policy: policy ?? null,
            parameterDefaults: parameterDefaults !== null ? cloneJsonValue(parameterDefaults) : null,
            partitioning: declaration.partitioning ?? null
          });
        }
      }

      if (Array.isArray(consumesList)) {
        for (const declaration of consumesList) {
          if (!declaration || typeof declaration.assetId !== 'string') {
            continue;
          }
          const normalized = normalizeAssetIdentifier(declaration.assetId);
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
      defaultParameters: definition.defaultParameters ?? {},
      producedAssets,
      consumes,
      onUpstreamUpdate
    };
    return config;
  }

  private selectParameterSourceAsset(
    config: WorkflowConfig,
    payload: AutoTriggerPayload
  ): WorkflowProducedAssetConfig | undefined {
    const direct = config.producedAssets.get(payload.assetNormalizedId);
    if (direct) {
      return direct;
    }

    for (const candidate of config.producedAssets.values()) {
      if (candidate.policy?.onUpstreamUpdate) {
        return candidate;
      }
    }

    for (const candidate of config.producedAssets.values()) {
      return candidate;
    }

    return undefined;
  }

  private async resolveRunParameters(
    config: WorkflowConfig,
    assetConfig: WorkflowProducedAssetConfig | undefined,
    partitionKey: string | null
  ): Promise<JsonValue> {
    let parameters: JsonValue = cloneJsonValue(config.defaultParameters);

    if (assetConfig && assetConfig.parameterDefaults !== null && assetConfig.parameterDefaults !== undefined) {
      parameters = mergeParameterLayer(parameters, assetConfig.parameterDefaults);
    }

    if (assetConfig) {
      const stored = await getWorkflowAssetPartitionParameters(
        config.id,
        assetConfig.assetId,
        partitionKey
      );
      if (stored) {
        parameters = mergeParameterLayer(parameters, stored.parameters);
      }
    }

    const derived = buildDerivedPartitionParameters(assetConfig?.partitioning ?? null, partitionKey);
    if (derived) {
      parameters = mergeParameterLayer(parameters, derived);
    }

    return parameters;
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

    if (await this.hasInFlight(workflowId)) {
      return;
    }

    const failureState = await getFailureStateRecord(workflowId);
    if (failureState?.nextEligibleAt) {
      const nextEligible = Date.parse(failureState.nextEligibleAt);
      if (!Number.isNaN(nextEligible) && nextEligible > nowMs()) {
        return;
      }
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
    const partitionKey = 'partitionKey' in payload ? payload.partitionKey ?? null : null;
    const assetConfig = this.selectParameterSourceAsset(config, payload);
    const parameters = await this.resolveRunParameters(config, assetConfig, partitionKey);
    const claimContext = this.buildClaimContext(payload, partitionKey);
    const claimed = await claimWorkflowAutoRun(workflowId, this.instanceId, {
      reason: payload.reason,
      assetId: payload.assetId,
      partitionKey,
      context: claimContext
    });

    if (!claimed) {
      return;
    }

    const trigger = this.buildTriggerPayload(payload);

    const runKeyParts: Array<string | null> = [
      'asset',
      payload.assetId ?? config.slug,
      partitionKey
    ];
    runKeyParts.push(payload.reason);
    if (payload.reason === 'upstream-update') {
      runKeyParts.push(payload.upstreamRunId);
    } else if (payload.reason === 'expiry') {
      runKeyParts.push(payload.expiryReason);
    }
    const runKeyCandidate = buildRunKeyFromParts(...runKeyParts);
    let runKeyColumns: { runKey: string | null; runKeyNormalized: string | null } = {
      runKey: null,
      runKeyNormalized: null
    };
    if (runKeyCandidate) {
      try {
        runKeyColumns = computeRunKeyColumns(runKeyCandidate);
      } catch (err) {
        logger.warn('Auto-materialize run skipped due to invalid run key', {
          workflowId,
          workflowSlug: config.slug,
          runKey: runKeyCandidate,
          error: (err as Error).message ?? 'unknown'
        });
        await releaseWorkflowAutoRun(workflowId, { ownerId: this.instanceId });
        return;
      }
    }

    let run: WorkflowRunRecord | null = null;
    try {
      run = await createWorkflowRun(workflowId, {
        triggeredBy: 'asset-materializer',
        parameters,
        trigger,
        partitionKey,
        runKey: runKeyColumns.runKey
      });

      const attached = await attachWorkflowRunToClaim(workflowId, this.instanceId, run.id);
      if (!attached) {
        await releaseWorkflowAutoRun(workflowId, { ownerId: this.instanceId });
        logger.warn('Failed to attach workflow run to materializer claim', {
          workflowId,
          workflowSlug: config.slug,
          workflowRunId: run.id
        });
        return;
      }

      await enqueueWorkflowRun(run.id, { runKey: run.runKey ?? runKeyColumns.runKey ?? null });
      logger.info('Auto-materialize run enqueued', {
        workflowId,
        workflowSlug: config.slug,
        runId: run.id,
        reason: payload.reason,
        assetId: payload.assetId
      });
    } catch (err) {
      if (!run && runKeyColumns.runKeyNormalized && isRunKeyConflict(err)) {
        const existing = await getActiveWorkflowRunByKey(workflowId, runKeyColumns.runKeyNormalized);
        await releaseWorkflowAutoRun(workflowId, { ownerId: this.instanceId });
        if (existing) {
          const existingRunKey = existing.runKey ?? runKeyColumns.runKey ?? null;
          try {
            await enqueueWorkflowRun(existing.id, { runKey: existingRunKey });
            logger.info('Auto-materialize run already active for run key', {
              workflowId,
              workflowSlug: config.slug,
              runKey: existingRunKey,
              existingRunId: existing.id
            });
            return;
          } catch (enqueueErr) {
            logger.error('Failed to re-enqueue existing auto-materialize run after run key conflict', {
              workflowId,
              workflowSlug: config.slug,
              existingRunId: existing.id,
              error: (enqueueErr as Error).message ?? 'unknown error'
            });
            throw enqueueErr;
          }
        }
        throw err;
      }
      if (run) {
        await releaseWorkflowAutoRun(workflowId, { workflowRunId: run.id });
      } else {
        await releaseWorkflowAutoRun(workflowId, { ownerId: this.instanceId });
      }
      throw err;
    }
  }

  private async hasInFlight(workflowId: string): Promise<boolean> {
    const claim = await getWorkflowAutoRunClaim(workflowId);
    return claim !== null;
  }

  private buildClaimContext(payload: AutoTriggerPayload, partitionKey: string | null): JsonValue {
    if (payload.reason === 'upstream-update') {
      return {
        reason: payload.reason,
        assetId: payload.assetId,
        upstreamWorkflowId: payload.upstreamWorkflowId,
        upstreamRunId: payload.upstreamRunId,
        partitionKey
      };
    }

    return {
      reason: payload.reason,
      assetId: payload.assetId,
      expiryReason: payload.expiryReason,
      partitionKey
    };
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

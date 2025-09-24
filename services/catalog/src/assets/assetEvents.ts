import { Queue } from 'bullmq';
import { emitApphubEvent } from '../events';
import { logger } from '../observability/logger';
import {
  ASSET_EVENT_QUEUE_NAME,
  getQueueConnection,
  isInlineQueueMode
} from '../queue';
import {
  recordWorkflowRunStepAssets,
  clearWorkflowAssetPartitionStale
} from '../db/workflows';
import type {
  WorkflowDefinitionRecord,
  WorkflowRunRecord,
  WorkflowRunStepAssetRecord,
  WorkflowRunStepAssetInput,
  JsonValue
} from '../db/types';
import type {
  AssetExpiryJobData,
  AssetExpiryReason,
  AssetExpiredEventData,
  AssetProducedEventData
} from './types';

export const ASSET_EXPIRY_JOB_NAME = 'asset-expiry';

let assetEventQueue: Queue<AssetExpiryJobData> | null = null;
let queueInitialisationFailed = false;

const inlineTimers = new Map<string, NodeJS.Timeout>();

function logError(message: string, meta?: Record<string, JsonValue>) {
  logger.error(message, meta);
}

function normalizePartitionKey(partitionKey: string | null | undefined): string {
  if (typeof partitionKey === 'string') {
    const trimmed = partitionKey.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return '';
}

function buildAssetKey(
  workflowDefinitionId: string,
  assetId: string,
  partitionKey: string | null | undefined
): string {
  const normalizedPartition = normalizePartitionKey(partitionKey);
  return `${workflowDefinitionId}:${assetId}:${normalizedPartition}`;
}

function buildJobId(reason: AssetExpiryReason, assetKey: string): string {
  return `${reason}:${assetKey}`;
}

function ensureAssetEventQueue(): Queue<AssetExpiryJobData> | null {
  if (isInlineQueueMode()) {
    return null;
  }

  if (assetEventQueue) {
    return assetEventQueue;
  }

  if (queueInitialisationFailed) {
    return null;
  }

  try {
    const connection = getQueueConnection();
    assetEventQueue = new Queue<AssetExpiryJobData>(ASSET_EVENT_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 25,
        attempts: 1
      }
    });
    return assetEventQueue;
  } catch (err) {
    queueInitialisationFailed = true;
    logError('Failed to initialise asset event queue', {
      error: err instanceof Error ? err.message : 'unknown'
    });
    return null;
  }
}

function toExpiredEvent(data: AssetExpiryJobData): AssetExpiredEventData {
  const { asset } = data;
  return {
    assetId: asset.assetId,
    workflowDefinitionId: asset.workflowDefinitionId,
    workflowSlug: asset.workflowSlug,
    workflowRunId: asset.workflowRunId,
    workflowRunStepId: asset.workflowRunStepId,
    stepId: asset.stepId,
    producedAt: asset.producedAt,
    freshness: asset.freshness,
    expiresAt: data.expiresAt,
    requestedAt: data.requestedAt,
    reason: data.reason,
    partitionKey: asset.partitionKey ?? null
  } satisfies AssetExpiredEventData;
}

export async function processAssetExpiryJob(data: AssetExpiryJobData): Promise<void> {
  emitApphubEvent({ type: 'asset.expired', data: toExpiredEvent(data) });
}

function cancelInlineTimer(jobId: string) {
  const timer = inlineTimers.get(jobId);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  inlineTimers.delete(jobId);
}

async function cancelQueuedJob(jobId: string) {
  const queue = ensureAssetEventQueue();
  if (!queue) {
    return;
  }
  try {
    const existing = await queue.getJob(jobId);
    if (existing) {
      await existing.remove();
    }
  } catch (err) {
    logError('Failed to remove scheduled asset expiry job', {
      jobId,
      error: err instanceof Error ? err.message : 'unknown'
    });
  }
}

async function scheduleExpiryJob(data: AssetExpiryJobData, delayMs: number) {
  const jobId = buildJobId(data.reason, data.assetKey);

  if (isInlineQueueMode()) {
    cancelInlineTimer(jobId);
    if (delayMs <= 0) {
      await processAssetExpiryJob(data);
      return;
    }
    const timer = setTimeout(() => {
      inlineTimers.delete(jobId);
      void processAssetExpiryJob(data);
    }, delayMs);
    inlineTimers.set(jobId, timer);
    return;
  }

  const queue = ensureAssetEventQueue();
  if (!queue) {
    return;
  }

  await cancelQueuedJob(jobId);

  try {
    await queue.add(ASSET_EXPIRY_JOB_NAME, data, {
      jobId,
      delay: Math.max(0, delayMs),
      removeOnComplete: true,
      removeOnFail: 25,
      attempts: 1
    });
  } catch (err) {
    logError('Failed to enqueue asset expiry job', {
      jobId,
      error: err instanceof Error ? err.message : 'unknown'
    });
  }
}

async function clearScheduledExpiry(assetKey: string, reason: AssetExpiryReason) {
  const jobId = buildJobId(reason, assetKey);
  cancelInlineTimer(jobId);
  await cancelQueuedJob(jobId);
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return Date.now();
  }
  return parsed;
}

function buildProducedEventData(options: {
  definition: WorkflowDefinitionRecord;
  run: WorkflowRunRecord;
  stepId: string;
  stepRecordId: string;
  asset: WorkflowRunStepAssetRecord;
}): AssetProducedEventData {
  const producedAt = typeof options.asset.producedAt === 'string' ? options.asset.producedAt : new Date().toISOString();
  return {
    assetId: options.asset.assetId,
    workflowDefinitionId: options.definition.id,
    workflowSlug: options.definition.slug,
    workflowRunId: options.run.id,
    workflowRunStepId: options.stepRecordId,
    stepId: options.stepId,
    producedAt,
    freshness: options.asset.freshness ?? null,
    partitionKey: options.asset.partitionKey ?? null
  } satisfies AssetProducedEventData;
}

async function scheduleFreshnessEvents(event: AssetProducedEventData) {
  const freshness = event.freshness;
  const producedAtMs = parseTimestamp(event.producedAt);
  const assetKey = buildAssetKey(event.workflowDefinitionId, event.assetId, event.partitionKey);
  const requestedAt = new Date().toISOString();

  await clearScheduledExpiry(assetKey, 'ttl');
  await clearScheduledExpiry(assetKey, 'cadence');

  if (!freshness) {
    return;
  }

  const jobs: AssetExpiryJobData[] = [];

  if (typeof freshness.ttlMs === 'number' && freshness.ttlMs > 0) {
    const expiresAt = new Date(producedAtMs + freshness.ttlMs).toISOString();
    jobs.push({
      assetKey,
      reason: 'ttl',
      requestedAt,
      expiresAt,
      asset: event
    });
  }

  if (typeof freshness.cadenceMs === 'number' && freshness.cadenceMs > 0) {
    const expiresAt = new Date(producedAtMs + freshness.cadenceMs).toISOString();
    jobs.push({
      assetKey,
      reason: 'cadence',
      requestedAt,
      expiresAt,
      asset: event
    });
  }

  for (const job of jobs) {
    const delayMs = Math.max(0, parseTimestamp(job.expiresAt) - Date.now());
    await scheduleExpiryJob(job, delayMs);
  }
}

export async function handleAssetsProduced(options: {
  definition: WorkflowDefinitionRecord;
  run: WorkflowRunRecord;
  stepId: string;
  stepRecordId: string;
  assets: WorkflowRunStepAssetRecord[];
}): Promise<void> {
  if (!options.assets || options.assets.length === 0) {
    return;
  }

  for (const asset of options.assets) {
    try {
      const event = buildProducedEventData({
        definition: options.definition,
        run: options.run,
        stepId: options.stepId,
        stepRecordId: options.stepRecordId,
        asset
      });
      emitApphubEvent({ type: 'asset.produced', data: event });
      await scheduleFreshnessEvents(event);
      try {
        await clearWorkflowAssetPartitionStale(
          options.definition.id,
          asset.assetId,
          asset.partitionKey ?? null
        );
      } catch (clearErr) {
        logError('Failed to clear stale flag for asset partition', {
          workflowDefinitionId: options.definition.id,
          assetId: asset.assetId,
          partitionKey: asset.partitionKey ?? null,
          error: clearErr instanceof Error ? clearErr.message : 'unknown'
        });
      }
    } catch (err) {
      logError('Failed to emit asset production metadata', {
        workflowDefinitionId: options.definition.id,
        workflowRunId: options.run.id,
        stepId: options.stepId,
        error: err instanceof Error ? err.message : 'unknown'
      });
    }
  }
}

export async function persistStepAssets(options: {
  definition: WorkflowDefinitionRecord;
  run: WorkflowRunRecord;
  stepId: string;
  stepRecordId: string;
  assets: WorkflowRunStepAssetInput[];
}): Promise<WorkflowRunStepAssetRecord[]> {
  const stored = await recordWorkflowRunStepAssets(
    options.run.workflowDefinitionId,
    options.run.id,
    options.stepRecordId,
    options.stepId,
    options.assets
  );

  if (stored.length > 0) {
    await handleAssetsProduced({
      definition: options.definition,
      run: options.run,
      stepId: options.stepId,
      stepRecordId: options.stepRecordId,
      assets: stored
    });
  }

  return stored;
}

export async function clearStepAssets(options: {
  run: WorkflowRunRecord;
  stepId: string;
  stepRecordId: string;
}): Promise<void> {
  await recordWorkflowRunStepAssets(
    options.run.workflowDefinitionId,
    options.run.id,
    options.stepRecordId,
    options.stepId,
    []
  );
}

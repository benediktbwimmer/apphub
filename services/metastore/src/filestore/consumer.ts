import { EventEmitter } from 'node:events';
import IORedis, { type Redis } from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import type {
  FilestoreEvent,
  FilestoreNodeEventPayload,
  FilestoreNodeReconciledPayload
} from '@apphub/shared/filestoreEvents';
import { parseFilestoreEventEnvelope } from '@apphub/shared/filestoreEvents';
import type { ServiceConfig } from '../config/serviceConfig';
import { withConnection } from '../db/client';
import { createRecord, softDeleteRecord, updateRecord } from '../db/recordsRepository';
import type { MetastoreMetrics } from '../plugins/metrics';

const SYSTEM_ACTOR = 'filestore-sync';
const inlineEmitter = new EventEmitter();
inlineEmitter.setMaxListeners(0);

const DEFAULT_STALL_THRESHOLD_SECONDS = 60;

type FilestoreHealthStatus = 'disabled' | 'ok' | 'stalled';

type FilestoreHealthState = {
  enabled: boolean;
  inline: boolean;
  stallThresholdSeconds: number;
  lastEventType: string | null;
  lastObservedAt: Date | null;
  lastReceivedAt: Date | null;
  connectionRetries: number;
  processingFailures: number;
};

export type FilestoreHealthSnapshot = {
  status: FilestoreHealthStatus;
  enabled: boolean;
  inline: boolean;
  thresholdSeconds: number;
  lagSeconds: number | null;
  lastEvent: {
    type: string | null;
    observedAt: string | null;
    receivedAt: string | null;
  };
  retries: {
    connect: number;
    processing: number;
    total: number;
  };
};

const healthState: FilestoreHealthState = {
  enabled: false,
  inline: false,
  stallThresholdSeconds: DEFAULT_STALL_THRESHOLD_SECONDS,
  lastEventType: null,
  lastObservedAt: null,
  lastReceivedAt: null,
  connectionRetries: 0,
  processingFailures: 0
};

let metricsHandle: MetastoreMetrics | null = null;

function bindMetrics(metrics: MetastoreMetrics | undefined): void {
  metricsHandle = metrics && metrics.enabled ? metrics : null;
  updateMetrics();
}

function resetHealthState(config: ServiceConfig['filestoreSync']): void {
  healthState.enabled = config.enabled;
  healthState.inline = config.inline;
  healthState.stallThresholdSeconds = config.stallThresholdSeconds;
  healthState.lastEventType = null;
  healthState.lastObservedAt = null;
  healthState.lastReceivedAt = null;
  healthState.connectionRetries = 0;
  healthState.processingFailures = 0;
  updateMetrics();
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed);
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value);
  }
  return null;
}

function extractObservedAt(event: FilestoreEvent): Date | null {
  const data = event.data as Record<string, unknown> | null | undefined;
  if (!data || typeof data !== 'object') {
    return null;
  }
  return toDate(data.observedAt);
}

function computeLagSeconds(now: Date = new Date()): number | null {
  const observedAt = healthState.lastObservedAt;
  if (!observedAt) {
    return null;
  }
  const diffMs = now.getTime() - observedAt.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return 0;
  }
  return diffMs / 1000;
}

function computeStatus(now: Date = new Date()): FilestoreHealthStatus {
  if (!healthState.enabled) {
    return 'disabled';
  }
  const lagSeconds = computeLagSeconds(now);
  if (lagSeconds !== null && lagSeconds > healthState.stallThresholdSeconds) {
    return 'stalled';
  }
  return 'ok';
}

function updateMetrics(now: Date = new Date()): void {
  if (!metricsHandle || !metricsHandle.enabled) {
    return;
  }
  const lagSeconds = computeLagSeconds(now);
  metricsHandle.filestoreLagSeconds.set(lagSeconds ?? 0);
  metricsHandle.filestoreStalled.set(computeStatus(now) === 'stalled' ? 1 : 0);
}

function recordConnectionRetry(): void {
  healthState.connectionRetries += 1;
  if (metricsHandle && metricsHandle.enabled) {
    metricsHandle.filestoreRetryTotal.inc({ kind: 'connect' });
  }
}

function recordProcessingFailure(): void {
  healthState.processingFailures += 1;
  if (metricsHandle && metricsHandle.enabled) {
    metricsHandle.filestoreRetryTotal.inc({ kind: 'processing' });
  }
}

function recordProcessedEvent(event: FilestoreEvent): void {
  const now = new Date();
  const observedAt = extractObservedAt(event) ?? now;
  healthState.lastEventType = event.type;
  healthState.lastObservedAt = observedAt;
  healthState.lastReceivedAt = now;
  updateMetrics(now);
}

interface ConsumerOptions {
  config: ServiceConfig['filestoreSync'];
  namespace: string;
  logger: FastifyBaseLogger;
}

type NodeEventInput = FilestoreNodeEventPayload | FilestoreNodeReconciledPayload;

function normalizeMetadata(existing: Record<string, unknown> | undefined, patch: Record<string, unknown>): Record<string, unknown> {
  const base = existing ? { ...existing } : {};
  const previousFilestore = typeof base.filestore === 'object' && base.filestore !== null ? { ...(base.filestore as Record<string, unknown>) } : {};
  return {
    ...base,
    filestore: {
      ...previousFilestore,
      ...patch
    }
  };
}

function buildNodeMetadata(data: NodeEventInput): Record<string, unknown> {
  const base: Record<string, unknown> = {
    backendMountId: data.backendMountId,
    path: data.path,
    kind: data.kind,
    state: data.state,
    parentId: data.parentId,
    version: data.version,
    sizeBytes: data.sizeBytes,
    checksum: data.checksum,
    contentHash: data.contentHash,
    nodeMetadata: data.metadata ?? {},
    observedAt: data.observedAt,
    journalId: null,
    command: null,
    idempotencyKey: null,
    principal: null,
    consistencyState: data.state === 'missing' ? 'missing' : data.state === 'inconsistent' ? 'inconsistent' : 'active',
    consistencyCheckedAt: null,
    lastReconciledAt: null,
    reconciliationReason: null,
    previousState: null
  } satisfies Record<string, unknown>;

  if ('journalId' in data) {
    base.journalId = data.journalId;
    base.command = data.command;
    base.idempotencyKey = data.idempotencyKey ?? null;
    base.principal = data.principal ?? null;
  }

  if ('consistencyState' in data) {
    return applyReconciliationMetadata(base, data);
  }

  return base;
}

function applyReconciliationMetadata(
  base: Record<string, unknown>,
  data: FilestoreNodeReconciledPayload
): Record<string, unknown> {
  return {
    ...base,
    consistencyState: data.consistencyState,
    consistencyCheckedAt: data.consistencyCheckedAt,
    lastReconciledAt: data.lastReconciledAt,
    reconciliationReason: data.reason,
    observedAt: data.observedAt,
    previousState: data.previousState
  } satisfies Record<string, unknown>;
}

export class FilestoreSyncConsumer {
  private readonly options: ConsumerOptions;
  private subscriber: Redis | null = null;
  private processing: Promise<void> = Promise.resolve();
  private stopped = false;
  private inlineListener: ((event: FilestoreEvent) => void) | null = null;

  constructor(options: ConsumerOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (!this.options.config.enabled) {
      this.options.logger.info('[metastore:filestore] sync disabled');
      updateMetrics();
      return;
    }

    if (this.options.config.inline) {
      this.options.logger.info('[metastore:filestore] inline event mode enabled');
      const listener = (event: FilestoreEvent) => {
        this.enqueue(event);
      };
      inlineEmitter.on('event', listener);
      this.inlineListener = listener;
      return;
    }

    const redis = new IORedis(this.options.config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null
    });

    redis.on('error', (err) => {
      this.options.logger.error({ err }, '[metastore:filestore] redis error');
    });

    redis.on('end', () => {
      if (this.stopped) {
        return;
      }
      this.options.logger.warn('[metastore:filestore] redis connection closed, will retry');
    });

    redis.on('message', (_channel, message) => {
      const envelope = parseFilestoreEventEnvelope(message);
      if (!envelope?.event) {
        this.options.logger.warn('[metastore:filestore] received invalid event payload');
        return;
      }
      this.enqueue(envelope.event);
    });

    const attemptSubscribe = async () => {
      try {
        await redis.connect();
        await redis.subscribe(this.options.config.channel);
        this.options.logger.info({ channel: this.options.config.channel }, '[metastore:filestore] subscribed to channel');
      } catch (err) {
        recordConnectionRetry();
        this.options.logger.error({ err }, '[metastore:filestore] failed to subscribe to filestore events');
        await redis.quit().catch(() => undefined);
        if (!this.stopped) {
          await new Promise((resolve) => setTimeout(resolve, this.options.config.retryDelayMs));
          await attemptSubscribe();
        }
      }
    };

    await attemptSubscribe();
    this.subscriber = redis;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.processing.catch(() => undefined);

    if (this.inlineListener) {
      inlineEmitter.off('event', this.inlineListener);
      this.inlineListener = null;
    }

    if (this.subscriber) {
      try {
        await this.subscriber.unsubscribe(this.options.config.channel);
      } catch (err) {
        this.options.logger.error({ err }, '[metastore:filestore] failed to unsubscribe from channel');
      }
      try {
        await this.subscriber.quit();
      } catch (err) {
        this.options.logger.error({ err }, '[metastore:filestore] failed to close redis connection');
      }
      this.subscriber = null;
    }
  }

  async waitForIdle(): Promise<void> {
    await this.processing.catch(() => undefined);
  }

  emitInline(event: FilestoreEvent): void {
    inlineEmitter.emit('event', event);
  }

  private enqueue(event: FilestoreEvent): void {
    this.processing = this.processing
      .catch(() => undefined)
      .then(async () => {
        try {
          await this.handleEvent(event);
          recordProcessedEvent(event);
        } catch (err) {
          recordProcessingFailure();
          this.options.logger.error({ err }, '[metastore:filestore] failed to process event');
        }
      });
  }

  private async handleEvent(event: FilestoreEvent): Promise<void> {
    switch (event.type) {
      case 'filestore.node.created':
      case 'filestore.node.updated': {
        await this.upsertNode(event.data);
        break;
      }
      case 'filestore.node.deleted': {
        await this.softDeleteNode(event.data);
        break;
      }
      case 'filestore.node.reconciled':
      case 'filestore.node.missing': {
        await this.upsertNode(event.data);
        break;
      }
      default:
        break;
    }
  }

  private async upsertNode(data: FilestoreNodeEventPayload | FilestoreNodeReconciledPayload): Promise<void> {
    if (!data.nodeId) {
      return;
    }
    const key = String(data.nodeId);
    const metadataPatch = buildNodeMetadata(data);

    await withConnection(async (client) => {
      const { record, created } = await createRecord(client, {
        namespace: this.options.config.namespace,
        key,
        metadata: normalizeMetadata({}, metadataPatch),
        actor: SYSTEM_ACTOR
      });

      if (created) {
        return;
      }

      const updatedMetadata = normalizeMetadata(record.metadata, metadataPatch);
      await updateRecord(client, {
        namespace: this.options.config.namespace,
        key,
        metadata: updatedMetadata,
        tags: record.tags,
        owner: record.owner,
        schemaHash: record.schemaHash ?? undefined,
        actor: SYSTEM_ACTOR
      });
    });
  }

  private async softDeleteNode(data: FilestoreNodeEventPayload): Promise<void> {
    if (!data.nodeId) {
      return;
    }
    const key = String(data.nodeId);
    await withConnection(async (client) => {
      await softDeleteRecord(client, {
        namespace: this.options.config.namespace,
        key,
        actor: SYSTEM_ACTOR
      });
    });
  }
}

function buildHealthSnapshot(now: Date = new Date()): FilestoreHealthSnapshot {
  const lagSeconds = computeLagSeconds(now);
  const status = computeStatus(now);
  return {
    status,
    enabled: healthState.enabled,
    inline: healthState.inline,
    thresholdSeconds: healthState.stallThresholdSeconds,
    lagSeconds,
    lastEvent: {
      type: healthState.lastEventType,
      observedAt: healthState.lastObservedAt ? healthState.lastObservedAt.toISOString() : null,
      receivedAt: healthState.lastReceivedAt ? healthState.lastReceivedAt.toISOString() : null
    },
    retries: {
      connect: healthState.connectionRetries,
      processing: healthState.processingFailures,
      total: healthState.connectionRetries + healthState.processingFailures
    }
  } satisfies FilestoreHealthSnapshot;
}

let consumerInstance: FilestoreSyncConsumer | null = null;

export async function initializeFilestoreSync(options: {
  config: ServiceConfig;
  logger: FastifyBaseLogger;
  metrics?: MetastoreMetrics;
}): Promise<FilestoreSyncConsumer> {
  if (consumerInstance) {
    return consumerInstance;
  }
  bindMetrics(options.metrics);
  resetHealthState(options.config.filestoreSync);
  const consumer = new FilestoreSyncConsumer({
    config: options.config.filestoreSync,
    namespace: options.config.filestoreSync.namespace,
    logger: options.logger
  });
  await consumer.start();
  consumerInstance = consumer;
  return consumer;
}

export async function shutdownFilestoreSync(): Promise<void> {
  if (!consumerInstance) {
    return;
  }
  await consumerInstance.stop();
  consumerInstance = null;
}

export function getFilestoreHealthSnapshot(): FilestoreHealthSnapshot {
  return buildHealthSnapshot();
}

export function emitFilestoreEventInline(event: FilestoreEvent): void {
  inlineEmitter.emit('event', event);
}

export async function waitForFilestoreSyncIdle(): Promise<void> {
  if (!consumerInstance) {
    return;
  }
  await consumerInstance.waitForIdle();
}

export function resetFilestoreSyncForTests(): void {
  consumerInstance = null;
  inlineEmitter.removeAllListeners();
  resetHealthState({
    enabled: false,
    inline: true,
    redisUrl: 'inline',
    channel: '',
    namespace: '',
    retryDelayMs: 1000,
    stallThresholdSeconds: DEFAULT_STALL_THRESHOLD_SECONDS
  });
  bindMetrics(undefined);
}

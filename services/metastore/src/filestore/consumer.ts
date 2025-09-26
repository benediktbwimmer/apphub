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

const SYSTEM_ACTOR = 'filestore-sync';
const inlineEmitter = new EventEmitter();
inlineEmitter.setMaxListeners(0);

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
        } catch (err) {
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

let consumerInstance: FilestoreSyncConsumer | null = null;

export async function initializeFilestoreSync(options: { config: ServiceConfig; logger: FastifyBaseLogger }): Promise<FilestoreSyncConsumer> {
  if (consumerInstance) {
    return consumerInstance;
  }
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
}

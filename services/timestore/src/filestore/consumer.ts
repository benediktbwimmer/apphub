import { EventEmitter } from 'node:events';
import IORedis, { type Redis } from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import type {
  FilestoreEvent,
  FilestoreNodeEventPayload,
  FilestoreNodeReconciledPayload,
  FilestoreCommandCompletedPayload,
  FilestoreDriftDetectedPayload
} from '@apphub/shared/filestoreEvents';
import { parseFilestoreEventEnvelope } from '@apphub/shared/filestoreEvents';
import type { ServiceConfig } from '../config/serviceConfig';
import { processIngestionJob } from '../ingestion/processor';
import { withConnection } from '../db/client';
import { getFilestoreNodeState, upsertFilestoreNodeState } from './stateRepository';

const inlineEmitter = new EventEmitter();
inlineEmitter.setMaxListeners(0);

interface ConsumerOptions {
  config: ServiceConfig['filestore'];
  logger: FastifyBaseLogger;
}

const ACTIVITY_SCHEMA = [
  { name: 'observed_at', type: 'timestamp' as const },
  { name: 'event_type', type: 'string' as const },
  { name: 'node_id', type: 'integer' as const },
  { name: 'backend_mount_id', type: 'integer' as const },
  { name: 'path', type: 'string' as const },
  { name: 'state', type: 'string' as const },
  { name: 'consistency_state', type: 'string' as const },
  { name: 'size_bytes', type: 'double' as const },
  { name: 'size_delta', type: 'double' as const },
  { name: 'journal_id', type: 'integer' as const },
  { name: 'command', type: 'string' as const },
  { name: 'principal', type: 'string' as const },
  { name: 'reconciliation_reason', type: 'string' as const },
  { name: 'metadata_json', type: 'string' as const }
];

export class FilestoreActivityConsumer {
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
      this.options.logger.info('[timestore:filestore] sync disabled');
      return;
    }

    if (this.options.config.inline) {
      this.options.logger.info('[timestore:filestore] inline event mode enabled');
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
      this.options.logger.error({ err }, '[timestore:filestore] redis error');
    });

    redis.on('end', () => {
      if (this.stopped) {
        return;
      }
      this.options.logger.warn('[timestore:filestore] redis connection closed, will retry');
    });

    redis.on('message', (_channel, message) => {
      const envelope = parseFilestoreEventEnvelope(message);
      if (!envelope?.event) {
        this.options.logger.warn('[timestore:filestore] received invalid event payload');
        return;
      }
      this.enqueue(envelope.event);
    });

    const attemptSubscribe = async () => {
      try {
        await redis.connect();
        await redis.subscribe(this.options.config.channel);
        this.options.logger.info({ channel: this.options.config.channel }, '[timestore:filestore] subscribed to channel');
      } catch (err) {
        this.options.logger.error({ err }, '[timestore:filestore] failed to subscribe to filestore events');
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
        this.options.logger.error({ err }, '[timestore:filestore] failed to unsubscribe from channel');
      }
      try {
        await this.subscriber.quit();
      } catch (err) {
        this.options.logger.error({ err }, '[timestore:filestore] failed to close redis connection');
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
          this.options.logger.error({ err }, '[timestore:filestore] failed to process event');
        }
      });
  }

  private async handleEvent(event: FilestoreEvent): Promise<void> {
    switch (event.type) {
      case 'filestore.node.created':
      case 'filestore.node.updated':
      case 'filestore.node.deleted':
      case 'filestore.node.reconciled':
      case 'filestore.node.missing': {
        await this.handleNodeEvent(event);
        break;
      }
      case 'filestore.command.completed':
        await this.handleCommandCompleted(event.data);
        break;
      case 'filestore.drift.detected':
        await this.handleDriftDetected(event.data);
        break;
      default:
        break;
    }
  }

  private async handleNodeEvent(event: Extract<FilestoreEvent,
    { type: 'filestore.node.created' | 'filestore.node.updated' | 'filestore.node.deleted' | 'filestore.node.reconciled' | 'filestore.node.missing' }>): Promise<void> {
    const data = event.data as FilestoreNodeEventPayload | FilestoreNodeReconciledPayload;
    if (!data.nodeId) {
      return;
    }

    const observedAtIso = this.resolveTimestamp('observedAt' in data ? data.observedAt : undefined);
    const observedAt = new Date(observedAtIso);

    const previousState = await withConnection((client) => getFilestoreNodeState(client, data.nodeId!));

    const currentSize = this.resolveNodeSize(event.type, data, previousState);
    const sizeDelta = this.computeSizeDelta(currentSize, previousState?.sizeBytes ?? null);

    const consistencyState = 'consistencyState' in data ? data.consistencyState : previousState?.consistencyState ?? null;

    const row = {
      observed_at: observedAtIso,
      event_type: event.type,
      node_id: data.nodeId ?? null,
      backend_mount_id: data.backendMountId ?? null,
      path: data.path ?? null,
      state: data.state ?? null,
      consistency_state: consistencyState,
      size_bytes: currentSize,
      size_delta: sizeDelta,
      journal_id: 'journalId' in data ? data.journalId ?? null : null,
      command: 'command' in data ? data.command ?? null : null,
      principal: 'principal' in data ? data.principal ?? null : null,
      reconciliation_reason: 'reason' in data ? data.reason ?? null : null,
      metadata_json: JSON.stringify({ metadata: data.metadata ?? {}, previousState: previousState ?? null })
    } satisfies Record<string, unknown>;

    await this.appendActivityRow(row, observedAtIso);

    await withConnection(async (client) => {
      await upsertFilestoreNodeState(client, {
        nodeId: data.nodeId!,
        backendMountId: data.backendMountId ?? null,
        path: data.path ?? null,
        state: data.state ?? null,
        consistencyState,
        sizeBytes: currentSize,
        lastObservedAt: observedAt,
        lastJournalId: 'journalId' in data ? data.journalId ?? null : previousState?.lastJournalId ?? null
      });
    });
  }

  private async handleCommandCompleted(data: FilestoreCommandCompletedPayload): Promise<void> {
    const observedAtIso = this.resolveTimestamp(data.observedAt);
    const row = {
      observed_at: observedAtIso,
      event_type: 'filestore.command.completed',
      node_id: data.nodeId ?? null,
      backend_mount_id: data.backendMountId ?? null,
      path: data.path ?? null,
      state: null,
      consistency_state: null,
      size_bytes: null,
      size_delta: null,
      journal_id: data.journalId,
      command: data.command,
      principal: data.principal ?? null,
      reconciliation_reason: null,
      metadata_json: JSON.stringify({ result: data.result })
    } satisfies Record<string, unknown>;

    await this.appendActivityRow(row, observedAtIso);
  }

  private async handleDriftDetected(data: FilestoreDriftDetectedPayload): Promise<void> {
    const observedAtIso = this.resolveTimestamp(data.detectedAt);
    const row = {
      observed_at: observedAtIso,
      event_type: 'filestore.drift.detected',
      node_id: data.nodeId ?? null,
      backend_mount_id: data.backendMountId ?? null,
      path: data.path ?? null,
      state: 'inconsistent',
      consistency_state: 'missing',
      size_bytes: null,
      size_delta: null,
      journal_id: null,
      command: null,
      principal: data.reporter ?? null,
      reconciliation_reason: data.reason ?? null,
      metadata_json: JSON.stringify({ metadata: data.metadata ?? {} })
    } satisfies Record<string, unknown>;

    await this.appendActivityRow(row, observedAtIso);
  }

  private resolveNodeSize(
    eventType: FilestoreEvent['type'],
    data: FilestoreNodeEventPayload | FilestoreNodeReconciledPayload,
    previous: { sizeBytes: number | null } | null
  ): number | null {
    if (eventType === 'filestore.node.deleted') {
      return 0;
    }
    if (data.sizeBytes !== undefined && data.sizeBytes !== null) {
      return Number(data.sizeBytes);
    }
    return previous?.sizeBytes ?? null;
  }

  private computeSizeDelta(currentSize: number | null, previousSize: number | null): number | null {
    if (currentSize === null) {
      return null;
    }
    if (previousSize === null || previousSize === undefined) {
      return currentSize;
    }
    return currentSize - previousSize;
  }

  private resolveTimestamp(candidate?: string): string {
    if (!candidate) {
      return new Date().toISOString();
    }
    const date = new Date(candidate);
    if (Number.isNaN(date.getTime())) {
      return new Date().toISOString();
    }
    return date.toISOString();
  }

  private async appendActivityRow(row: Record<string, unknown>, observedAtIso: string): Promise<void> {
    const dateKey = observedAtIso.slice(0, 10);
    await processIngestionJob({
      datasetSlug: this.options.config.datasetSlug,
      datasetName: this.options.config.datasetName,
      tableName: this.options.config.tableName,
      schema: { fields: ACTIVITY_SCHEMA },
      partition: {
        key: { date: dateKey },
        timeRange: {
          start: observedAtIso,
          end: observedAtIso
        }
      },
      rows: [row],
      receivedAt: new Date().toISOString()
    });
  }
}

let consumerInstance: FilestoreActivityConsumer | null = null;

export async function initializeFilestoreActivity(options: { config: ServiceConfig; logger: FastifyBaseLogger }): Promise<FilestoreActivityConsumer> {
  if (consumerInstance) {
    return consumerInstance;
  }
  const filestoreConfig = { ...options.config.filestore };
  if (filestoreConfig.redisUrl === 'inline') {
    filestoreConfig.inline = true;
  }
  const consumer = new FilestoreActivityConsumer({
    config: filestoreConfig,
    logger: options.logger
  });
  await consumer.start();
  consumerInstance = consumer;
  return consumer;
}

export async function shutdownFilestoreActivity(): Promise<void> {
  if (!consumerInstance) {
    return;
  }
  await consumerInstance.stop();
  consumerInstance = null;
}

export function emitFilestoreActivityInline(event: FilestoreEvent): void {
  inlineEmitter.emit('event', event);
}

export async function waitForFilestoreActivityIdle(): Promise<void> {
  if (!consumerInstance) {
    return;
  }
  await consumerInstance.waitForIdle();
}

export function resetFilestoreActivityForTests(): void {
  consumerInstance = null;
  inlineEmitter.removeAllListeners();
}

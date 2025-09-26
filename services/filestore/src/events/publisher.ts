import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import IORedis, { type Redis } from 'ioredis';
import type { NodeRecord, NodeState, NodeKind } from '../db/nodes';
import type { CommandCompletedEvent } from './bus';
import { filestoreEvents } from './bus';
import type { ServiceConfig } from '../config/serviceConfig';

export type FilestoreNodeEventPayload = {
  backendMountId: number;
  nodeId: number | null;
  path: string;
  kind: NodeKind | 'unknown';
  state: NodeState | 'unknown';
  parentId: number | null;
  version: number | null;
  sizeBytes: number | null;
  checksum: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  journalId: number;
  command: string;
  idempotencyKey: string | null;
  principal: string | null;
  observedAt: string;
};

export type FilestoreCommandCompletedPayload = {
  journalId: number;
  command: string;
  backendMountId: number;
  nodeId: number | null;
  path: string;
  idempotencyKey: string | null;
  principal: string | null;
  result: Record<string, unknown>;
  observedAt: string;
};

export type FilestoreDriftDetectedPayload = {
  backendMountId: number;
  nodeId: number | null;
  path: string;
  detectedAt: string;
  reason: string;
  reporter?: string;
  metadata?: Record<string, unknown>;
};

export type FilestoreEvent =
  | { type: 'filestore.node.created'; data: FilestoreNodeEventPayload }
  | { type: 'filestore.node.updated'; data: FilestoreNodeEventPayload }
  | { type: 'filestore.node.deleted'; data: FilestoreNodeEventPayload }
  | { type: 'filestore.command.completed'; data: FilestoreCommandCompletedPayload }
  | { type: 'filestore.drift.detected'; data: FilestoreDriftDetectedPayload };

export type FilestoreEventListener = (event: FilestoreEvent) => void | Promise<void>;

const eventEmitter = new EventEmitter();
eventEmitter.setMaxListeners(0);

let initialized = false;
let inlineMode = true;
let channelName = 'apphub:filestore';
let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let configRef: ServiceConfig | null = null;
let commandListener: ((payload: CommandCompletedEvent) => void) | null = null;
let redisFailureNotified = false;
const originId = `${process.pid}:${randomUUID()}`;

function resolveInlineMode(config: ServiceConfig): boolean {
  const explicit = (process.env.FILESTORE_EVENTS_MODE ?? '').trim().toLowerCase();
  if (explicit === 'inline') {
    return true;
  }
  if (explicit === 'redis') {
    return false;
  }
  return config.events.mode === 'inline';
}

function computeChannel(config: ServiceConfig): string {
  return process.env.FILESTORE_EVENTS_CHANNEL || config.events.channel;
}

function sanitizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  if (Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function deriveNodePayload(
  payload: CommandCompletedEvent
): FilestoreNodeEventPayload {
  const node: NodeRecord | null | undefined = payload.node;
  const result = payload.result as Partial<Record<string, unknown>>;
  const path =
    node?.path ??
    (typeof result.path === 'string' ? (result.path as string) : payload.path);
  const kind =
    node?.kind ??
    (typeof result.kind === 'string' ? (result.kind as NodeKind | 'unknown') : 'unknown');
  const state =
    node?.state ??
    (typeof result.state === 'string' ? (result.state as NodeState | 'unknown') : 'unknown');
  const version = node?.version ?? (typeof result.version === 'number' ? (result.version as number) : null);
  const sizeBytes = node?.sizeBytes ?? (typeof result.sizeBytes === 'number' ? (result.sizeBytes as number) : null);
  const checksum = node?.checksum ?? null;
  const contentHash = node?.contentHash ?? null;
  const metadata = sanitizeMetadata(node?.metadata ?? {});
  const parentId = node?.parentId ?? null;

  return {
    backendMountId: payload.backendMountId,
    nodeId: node?.id ?? (typeof result.nodeId === 'number' ? (result.nodeId as number) : null),
    path,
    kind,
    state,
    parentId,
    version,
    sizeBytes,
    checksum,
    contentHash,
    metadata,
    journalId: payload.journalId,
    command: payload.command,
    idempotencyKey: payload.idempotencyKey ?? null,
    principal: payload.principal ?? null,
    observedAt: new Date().toISOString()
  };
}

async function handleCommandCompleted(payload: CommandCompletedEvent): Promise<void> {
  const observedAt = new Date().toISOString();
  const commandEvent: FilestoreEvent = {
    type: 'filestore.command.completed',
    data: {
      journalId: payload.journalId,
      command: payload.command,
      backendMountId: payload.backendMountId,
      nodeId: payload.nodeId,
      path: payload.path,
      idempotencyKey: payload.idempotencyKey ?? null,
      principal: payload.principal ?? null,
      result: payload.result,
      observedAt
    }
  };
  await emitFilestoreEvent(commandEvent);

  const nodePayload = deriveNodePayload(payload);
  if (payload.command === 'deleteNode') {
    const event: FilestoreEvent = { type: 'filestore.node.deleted', data: nodePayload };
    await emitFilestoreEvent(event);
    return;
  }

  if (payload.command === 'createDirectory') {
    const version = nodePayload.version ?? 0;
    const eventType: FilestoreEvent['type'] = version > 1 ? 'filestore.node.updated' : 'filestore.node.created';
    await emitFilestoreEvent({ type: eventType, data: nodePayload });
  }
}

function disableRedis(reason: string) {
  if (inlineMode) {
    return;
  }
  inlineMode = true;
  if (!redisFailureNotified) {
    console.warn(`[filestore:events] Falling back to inline mode: ${reason}`);
    redisFailureNotified = true;
  }
  if (publisher) {
    publisher.removeAllListeners();
    publisher.quit().catch(() => undefined);
    publisher = null;
  }
  if (subscriber) {
    subscriber.removeAllListeners();
    subscriber.quit().catch(() => undefined);
    subscriber = null;
  }
}

function ensureRedis(config: ServiceConfig): void {
  if (inlineMode || publisher || subscriber) {
    return;
  }

  const connectionOptions = { maxRetriesPerRequest: null } as const;
  const redisUrl = config.redis.url;

  publisher = new IORedis(redisUrl, connectionOptions);
  publisher.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ECONNREFUSED')) {
      disableRedis('Redis unavailable for publisher');
      return;
    }
    console.error('[filestore:events] Redis publish error', err);
  });

  subscriber = new IORedis(redisUrl, connectionOptions);
  subscriber.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ECONNREFUSED')) {
      disableRedis('Redis unavailable for subscriber');
      return;
    }
    console.error('[filestore:events] Redis subscribe error', err);
  });

  subscriber.subscribe(channelName, (err) => {
    if (err) {
      console.error('[filestore:events] Failed to subscribe to channel', err);
      disableRedis('subscription error');
    }
  });

  subscriber.on('message', (_channel, message) => {
    try {
      const envelope = JSON.parse(message) as { origin?: string; event: FilestoreEvent };
      if (envelope.origin && envelope.origin === originId) {
        return;
      }
      if (envelope.event) {
        eventEmitter.emit('event', envelope.event);
      }
    } catch (err) {
      console.error('[filestore:events] Failed to parse event payload', err);
    }
  });
}

export async function initializeFilestoreEvents(options: { config: ServiceConfig }): Promise<void> {
  if (initialized) {
    return;
  }
  const { config } = options;
  configRef = config;
  inlineMode = resolveInlineMode(config);
  channelName = computeChannel(config);
  redisFailureNotified = false;

  if (!inlineMode) {
    ensureRedis(config);
  }

  commandListener = (payload: CommandCompletedEvent) => {
    void handleCommandCompleted(payload);
  };
  filestoreEvents.on('command.completed', commandListener);
  initialized = true;
}

export async function shutdownFilestoreEvents(): Promise<void> {
  if (commandListener) {
    filestoreEvents.off('command.completed', commandListener);
    commandListener = null;
  }
  if (subscriber) {
    try {
      subscriber.removeAllListeners();
      await subscriber.unsubscribe(channelName);
      await subscriber.quit();
    } catch (err) {
      console.error('[filestore:events] Failed to close subscriber', err);
    }
    subscriber = null;
  }
  if (publisher) {
    try {
      publisher.removeAllListeners();
      await publisher.quit();
    } catch (err) {
      console.error('[filestore:events] Failed to close publisher', err);
    }
    publisher = null;
  }
  initialized = false;
}

export function resetFilestoreEventsForTests(): void {
  initialized = false;
  inlineMode = true;
  channelName = 'apphub:filestore';
  redisFailureNotified = false;
  configRef = null;
  if (commandListener) {
    filestoreEvents.off('command.completed', commandListener);
    commandListener = null;
  }
  eventEmitter.removeAllListeners();
}

export function subscribeToFilestoreEvents(listener: FilestoreEventListener): () => void {
  eventEmitter.on('event', listener);
  return () => {
    eventEmitter.off('event', listener);
  };
}

export async function emitFilestoreEvent(event: FilestoreEvent): Promise<void> {
  eventEmitter.emit('event', event);
  if (inlineMode || !publisher) {
    return;
  }
  try {
    const envelope = JSON.stringify({ origin: originId, event });
    await publisher.publish(channelName, envelope);
  } catch (err) {
    console.error('[filestore:events] Failed to publish event', err);
    disableRedis('publish failure');
  }
}

export async function emitDriftDetectedEvent(payload: FilestoreDriftDetectedPayload): Promise<void> {
  await emitFilestoreEvent({ type: 'filestore.drift.detected', data: payload });
}

export function getFilestoreEventsMode(): 'inline' | 'redis' {
  return inlineMode ? 'inline' : 'redis';
}

export function getFilestoreEventsChannel(): string {
  return channelName;
}

export function getFilestoreEventsConfig(): ServiceConfig | null {
  return configRef;
}

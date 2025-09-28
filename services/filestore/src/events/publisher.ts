import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import IORedis, { type Redis } from 'ioredis';
import type { NodeRecord } from '../db/nodes';
import type { CommandCompletedEvent } from './bus';
import { filestoreEvents } from './bus';
import type { ServiceConfig } from '../config/serviceConfig';
import type {
  FilestoreEvent,
  FilestoreNodeEventPayload,
  FilestoreCommandCompletedPayload,
  FilestoreDriftDetectedPayload,
  FilestoreNodeDownloadedPayload,
  FilestoreNodeReconciledPayload,
  FilestoreNodeKind,
  FilestoreNodeState,
  FilestoreReconciliationJobEventPayload
} from '@apphub/shared/filestoreEvents';
import type { ReconciliationJobRecord } from '../db/reconciliationJobs';
import { createEventPublisher, type EventEnvelope, type JsonValue } from '@apphub/event-bus';
export type { FilestoreEvent } from '@apphub/shared/filestoreEvents';

export type FilestoreEventListener = (event: FilestoreEvent) => void | Promise<void>;

export type FilestoreEventSubscriptionOptions = {
  backendMountId?: number;
  pathPrefix?: string;
  eventTypes?: Iterable<FilestoreEvent['type']>;
};

const eventEmitter = new EventEmitter();
eventEmitter.setMaxListeners(0);

let initialized = false;
let inlineMode = true;
let channelName = 'apphub:filestore';
let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let configRef: ServiceConfig | null = null;
let commandListener: ((payload: CommandCompletedEvent) => void) | null = null;
let eventsReady = false;
let lastRedisError: string | null = null;
const originId = `${process.pid}:${randomUUID()}`;

function allowInlineMode(): boolean {
  const value = process.env.APPHUB_ALLOW_INLINE_MODE;
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function assertInlineAllowed(context: string): void {
  if (!allowInlineMode()) {
    throw new Error(`${context} requested inline mode but APPHUB_ALLOW_INLINE_MODE is not enabled`);
  }
}

function resolveInlineMode(config: ServiceConfig): boolean {
  const explicit = (process.env.FILESTORE_EVENTS_MODE ?? '').trim().toLowerCase();
  if (explicit === 'inline') {
    assertInlineAllowed('FILESTORE_EVENTS_MODE');
    return true;
  }
  if (explicit === 'redis') {
    return false;
  }
  if (config.events.mode === 'inline') {
    assertInlineAllowed('service configuration');
    return true;
  }
  return false;
}

function markEventsReady(): void {
  lastRedisError = null;
  eventsReady = true;
}

function recordRedisFailure(reason: string, err?: unknown): void {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : null;
  lastRedisError = message ? `${reason}: ${message}` : reason;
  eventsReady = false;
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

function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    const normalized: JsonValue[] = [];
    for (const entry of value) {
      const child = toJsonValue(entry);
      if (child !== undefined) {
        normalized.push(child);
      }
    }
    return normalized;
  }
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const child = toJsonValue(entry);
      if (child !== undefined) {
        result[key] = child;
      }
    }
    return result;
  }
  return undefined;
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
    (typeof result.kind === 'string' ? (result.kind as FilestoreNodeKind | 'unknown') : 'unknown');
  const state =
    node?.state ??
    (typeof result.state === 'string' ? (result.state as FilestoreNodeState | 'unknown') : 'unknown');
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
  switch (payload.command) {
    case 'deleteNode': {
      await emitFilestoreEvent({ type: 'filestore.node.deleted', data: nodePayload });
      return;
    }
    case 'createDirectory': {
      const version = nodePayload.version ?? 0;
      const eventType: FilestoreEvent['type'] = version > 1 ? 'filestore.node.updated' : 'filestore.node.created';
      await emitFilestoreEvent({ type: eventType, data: nodePayload });
      return;
    }
    case 'uploadFile': {
      const version = nodePayload.version ?? 0;
      const createdEvent: FilestoreEvent['type'] = version > 1 ? 'filestore.node.updated' : 'filestore.node.created';
      await emitFilestoreEvent({ type: createdEvent, data: nodePayload });
      await emitFilestoreEvent({ type: 'filestore.node.uploaded', data: nodePayload });
      return;
    }
    case 'writeFile': {
      await emitFilestoreEvent({ type: 'filestore.node.updated', data: nodePayload });
      await emitFilestoreEvent({ type: 'filestore.node.uploaded', data: nodePayload });
      return;
    }
    case 'copyNode': {
      await emitFilestoreEvent({ type: 'filestore.node.created', data: nodePayload });
      await emitFilestoreEvent({ type: 'filestore.node.copied', data: nodePayload });
      return;
    }
    case 'moveNode': {
      await emitFilestoreEvent({ type: 'filestore.node.updated', data: nodePayload });
      await emitFilestoreEvent({ type: 'filestore.node.moved', data: nodePayload });
      return;
    }
    case 'updateNodeMetadata': {
      await emitFilestoreEvent({ type: 'filestore.node.updated', data: nodePayload });
      return;
    }
    default:
      return;
  }
}

async function disposeRedisConnections(): Promise<void> {
  if (publisher) {
    publisher.removeAllListeners();
    try {
      await publisher.quit();
    } catch (err) {
      console.error('[filestore:events] Failed to close publisher connection', err);
    }
    publisher = null;
  }
  if (subscriber) {
    subscriber.removeAllListeners();
    try {
      await subscriber.unsubscribe(channelName);
    } catch (err) {
      console.error('[filestore:events] Failed to unsubscribe from channel', err);
    }
    try {
      await subscriber.quit();
    } catch (err) {
      console.error('[filestore:events] Failed to close subscriber connection', err);
    }
    subscriber = null;
  }
}

async function ensureRedis(config: ServiceConfig): Promise<void> {
  if (inlineMode) {
    markEventsReady();
    return;
  }

  if (publisher && subscriber) {
    return;
  }

  const connectionOptions = { maxRetriesPerRequest: null, lazyConnect: true } as const;
  const redisUrl = config.redis.url;

  const nextPublisher = new IORedis(redisUrl, connectionOptions);
  const nextSubscriber = new IORedis(redisUrl, connectionOptions);

  const handleError = (source: 'publisher' | 'subscriber') => (err: unknown) => {
    recordRedisFailure(`${source} error`, err);
    console.error(`[filestore:events] Redis ${source} error`, err);
  };

  const handleClose = (source: 'publisher' | 'subscriber') => () => {
    recordRedisFailure(`${source} connection closed`);
  };

  nextPublisher.on('error', handleError('publisher'));
  nextSubscriber.on('error', handleError('subscriber'));
  nextPublisher.on('end', handleClose('publisher'));
  nextSubscriber.on('end', handleClose('subscriber'));
  nextPublisher.on('close', handleClose('publisher'));
  nextSubscriber.on('close', handleClose('subscriber'));
  nextPublisher.on('ready', markEventsReady);
  nextSubscriber.on('ready', markEventsReady);

  try {
    if (nextPublisher.status !== 'ready') {
      await nextPublisher.connect();
    }
    if (nextSubscriber.status !== 'ready') {
      await nextSubscriber.connect();
    }

    await new Promise<void>((resolve, reject) => {
      nextSubscriber.subscribe(channelName, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    publisher = nextPublisher;
    subscriber = nextSubscriber;
    markEventsReady();

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
  } catch (err) {
    nextPublisher.removeAllListeners();
    nextSubscriber.removeAllListeners();
    try {
      await nextPublisher.quit();
    } catch (quitErr) {
      console.error('[filestore:events] Failed to close publisher after init error', quitErr);
    }
    try {
      await nextSubscriber.quit();
    } catch (quitErr) {
      console.error('[filestore:events] Failed to close subscriber after init error', quitErr);
    }
    recordRedisFailure('Redis initialisation failure', err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function initializeFilestoreEvents(options: { config: ServiceConfig }): Promise<void> {
  if (initialized) {
    return;
  }
  const { config } = options;
  configRef = config;
  inlineMode = resolveInlineMode(config);
  channelName = computeChannel(config);
  eventsReady = false;
  lastRedisError = null;

  await ensureRedis(config);

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
  eventsReady = inlineMode;
  await disposeRedisConnections();
  initialized = false;
}

export function resetFilestoreEventsForTests(): void {
  initialized = false;
  inlineMode = true;
  channelName = 'apphub:filestore';
  eventsReady = false;
  lastRedisError = null;
  void disposeRedisConnections();
  configRef = null;
  if (commandListener) {
    filestoreEvents.off('command.completed', commandListener);
    commandListener = null;
  }
  eventEmitter.removeAllListeners();
}

function toNormalizedPathPrefix(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

function extractBackendMountId(event: FilestoreEvent): number | null {
  const data = event.data as Record<string, unknown> | null | undefined;
  if (!data || typeof data !== 'object') {
    return null;
  }
  const candidate = data.backendMountId;
  return typeof candidate === 'number' ? candidate : null;
}

function extractPath(event: FilestoreEvent): string | null {
  const data = event.data as Record<string, unknown> | null | undefined;
  if (!data || typeof data !== 'object') {
    return null;
  }
  const candidate = data.path;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function buildEventFilter(
  options: FilestoreEventSubscriptionOptions | undefined
):
  | null
  | {
      backendMountId: number | null;
      pathPrefix: string | null;
      eventTypes: Set<FilestoreEvent['type']> | null;
    } {
  if (!options) {
    return null;
  }

  const backendMountId =
    typeof options.backendMountId === 'number' && Number.isFinite(options.backendMountId)
      ? options.backendMountId
      : null;
  const pathPrefix = toNormalizedPathPrefix(options.pathPrefix);
  let eventTypes: Set<FilestoreEvent['type']> | null = null;
  if (options.eventTypes) {
    eventTypes = new Set();
    for (const value of options.eventTypes) {
      if (typeof value === 'string' && value.startsWith('filestore.')) {
        eventTypes.add(value as FilestoreEvent['type']);
      }
    }
    if (eventTypes.size === 0) {
      eventTypes = null;
    }
  }

  if (backendMountId === null && pathPrefix === null && eventTypes === null) {
    return null;
  }

  return { backendMountId, pathPrefix, eventTypes };
}

function shouldDeliverEvent(
  event: FilestoreEvent,
  filter:
    | null
    | {
        backendMountId: number | null;
        pathPrefix: string | null;
        eventTypes: Set<FilestoreEvent['type']> | null;
      }
): boolean {
  if (!filter) {
    return true;
  }

  if (filter.eventTypes && !filter.eventTypes.has(event.type)) {
    return false;
  }

  if (filter.backendMountId !== null) {
    const backendMountId = extractBackendMountId(event);
    if (backendMountId !== filter.backendMountId) {
      return false;
    }
  }

  if (filter.pathPrefix !== null) {
    const path = extractPath(event);
    if (!path || !path.startsWith(filter.pathPrefix)) {
      return false;
    }
  }

  return true;
}

export function subscribeToFilestoreEvents(
  listener: FilestoreEventListener,
  options?: FilestoreEventSubscriptionOptions
): () => void {
  const filter = buildEventFilter(options);
  const wrappedListener: FilestoreEventListener = (event) => {
    if (!shouldDeliverEvent(event, filter)) {
      return undefined;
    }
    return listener(event);
  };

  eventEmitter.on('event', wrappedListener);
  return () => {
    eventEmitter.off('event', wrappedListener);
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
    recordRedisFailure('publish failure', err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function emitDriftDetectedEvent(payload: FilestoreDriftDetectedPayload): Promise<void> {
  await emitFilestoreEvent({ type: 'filestore.drift.detected', data: payload });
}

export async function emitNodeReconciledEvent(payload: FilestoreNodeReconciledPayload): Promise<void> {
  await emitFilestoreEvent({ type: 'filestore.node.reconciled', data: payload });
}

export async function emitNodeMissingEvent(payload: FilestoreNodeReconciledPayload): Promise<void> {
  await emitFilestoreEvent({ type: 'filestore.node.missing', data: payload });
}

export async function emitNodeDownloadedEvent(payload: FilestoreNodeDownloadedPayload): Promise<void> {
  await emitFilestoreEvent({ type: 'filestore.node.downloaded', data: payload });
}

function formatDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function serializeReconciliationJob(
  record: ReconciliationJobRecord
): FilestoreReconciliationJobEventPayload {
  return {
    id: record.id,
    jobKey: record.jobKey,
    backendMountId: record.backendMountId,
    nodeId: record.nodeId,
    path: record.path,
    reason: record.reason,
    status: record.status,
    detectChildren: record.detectChildren,
    requestedHash: record.requestedHash,
    attempt: record.attempt,
    result: record.result ?? null,
    error: record.error ?? null,
    enqueuedAt: record.enqueuedAt.toISOString(),
    startedAt: formatDate(record.startedAt),
    completedAt: formatDate(record.completedAt),
    durationMs: record.durationMs ?? null,
    updatedAt: record.updatedAt.toISOString()
  } satisfies FilestoreReconciliationJobEventPayload;
}

async function emitReconciliationJobEvent(
  type:
    | 'filestore.reconciliation.job.queued'
    | 'filestore.reconciliation.job.started'
    | 'filestore.reconciliation.job.completed'
    | 'filestore.reconciliation.job.failed'
    | 'filestore.reconciliation.job.cancelled',
  record: ReconciliationJobRecord
): Promise<void> {
  await emitFilestoreEvent({ type, data: serializeReconciliationJob(record) });
}

export async function emitReconciliationJobQueuedEvent(record: ReconciliationJobRecord): Promise<void> {
  await emitReconciliationJobEvent('filestore.reconciliation.job.queued', record);
}

export async function emitReconciliationJobStartedEvent(record: ReconciliationJobRecord): Promise<void> {
  await emitReconciliationJobEvent('filestore.reconciliation.job.started', record);
}

export async function emitReconciliationJobCompletedEvent(record: ReconciliationJobRecord): Promise<void> {
  await emitReconciliationJobEvent('filestore.reconciliation.job.completed', record);
}

export async function emitReconciliationJobFailedEvent(record: ReconciliationJobRecord): Promise<void> {
  await emitReconciliationJobEvent('filestore.reconciliation.job.failed', record);
}

export async function emitReconciliationJobCancelledEvent(record: ReconciliationJobRecord): Promise<void> {
  await emitReconciliationJobEvent('filestore.reconciliation.job.cancelled', record);
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

export function isFilestoreEventsReady(): boolean {
  return inlineMode ? true : eventsReady;
}

export function getFilestoreEventsHealth(): {
  mode: 'inline' | 'redis';
  ready: boolean;
  lastError: string | null;
} {
  return {
    mode: getFilestoreEventsMode(),
    ready: isFilestoreEventsReady(),
    lastError: inlineMode ? null : lastRedisError
  };
}

const DEFAULT_SOURCE = process.env.FILESTORE_EVENT_SOURCE ?? 'filestore.service';
let publisherHandle: ReturnType<typeof createEventPublisher> | null = null;

function getPublisher() {
  if (!publisherHandle) {
    publisherHandle = createEventPublisher();
  }
  return publisherHandle;
}

export async function publishFilestoreEvent(
  type: string,
  payload: Record<string, unknown>,
  source: string = DEFAULT_SOURCE
): Promise<EventEnvelope> {
  const publisher = getPublisher();
  const normalizedPayload = toJsonValue(payload);
  const payloadObject =
    normalizedPayload && typeof normalizedPayload === 'object' && !Array.isArray(normalizedPayload)
      ? (normalizedPayload as Record<string, JsonValue>)
      : {};
  return publisher.publish({
    type,
    source,
    payload: payloadObject
  });
}

export async function closeFilestoreEventPublisher(): Promise<void> {
  if (publisherHandle) {
    await publisherHandle.close();
    publisherHandle = null;
  }
}

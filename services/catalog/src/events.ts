import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import IORedis, { type Redis } from 'ioredis';
import type {
  BuildRecord,
  IngestionEvent,
  JobDefinitionRecord,
  JobRunRecord,
  LaunchRecord,
  RepositoryRecord,
  ServiceRecord,
  JobBundleRecord,
  JobBundleVersionRecord,
  WorkflowDefinitionRecord,
  WorkflowRunRecord
} from './db/index';

export type ApphubEvent =
  | { type: 'repository.updated'; data: { repository: RepositoryRecord } }
  | { type: 'repository.ingestion-event'; data: { event: IngestionEvent } }
  | { type: 'build.updated'; data: { build: BuildRecord } }
  | { type: 'launch.updated'; data: { launch: LaunchRecord } }
  | { type: 'service.updated'; data: { service: ServiceRecord } }
  | { type: 'job.definition.updated'; data: { job: JobDefinitionRecord } }
  | { type: 'job.run.updated'; data: { run: JobRunRecord } }
  | { type: 'job.run.pending'; data: { run: JobRunRecord } }
  | { type: 'job.run.running'; data: { run: JobRunRecord } }
  | { type: 'job.run.succeeded'; data: { run: JobRunRecord } }
  | { type: 'job.run.failed'; data: { run: JobRunRecord } }
  | { type: 'job.run.canceled'; data: { run: JobRunRecord } }
  | { type: 'job.run.expired'; data: { run: JobRunRecord } }
  | { type: 'job.bundle.published'; data: { bundle: JobBundleRecord; version: JobBundleVersionRecord } }
  | { type: 'job.bundle.updated'; data: { bundle: JobBundleRecord; version: JobBundleVersionRecord } }
  | { type: 'job.bundle.deprecated'; data: { bundle: JobBundleRecord; version: JobBundleVersionRecord } }
  | { type: 'workflow.definition.updated'; data: { workflow: WorkflowDefinitionRecord } }
  | { type: 'workflow.run.updated'; data: { run: WorkflowRunRecord } }
  | { type: 'workflow.run.pending'; data: { run: WorkflowRunRecord } }
  | { type: 'workflow.run.running'; data: { run: WorkflowRunRecord } }
  | { type: 'workflow.run.succeeded'; data: { run: WorkflowRunRecord } }
  | { type: 'workflow.run.failed'; data: { run: WorkflowRunRecord } }
  | { type: 'workflow.run.canceled'; data: { run: WorkflowRunRecord } };

type EventEnvelope = {
  origin: string;
  event: ApphubEvent;
};

const bus = new EventEmitter();
bus.setMaxListeners(0);

const configuredMode = process.env.APPHUB_EVENTS_MODE;
const envRedisUrl = process.env.REDIS_URL;

let inlineMode: boolean;
if (configuredMode === 'inline') {
  inlineMode = true;
} else if (configuredMode === 'redis') {
  inlineMode = false;
} else {
  inlineMode = envRedisUrl === 'inline';
}

const redisUrl = inlineMode ? null : envRedisUrl ?? 'redis://127.0.0.1:6379';
const eventChannel = process.env.APPHUB_EVENTS_CHANNEL ?? 'apphub:events';
const originId = `${process.pid}:${randomUUID()}`;

let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let redisFailureNotified = false;

function disableRedisEvents(reason: string) {
  if (inlineMode) {
    return;
  }
  inlineMode = true;
  if (!redisFailureNotified) {
    console.warn(`[events] Falling back to inline mode: ${reason}`);
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

if (!inlineMode && redisUrl) {
  const connectionOptions = { maxRetriesPerRequest: null } as const;

  publisher = new IORedis(redisUrl, connectionOptions);
  publisher.on('error', (err) => {
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : String(err);
    if (code === 'ECONNREFUSED' || message.includes('ECONNREFUSED')) {
      disableRedisEvents('Redis unavailable');
      return;
    }
    console.error('[events] Redis publish error', err);
  });

  subscriber = new IORedis(redisUrl, connectionOptions);
  subscriber.on('error', (err) => {
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : String(err);
    if (code === 'ECONNREFUSED' || message.includes('ECONNREFUSED')) {
      disableRedisEvents('Redis unavailable');
      return;
    }
    console.error('[events] Redis subscribe error', err);
  });

  subscriber
    .subscribe(eventChannel)
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      disableRedisEvents(`Failed to subscribe to Redis channel: ${message}`);
    });

  subscriber.on('message', (_channel, payload) => {
    if (inlineMode) {
      return;
    }
    try {
      const envelope = JSON.parse(payload) as Partial<EventEnvelope>;
      if (!envelope || !envelope.event) {
        return;
      }
      if (envelope.origin === originId) {
        return;
      }
      bus.emit('apphub:event', envelope.event);
    } catch (err) {
      console.error('[events] Failed to parse published event', err);
    }
  });
} else {
  inlineMode = true;
}

export function emitApphubEvent(event: ApphubEvent) {
  bus.emit('apphub:event', event);

  if (inlineMode || !publisher) {
    return;
  }

  const payload: EventEnvelope = { origin: originId, event };
  publisher.publish(eventChannel, JSON.stringify(payload)).catch((err) => {
    console.error('[events] Failed to publish event', err);
  });
}

export function subscribeToApphubEvents(listener: (event: ApphubEvent) => void) {
  bus.on('apphub:event', listener);
  return () => bus.off('apphub:event', listener);
}

export function onceApphubEvent(listener: (event: ApphubEvent) => void) {
  bus.once('apphub:event', listener);
}

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import IORedis, { type Redis } from 'ioredis';
import type { BuildRecord, IngestionEvent, LaunchRecord, RepositoryRecord } from './db';

export type ApphubEvent =
  | { type: 'repository.updated'; data: { repository: RepositoryRecord } }
  | { type: 'repository.ingestion-event'; data: { event: IngestionEvent } }
  | { type: 'build.updated'; data: { build: BuildRecord } }
  | { type: 'launch.updated'; data: { launch: LaunchRecord } };

type EventEnvelope = {
  origin: string;
  event: ApphubEvent;
};

const bus = new EventEmitter();
bus.setMaxListeners(0);

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const inlineMode = redisUrl === 'inline';
const eventChannel = process.env.APPHUB_EVENTS_CHANNEL ?? 'apphub:events';
const originId = `${process.pid}:${randomUUID()}`;

let publisher: Redis | null = null;
let subscriber: Redis | null = null;

if (!inlineMode) {
  publisher = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  publisher.on('error', (err) => {
    console.error('[events] Redis publish error', err);
  });

  subscriber = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  subscriber.on('error', (err) => {
    console.error('[events] Redis subscribe error', err);
  });

  subscriber.subscribe(eventChannel).catch((err) => {
    console.error('[events] Failed to subscribe to channel', err);
  });

  subscriber.on('message', (_channel, payload) => {
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

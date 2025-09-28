import { EventEmitter } from 'node:events';

export type RecordStreamAction = 'created' | 'updated' | 'deleted';

export type RecordStreamEvent = {
  id: string;
  action: RecordStreamAction;
  namespace: string;
  key: string;
  version: number | null;
  occurredAt: string;
  updatedAt: string | null;
  deletedAt: string | null;
  actor: string | null;
  mode?: 'soft' | 'hard';
};

export type RecordStreamListener = (event: RecordStreamEvent) => void;

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

let nextId = 0;
let subscriberCount = 0;

function toDeliveredEvent(event: Omit<RecordStreamEvent, 'id'>): RecordStreamEvent {
  nextId += 1;
  return { ...event, id: String(nextId) } satisfies RecordStreamEvent;
}

export function emitRecordStreamEvent(event: Omit<RecordStreamEvent, 'id'>): RecordStreamEvent {
  const delivered = toDeliveredEvent(event);
  emitter.emit('event', delivered);
  return delivered;
}

export function subscribeToRecordStream(listener: RecordStreamListener): () => void {
  subscriberCount += 1;
  emitter.on('event', listener);
  let active = true;
  return () => {
    if (!active) {
      return;
    }
    active = false;
    emitter.off('event', listener);
    subscriberCount = Math.max(0, subscriberCount - 1);
  };
}

export function getRecordStreamSubscriberCount(): number {
  return subscriberCount;
}

export function formatRecordStreamEventFrame(event: RecordStreamEvent): string {
  const payload = JSON.stringify({
    action: event.action,
    namespace: event.namespace,
    key: event.key,
    version: event.version,
    occurredAt: event.occurredAt,
    updatedAt: event.updatedAt,
    deletedAt: event.deletedAt,
    actor: event.actor,
    mode: event.mode ?? undefined
  });
  const type = `metastore.record.${event.action}`;
  return `event: ${type}\n` + `id: ${event.id}\n` + `data: ${payload}\n\n`;
}

export function formatRecordStreamComment(comment: string): string {
  return `:${comment}\n\n`;
}

import { createEventPublisher, type EventEnvelope, type JsonValue } from '@apphub/event-bus';

const DEFAULT_SOURCE = process.env.METASTORE_EVENT_SOURCE ?? 'metastore.api';
let publisherHandle: ReturnType<typeof createEventPublisher> | null = null;

function getPublisher() {
  if (!publisherHandle) {
    publisherHandle = createEventPublisher();
  }
  return publisherHandle;
}

export async function publishMetastoreEvent(
  type: string,
  payload: Record<string, unknown>
): Promise<EventEnvelope> {
  const publisher = getPublisher();
  return publisher.publish({
    type,
    source: DEFAULT_SOURCE,
    payload: payload as Record<string, JsonValue>
  });
}

export async function closeMetastoreEventPublisher(): Promise<void> {
  if (publisherHandle) {
    await publisherHandle.close();
    publisherHandle = null;
  }
}

export async function publishMetastoreRecordEvent(
  action: 'created' | 'updated' | 'deleted',
  payload: Record<string, unknown>
): Promise<EventEnvelope> {
  return publishMetastoreEvent(`metastore.record.${action}`, payload);
}

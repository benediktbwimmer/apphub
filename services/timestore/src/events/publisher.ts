import { createEventPublisher, type EventEnvelope, type JsonValue } from '@apphub/event-bus';

const DEFAULT_SOURCE = process.env.TIMESTORE_EVENT_SOURCE ?? 'timestore.service';
let publisherHandle: ReturnType<typeof createEventPublisher> | null = null;

function getPublisher() {
  if (!publisherHandle) {
    publisherHandle = createEventPublisher();
  }
  return publisherHandle;
}

export async function publishTimestoreEvent(
  type: string,
  payload: Record<string, unknown>,
  source: string = DEFAULT_SOURCE
): Promise<EventEnvelope> {
  const publisher = getPublisher();
  return publisher.publish({
    type,
    source,
    payload: payload as Record<string, JsonValue>
  });
}

export async function closeTimestoreEventPublisher(): Promise<void> {
  if (publisherHandle) {
    await publisherHandle.close();
    publisherHandle = null;
  }
}

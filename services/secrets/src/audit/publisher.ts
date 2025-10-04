import { createEventPublisher, type EventEnvelope } from '@apphub/event-bus';
import type { JsonValue } from '@apphub/shared';
import type { SecretAuditEvent, SecretTokenAuditEvent } from '../types';

const DEFAULT_SOURCE = process.env.SECRETS_SERVICE_AUDIT_SOURCE?.trim() || 'secrets.api';

let publisherHandle: ReturnType<typeof createEventPublisher> | null = null;

function getPublisher() {
  if (!publisherHandle) {
    publisherHandle = createEventPublisher();
  }
  return publisherHandle;
}

export async function publishSecretAuditEvent(event: SecretAuditEvent): Promise<EventEnvelope> {
  const publisher = getPublisher();
  return publisher.publish({
    type: event.type,
    source: DEFAULT_SOURCE,
    payload: event as unknown as Record<string, JsonValue>
  });
}

export async function publishSecretTokenEvent(event: SecretTokenAuditEvent): Promise<EventEnvelope> {
  const publisher = getPublisher();
  return publisher.publish({
    type: event.type,
    source: DEFAULT_SOURCE,
    payload: event as unknown as Record<string, JsonValue>
  });
}

export async function closeAuditPublisher(): Promise<void> {
  if (!publisherHandle) {
    return;
  }
  await publisherHandle.close();
  publisherHandle = null;
}

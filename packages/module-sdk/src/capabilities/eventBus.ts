import { httpRequest, type FetchLike, type TokenProvider } from '../internal/http';

export interface EventBusCapabilityConfig {
  baseUrl: string;
  token?: TokenProvider;
  fetchImpl?: FetchLike;
}

export interface PublishEventInput {
  type: string;
  payload: Record<string, unknown>;
  occurredAt?: string | Date;
  metadata?: Record<string, unknown>;
  correlationId?: string;
  ttlSeconds?: number;
  principal?: string;
  idempotencyKey?: string;
}

export interface EventBusCapability {
  publish(input: PublishEventInput): Promise<void>;
}

function normalizeOccurredAt(value: PublishEventInput['occurredAt']): string | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  return value.toISOString();
}

export function createEventBusCapability(config: EventBusCapabilityConfig): EventBusCapability {
  return {
    async publish(input: PublishEventInput): Promise<void> {
      await httpRequest({
        baseUrl: config.baseUrl,
        path: '/v1/events',
        method: 'POST',
        authToken: config.token,
        principal: input.principal,
        idempotencyKey: input.idempotencyKey,
        fetchImpl: config.fetchImpl,
        body: {
          type: input.type,
          payload: input.payload,
          occurredAt: normalizeOccurredAt(input.occurredAt),
          metadata: input.metadata,
          correlationId: input.correlationId,
          ttlSeconds: input.ttlSeconds
        },
        expectJson: true
      });
    }
  } satisfies EventBusCapability;
}

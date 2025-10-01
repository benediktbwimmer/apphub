import { httpRequest, type FetchLike, type TokenProvider } from '../internal/http';

export interface EventBusCapabilityConfig {
  baseUrl: string;
  token?: TokenProvider;
  fetchImpl?: FetchLike;
  defaultSource?: string;
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
  source?: string;
  id?: string;
}

export interface EventBusCapability {
  publish(input: PublishEventInput): Promise<void>;
  close(): Promise<void>;
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
          id: input.id,
          type: input.type,
          payload: input.payload,
          occurredAt: normalizeOccurredAt(input.occurredAt),
          metadata: input.metadata,
          correlationId: input.correlationId,
          ttlSeconds: input.ttlSeconds,
          source: input.source ?? config.defaultSource
        },
        expectJson: true
      });
    },

    async close(): Promise<void> {
      // HTTP implementation maintains no persistent connection, so closing is a no-op.
    }
  } satisfies EventBusCapability;
}

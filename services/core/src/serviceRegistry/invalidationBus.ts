import { EventEmitter } from 'node:events';
import IORedis, { type Redis } from 'ioredis';
import type { ModuleResourceType } from '../db/types';

const INVALIDATION_CHANNEL = 'service-registry:invalidate';

const emitter = new EventEmitter();

type ServiceRegistryInvalidationSource = 'local' | 'remote';

type ManifestInvalidationMessage = {
  kind: 'manifest';
  reason: string;
  moduleId?: string | null;
};

type HealthInvalidationMessage = {
  kind: 'health';
  reason: string;
  slug?: string | null;
};

type ModuleContextInvalidationMessage = {
  kind: 'module-context';
  moduleId: string;
  moduleVersion?: string | null;
  resourceType: ModuleResourceType;
  resourceId: string;
  resourceSlug?: string | null;
  resourceName?: string | null;
  action: 'upsert' | 'delete';
};

export type ServiceRegistryInvalidationMessage =
  | ManifestInvalidationMessage
  | HealthInvalidationMessage
  | ModuleContextInvalidationMessage;

type InternalInvalidationPayload = {
  message: ServiceRegistryInvalidationMessage;
  source: ServiceRegistryInvalidationSource;
};

let redisPublisher: Redis | null = null;
let redisSubscriber: Redis | null = null;
let redisSubscriptionActive = false;
let redisConnectionPromise: Promise<void> | null = null;

function normalize(value: string | undefined | null): string | undefined {
  return value ? value.trim() : undefined;
}

function isInlineMode(): boolean {
  const redisUrl = normalize(process.env.REDIS_URL);
  if (redisUrl && redisUrl.toLowerCase() === 'inline') {
    return true;
  }
  const eventsMode = normalize(process.env.APPHUB_EVENTS_MODE);
  return Boolean(eventsMode && eventsMode.toLowerCase() === 'inline');
}

function resolveRedisUrl(): string {
  const redisUrl = normalize(process.env.REDIS_URL);
  if (!redisUrl || redisUrl.toLowerCase() === 'inline') {
    return 'redis://127.0.0.1:6379';
  }
  return redisUrl;
}

function emitInvalidation(message: ServiceRegistryInvalidationMessage, source: ServiceRegistryInvalidationSource): void {
  emitter.emit('invalidate', { message, source } satisfies InternalInvalidationPayload);
}

async function ensureRedisConnections(): Promise<void> {
  if (isInlineMode()) {
    redisPublisher = null;
    if (redisSubscriber) {
      redisSubscriber.disconnect();
      redisSubscriber = null;
    }
    redisSubscriptionActive = false;
    redisConnectionPromise = null;
    return;
  }

  if (redisSubscriptionActive && redisPublisher && redisSubscriber) {
    return;
  }

  if (redisConnectionPromise) {
    await redisConnectionPromise;
    return;
  }

  redisConnectionPromise = (async () => {
    const url = resolveRedisUrl();

    if (!redisPublisher) {
      const publisher = new IORedis(url, { maxRetriesPerRequest: null });
      publisher.on('error', (err) => {
        console.error('[service-registry:invalidate] redis publish error', err);
      });
      redisPublisher = publisher;
    }

    if (!redisSubscriber) {
      const subscriber = new IORedis(url, { maxRetriesPerRequest: null });
      subscriber.on('message', (_channel, payload) => {
        try {
          const parsed = JSON.parse(payload) as ServiceRegistryInvalidationMessage;
          emitInvalidation(parsed, 'remote');
        } catch (err) {
          console.error('[service-registry:invalidate] failed to parse invalidation payload', err);
        }
      });
      subscriber.on('error', (err) => {
        console.error('[service-registry:invalidate] redis subscribe error', err);
      });
      await subscriber.subscribe(INVALIDATION_CHANNEL);
      redisSubscriber = subscriber;
      redisSubscriptionActive = true;
    }
  })();

  try {
    await redisConnectionPromise;
  } finally {
    redisConnectionPromise = null;
  }
}

export function subscribeToServiceRegistryInvalidations(
  listener: (message: ServiceRegistryInvalidationMessage, source: ServiceRegistryInvalidationSource) => void
): () => void {
  const handler = (payload: InternalInvalidationPayload) => {
    listener(payload.message, payload.source);
  };

  emitter.on('invalidate', handler);

  void ensureRedisConnections();

  return () => {
    emitter.off('invalidate', handler);
  };
}

export async function publishServiceRegistryInvalidation(
  message: ServiceRegistryInvalidationMessage,
  options: { skipLocal?: boolean } = {}
): Promise<void> {
  if (!options.skipLocal) {
    emitInvalidation(message, 'local');
  }

  if (isInlineMode()) {
    return;
  }

  try {
    await ensureRedisConnections();
    if (redisPublisher) {
      await redisPublisher.publish(INVALIDATION_CHANNEL, JSON.stringify(message));
    }
  } catch (err) {
    console.error('[service-registry:invalidate] failed to publish invalidation', err);
  }
}

import IORedis, { type Redis } from 'ioredis';
import type { RuntimeScalingTargetKey } from './targets';

export type RuntimeScalingUpdateMessage = {
  type: 'policy:update';
  target: RuntimeScalingTargetKey;
  desiredConcurrency?: number;
  updatedAt?: string;
};

export type RuntimeScalingSyncRequest = {
  type: 'policy:sync-request';
  target?: RuntimeScalingTargetKey;
  requestedAt?: string;
};

export type RuntimeScalingMessage = RuntimeScalingUpdateMessage | RuntimeScalingSyncRequest;

const CHANNEL = process.env.RUNTIME_SCALING_CHANNEL ?? 'apphub:runtime-scaling';

let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let initializingSubscriber: Promise<void> | null = null;

const listeners = new Set<(message: RuntimeScalingMessage) => void>();

function getRedisUrl(): string | null {
  const raw = process.env.REDIS_URL;
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.toLowerCase() === 'inline') {
    return null;
  }
  return trimmed;
}

function createRedisClient(): Redis | null {
  const url = getRedisUrl();
  if (!url) {
    return null;
  }
  const instance = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
  instance.on('error', (err) => {
    console.error('[runtime-scaling] Redis connection error', err);
  });
  return instance;
}

async function ensurePublisher(): Promise<Redis | null> {
  if (publisher) {
    return publisher;
  }
  publisher = createRedisClient();
  if (!publisher) {
    return null;
  }
  try {
    await publisher.connect();
    return publisher;
  } catch (err) {
    console.error('[runtime-scaling] Failed to connect Redis publisher', err);
    publisher.quit().catch(() => undefined);
    publisher = null;
    return null;
  }
}

async function ensureSubscriber(): Promise<void> {
  if (subscriber) {
    return;
  }
  if (initializingSubscriber) {
    await initializingSubscriber;
    return;
  }
  const instance = createRedisClient();
  if (!instance) {
    return;
  }
  initializingSubscriber = (async () => {
    try {
      await instance.connect();
      await instance.subscribe(CHANNEL);
      instance.on('message', (_channel, payload) => {
        handleIncomingMessage(payload);
      });
      subscriber = instance;
    } catch (err) {
      console.error('[runtime-scaling] Failed to subscribe to Redis channel', err);
      instance.quit().catch(() => undefined);
    } finally {
      initializingSubscriber = null;
    }
  })();
  await initializingSubscriber;
}

function handleIncomingMessage(payload: string): void {
  try {
    const parsed = JSON.parse(payload) as RuntimeScalingMessage;
    if (!parsed || typeof parsed !== 'object' || parsed === null) {
      return;
    }
    if (parsed.type === 'policy:update') {
      if (typeof parsed.target !== 'string') {
        return;
      }
      for (const listener of listeners) {
        listener({
          type: 'policy:update',
          target: parsed.target as RuntimeScalingTargetKey,
          desiredConcurrency: typeof parsed.desiredConcurrency === 'number' ? parsed.desiredConcurrency : undefined,
          updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString()
        });
      }
      return;
    }
    if (parsed.type === 'policy:sync-request') {
      for (const listener of listeners) {
        listener({
          type: 'policy:sync-request',
          target: parsed.target as RuntimeScalingTargetKey | undefined,
          requestedAt: typeof parsed.requestedAt === 'string' ? parsed.requestedAt : new Date().toISOString()
        });
      }
    }
  } catch (err) {
    console.error('[runtime-scaling] Failed to parse runtime scaling message', err);
  }
}

export async function publishRuntimeScalingUpdate(message: RuntimeScalingUpdateMessage): Promise<void> {
  const client = await ensurePublisher();
  if (!client) {
    return;
  }
  const payload = JSON.stringify({ ...message, updatedAt: message.updatedAt ?? new Date().toISOString() });
  try {
    await client.publish(CHANNEL, payload);
  } catch (err) {
    console.error('[runtime-scaling] Failed to publish scaling update', err);
  }
}

export async function publishRuntimeScalingSyncRequest(
  message: RuntimeScalingSyncRequest
): Promise<void> {
  const client = await ensurePublisher();
  if (!client) {
    return;
  }
  const payload = JSON.stringify({
    type: 'policy:sync-request',
    target: message.target,
    requestedAt: message.requestedAt ?? new Date().toISOString()
  });
  try {
    await client.publish(CHANNEL, payload);
  } catch (err) {
    console.error('[runtime-scaling] Failed to publish scaling sync request', err);
  }
}

export async function subscribeToRuntimeScalingUpdates(
  listener: (message: RuntimeScalingMessage) => void
): Promise<() => void> {
  listeners.add(listener);
  await ensureSubscriber();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && subscriber) {
      subscriber.unsubscribe(CHANNEL).catch(() => undefined);
    }
  };
}

export async function closeRuntimeScalingChannels(): Promise<void> {
  if (publisher) {
    await publisher.quit().catch(() => undefined);
    publisher = null;
  }
  if (subscriber) {
    subscriber.removeAllListeners('message');
    await subscriber.quit().catch(() => undefined);
    subscriber = null;
  }
}

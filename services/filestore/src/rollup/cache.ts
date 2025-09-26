import IORedis, { type Redis } from 'ioredis';
import type { RollupSummary } from './types';
import type { RollupMetrics } from './metrics';

export interface RollupCacheOptions {
  ttlSeconds: number;
  maxEntries: number;
  redisUrl: string;
  keyPrefix: string;
  inlineMode: boolean;
  metrics: RollupMetrics;
}

type LocalEntry = {
  summary: RollupSummary;
  expiresAt: number;
};

export interface RollupCache {
  get(nodeId: number): Promise<RollupSummary | null>;
  set(summary: RollupSummary): Promise<void>;
  invalidate(nodeId: number, publish?: boolean): Promise<void>;
  shutdown(): Promise<void>;
}

const INVALIDATE_CHANNEL_SUFFIX = 'rollup:invalidate';

function serialize(summary: RollupSummary) {
  return JSON.stringify({
    ...summary,
    lastCalculatedAt: summary.lastCalculatedAt ? summary.lastCalculatedAt.toISOString() : null
  });
}

function deserialize(payload: string): RollupSummary {
  const parsed = JSON.parse(payload) as Omit<RollupSummary, 'lastCalculatedAt'> & {
    lastCalculatedAt: string | null;
  };
  return {
    ...parsed,
    lastCalculatedAt: parsed.lastCalculatedAt ? new Date(parsed.lastCalculatedAt) : null
  };
}

function buildKey(prefix: string, nodeId: number): string {
  return `${prefix}:rollup:${nodeId}`;
}

function buildChannel(prefix: string): string {
  return `${prefix}:${INVALIDATE_CHANNEL_SUFFIX}`;
}

export function createRollupCache(options: RollupCacheOptions): RollupCache {
  const local = new Map<number, LocalEntry>();
  const ttlMs = options.ttlSeconds * 1000;
  let redisClient: Redis | null = null;
  let redisSubscriber: Redis | null = null;
  const channel = buildChannel(options.keyPrefix);

  function evictIfNeeded(): void {
    if (local.size <= options.maxEntries) {
      return;
    }
    const iterator = local.keys();
    const toDelete = iterator.next();
    if (!toDelete.done) {
      local.delete(toDelete.value);
    }
  }

  function registerSubscriber(): void {
    if (options.inlineMode || redisSubscriber) {
      return;
    }
    if (!redisClient) {
      return;
    }
    redisSubscriber = redisClient.duplicate();
    void redisSubscriber.subscribe(channel, (err) => {
      if (err) {
        console.error('[filestore:rollup-cache] Failed to subscribe for invalidation', err);
        return;
      }
    });
    redisSubscriber.on('message', (_channel, message) => {
      const nodeId = Number(message);
      if (Number.isFinite(nodeId)) {
        local.delete(nodeId);
      }
    });
  }

  if (!options.inlineMode) {
    redisClient = new IORedis(options.redisUrl, {
      maxRetriesPerRequest: null
    });
    redisClient.on('error', (err) => {
      console.error('[filestore:rollup-cache] Redis error', err);
    });
    registerSubscriber();
  }

  async function getFromRedis(nodeId: number): Promise<RollupSummary | null> {
    if (!redisClient) {
      return null;
    }
    const key = buildKey(options.keyPrefix, nodeId);
    const payload = await redisClient.get(key);
    if (!payload) {
      options.metrics.recordCacheMiss('redis');
      return null;
    }
    options.metrics.recordCacheHit('redis');
    const summary = deserialize(payload);
    local.set(nodeId, { summary, expiresAt: Date.now() + ttlMs });
    evictIfNeeded();
    return summary;
  }

  return {
    async get(nodeId: number): Promise<RollupSummary | null> {
      const entry = local.get(nodeId);
      if (entry && entry.expiresAt > Date.now()) {
        options.metrics.recordCacheHit('local');
        return entry.summary;
      }
      if (entry) {
        local.delete(nodeId);
      }
      options.metrics.recordCacheMiss('local');
      if (options.inlineMode) {
        return null;
      }
      return getFromRedis(nodeId);
    },
    async set(summary: RollupSummary): Promise<void> {
      local.set(summary.nodeId, { summary, expiresAt: Date.now() + ttlMs });
      evictIfNeeded();
      if (options.inlineMode || !redisClient) {
        return;
      }
      const key = buildKey(options.keyPrefix, summary.nodeId);
      await redisClient.set(key, serialize(summary), 'EX', options.ttlSeconds);
    },
    async invalidate(nodeId: number, publish = true): Promise<void> {
      local.delete(nodeId);
      if (options.inlineMode || !redisClient) {
        return;
      }
      const key = buildKey(options.keyPrefix, nodeId);
      await redisClient.del(key);
      if (publish) {
        await redisClient.publish(channel, String(nodeId));
      }
    },
    async shutdown(): Promise<void> {
      if (redisSubscriber) {
        try {
          await redisSubscriber.unsubscribe(channel);
        } catch (err) {
          console.error('[filestore:rollup-cache] Failed to unsubscribe', err);
        }
        try {
          await redisSubscriber.quit();
        } catch {
          // ignore
        }
        redisSubscriber = null;
      }
      if (redisClient) {
        try {
          await redisClient.quit();
        } catch {
          // ignore
        }
        redisClient = null;
      }
      local.clear();
    }
  };
}

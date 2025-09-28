import type { FastifyBaseLogger } from 'fastify';
import { withConnection } from '../db/client';
import type { MetastoreMetrics } from '../plugins/metrics';
import { getSchemaDefinition, upsertSchemaDefinition, type SchemaUpsertResult } from './repository';
import type {
  SchemaDefinition,
  SchemaDefinitionInput,
  SchemaFetchResult,
  SchemaRegistryConfig
} from './types';

const DEFAULT_CONFIG: SchemaRegistryConfig = {
  ttlMs: 5 * 60_000,
  refreshAheadMs: 60_000,
  refreshIntervalMs: 30_000,
  negativeTtlMs: 60_000
};

type CacheEntry =
  | {
      kind: 'hit';
      value: SchemaDefinition;
      expiresAt: number;
      refreshAt: number;
      refreshing: boolean;
    }
  | {
      kind: 'miss';
      value: null;
      expiresAt: number;
      refreshing: false;
    };

type LoadOutcome = {
  definition: SchemaDefinition | null;
  initiated: boolean;
};

type FetchOptions = {
  logger?: FastifyBaseLogger;
  metrics?: MetastoreMetrics;
};

type LoadOptions = {
  allowNegativeCache?: boolean;
};

let config: SchemaRegistryConfig = { ...DEFAULT_CONFIG };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<SchemaDefinition | null>>();
let refreshTimer: NodeJS.Timeout | null = null;

function effectiveTtlMs(): number {
  return Math.max(0, config.ttlMs);
}

function effectiveNegativeTtlMs(): number {
  const candidate = Math.max(0, config.negativeTtlMs);
  if (candidate === 0 && effectiveTtlMs() > 0) {
    return Math.min(30_000, effectiveTtlMs());
  }
  return candidate;
}

function computeRefreshAt(now: number): number {
  const ttl = effectiveTtlMs();
  if (ttl <= 0) {
    return now;
  }
  const normalizedAhead = Math.max(0, Math.min(config.refreshAheadMs, ttl));
  const expiresAt = now + ttl;
  const refreshAt = expiresAt - normalizedAhead;
  return refreshAt <= now ? now : refreshAt;
}

function setPositiveCacheEntry(schemaHash: string, definition: SchemaDefinition): void {
  const ttl = effectiveTtlMs();
  if (ttl <= 0) {
    cache.delete(schemaHash);
    return;
  }
  const now = Date.now();
  cache.set(schemaHash, {
    kind: 'hit',
    value: definition,
    expiresAt: now + ttl,
    refreshAt: computeRefreshAt(now),
    refreshing: false
  });
}

function setNegativeCacheEntry(schemaHash: string): void {
  const ttl = effectiveNegativeTtlMs();
  if (ttl <= 0) {
    cache.delete(schemaHash);
    return;
  }
  const now = Date.now();
  cache.set(schemaHash, {
    kind: 'miss',
    value: null,
    expiresAt: now + ttl,
    refreshing: false
  });
}

function recordCacheHit(metrics: MetastoreMetrics | undefined, kind: 'positive' | 'negative'): void {
  metrics?.schemaRegistryCacheHitsTotal.labels(kind).inc();
}

function recordCacheMiss(metrics: MetastoreMetrics | undefined, reason: 'cold' | 'expired'): void {
  metrics?.schemaRegistryCacheMissesTotal.labels(reason).inc();
}

async function loadAndCache(
  schemaHash: string,
  logger: FastifyBaseLogger | undefined,
  options: LoadOptions
): Promise<LoadOutcome> {
  const existing = inflight.get(schemaHash);
  if (existing) {
    const definition = await existing;
    return { definition, initiated: false } satisfies LoadOutcome;
  }

  const fetchPromise = (async () => {
    try {
      const definition = await withConnection((client) => getSchemaDefinition(client, schemaHash));
      if (definition) {
        setPositiveCacheEntry(schemaHash, definition);
        return definition;
      }

      if (options.allowNegativeCache !== false) {
        setNegativeCacheEntry(schemaHash);
      } else {
        cache.delete(schemaHash);
      }
      return null;
    } catch (err) {
      cache.delete(schemaHash);
      logger?.error({ err, schemaHash }, 'Failed to load schema definition from repository');
      throw err;
    }
  })();

  inflight.set(schemaHash, fetchPromise);

  try {
    const definition = await fetchPromise;
    return { definition, initiated: true } satisfies LoadOutcome;
  } finally {
    inflight.delete(schemaHash);
  }
}

async function refreshEntry(schemaHash: string, logger?: FastifyBaseLogger): Promise<void> {
  const entry = cache.get(schemaHash);
  if (!entry || entry.kind !== 'hit' || entry.refreshing) {
    return;
  }

  entry.refreshing = true;

  try {
    await loadAndCache(schemaHash, logger, { allowNegativeCache: true });
  } catch (err) {
    logger?.warn({ err, schemaHash }, 'Schema registry cache refresh failed');
    const current = cache.get(schemaHash);
    if (current && current === entry) {
      const now = Date.now();
      entry.refreshing = false;
      entry.expiresAt = now + Math.max(1_000, Math.min(config.refreshIntervalMs, effectiveTtlMs() || config.refreshIntervalMs));
      entry.refreshAt = entry.expiresAt;
    }
    return;
  }

  const current = cache.get(schemaHash);
  if (current && current.kind === 'hit') {
    current.refreshing = false;
  }
}

function refreshCache(logger?: FastifyBaseLogger): void {
  if (effectiveTtlMs() <= 0) {
    return;
  }
  const now = Date.now();
  for (const [schemaHash, entry] of cache.entries()) {
    if (entry.kind === 'hit' && !entry.refreshing && now >= entry.refreshAt) {
      void refreshEntry(schemaHash, logger);
    }
  }
}

export function configureSchemaRegistry(options: Partial<SchemaRegistryConfig>): void {
  config = {
    ...config,
    ...options
  } satisfies SchemaRegistryConfig;
}

export function startSchemaRegistryRefresh(logger: FastifyBaseLogger): void {
  if (refreshTimer) {
    return;
  }
  const intervalMs = Math.max(1_000, config.refreshIntervalMs);
  refreshTimer = setInterval(() => refreshCache(logger), intervalMs);
  if (typeof refreshTimer.unref === 'function') {
    refreshTimer.unref();
  }
}

export function stopSchemaRegistryRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

export function clearSchemaRegistryCache(): void {
  cache.clear();
}

export async function fetchSchemaDefinitionCached(
  schemaHash: string,
  options: FetchOptions = {}
): Promise<SchemaFetchResult> {
  const now = Date.now();
  const entry = cache.get(schemaHash);

  if (entry && now <= entry.expiresAt) {
    if (entry.kind === 'hit') {
      recordCacheHit(options.metrics, 'positive');
      if (now >= entry.refreshAt) {
        void refreshEntry(schemaHash, options.logger);
      }
      return {
        status: 'found',
        definition: entry.value,
        source: 'cache'
      } satisfies SchemaFetchResult;
    }

    recordCacheHit(options.metrics, 'negative');
    return {
      status: 'missing',
      source: 'cache'
    } satisfies SchemaFetchResult;
  }

  const reason: 'cold' | 'expired' = entry ? 'expired' : 'cold';
  if (entry) {
    cache.delete(schemaHash);
  }

  const { definition, initiated } = await loadAndCache(schemaHash, options.logger, { allowNegativeCache: true });

  if (initiated) {
    recordCacheMiss(options.metrics, reason);
  }

  if (definition) {
    return {
      status: 'found',
      definition,
      source: 'database'
    } satisfies SchemaFetchResult;
  }

  return {
    status: 'missing',
    source: 'database'
  } satisfies SchemaFetchResult;
}

export async function registerSchemaDefinition(
  input: SchemaDefinitionInput,
  logger?: FastifyBaseLogger
): Promise<SchemaUpsertResult> {
  const result = await withConnection((client) => upsertSchemaDefinition(client, input));
  try {
    setPositiveCacheEntry(input.schemaHash, result.definition);
  } catch (err) {
    logger?.warn({ err, schemaHash: input.schemaHash }, 'Failed to update schema cache after registration');
  }
  return result;
}

export function removeSchemaFromCache(schemaHash: string): void {
  cache.delete(schemaHash);
}

export function getSchemaRegistryConfig(): SchemaRegistryConfig {
  return { ...config } satisfies SchemaRegistryConfig;
}

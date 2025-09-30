import { z } from 'zod';

type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

const configSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().nonnegative(),
  logLevel: z.custom<LogLevel>((value) =>
    value === 'fatal' ||
    value === 'error' ||
    value === 'warn' ||
    value === 'info' ||
    value === 'debug' ||
    value === 'trace'
  ),
  metricsEnabled: z.boolean(),
  database: z.object({
    url: z.string().min(1),
    schema: z.string().min(1),
    maxConnections: z.number().int().positive(),
    idleTimeoutMs: z.number().int().nonnegative(),
    connectionTimeoutMs: z.number().int().nonnegative()
  }),
  redis: z.object({
    url: z.string().min(1),
    keyPrefix: z.string().min(1),
    inline: z.boolean()
  }),
  rollups: z.object({
    queueName: z.string().min(1),
    cacheTtlSeconds: z.number().int().positive(),
    cacheMaxEntries: z.number().int().positive(),
    recalcDepthThreshold: z.number().int().nonnegative(),
    recalcChildCountThreshold: z.number().int().nonnegative(),
    maxCascadeDepth: z.number().int().positive(),
    queueConcurrency: z.number().int().positive()
  }),
  events: z.object({
    mode: z.union([z.literal('inline'), z.literal('redis')]),
    channel: z.string().min(1)
  }),
  reconciliation: z.object({
    queueName: z.string().min(1),
    queueConcurrency: z.number().int().positive(),
    auditIntervalMs: z.number().int().nonnegative(),
    auditBatchSize: z.number().int().positive()
  }),
  journal: z.object({
    retentionDays: z.number().int().nonnegative(),
    pruneBatchSize: z.number().int().positive(),
    pruneIntervalMs: z.number().int().nonnegative()
  })
});

export type ServiceConfig = z.infer<typeof configSchema>;

let cachedConfig: ServiceConfig | null = null;

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

const DEFAULT_LOCAL_REDIS_URL = 'redis://127.0.0.1:6379';

function isProductionEnv(): boolean {
  const value = process.env.NODE_ENV?.trim().toLowerCase();
  return value === 'production';
}

function normalizeRedisUrl(value: string): string {
  if (value === 'inline') {
    return value;
  }
  return /^redis:\/\//i.test(value) ? value : `redis://${value}`;
}

function allowInlineMode(): boolean {
  return parseBoolean(process.env.APPHUB_ALLOW_INLINE_MODE, false);
}

function assertInlineAllowed(context: string): void {
  if (!allowInlineMode()) {
    throw new Error(`${context} requested inline mode but APPHUB_ALLOW_INLINE_MODE is not enabled`);
  }
}

function resolveLogLevel(value: string | undefined): LogLevel {
  const normalized = (value || 'info').trim().toLowerCase();
  switch (normalized) {
    case 'fatal':
    case 'error':
    case 'warn':
    case 'info':
    case 'debug':
    case 'trace':
      return normalized;
    default:
      return 'info';
  }
}

export function loadServiceConfig(): ServiceConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const env = process.env;
  const host = env.FILESTORE_HOST || env.HOST || '127.0.0.1';
  const port = parseNumber(env.FILESTORE_PORT || env.PORT, 4300);
  const logLevel = resolveLogLevel(env.FILESTORE_LOG_LEVEL);
  const databaseUrl = env.FILESTORE_DATABASE_URL || env.DATABASE_URL || 'postgres://apphub:apphub@127.0.0.1:5432/apphub';
  const schema = env.FILESTORE_PG_SCHEMA || 'filestore';
  const maxConnections = parseNumber(env.FILESTORE_PGPOOL_MAX || env.PGPOOL_MAX, 10);
  const idleTimeoutMs = parseNumber(env.FILESTORE_PGPOOL_IDLE_TIMEOUT_MS || env.PGPOOL_IDLE_TIMEOUT_MS, 30_000);
  const connectionTimeoutMs = parseNumber(
    env.FILESTORE_PGPOOL_CONNECTION_TIMEOUT_MS || env.PGPOOL_CONNECTION_TIMEOUT_MS,
    10_000
  );
  const metricsEnabled = parseBoolean(env.FILESTORE_METRICS_ENABLED, true);
  const fallbackRedisUrl = isProductionEnv() ? null : DEFAULT_LOCAL_REDIS_URL;
  const redisUrlSource = env.FILESTORE_REDIS_URL || env.REDIS_URL || fallbackRedisUrl;
  const normalizedRedisSource = (redisUrlSource ?? '').trim();
  if (!normalizedRedisSource) {
    throw new Error('Set FILESTORE_REDIS_URL or REDIS_URL to a redis:// connection string');
  }
  const redisUrl = normalizeRedisUrl(normalizedRedisSource);
  const redisKeyPrefix = env.FILESTORE_REDIS_KEY_PREFIX || 'filestore';
  const rollupQueueName = env.FILESTORE_ROLLUP_QUEUE_NAME || 'filestore_rollup_queue';
  const rollupCacheTtlSeconds = parseNumber(env.FILESTORE_ROLLUP_CACHE_TTL_SECONDS, 300);
  const rollupCacheMaxEntries = parseNumber(env.FILESTORE_ROLLUP_CACHE_MAX_ENTRIES, 1024);
  const rollupRecalcDepthThreshold = parseNumber(env.FILESTORE_ROLLUP_RECALC_DEPTH_THRESHOLD, 4);
  const rollupRecalcChildThreshold = parseNumber(env.FILESTORE_ROLLUP_RECALC_CHILD_THRESHOLD, 250);
  const rollupMaxCascadeDepth = parseNumber(env.FILESTORE_ROLLUP_MAX_CASCADE_DEPTH, 64);
  const rollupQueueConcurrency = parseNumber(env.FILESTORE_ROLLUP_QUEUE_CONCURRENCY, 1);
  const reconcileQueueName = env.FILESTORE_RECONCILE_QUEUE_NAME || 'filestore_reconcile_queue';
  const reconcileQueueConcurrency = parseNumber(env.FILESTORE_RECONCILE_QUEUE_CONCURRENCY, 1);
  const reconcileAuditInterval = parseNumber(env.FILESTORE_RECONCILE_AUDIT_INTERVAL_MS, 300_000);
  const reconcileAuditBatchSize = parseNumber(env.FILESTORE_RECONCILE_AUDIT_BATCH_SIZE, 100);
  const journalRetentionDays = parseNumber(env.FILESTORE_JOURNAL_RETENTION_DAYS, 30);
  const journalPruneBatchSize = parseNumber(env.FILESTORE_JOURNAL_PRUNE_BATCH_SIZE, 500);
  const journalPruneIntervalMs = parseNumber(env.FILESTORE_JOURNAL_PRUNE_INTERVAL_MS, 60_000);
  const eventsModeEnv = (env.FILESTORE_EVENTS_MODE || '').trim().toLowerCase();
  const derivedRedisInline = redisUrl === 'inline';
  if (derivedRedisInline) {
    assertInlineAllowed('FILESTORE_REDIS_URL');
  }
  const eventsModeCandidate: 'inline' | 'redis' = eventsModeEnv === 'inline'
    ? 'inline'
    : eventsModeEnv === 'redis'
      ? 'redis'
      : derivedRedisInline
        ? 'inline'
        : 'redis';
  if (eventsModeCandidate === 'inline') {
    assertInlineAllowed('FILESTORE_EVENTS_MODE');
  }
  const eventsMode = eventsModeCandidate;
  const eventsChannel = env.FILESTORE_EVENTS_CHANNEL || `${redisKeyPrefix}:filestore`;

  const candidateConfig: ServiceConfig = {
    host,
    port,
    logLevel,
    metricsEnabled,
    database: {
      url: databaseUrl,
      schema,
      maxConnections: maxConnections > 0 ? maxConnections : 1,
      idleTimeoutMs: idleTimeoutMs >= 0 ? idleTimeoutMs : 0,
      connectionTimeoutMs: connectionTimeoutMs >= 0 ? connectionTimeoutMs : 0
    },
    redis: {
      url: redisUrl,
      keyPrefix: redisKeyPrefix,
      inline: redisUrl === 'inline'
    },
    rollups: {
      queueName: rollupQueueName,
      cacheTtlSeconds: rollupCacheTtlSeconds > 0 ? rollupCacheTtlSeconds : 60,
      cacheMaxEntries: rollupCacheMaxEntries > 0 ? rollupCacheMaxEntries : 512,
      recalcDepthThreshold: Math.max(0, rollupRecalcDepthThreshold),
      recalcChildCountThreshold: Math.max(0, rollupRecalcChildThreshold),
      maxCascadeDepth: rollupMaxCascadeDepth > 0 ? rollupMaxCascadeDepth : 64,
      queueConcurrency: rollupQueueConcurrency > 0 ? rollupQueueConcurrency : 1
    },
    events: {
      mode: eventsMode,
      channel: eventsChannel
    },
    reconciliation: {
      queueName: reconcileQueueName,
      queueConcurrency: reconcileQueueConcurrency > 0 ? reconcileQueueConcurrency : 1,
      auditIntervalMs: Math.max(0, reconcileAuditInterval),
      auditBatchSize: reconcileAuditBatchSize > 0 ? reconcileAuditBatchSize : 100
    },
    journal: {
      retentionDays: Math.max(0, journalRetentionDays),
      pruneBatchSize: journalPruneBatchSize > 0 ? journalPruneBatchSize : 100,
      pruneIntervalMs: Math.max(0, journalPruneIntervalMs)
    }
  };

  cachedConfig = configSchema.parse(candidateConfig);
  return cachedConfig;
}

export function resetCachedServiceConfig(): void {
  cachedConfig = null;
}

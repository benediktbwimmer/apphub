import path from 'node:path';
import { z } from 'zod';

type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

type StorageDriver = 'local' | 's3';

const retentionRuleSchema = z.object({
  maxAgeHours: z.number().int().positive().optional(),
  maxTotalBytes: z.number().int().positive().optional()
});

const lifecycleSchema = z.object({
  enabled: z.boolean(),
  queueName: z.string().min(1),
  intervalSeconds: z.number().int().positive(),
  jitterSeconds: z.number().int().nonnegative(),
  jobConcurrency: z.number().int().positive(),
  compaction: z.object({
    smallPartitionBytes: z.number().int().positive(),
    targetPartitionBytes: z.number().int().positive(),
    maxPartitionsPerGroup: z.number().int().positive()
  }),
  retention: z.object({
    defaultRules: retentionRuleSchema,
    deleteGraceMinutes: z.number().int().nonnegative()
  }),
  exports: z.object({
    enabled: z.boolean(),
    outputFormat: z.literal('parquet'),
    outputPrefix: z.string().min(1),
    minIntervalHours: z.number().int().positive()
  })
});

const cacheSchema = z.object({
  enabled: z.boolean(),
  directory: z.string().min(1),
  maxBytes: z.number().int().positive()
});

const configSchema = z.object({
  host: z.string(),
  port: z.number().int().nonnegative(),
  logLevel: z.custom<LogLevel>((value) =>
    value === 'fatal' ||
    value === 'error' ||
    value === 'warn' ||
    value === 'info' ||
    value === 'debug' ||
    value === 'trace'
  ),
  database: z.object({
    url: z.string().min(1),
    schema: z.string().min(1),
    maxConnections: z.number().int().positive(),
    idleTimeoutMs: z.number().int().nonnegative(),
    connectionTimeoutMs: z.number().int().nonnegative()
  }),
  storage: z.object({
    driver: z.custom<StorageDriver>((value) => value === 'local' || value === 's3'),
    root: z.string().min(1),
    s3: z
      .object({
        bucket: z.string().min(1),
        endpoint: z.string().min(1).optional(),
        region: z.string().min(1).optional(),
        accessKeyId: z.string().min(1).optional(),
        secretAccessKey: z.string().min(1).optional(),
        sessionToken: z.string().min(1).optional(),
        forcePathStyle: z.boolean().optional()
      })
      .optional()
  }),
  query: z.object({
    cache: cacheSchema
  }),
  lifecycle: lifecycleSchema
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

function resolveStorageRoot(envValue: string | undefined): string {
  if (envValue) {
    return envValue;
  }
  return path.resolve(process.cwd(), 'services', 'data', 'timestore');
}

function resolveCacheDirectory(envValue: string | undefined): string {
  if (envValue) {
    return envValue;
  }
  return path.resolve(process.cwd(), 'services', 'data', 'timestore', 'cache');
}

export function loadServiceConfig(): ServiceConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const env = process.env;
  const host = env.TIMESTORE_HOST || env.HOST || '127.0.0.1';
  const port = parseNumber(env.TIMESTORE_PORT || env.PORT, 4100);
  const logLevel = (env.TIMESTORE_LOG_LEVEL || 'info') as LogLevel;
  const databaseUrl = env.TIMESTORE_DATABASE_URL || env.DATABASE_URL || 'postgres://apphub:apphub@127.0.0.1:5432/apphub';
  const schema = env.TIMESTORE_PG_SCHEMA || 'timestore';
  const maxConnections = parseNumber(env.TIMESTORE_PGPOOL_MAX || env.PGPOOL_MAX, 10);
  const idleTimeoutMs = parseNumber(env.TIMESTORE_PGPOOL_IDLE_TIMEOUT_MS || env.PGPOOL_IDLE_TIMEOUT_MS, 30_000);
  const connectionTimeoutMs = parseNumber(
    env.TIMESTORE_PGPOOL_CONNECTION_TIMEOUT_MS || env.PGPOOL_CONNECTION_TIMEOUT_MS,
    10_000
  );
  const storageDriver = (env.TIMESTORE_STORAGE_DRIVER || 'local') as StorageDriver;
  const storageRoot = resolveStorageRoot(env.TIMESTORE_STORAGE_ROOT);
  const s3Bucket = env.TIMESTORE_S3_BUCKET;
  const s3Endpoint = env.TIMESTORE_S3_ENDPOINT;
  const s3Region = env.TIMESTORE_S3_REGION;
  const s3AccessKeyId = env.TIMESTORE_S3_ACCESS_KEY_ID;
  const s3SecretAccessKey = env.TIMESTORE_S3_SECRET_ACCESS_KEY;
  const s3SessionToken = env.TIMESTORE_S3_SESSION_TOKEN;
  const s3ForcePathStyle = parseBoolean(env.TIMESTORE_S3_FORCE_PATH_STYLE, false);
  const queryCacheEnabled = parseBoolean(env.TIMESTORE_QUERY_CACHE_ENABLED, true);
  const queryCacheDirectory = resolveCacheDirectory(env.TIMESTORE_QUERY_CACHE_DIR);
  const queryCacheMaxBytes = parseNumber(env.TIMESTORE_QUERY_CACHE_MAX_BYTES, 5 * 1024 * 1024 * 1024);
  const lifecycleEnabled = parseBoolean(env.TIMESTORE_LIFECYCLE_ENABLED, true);
  const lifecycleQueueName = env.TIMESTORE_LIFECYCLE_QUEUE_NAME || 'timestore_lifecycle_queue';
  const lifecycleIntervalSeconds = parseNumber(env.TIMESTORE_LIFECYCLE_INTERVAL_SECONDS, 300);
  const lifecycleJitterSeconds = parseNumber(env.TIMESTORE_LIFECYCLE_JITTER_SECONDS, 30);
  const lifecycleConcurrency = parseNumber(env.TIMESTORE_LIFECYCLE_CONCURRENCY, 1);
  const lifecycleSmallPartitionBytes = parseNumber(env.TIMESTORE_LIFECYCLE_COMPACTION_SMALL_BYTES, 20 * 1024 * 1024);
  const lifecycleTargetPartitionBytes = parseNumber(env.TIMESTORE_LIFECYCLE_COMPACTION_TARGET_BYTES, 200 * 1024 * 1024);
  const lifecycleMaxPartitionsPerGroup = parseNumber(env.TIMESTORE_LIFECYCLE_COMPACTION_MAX_PARTITIONS, 16);
  const lifecycleDefaultMaxAgeHours = parseNumber(env.TIMESTORE_LIFECYCLE_RETENTION_MAX_AGE_HOURS, 720);
  const lifecycleDefaultMaxTotalBytes = parseNumber(env.TIMESTORE_LIFECYCLE_RETENTION_MAX_TOTAL_BYTES, 500 * 1024 * 1024 * 1024);
  const lifecycleDeleteGraceMinutes = parseNumber(env.TIMESTORE_LIFECYCLE_RETENTION_DELETE_GRACE_MINUTES, 5);
  const lifecycleExportsEnabled = parseBoolean(env.TIMESTORE_LIFECYCLE_EXPORTS_ENABLED, true);
  const lifecycleExportPrefix = env.TIMESTORE_LIFECYCLE_EXPORT_PREFIX || 'exports';
  const lifecycleExportMinIntervalHours = parseNumber(env.TIMESTORE_LIFECYCLE_EXPORT_MIN_INTERVAL_HOURS, 24);

  const candidateConfig = {
    host,
    port,
    logLevel,
    database: {
      url: databaseUrl,
      schema,
      maxConnections,
      idleTimeoutMs,
      connectionTimeoutMs
    },
    storage: {
      driver: storageDriver,
      root: storageRoot,
      s3:
        storageDriver === 's3' || Boolean(s3Bucket)
          ? {
              bucket: s3Bucket || 'timestore-data',
              endpoint: s3Endpoint,
              region: s3Region,
              accessKeyId: s3AccessKeyId,
              secretAccessKey: s3SecretAccessKey,
              sessionToken: s3SessionToken,
              forcePathStyle: s3ForcePathStyle ? true : undefined
            }
          : undefined
    },
    query: {
      cache: {
        enabled: queryCacheEnabled,
        directory: queryCacheDirectory,
        maxBytes: queryCacheMaxBytes > 0 ? queryCacheMaxBytes : 1 * 1024 * 1024
      }
    },
    lifecycle: {
      enabled: lifecycleEnabled,
      queueName: lifecycleQueueName,
      intervalSeconds: lifecycleIntervalSeconds,
      jitterSeconds: lifecycleJitterSeconds,
      jobConcurrency: lifecycleConcurrency,
      compaction: {
        smallPartitionBytes: lifecycleSmallPartitionBytes,
        targetPartitionBytes: lifecycleTargetPartitionBytes,
        maxPartitionsPerGroup: lifecycleMaxPartitionsPerGroup
      },
      retention: {
        defaultRules: {
          maxAgeHours: lifecycleDefaultMaxAgeHours > 0 ? lifecycleDefaultMaxAgeHours : undefined,
          maxTotalBytes: lifecycleDefaultMaxTotalBytes > 0 ? lifecycleDefaultMaxTotalBytes : undefined
        },
        deleteGraceMinutes: lifecycleDeleteGraceMinutes
      },
      exports: {
        enabled: lifecycleExportsEnabled,
        outputFormat: 'parquet',
        outputPrefix: lifecycleExportPrefix,
        minIntervalHours: lifecycleExportMinIntervalHours
      }
    }
  } satisfies ServiceConfig;

  const parsed = configSchema.parse(candidateConfig);
  cachedConfig = parsed;
  return parsed;
}

export function resetCachedServiceConfig(): void {
  cachedConfig = null;
}

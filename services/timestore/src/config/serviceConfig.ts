import path from 'node:path';
import { z } from 'zod';

type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

type StorageDriver = 'local' | 's3' | 'gcs' | 'azure_blob';

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
    maxPartitionsPerGroup: z.number().int().positive(),
    chunkPartitionLimit: z.number().int().positive(),
    checkpointTtlHours: z.number().int().positive(),
    maxChunkRetries: z.number().int().positive()
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

const manifestCacheSchema = z.object({
  enabled: z.boolean(),
  redisUrl: z.string().min(1),
  keyPrefix: z.string().min(1),
  ttlSeconds: z.number().int().positive(),
  inline: z.boolean()
});

const metricsSchema = z.object({
  enabled: z.boolean(),
  collectDefaultMetrics: z.boolean(),
  prefix: z.string().min(1),
  scope: z.string().min(1).nullable()
});

const tracingSchema = z.object({
  enabled: z.boolean(),
  serviceName: z.string().min(1)
});

const sqlSchema = z.object({
  maxQueryLength: z.number().int().positive(),
  statementTimeoutMs: z.number().int().positive(),
  runtimeCacheTtlMs: z.number().int().nonnegative()
});

const filestoreSchema = z.object({
  enabled: z.boolean(),
  redisUrl: z.string().min(1),
  channel: z.string().min(1),
  datasetSlug: z.string().min(1),
  datasetName: z.string().min(1),
  tableName: z.string().min(1),
  retryDelayMs: z.number().int().positive(),
  inline: z.boolean()
});

const gcsSchema = z.object({
  bucket: z.string().min(1),
  projectId: z.string().min(1).optional(),
  keyFilename: z.string().min(1).optional(),
  clientEmail: z.string().min(1).optional(),
  privateKey: z.string().min(1).optional(),
  hmacKeyId: z.string().min(1).optional(),
  hmacSecret: z.string().min(1).optional()
});

const azureSchema = z.object({
  container: z.string().min(1),
  connectionString: z.string().min(1).optional(),
  accountName: z.string().min(1).optional(),
  accountKey: z.string().min(1).optional(),
  sasToken: z.string().min(1).optional(),
  endpoint: z.string().min(1).optional()
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
    driver: z.custom<StorageDriver>((value) => value === 'local' || value === 's3' || value === 'gcs' || value === 'azure_blob'),
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
      .optional(),
    gcs: gcsSchema.optional(),
    azure: azureSchema.optional()
  }),
  query: z.object({
    cache: cacheSchema,
    manifestCache: manifestCacheSchema
  }),
  sql: sqlSchema,
  lifecycle: lifecycleSchema,
  observability: z.object({
    metrics: metricsSchema,
    tracing: tracingSchema
  }),
  filestore: filestoreSchema
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
  const gcsBucket = env.TIMESTORE_GCS_BUCKET;
  const gcsProjectId = env.TIMESTORE_GCS_PROJECT_ID;
  const gcsKeyFilename = env.TIMESTORE_GCS_KEY_FILENAME;
  const gcsClientEmail = env.TIMESTORE_GCS_CLIENT_EMAIL;
  const gcsPrivateKey = env.TIMESTORE_GCS_PRIVATE_KEY;
  const gcsHmacKeyId = env.TIMESTORE_GCS_HMAC_KEY_ID;
  const gcsHmacSecret = env.TIMESTORE_GCS_HMAC_SECRET;
  const azureContainer = env.TIMESTORE_AZURE_CONTAINER;
  const azureConnectionString = env.TIMESTORE_AZURE_CONNECTION_STRING;
  const azureAccountName = env.TIMESTORE_AZURE_ACCOUNT_NAME;
  const azureAccountKey = env.TIMESTORE_AZURE_ACCOUNT_KEY;
  const azureSasToken = env.TIMESTORE_AZURE_SAS_TOKEN;
  const azureEndpoint = env.TIMESTORE_AZURE_ENDPOINT;
  const queryCacheEnabled = parseBoolean(env.TIMESTORE_QUERY_CACHE_ENABLED, true);
  const queryCacheDirectory = resolveCacheDirectory(env.TIMESTORE_QUERY_CACHE_DIR);
  const queryCacheMaxBytes = parseNumber(env.TIMESTORE_QUERY_CACHE_MAX_BYTES, 5 * 1024 * 1024 * 1024);
  const sqlMaxQueryLength = parseNumber(env.TIMESTORE_SQL_MAX_LENGTH, 10_000);
  const sqlStatementTimeoutMs = parseNumber(env.TIMESTORE_SQL_TIMEOUT_MS, 30_000);
  const sqlRuntimeCacheTtlMs = parseNumber(env.TIMESTORE_SQL_RUNTIME_CACHE_TTL_MS, 30_000);
  const manifestCacheEnabled = parseBoolean(env.TIMESTORE_MANIFEST_CACHE_ENABLED, true);
  const manifestCacheRedisUrl = env.TIMESTORE_MANIFEST_CACHE_REDIS_URL || env.REDIS_URL || 'redis://127.0.0.1:6379';
  const manifestCacheKeyPrefix = env.TIMESTORE_MANIFEST_CACHE_KEY_PREFIX || 'timestore:manifest';
  const manifestCacheTtlSeconds = parseNumber(env.TIMESTORE_MANIFEST_CACHE_TTL_SECONDS, 300);
  const manifestCacheInline = manifestCacheRedisUrl === 'inline';

  const lifecycleEnabled = parseBoolean(env.TIMESTORE_LIFECYCLE_ENABLED, true);
  const lifecycleQueueName = env.TIMESTORE_LIFECYCLE_QUEUE_NAME || 'timestore_lifecycle_queue';
  const lifecycleIntervalSeconds = parseNumber(env.TIMESTORE_LIFECYCLE_INTERVAL_SECONDS, 300);
  const lifecycleJitterSeconds = parseNumber(env.TIMESTORE_LIFECYCLE_JITTER_SECONDS, 30);
  const lifecycleConcurrency = parseNumber(env.TIMESTORE_LIFECYCLE_CONCURRENCY, 1);
  const lifecycleSmallPartitionBytes = parseNumber(env.TIMESTORE_LIFECYCLE_COMPACTION_SMALL_BYTES, 20 * 1024 * 1024);
  const lifecycleTargetPartitionBytes = parseNumber(env.TIMESTORE_LIFECYCLE_COMPACTION_TARGET_BYTES, 200 * 1024 * 1024);
  const lifecycleMaxPartitionsPerGroup = parseNumber(env.TIMESTORE_LIFECYCLE_COMPACTION_MAX_PARTITIONS, 16);
  const lifecycleChunkPartitionLimit = parseNumber(env.TIMESTORE_LIFECYCLE_COMPACTION_CHUNK_PARTITIONS, 48);
  const lifecycleCheckpointTtlHours = parseNumber(env.TIMESTORE_LIFECYCLE_COMPACTION_CHECKPOINT_TTL_HOURS, 24);
  const lifecycleMaxChunkRetries = parseNumber(env.TIMESTORE_LIFECYCLE_COMPACTION_MAX_CHUNK_RETRIES, 3);
  const lifecycleDefaultMaxAgeHours = parseNumber(env.TIMESTORE_LIFECYCLE_RETENTION_MAX_AGE_HOURS, 720);
  const lifecycleDefaultMaxTotalBytes = parseNumber(env.TIMESTORE_LIFECYCLE_RETENTION_MAX_TOTAL_BYTES, 500 * 1024 * 1024 * 1024);
  const lifecycleDeleteGraceMinutes = parseNumber(env.TIMESTORE_LIFECYCLE_RETENTION_DELETE_GRACE_MINUTES, 5);
  const lifecycleExportsEnabled = parseBoolean(env.TIMESTORE_LIFECYCLE_EXPORTS_ENABLED, true);
  const lifecycleExportPrefix = env.TIMESTORE_LIFECYCLE_EXPORT_PREFIX || 'exports';
  const lifecycleExportMinIntervalHours = parseNumber(env.TIMESTORE_LIFECYCLE_EXPORT_MIN_INTERVAL_HOURS, 24);
  const metricsEnabled = parseBoolean(env.TIMESTORE_METRICS_ENABLED, true);
  const metricsCollectDefault = parseBoolean(env.TIMESTORE_METRICS_COLLECT_DEFAULT, true);
  const metricsPrefix = env.TIMESTORE_METRICS_PREFIX || 'timestore_';
  const metricsScope = env.TIMESTORE_METRICS_SCOPE || env.TIMESTORE_ADMIN_SCOPE || env.TIMESTORE_REQUIRE_SCOPE || null;
  const tracingEnabled = parseBoolean(env.TIMESTORE_TRACING_ENABLED, false);
  const tracingServiceName = env.TIMESTORE_TRACING_SERVICE_NAME || 'timestore';
  const filestoreEnabled = parseBoolean(env.TIMESTORE_FILESTORE_SYNC_ENABLED, true);
  const filestoreRedisUrl = env.FILESTORE_REDIS_URL || env.REDIS_URL || 'redis://127.0.0.1:6379';
  const filestoreChannel = env.FILESTORE_EVENTS_CHANNEL || 'apphub:filestore';
  const filestoreDatasetSlug = env.TIMESTORE_FILESTORE_DATASET_SLUG || 'filestore_activity';
  const filestoreDatasetName = env.TIMESTORE_FILESTORE_DATASET_NAME || 'Filestore Activity';
  const filestoreTableName = env.TIMESTORE_FILESTORE_TABLE_NAME || 'filestore_activity';
  const filestoreRetryMs = parseNumber(env.TIMESTORE_FILESTORE_RETRY_MS, 3_000);
  const filestoreInline = filestoreRedisUrl === 'inline';

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
          : undefined,
      gcs:
        storageDriver === 'gcs' || Boolean(gcsBucket)
          ? {
              bucket: gcsBucket ?? '',
              projectId: gcsProjectId,
              keyFilename: gcsKeyFilename,
              clientEmail: gcsClientEmail,
              privateKey: gcsPrivateKey,
              hmacKeyId: gcsHmacKeyId,
              hmacSecret: gcsHmacSecret
            }
          : undefined,
      azure:
        storageDriver === 'azure_blob' || Boolean(azureContainer)
          ? {
              container: azureContainer ?? '',
              connectionString: azureConnectionString,
              accountName: azureAccountName,
              accountKey: azureAccountKey,
              sasToken: azureSasToken,
              endpoint: azureEndpoint
            }
          : undefined
    },
    query: {
      cache: {
        enabled: queryCacheEnabled,
        directory: queryCacheDirectory,
        maxBytes: queryCacheMaxBytes > 0 ? queryCacheMaxBytes : 1 * 1024 * 1024
      },
      manifestCache: {
        enabled: manifestCacheEnabled,
        redisUrl: manifestCacheRedisUrl,
        keyPrefix: manifestCacheKeyPrefix,
        ttlSeconds: manifestCacheTtlSeconds > 0 ? manifestCacheTtlSeconds : 60,
        inline: manifestCacheInline
      }
    },
    sql: {
      maxQueryLength: sqlMaxQueryLength > 0 ? sqlMaxQueryLength : 10_000,
      statementTimeoutMs: sqlStatementTimeoutMs > 0 ? sqlStatementTimeoutMs : 30_000,
      runtimeCacheTtlMs: sqlRuntimeCacheTtlMs >= 0 ? sqlRuntimeCacheTtlMs : 0
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
        maxPartitionsPerGroup: lifecycleMaxPartitionsPerGroup,
        chunkPartitionLimit: lifecycleChunkPartitionLimit > 0 ? lifecycleChunkPartitionLimit : 48,
        checkpointTtlHours: lifecycleCheckpointTtlHours > 0 ? lifecycleCheckpointTtlHours : 24,
        maxChunkRetries: lifecycleMaxChunkRetries > 0 ? lifecycleMaxChunkRetries : 3
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
    },
    observability: {
      metrics: {
        enabled: metricsEnabled,
        collectDefaultMetrics: metricsCollectDefault,
        prefix: metricsPrefix,
        scope: metricsScope
      },
      tracing: {
        enabled: tracingEnabled,
        serviceName: tracingServiceName
      }
    },
    filestore: {
      enabled: filestoreEnabled,
      redisUrl: filestoreRedisUrl,
      channel: filestoreChannel,
      datasetSlug: filestoreDatasetSlug,
      datasetName: filestoreDatasetName,
      tableName: filestoreTableName,
      retryDelayMs: filestoreRetryMs > 0 ? filestoreRetryMs : 3_000,
      inline: filestoreInline
    }
  } satisfies ServiceConfig;

  const parsed = configSchema.parse(candidateConfig);
  cachedConfig = parsed;
  return parsed;
}

export function resetCachedServiceConfig(): void {
  cachedConfig = null;
}

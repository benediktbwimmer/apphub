import path from 'node:path';
import { z } from 'zod';

type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

type StorageDriver = 'local' | 's3';

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
        region: z.string().min(1).optional()
      })
      .optional()
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

function resolveStorageRoot(envValue: string | undefined): string {
  if (envValue) {
    return envValue;
  }
  return path.resolve(process.cwd(), 'services', 'data', 'timestore');
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
        storageDriver === 's3'
          ? {
              bucket: s3Bucket || 'timestore-data',
              endpoint: s3Endpoint,
              region: s3Region
            }
          : undefined
    }
  } satisfies ServiceConfig;

  const parsed = configSchema.parse(candidateConfig);
  cachedConfig = parsed;
  return parsed;
}

export function resetCachedServiceConfig(): void {
  cachedConfig = null;
}

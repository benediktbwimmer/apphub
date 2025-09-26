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
  const port = parseNumber(env.FILESTORE_PORT || env.PORT, 4200);
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
    }
  };

  cachedConfig = configSchema.parse(candidateConfig);
  return cachedConfig;
}

export function resetCachedServiceConfig(): void {
  cachedConfig = null;
}

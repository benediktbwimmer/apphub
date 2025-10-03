import type { Pool, PoolClient } from 'pg';
import { createPostgresPool } from '@apphub/shared';
import type { PostgresAcquireOptions } from '@apphub/shared';

const DEFAULT_DATABASE_URL = 'postgres://apphub:apphub@127.0.0.1:5432/apphub';

type PoolOptions = {
  connectionString?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
};

function buildPool(options: PoolOptions = {}) {
  return createPostgresPool({
    connectionString:
      options.connectionString ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    max: options.max ?? Number(process.env.PGPOOL_MAX ?? 5),
    idleTimeoutMillis: options.idleTimeoutMillis ?? Number(process.env.PGPOOL_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis:
      options.connectionTimeoutMillis ?? Number(process.env.PGPOOL_CONNECTION_TIMEOUT_MS ?? 10_000)
  });
}

let poolHelpers: ReturnType<typeof buildPool> | null = null;
let shutdownHookRegistered = false;

function registerShutdownHook(): void {
  if (shutdownHookRegistered) {
    return;
  }
  shutdownHookRegistered = true;
  process.once('beforeExit', () => {
    if (!poolHelpers) {
      return;
    }
    void poolHelpers.closePool().catch(() => undefined);
    poolHelpers = null;
  });
}

function ensurePool(): ReturnType<typeof buildPool> {
  if (!poolHelpers) {
    poolHelpers = buildPool();
    registerShutdownHook();
  }
  return poolHelpers;
}

export function getClient(options?: PostgresAcquireOptions): Promise<PoolClient> {
  return ensurePool().getClient(options);
}

export function withConnection<T>(
  fn: (client: PoolClient) => Promise<T>,
  options?: PostgresAcquireOptions
): Promise<T> {
  return ensurePool().withConnection(fn, options);
}

export function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  options?: PostgresAcquireOptions
): Promise<T> {
  return ensurePool().withTransaction(fn, options);
}

export async function closePool(): Promise<void> {
  if (!poolHelpers) {
    return;
  }
  await poolHelpers.closePool();
  poolHelpers = null;
}

export function getPool(): Pool {
  return ensurePool().getPool();
}

export async function resetDatabasePool(options: PoolOptions = {}): Promise<void> {
  if (poolHelpers) {
    await poolHelpers.closePool().catch(() => undefined);
  }
  poolHelpers = buildPool(options);
}

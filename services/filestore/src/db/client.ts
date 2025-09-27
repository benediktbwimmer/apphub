import type { Pool, PoolClient } from 'pg';
import { createPostgresPool, type PostgresAcquireOptions, type PostgresHelpers } from '@apphub/shared';
import { loadServiceConfig, resetCachedServiceConfig, type ServiceConfig } from '../config/serviceConfig';

function createPool(config: ServiceConfig): PostgresHelpers {
  return createPostgresPool({
    connectionString: config.database.url,
    max: config.database.maxConnections,
    idleTimeoutMillis: config.database.idleTimeoutMs,
    connectionTimeoutMillis: config.database.connectionTimeoutMs,
    schema: config.database.schema
  });
}

let activeConfig: ServiceConfig = loadServiceConfig();
let poolHelpers: PostgresHelpers = createPool(activeConfig);
export let POSTGRES_SCHEMA: string = activeConfig.database.schema;

function refreshConfig(): void {
  activeConfig = loadServiceConfig();
  POSTGRES_SCHEMA = activeConfig.database.schema;
}

export function getClient(options?: PostgresAcquireOptions): Promise<PoolClient> {
  return poolHelpers.getClient(options);
}

export function withConnection<T>(
  fn: (client: PoolClient) => Promise<T>,
  options?: PostgresAcquireOptions
): Promise<T> {
  return poolHelpers.withConnection(fn, options);
}

export function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  options?: PostgresAcquireOptions
): Promise<T> {
  return poolHelpers.withTransaction(fn, options);
}

export function getPool(): Pool {
  return poolHelpers.getPool();
}

export async function closePool(): Promise<void> {
  await poolHelpers.closePool();
}

export async function resetPool(): Promise<void> {
  await poolHelpers.closePool().catch(() => undefined);
  resetCachedServiceConfig();
  refreshConfig();
  poolHelpers = createPool(activeConfig);
}

export function getActiveConfig(): ServiceConfig {
  return activeConfig;
}


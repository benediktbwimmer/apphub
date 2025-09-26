import type { Pool, PoolClient } from 'pg';
import { createPostgresPool, type PostgresAcquireOptions } from '@apphub/shared';
import { runMigrations } from './migrations';
import { loadServiceConfig } from '../config/serviceConfig';

const DEFAULT_DATABASE_URL = 'postgres://apphub:apphub@127.0.0.1:5432/apphub';

const serviceConfig = loadServiceConfig();

const poolHelpers = createPostgresPool({
  connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  max: serviceConfig.database.maxConnections,
  idleTimeoutMillis: serviceConfig.database.idleTimeoutMs,
  connectionTimeoutMillis: serviceConfig.database.connectionTimeoutMs,
  schema: serviceConfig.database.schema
});

const {
  getClient: baseGetClient,
  withConnection: baseWithConnection,
  withTransaction: baseWithTransaction,
  closePool: baseClosePool,
  getPool: baseGetPool
} = poolHelpers;

function quoteIdentifier(input: string): string {
  return `"${input.replace(/"/g, '""')}"`;
}

let schemaReadyPromise: Promise<void> | null = null;

async function prepareSchema(): Promise<void> {
  // Ensure the dedicated schema exists before applying migrations.
  const rawClient = await baseGetClient({ setSearchPath: false });
  try {
    await rawClient.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(serviceConfig.database.schema)}`);
  } finally {
    rawClient.release();
  }

  await baseWithConnection(async (client) => {
    await runMigrations(client);
  });
}

export async function ensureSchemaReady(): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = prepareSchema().catch((err) => {
      schemaReadyPromise = null;
      throw err;
    });
  }

  await schemaReadyPromise;
}

export async function getClient(options?: PostgresAcquireOptions): Promise<PoolClient> {
  return baseGetClient(options);
}

export async function withConnection<T>(
  fn: (client: PoolClient) => Promise<T>,
  options?: PostgresAcquireOptions
): Promise<T> {
  return baseWithConnection(fn, options);
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  options?: PostgresAcquireOptions
): Promise<T> {
  return baseWithTransaction(fn, options);
}

export async function closePool(): Promise<void> {
  await baseClosePool();
}

export function getPool(): Pool {
  return baseGetPool();
}

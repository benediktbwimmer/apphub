import type { Pool } from 'pg';
import { createPostgresPool } from '@apphub/shared';

const DEFAULT_DATABASE_URL = 'postgres://apphub:apphub@127.0.0.1:5432/apphub';

const poolHelpers = createPostgresPool({
  connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  max: Number(process.env.PGPOOL_MAX ?? 20),
  idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_TIMEOUT_MS ?? 30_000),
  connectionTimeoutMillis: Number(process.env.PGPOOL_CONNECTION_TIMEOUT_MS ?? 10_000)
});

export const { getClient, withConnection, withTransaction, closePool, getPool } = poolHelpers;

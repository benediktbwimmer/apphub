import { Pool, type PoolClient } from 'pg';
import pg from 'pg';

pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number.parseInt(value, 10));

const DEFAULT_DATABASE_URL = 'postgres://apphub:apphub@127.0.0.1:5432/apphub';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  max: Number(process.env.PGPOOL_MAX ?? 20),
  idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_TIMEOUT_MS ?? 30_000),
  connectionTimeoutMillis: Number(process.env.PGPOOL_CONNECTION_TIMEOUT_MS ?? 10_000)
});

pool.on('error', (err: Error) => {
  console.error('[db] unexpected error on idle client', err);
});

export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

export async function withConnection<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getClient();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withConnection(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('[db] failed to rollback transaction', rollbackErr);
      }
      throw err;
    }
  });
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export function getPool(): Pool {
  return pool;
}

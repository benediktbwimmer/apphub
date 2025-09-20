import type { PoolClient } from 'pg';
import { withConnection, withTransaction } from './client';
import { ensureDatabase } from './init';

export async function useConnection<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureDatabase();
  return withConnection(fn);
}

export async function useTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureDatabase();
  return withTransaction(fn);
}

import type { PoolClient } from 'pg';
import { withConnection } from './client';

const MIN_PRUNE_LIMIT = 1;

async function pruneWithClient(
  client: PoolClient,
  cutoff: Date,
  limit: number
): Promise<number> {
  const boundedLimit = Number.isFinite(limit) && limit >= MIN_PRUNE_LIMIT ? Math.floor(limit) : MIN_PRUNE_LIMIT;
  const result = await client.query<{ id: number }>(
    `WITH candidates AS (
       SELECT id
         FROM journal_entries
        WHERE created_at < $1
        ORDER BY created_at ASC
        LIMIT $2
     )
     DELETE FROM journal_entries
      WHERE id IN (SELECT id FROM candidates)
      RETURNING id`,
    [cutoff, boundedLimit]
  );
  return result.rowCount ?? 0;
}

export async function pruneJournalEntriesOlderThan(
  cutoff: Date,
  limit: number
): Promise<number> {
  if (!(cutoff instanceof Date) || Number.isNaN(cutoff.getTime())) {
    return 0;
  }
  return withConnection((client) => pruneWithClient(client, cutoff, limit));
}

export async function pruneJournalEntriesOlderThanWithClient(
  client: PoolClient,
  cutoff: Date,
  limit: number
): Promise<number> {
  if (!(cutoff instanceof Date) || Number.isNaN(cutoff.getTime())) {
    return 0;
  }
  return pruneWithClient(client, cutoff, limit);
}

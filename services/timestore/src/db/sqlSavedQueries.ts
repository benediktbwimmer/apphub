import type { PoolClient, QueryResultRow } from 'pg';
import { withConnection } from './client';

export interface SavedSqlQueryStats {
  rowCount?: number;
  elapsedMs?: number;
}

export interface SavedSqlQueryRecord {
  id: string;
  statement: string;
  label: string | null;
  createdBy: string | null;
  stats: SavedSqlQueryStats | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertSavedSqlQueryInput {
  id: string;
  statement: string;
  label?: string | null;
  createdBy?: string | null;
  stats?: SavedSqlQueryStats | null;
}

interface SavedSqlQueryRow extends QueryResultRow {
  id: string;
  statement: string;
  label: string | null;
  created_by: string | null;
  stats: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: SavedSqlQueryRow): SavedSqlQueryRecord {
  return {
    id: row.id,
    statement: row.statement,
    label: row.label,
    createdBy: row.created_by,
    stats: mapStats(row.stats),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapStats(stats: Record<string, unknown> | null): SavedSqlQueryStats | null {
  if (!stats || typeof stats !== 'object') {
    return null;
  }
  const result: SavedSqlQueryStats = {};
  const rowCount = (stats as Record<string, unknown>).rowCount;
  if (typeof rowCount === 'number' && Number.isFinite(rowCount)) {
    result.rowCount = rowCount;
  }
  const elapsedMs = (stats as Record<string, unknown>).elapsedMs;
  if (typeof elapsedMs === 'number' && Number.isFinite(elapsedMs)) {
    result.elapsedMs = elapsedMs;
  }
  return Object.keys(result).length === 0 ? null : result;
}

function normalizeStats(stats: SavedSqlQueryStats | null | undefined): Record<string, number> | null {
  if (!stats) {
    return null;
  }
  const normalized: Record<string, number> = {};
  if (typeof stats.rowCount === 'number' && Number.isFinite(stats.rowCount)) {
    normalized.rowCount = Math.trunc(stats.rowCount);
  }
  if (typeof stats.elapsedMs === 'number' && Number.isFinite(stats.elapsedMs)) {
    normalized.elapsedMs = Math.trunc(stats.elapsedMs);
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

async function querySavedSqlQueries<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  return withConnection(async (client) => fn(client));
}

export async function listSavedSqlQueries(): Promise<SavedSqlQueryRecord[]> {
  return querySavedSqlQueries(async (client) => {
    const { rows } = await client.query<SavedSqlQueryRow>(
      `SELECT id, statement, label, created_by, stats, created_at, updated_at
         FROM sql_saved_queries
         ORDER BY updated_at DESC`
    );
    return rows.map(mapRow);
  });
}

export async function getSavedSqlQueryById(id: string): Promise<SavedSqlQueryRecord | null> {
  return querySavedSqlQueries(async (client) => {
    const { rows } = await client.query<SavedSqlQueryRow>(
      `SELECT id, statement, label, created_by, stats, created_at, updated_at
         FROM sql_saved_queries
         WHERE id = $1`,
      [id]
    );
    const row = rows[0];
    return row ? mapRow(row) : null;
  });
}

export async function upsertSavedSqlQuery(input: UpsertSavedSqlQueryInput): Promise<SavedSqlQueryRecord> {
  const stats = normalizeStats(input.stats);
  return querySavedSqlQueries(async (client) => {
    const { rows } = await client.query<SavedSqlQueryRow>(
      `INSERT INTO sql_saved_queries (id, statement, label, created_by, stats)
         VALUES ($1, $2, $3, $4, COALESCE($5::jsonb, '{}'::jsonb))
       ON CONFLICT (id)
         DO UPDATE SET
           statement = EXCLUDED.statement,
           label = EXCLUDED.label,
           stats = COALESCE(EXCLUDED.stats, '{}'::jsonb),
           updated_at = NOW(),
           created_by = COALESCE(sql_saved_queries.created_by, EXCLUDED.created_by)
       RETURNING id, statement, label, created_by, stats, created_at, updated_at`,
      [
        input.id,
        input.statement,
        input.label ?? null,
        input.createdBy ?? null,
        stats ? JSON.stringify(stats) : null
      ]
    );
    return mapRow(rows[0]);
  });
}

export async function deleteSavedSqlQuery(id: string): Promise<boolean> {
  return querySavedSqlQueries(async (client) => {
    const { rowCount } = await client.query(
      'DELETE FROM sql_saved_queries WHERE id = $1',
      [id]
    );
    return (rowCount ?? 0) > 0;
  });
}

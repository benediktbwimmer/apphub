import type { PoolClient } from 'pg';
import { useConnection, useTransaction } from './utils';
import type { SessionRow } from './rowTypes';
import type { DbUser, DbRole, UserWithAccess } from './users';
import { getUserWithAccessUsingClient } from './users';

export type DbSession = {
  id: string;
  userId: string;
  sessionTokenHash: string;
  refreshTokenHash: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
};

export type SessionWithAccess = {
  session: DbSession;
  user: DbUser;
  roles: DbRole[];
  scopes: string[];
};

export type CreateSessionInput = {
  id: string;
  userId: string;
  sessionTokenHash: string;
  expiresAt: Date;
  refreshTokenHash?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export type UpdateSessionActivityInput = {
  sessionId: string;
  lastSeenAt?: Date;
  expiresAt?: Date;
  ip?: string | null;
  userAgent?: string | null;
};

function mapSessionRow(row: SessionRow): DbSession {
  return {
    id: row.id,
    userId: row.user_id,
    sessionTokenHash: row.session_token_hash,
    refreshTokenHash: row.refresh_token_hash,
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at
  } satisfies DbSession;
}

async function loadSessionRow(client: PoolClient, sessionId: string, sessionTokenHash: string): Promise<SessionRow | null> {
  const { rows } = await client.query<SessionRow>(
    `SELECT *
       FROM sessions
      WHERE id = $1
        AND session_token_hash = $2`,
    [sessionId, sessionTokenHash]
  );
  return rows[0] ?? null;
}

export async function createSessionRecord(input: CreateSessionInput): Promise<DbSession> {
  return useTransaction(async (client) => {
    const { rows } = await client.query<SessionRow>(
      `INSERT INTO sessions (
         id,
         user_id,
         session_token_hash,
         refresh_token_hash,
         ip,
         user_agent,
         created_at,
         updated_at,
         expires_at,
         last_seen_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), $7, NOW())
       RETURNING *`,
      [
        input.id,
        input.userId,
        input.sessionTokenHash,
        input.refreshTokenHash ?? null,
        input.ip ?? null,
        input.userAgent ?? null,
        input.expiresAt.toISOString()
      ]
    );
    return mapSessionRow(rows[0]);
  });
}

export async function loadSessionWithAccess(
  sessionId: string,
  sessionTokenHash: string,
  now: Date
): Promise<SessionWithAccess | null> {
  return useConnection(async (client) => {
    const row = await loadSessionRow(client, sessionId, sessionTokenHash);
    if (!row) {
      return null;
    }
    const expiresAt = new Date(row.expires_at);
    if (expiresAt.getTime() <= now.getTime()) {
      return null;
    }
    const access = await getUserWithAccessUsingClient(client, row.user_id);
    if (!access) {
      return null;
    }
    return {
      session: mapSessionRow(row),
      user: access.user,
      roles: access.roles,
      scopes: access.scopes
    } satisfies SessionWithAccess;
  });
}

export async function updateSessionActivity(input: UpdateSessionActivityInput): Promise<void> {
  await useConnection((client) =>
    client.query(
      `UPDATE sessions
          SET last_seen_at = COALESCE($2, last_seen_at),
              expires_at = COALESCE($3, expires_at),
              ip = COALESCE($4, ip),
              user_agent = COALESCE($5, user_agent),
              updated_at = NOW()
        WHERE id = $1`,
      [
        input.sessionId,
        input.lastSeenAt ? input.lastSeenAt.toISOString() : null,
        input.expiresAt ? input.expiresAt.toISOString() : null,
        input.ip ?? null,
        input.userAgent ?? null
      ]
    )
  );
}

export async function deleteSession(sessionId: string): Promise<void> {
  await useConnection((client) =>
    client.query(`DELETE FROM sessions WHERE id = $1`, [sessionId])
  );
}

export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  await useConnection((client) =>
    client.query(`DELETE FROM sessions WHERE user_id = $1`, [userId])
  );
}

export async function listSessionsForUser(userId: string): Promise<DbSession[]> {
  const { rows } = await useConnection((client) =>
    client.query<SessionRow>(
      `SELECT *
         FROM sessions
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [userId]
    )
  );
  return rows.map(mapSessionRow);
}


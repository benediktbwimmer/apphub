import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  useTransaction,
  useConnection
} from './utils';
import type {
  RoleRow,
  UserIdentityRow,
  UserRow
} from './rowTypes';

export type DbUser = {
  id: string;
  primaryEmail: string;
  displayName: string | null;
  avatarUrl: string | null;
  kind: 'user' | 'service';
  status: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

export type DbUserIdentity = {
  id: string;
  userId: string;
  provider: string;
  providerSubject: string;
  email: string | null;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
};

export type DbRole = {
  id: string;
  slug: string;
  description: string | null;
};

export type UserWithAccess = {
  user: DbUser;
  roles: DbRole[];
  scopes: string[];
};

export type UpsertUserIdentityInput = {
  provider: string;
  providerSubject: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  kind?: 'user' | 'service';
};

function mapUserRow(row: UserRow): DbUser {
  return {
    id: row.id,
    primaryEmail: row.primary_email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    kind: row.kind === 'service' ? 'service' : 'user',
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at
  } satisfies DbUser;
}

function mapIdentityRow(row: UserIdentityRow): DbUserIdentity {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerSubject: row.provider_subject,
    email: row.email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at
  } satisfies DbUserIdentity;
}

function mapRoleRow(row: RoleRow): DbRole {
  return {
    id: row.id,
    slug: row.slug,
    description: row.description
  } satisfies DbRole;
}

async function ensureRoleAssignment(client: PoolClient, userId: string, roleId: string): Promise<void> {
  await client.query(
    `INSERT INTO user_roles (user_id, role_id)
       VALUES ($1, $2)
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [userId, roleId]
  );
}

async function loadRoles(client: PoolClient, userId: string): Promise<DbRole[]> {
  const { rows } = await client.query<RoleRow>(
    `SELECT r.id, r.slug, r.description, r.created_at
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1
      ORDER BY r.slug ASC`,
    [userId]
  );
  return rows.map(mapRoleRow);
}

async function loadScopes(client: PoolClient, userId: string): Promise<string[]> {
  const { rows } = await client.query<{ scope: string }>(
    `SELECT DISTINCT rs.scope
       FROM role_scopes rs
       JOIN user_roles ur ON ur.role_id = rs.role_id
      WHERE ur.user_id = $1
      ORDER BY rs.scope ASC`,
    [userId]
  );
  return rows.map((row) => row.scope);
}

async function loadUserWithAccess(client: PoolClient, userId: string): Promise<UserWithAccess | null> {
  const { rows } = await client.query<UserRow>(
    `SELECT *
       FROM users
      WHERE id = $1`,
    [userId]
  );
  const userRow = rows[0];
  if (!userRow) {
    return null;
  }
  const roles = await loadRoles(client, userId);
  const scopes = await loadScopes(client, userId);
  return {
    user: mapUserRow(userRow),
    roles,
    scopes
  } satisfies UserWithAccess;
}

async function findIdentity(client: PoolClient, provider: string, providerSubject: string): Promise<DbUserIdentity | null> {
  const { rows } = await client.query<UserIdentityRow>(
    `SELECT *
       FROM user_identities
      WHERE provider = $1
        AND provider_subject = $2`,
    [provider, providerSubject]
  );
  const row = rows[0];
  return row ? mapIdentityRow(row) : null;
}

export async function getUserWithAccess(userId: string): Promise<UserWithAccess | null> {
  return useConnection((client) => loadUserWithAccess(client, userId));
}

export async function getUserWithAccessUsingClient(client: PoolClient, userId: string): Promise<UserWithAccess | null> {
  return loadUserWithAccess(client, userId);
}

export async function upsertUserIdentityWithAccess(input: UpsertUserIdentityInput): Promise<UserWithAccess> {
  return useTransaction(async (client) => {
    const existingIdentity = await findIdentity(client, input.provider, input.providerSubject);

    if (existingIdentity) {
      await client.query(
        `UPDATE user_identities
            SET email = $1,
                updated_at = NOW(),
                last_seen_at = NOW()
          WHERE id = $2`,
        [input.email, existingIdentity.id]
      );

      const { rows: userRows } = await client.query<UserRow>(
        `UPDATE users
            SET primary_email = $1,
                display_name = COALESCE($2, display_name),
                avatar_url = COALESCE($3, avatar_url),
                updated_at = NOW(),
                last_login_at = NOW()
          WHERE id = $4
          RETURNING *`,
        [
          input.email,
          input.displayName ?? null,
          input.avatarUrl ?? null,
          existingIdentity.userId
        ]
      );

      const updatedRow = userRows[0];
      return {
        user: mapUserRow(updatedRow),
        roles: await loadRoles(client, existingIdentity.userId),
        scopes: await loadScopes(client, existingIdentity.userId)
      } satisfies UserWithAccess;
    }

    const { rows: userRows } = await client.query<UserRow>(
      `SELECT *
         FROM users
        WHERE LOWER(primary_email) = LOWER($1)
        LIMIT 1
        FOR UPDATE`,
      [input.email]
    );

    const existingUser = userRows[0];

    let userRow: UserRow;
    if (existingUser) {
      const { rows: updatedRows } = await client.query<UserRow>(
        `UPDATE users
            SET display_name = COALESCE($1, display_name),
                avatar_url = COALESCE($2, avatar_url),
                updated_at = NOW(),
                last_login_at = NOW()
          WHERE id = $3
          RETURNING *`,
        [input.displayName ?? null, input.avatarUrl ?? null, existingUser.id]
      );
      userRow = updatedRows[0];
    } else {
      const userId = `usr_${randomUUID()}`;
      const { rows: insertedRows } = await client.query<UserRow>(
        `INSERT INTO users (
           id,
           primary_email,
           display_name,
           avatar_url,
           kind,
           status,
           created_at,
           updated_at,
           last_login_at
         ) VALUES ($1, $2, $3, $4, $5, 'active', NOW(), NOW(), NOW())
         RETURNING *`,
        [
          userId,
          input.email,
          input.displayName ?? null,
          input.avatarUrl ?? null,
          input.kind ?? 'user'
        ]
      );
      userRow = insertedRows[0];
      await ensureRoleAssignment(client, userRow.id, 'role-viewer');
    }

    await client.query(
      `INSERT INTO user_identities (
         id,
         user_id,
         provider,
         provider_subject,
         email,
         created_at,
         updated_at,
         last_seen_at
       ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
       ON CONFLICT (provider, provider_subject) DO UPDATE
         SET email = EXCLUDED.email,
             updated_at = NOW(),
             last_seen_at = NOW()`,
      [`uid_${randomUUID()}`, userRow.id, input.provider, input.providerSubject, input.email]
    );

    return {
      user: mapUserRow(userRow),
      roles: await loadRoles(client, userRow.id),
      scopes: await loadScopes(client, userRow.id)
    } satisfies UserWithAccess;
  });
}

export async function touchUserLogin(userId: string): Promise<void> {
  await useConnection((client) =>
    client.query(
      `UPDATE users
          SET last_login_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [userId]
    )
  );
}

export async function ensureUserRole(userId: string, roleId: string): Promise<void> {
  await useConnection((client) => ensureRoleAssignment(client, userId, roleId));
}

export async function listUsers(): Promise<DbUser[]> {
  const { rows } = await useConnection((client) =>
    client.query<UserRow>(`SELECT * FROM users ORDER BY created_at ASC`)
  );
  return rows.map(mapUserRow);
}

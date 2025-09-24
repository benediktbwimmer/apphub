import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { useConnection, useTransaction } from './utils';
import type { ApiKeyRow } from './rowTypes';
import type { JsonValue } from './types';
import { hashSha256, toBase64Url } from '../auth/crypto';

export type ApiKeyRecord = {
  id: string;
  userId: string;
  name: string | null;
  prefix: string;
  tokenHash: string;
  scopes: string[];
  metadata: JsonValue | null;
  createdBySessionId: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
};

export type CreateApiKeyOptions = {
  userId: string;
  name?: string | null;
  scopes: string[];
  expiresAt?: Date | null;
  metadata?: JsonValue | null;
  createdBySessionId?: string | null;
};

export type ApiKeyEventType = 'created' | 'revoked' | 'used';

export type ApiKeyEventInput = {
  apiKeyId: string;
  userId: string;
  type: ApiKeyEventType;
  metadata?: JsonValue | null;
};

export type GeneratedApiKey = {
  id: string;
  prefix: string;
  secret: string;
  token: string;
  tokenHash: string;
};

function mapApiKeyRow(row: ApiKeyRow): ApiKeyRecord {
  const scopes = Array.isArray(row.scopes)
    ? (row.scopes as string[])
    : typeof row.scopes === 'string'
      ? row.scopes.split(',').map((scope) => scope.trim()).filter(Boolean)
      : [];
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    prefix: row.prefix,
    tokenHash: row.token_hash,
    scopes,
    metadata: (row.metadata as JsonValue | null) ?? null,
    createdBySessionId: row.created_by_session_id,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    revokedAt: row.revoked_at
  } satisfies ApiKeyRecord;
}

function generatePrefix(): string {
  const bytes = randomBytes(6);
  return `apphub_${bytes.toString('hex')}`;
}

function generateApiKey(): GeneratedApiKey {
  const prefix = generatePrefix();
  const secret = toBase64Url(randomBytes(32));
  const token = `${prefix}.${secret}`;
  const tokenHash = hashSha256(token);
  return {
    id: `key_${randomUUID()}`,
    prefix,
    secret,
    token,
    tokenHash
  } satisfies GeneratedApiKey;
}

async function insertApiKey(
  client: PoolClient,
  options: CreateApiKeyOptions
): Promise<{ record: ApiKeyRecord; token: string }> {
  const generated = generateApiKey();
  const expiresAt = options.expiresAt ?? null;
  const { rows } = await client.query<ApiKeyRow>(
    `INSERT INTO api_keys (
       id,
       user_id,
       name,
       prefix,
       token_hash,
       scopes,
       metadata,
       created_by_session_id,
       last_used_at,
       expires_at,
       created_at,
       updated_at,
       revoked_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, NULL, $9, NOW(), NOW(), NULL)
     RETURNING *`,
    [
      generated.id,
      options.userId,
      options.name ?? null,
      generated.prefix,
      generated.tokenHash,
      JSON.stringify(options.scopes ?? []),
      options.metadata ?? null,
      options.createdBySessionId ?? null,
      expiresAt ? expiresAt.toISOString() : null
    ]
  );

  const record = mapApiKeyRow(rows[0]);

  await client.query(
    `INSERT INTO api_key_events (
       api_key_id,
       user_id,
       event,
       metadata,
       created_at
     ) VALUES ($1, $2, $3, $4, NOW())`,
    [record.id, record.userId, 'created', options.metadata ?? null]
  );

  return { record, token: generated.token };
}

export async function createApiKey(options: CreateApiKeyOptions): Promise<{ record: ApiKeyRecord; token: string }> {
  return useTransaction((client) => insertApiKey(client, options));
}

export async function listApiKeysForUser(userId: string): Promise<ApiKeyRecord[]> {
  const { rows } = await useConnection((client) =>
    client.query<ApiKeyRow>(
      `SELECT *
         FROM api_keys
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [userId]
    )
  );
  return rows.map(mapApiKeyRow);
}

export async function findActiveApiKeyByHash(tokenHash: string): Promise<ApiKeyRecord | null> {
  const { rows } = await useConnection((client) =>
    client.query<ApiKeyRow>(
      `SELECT *
         FROM api_keys
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > NOW())
        LIMIT 1`,
      [tokenHash]
    )
  );
  const row = rows[0];
  return row ? mapApiKeyRow(row) : null;
}

export async function markApiKeyUsage(apiKeyId: string): Promise<void> {
  await useConnection((client) =>
    client.query(
      `UPDATE api_keys
          SET last_used_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [apiKeyId]
    )
  );
}

export async function revokeApiKey(
  apiKeyId: string,
  userId: string,
  metadata?: JsonValue | null
): Promise<ApiKeyRecord | null> {
  return useTransaction(async (client) => {
    const { rows } = await client.query<ApiKeyRow>(
      `UPDATE api_keys
          SET revoked_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
          AND user_id = $2
          AND revoked_at IS NULL
        RETURNING *`,
      [apiKeyId, userId]
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    await client.query(
      `INSERT INTO api_key_events (api_key_id, user_id, event, metadata, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
      [row.id, row.user_id, 'revoked', metadata ?? null]
    );
    return mapApiKeyRow(row);
  });
}

export async function recordApiKeyEvent(event: ApiKeyEventInput): Promise<void> {
  await useConnection((client) =>
    client.query(
      `INSERT INTO api_key_events (api_key_id, user_id, event, metadata, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
      [event.apiKeyId, event.userId, event.type, event.metadata ?? null]
    )
  );
}

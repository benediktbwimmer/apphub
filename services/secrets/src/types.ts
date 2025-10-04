import type { JsonValue } from '@apphub/shared';

export type SecretRecord = {
  key: string;
  value: string;
  version?: string | null;
  metadata?: Record<string, JsonValue> | null;
  backend: string;
};

export type SecretConfigEntry = {
  value: string;
  version?: string | null;
  metadata?: Record<string, JsonValue> | null;
};

export type SecretConfig = string | SecretConfigEntry;

export type SecretConfigCollection = Record<string, SecretConfig>;

export type SecretAccessOutcome = 'authorized' | 'forbidden' | 'missing' | 'expired';

export type IssuedSecretToken = {
  id: string;
  token: string;
  tokenHash: string;
  subject: string;
  allowedKeys: Set<string> | '*';
  metadata?: Record<string, JsonValue> | null;
  issuedAt: Date;
  expiresAt: Date;
  refreshCount: number;
};

export type IssueTokenInput = {
  subject: string;
  keys: string[] | '*';
  ttlSeconds?: number | null;
  metadata?: Record<string, JsonValue> | null;
};

export type RefreshTokenResult = {
  token: IssuedSecretToken;
  previousExpiresAt: Date;
};

export type SecretAuditEvent = {
  type: 'secret.access';
  key: string;
  backend: string;
  subject: string;
  tokenId: string;
  tokenHash: string;
  outcome: SecretAccessOutcome;
  version?: string | null;
  reason?: string;
  accessedAt: string;
  expiresAt: string;
  issuedAt: string;
  metadata?: Record<string, JsonValue> | null;
};

export type SecretTokenAuditEvent =
  | {
      type: 'secret.token.issued';
      tokenId: string;
      tokenHash: string;
      subject: string;
      keys: string[] | '*';
      issuedAt: string;
      expiresAt: string;
      metadata?: Record<string, JsonValue> | null;
    }
  | {
      type: 'secret.token.refreshed';
      tokenId: string;
      tokenHash: string;
      subject: string;
      keys: string[] | '*';
      issuedAt: string;
      previousExpiresAt: string;
      expiresAt: string;
      metadata?: Record<string, JsonValue> | null;
    }
  | {
      type: 'secret.token.revoked';
      tokenId: string;
      tokenHash: string;
      subject: string;
      revokedAt: string;
      metadata?: Record<string, JsonValue> | null;
    };

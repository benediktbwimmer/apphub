import type { JsonValue } from './workflowTopology';

type SecretEventBase = {
  subject: string;
  tokenId: string;
  tokenHash: string;
  metadata?: Record<string, JsonValue> | null;
};

export type SecretAccessEvent = {
  type: 'secret.access';
  data: SecretEventBase & {
    key: string;
    backend: string;
    outcome: 'authorized' | 'forbidden' | 'missing' | 'expired';
    version?: string | null;
    reason?: string | null;
    accessedAt: string;
    issuedAt: string;
    expiresAt: string;
  };
};

export type SecretTokenIssuedEvent = {
  type: 'secret.token.issued';
  data: SecretEventBase & {
    keys: string[] | '*';
    issuedAt: string;
    expiresAt: string;
  };
};

export type SecretTokenRefreshedEvent = {
  type: 'secret.token.refreshed';
  data: SecretEventBase & {
    keys: string[] | '*';
    issuedAt: string;
    previousExpiresAt: string;
    expiresAt: string;
  };
};

export type SecretTokenRevokedEvent = {
  type: 'secret.token.revoked';
  data: SecretEventBase & {
    revokedAt: string;
  };
};

export type SecretEvent =
  | SecretAccessEvent
  | SecretTokenIssuedEvent
  | SecretTokenRefreshedEvent
  | SecretTokenRevokedEvent;

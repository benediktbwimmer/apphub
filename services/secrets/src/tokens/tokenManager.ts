import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IssueTokenInput, IssuedSecretToken, RefreshTokenResult } from '../types';

function generateToken(length = 48): string {
  const buffer = randomBytes(length);
  return buffer.toString('base64url');
}

function clampTtl(ttlSeconds: number, maxTtlSeconds: number): number {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    return 0;
  }
  return Math.min(Math.floor(ttlSeconds), maxTtlSeconds);
}

export type SecretTokenManagerOptions = {
  defaultTtlSeconds: number;
  maxTtlSeconds: number;
  now?: () => Date;
};

export class SecretTokenManager {
  private readonly defaultTtlSeconds: number;
  private readonly maxTtlSeconds: number;
  private readonly now: () => Date;
  private readonly tokens = new Map<string, IssuedSecretToken>();

  constructor(options: SecretTokenManagerOptions) {
    this.defaultTtlSeconds = Math.max(options.defaultTtlSeconds, 30);
    this.maxTtlSeconds = Math.max(options.maxTtlSeconds, this.defaultTtlSeconds);
    this.now = options.now ?? (() => new Date());
  }

  issue(input: IssueTokenInput): IssuedSecretToken {
    const ttlCandidate = input.ttlSeconds ?? this.defaultTtlSeconds;
    const ttlSeconds = clampTtl(ttlCandidate, this.maxTtlSeconds) || this.defaultTtlSeconds;
    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);
    const token = generateToken();
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const allowedKeys = input.keys === '*' ? '*' : new Set(input.keys.map((key) => key.trim()).filter(Boolean));
    if (allowedKeys !== '*' && allowedKeys.size === 0) {
      throw new Error('Token scopes cannot be empty');
    }

    const record: IssuedSecretToken = {
      id: randomUUID(),
      token,
      tokenHash,
      subject: input.subject,
      allowedKeys,
      metadata: input.metadata ?? null,
      issuedAt,
      expiresAt,
      refreshCount: 0
    } satisfies IssuedSecretToken;

    this.tokens.set(token, record);
    return record;
  }

  get(token: string): IssuedSecretToken | null {
    const trimmed = token.trim();
    if (!trimmed) {
      return null;
    }
    const record = this.tokens.get(trimmed);
    if (!record) {
      return null;
    }
    if (record.expiresAt.getTime() <= this.now().getTime()) {
      this.tokens.delete(trimmed);
      return null;
    }
    return record;
  }

  refresh(token: string, ttlSeconds?: number | null): RefreshTokenResult | null {
    const record = this.get(token);
    if (!record) {
      return null;
    }
    const now = this.now();
    const ttlCandidate = ttlSeconds ?? this.defaultTtlSeconds;
    const ttl = clampTtl(ttlCandidate, this.maxTtlSeconds) || this.defaultTtlSeconds;
    const previousExpiresAt = record.expiresAt;
    const nextExpiresAt = new Date(now.getTime() + ttl * 1000);
    record.expiresAt = nextExpiresAt;
    record.refreshCount += 1;
    return {
      token: record,
      previousExpiresAt
    } satisfies RefreshTokenResult;
  }

  revoke(token: string): IssuedSecretToken | null {
    const record = this.tokens.get(token);
    if (!record) {
      return null;
    }
    this.tokens.delete(token);
    return record;
  }

  pruneExpired(): number {
    const now = this.now().getTime();
    let removed = 0;
    for (const [token, record] of this.tokens.entries()) {
      if (record.expiresAt.getTime() <= now) {
        this.tokens.delete(token);
        removed += 1;
      }
    }
    return removed;
  }

  listActive(): IssuedSecretToken[] {
    this.pruneExpired();
    return Array.from(this.tokens.values()).map((token) => ({ ...token }));
  }
}

import type { JsonValue } from './workflowTopology';

export type ManagedSecret = {
  key: string;
  value: string | null;
  version: string | null;
  metadata: Record<string, JsonValue> | null;
  backend: string;
  tokenExpiresAt: string;
};

export type SecretsClientConfig = {
  baseUrl: string;
  adminToken: string;
  subject?: string;
  fetchImpl?: typeof fetch;
  tokenTtlSeconds?: number;
  tokenRenewalBufferMs?: number;
  cacheTtlMs?: number;
  logger?: {
    debug?: (message: string, meta?: Record<string, unknown>) => void;
    warn?: (message: string, meta?: Record<string, unknown>) => void;
    error?: (message: string, meta?: Record<string, unknown>) => void;
  };
};

export class SecretsClient {
  private readonly baseUrl: string;
  private readonly adminToken: string;
  private readonly subject: string;
  private readonly fetchImpl: typeof fetch;
  private readonly tokenTtlSeconds: number;
  private readonly tokenRenewalBufferMs: number;
  private readonly cacheTtlMs: number;
  private readonly logger?: SecretsClientConfig['logger'];

  private readonly tokenCache = new Map<string, TokenCacheEntry>();
  private readonly tokenPromises = new Map<string, Promise<TokenCacheEntry>>();
  private readonly secretCache = new Map<string, SecretCacheEntry>();

  constructor(config: SecretsClientConfig) {
    if (!config.baseUrl) {
      throw new Error('SecretsClient requires a baseUrl');
    }
    if (!config.adminToken) {
      throw new Error('SecretsClient requires an adminToken');
    }
    this.baseUrl = config.baseUrl.replace(/\/?$/, '');
    this.adminToken = config.adminToken;
    this.subject = config.subject?.trim() || 'apphub.client';
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (!this.fetchImpl) {
      throw new Error('SecretsClient requires a fetch implementation');
    }
    this.tokenTtlSeconds = Math.max(config.tokenTtlSeconds ?? 300, 60);
    this.tokenRenewalBufferMs = Math.max(config.tokenRenewalBufferMs ?? 5000, 1000);
    this.cacheTtlMs = Math.max(config.cacheTtlMs ?? 10_000, 1000);
    this.logger = config.logger;
  }

  async resolveSecret(key: string, options?: { forceRefresh?: boolean }): Promise<ManagedSecret | null> {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      return null;
    }
    if (!options?.forceRefresh) {
      const cached = this.secretCache.get(trimmedKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.secret;
      }
    }

    const token = await this.ensureToken(trimmedKey);
    const secret = await this.fetchSecret(trimmedKey, token);
    if (!secret) {
      this.secretCache.delete(trimmedKey);
      return null;
    }

    this.secretCache.set(trimmedKey, {
      secret,
      expiresAt: Date.now() + this.cacheTtlMs
    });
    return secret;
  }

  invalidate(key: string): void {
    const trimmed = key.trim();
    if (!trimmed) {
      return;
    }
    this.secretCache.delete(trimmed);
    this.tokenCache.delete(trimmed);
  }

  reset(): void {
    this.secretCache.clear();
    this.tokenCache.clear();
    this.tokenPromises.clear();
  }

  private async ensureToken(key: string): Promise<TokenCacheEntry> {
    const existing = this.tokenCache.get(key);
    if (existing && existing.expiresAt - Date.now() > this.tokenRenewalBufferMs) {
      return existing;
    }
    const pending = this.tokenPromises.get(key);
    if (pending) {
      return pending;
    }
    const promise = this.issueToken(key)
      .then((token) => {
        this.tokenCache.set(key, token);
        return token;
      })
      .finally(() => {
        this.tokenPromises.delete(key);
      });
    this.tokenPromises.set(key, promise);
    return promise;
  }

  private async issueToken(key: string): Promise<TokenCacheEntry> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/tokens`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        subject: this.subject,
        keys: [key],
        ttlSeconds: this.tokenTtlSeconds
      })
    });

    if (!response.ok) {
      const message = await safeReadError(response);
      this.logger?.error?.('Failed to issue secret token', {
        status: response.status,
        statusText: response.statusText,
        message
      });
      throw new Error(`Failed to issue secret token: ${response.status}`);
    }

    const data = (await response.json()) as SecretTokenResponse;
    const expiresAt = Date.parse(data.expiresAt);
    return {
      token: data.token,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + this.tokenTtlSeconds * 1000,
      allowedKeys: data.allowedKeys === '*' ? '*' : new Set(data.allowedKeys)
    } satisfies TokenCacheEntry;
  }

  private async fetchSecret(key: string, token: TokenCacheEntry): Promise<ManagedSecret | null> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/secrets/${encodeURIComponent(key)}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token.token}`
      }
    });

    if (response.status === 404) {
      return null;
    }
    if (response.status === 401 || response.status === 403) {
      this.logger?.warn?.('Secret access denied, invalidating token', {
        key,
        status: response.status
      });
      this.tokenCache.delete(key);
      this.secretCache.delete(key);
      throw new Error(`Secret access forbidden for key ${key}`);
    }
    if (!response.ok) {
      const message = await safeReadError(response);
      this.logger?.error?.('Failed to fetch secret', {
        key,
        status: response.status,
        message
      });
      throw new Error(`Failed to fetch secret: ${response.status}`);
    }

    const data = (await response.json()) as SecretValueResponse;
    return {
      key: data.key,
      value: typeof data.value === 'string' ? data.value : null,
      version: typeof data.version === 'string' ? data.version : null,
      metadata: (data.metadata ?? null) as Record<string, JsonValue> | null,
      backend: data.backend,
      tokenExpiresAt: data.tokenExpiresAt
    } satisfies ManagedSecret;
  }
}

async function safeReadError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 1024);
  } catch {
    return '';
  }
}

type TokenCacheEntry = {
  token: string;
  expiresAt: number;
  allowedKeys: Set<string> | '*';
};

type SecretCacheEntry = {
  secret: ManagedSecret;
  expiresAt: number;
};

type SecretTokenResponse = {
  token: string;
  tokenId: string;
  subject: string;
  issuedAt: string;
  expiresAt: string;
  allowedKeys: string[] | '*';
  tokenHash: string;
  refreshCount: number;
};

type SecretValueResponse = {
  key: string;
  value: string | null;
  version: string | null;
  metadata?: Record<string, JsonValue> | null;
  backend: string;
  tokenExpiresAt: string;
};

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export type TokenScope = 'metastore:read' | 'metastore:write' | 'metastore:delete' | 'metastore:admin';

export type TokenDefinition = {
  token: string;
  subject: string;
  scopes: TokenScope[] | '*';
  namespaces: string[] | '*';
  kind: 'user' | 'service';
};

export type ServiceConfig = {
  host: string;
  port: number;
  authDisabled: boolean;
  tokens: TokenDefinition[];
  defaultNamespace: string;
  metricsEnabled: boolean;
  database: {
    schema: string;
    maxConnections: number;
    idleTimeoutMs: number;
    connectionTimeoutMs: number;
  };
  filestoreSync: {
    enabled: boolean;
    redisUrl: string;
    channel: string;
    namespace: string;
    retryDelayMs: number;
    inline: boolean;
  };
};

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function parsePort(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return parsed;
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

const KNOWN_SCOPES: TokenScope[] = ['metastore:read', 'metastore:write', 'metastore:delete', 'metastore:admin'];

function normalizeScopes(raw: unknown): TokenScope[] | '*'
{
  if (raw === '*' || raw === 'all') {
    return '*';
  }
  if (Array.isArray(raw)) {
    const scopes = raw
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean)
      .filter((scope): scope is TokenScope => (KNOWN_SCOPES as string[]).includes(scope));
    return scopes.length > 0 ? scopes : '*';
  }
  return '*';
}

function normalizeNamespaces(raw: unknown): string[] | '*'
{
  if (raw === '*' || raw === 'all') {
    return '*';
  }
  if (Array.isArray(raw)) {
    const namespaces = raw
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean);
    return namespaces.length > 0 ? namespaces : '*';
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '*') {
      return '*';
    }
    if (trimmed.length > 0) {
      return [trimmed];
    }
  }
  return '*';
}

function toKind(raw: unknown): 'user' | 'service' {
  if (raw === 'service') {
    return 'service';
  }
  return 'user';
}

function resolveTokensFromString(contents: string, source: string): TokenDefinition[] {
  try {
    const parsed = JSON.parse(contents);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const raw = entry as Record<string, unknown>;
        const token = typeof raw.token === 'string' ? raw.token.trim() : '';
        if (!token) {
          return null;
        }
        const subject = typeof raw.subject === 'string' && raw.subject.trim().length > 0
          ? raw.subject.trim()
          : `token:${token.slice(0, 6)}`;
        const scopes = normalizeScopes(raw.scopes);
        const namespaces = normalizeNamespaces(raw.namespaces ?? raw.namespace);
        const kind = toKind(raw.kind);
        return { token, subject, scopes, namespaces, kind } satisfies TokenDefinition;
      })
      .filter((entry): entry is TokenDefinition => entry !== null);
  } catch (err) {
    console.warn(`[metastore:config] Failed to parse token definition from ${source}:`, err);
    return [];
  }
}

function loadTokensFromPath(rawPath: string | undefined): TokenDefinition[] {
  if (!rawPath) {
    return [];
  }
  const resolved = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
  if (!existsSync(resolved)) {
    console.warn(`[metastore:config] Token file not found: ${resolved}`);
    return [];
  }
  try {
    const contents = readFileSync(resolved, 'utf8');
    return resolveTokensFromString(contents, resolved);
  } catch (err) {
    console.warn(`[metastore:config] Failed to read token file ${resolved}:`, err);
    return [];
  }
}

function loadTokens(): TokenDefinition[] {
  const direct = process.env.APPHUB_METASTORE_TOKENS ?? process.env.APPHUB_OPERATOR_TOKENS ?? '';
  const filePath = process.env.APPHUB_METASTORE_TOKENS_PATH ?? process.env.APPHUB_OPERATOR_TOKENS_PATH;

  const fromEnv = direct ? resolveTokensFromString(direct, 'APPHUB_METASTORE_TOKENS') : [];
  const fromFile = loadTokensFromPath(filePath);

  return [...fromFile, ...fromEnv];
}

let cachedConfig: ServiceConfig | null = null;

export function loadServiceConfig(): ServiceConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const host = process.env.HOST ?? '::';
  const port = parsePort(process.env.PORT, 4100);
  const authDisabled = parseBoolean(process.env.APPHUB_AUTH_DISABLED, false);
  const tokens = loadTokens();
  const defaultNamespace = process.env.APPHUB_METASTORE_DEFAULT_NAMESPACE ?? 'default';
  const metricsEnabled = parseBoolean(process.env.APPHUB_METRICS_ENABLED, true);
  const schema = process.env.APPHUB_METASTORE_PG_SCHEMA ?? 'metastore';
  const maxConnections = parseNumber(process.env.APPHUB_METASTORE_PGPOOL_MAX ?? process.env.PGPOOL_MAX, 10);
  const idleTimeoutMs = parseNumber(
    process.env.APPHUB_METASTORE_PGPOOL_IDLE_TIMEOUT_MS ?? process.env.PGPOOL_IDLE_TIMEOUT_MS,
    30_000
  );
  const connectionTimeoutMs = parseNumber(
    process.env.APPHUB_METASTORE_PGPOOL_CONNECTION_TIMEOUT_MS ??
      process.env.PGPOOL_CONNECTION_TIMEOUT_MS,
    10_000
  );
  const filestoreSyncEnabled = parseBoolean(process.env.METASTORE_FILESTORE_SYNC_ENABLED, true);
  const filestoreRedisUrl = process.env.FILESTORE_REDIS_URL || process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const filestoreChannel = process.env.FILESTORE_EVENTS_CHANNEL || 'apphub:filestore';
  const filestoreNamespace = process.env.METASTORE_FILESTORE_NAMESPACE || 'filestore';
  const filestoreRetryDelayMs = parseInt(process.env.METASTORE_FILESTORE_RETRY_MS ?? '', 10);
  const retryDelayMs = Number.isFinite(filestoreRetryDelayMs) && filestoreRetryDelayMs > 0 ? filestoreRetryDelayMs : 3000;
  const inline = filestoreRedisUrl === 'inline';

  cachedConfig = {
    host,
    port,
    authDisabled,
    tokens,
    defaultNamespace,
    metricsEnabled,
    database: {
      schema,
      maxConnections,
      idleTimeoutMs,
      connectionTimeoutMs
    },
    filestoreSync: {
      enabled: filestoreSyncEnabled,
      redisUrl: filestoreRedisUrl,
      channel: filestoreChannel,
      namespace: filestoreNamespace,
      retryDelayMs,
      inline
    }
  } satisfies ServiceConfig;

  return cachedConfig;
}

export function refreshServiceTokens(): TokenDefinition[] {
  const tokens = loadTokens();
  if (cachedConfig) {
    cachedConfig = {
      ...cachedConfig,
      tokens
    } satisfies ServiceConfig;
  }
  return tokens;
}

export function resetServiceConfigCache(): void {
  cachedConfig = null;
}

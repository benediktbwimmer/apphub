import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FilterNode } from '../search/types';
import { parseFilterNode } from '../schemas/filters';

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
  searchPresets: SearchPresetDefinition[];
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
    stallThresholdSeconds: number;
  };
  schemaRegistry: {
    cacheTtlMs: number;
    negativeCacheTtlMs: number;
    refreshAheadMs: number;
    refreshIntervalMs: number;
  };
};

export type SearchPresetDefinition = {
  name: string;
  label?: string;
  description?: string;
  filter: FilterNode;
  requiredScopes: TokenScope[];
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

const DEFAULT_LOCAL_REDIS_URL = 'redis://127.0.0.1:6379';

function isProductionEnv(): boolean {
  const value = process.env.NODE_ENV?.trim().toLowerCase();
  return value === 'production';
}

function normalizeRedisUrl(value: string): string {
  if (value === 'inline') {
    return value;
  }
  return /^redis:\/\//i.test(value) ? value : `redis://${value}`;
}

function allowInlineMode(): boolean {
  return parseBoolean(process.env.APPHUB_ALLOW_INLINE_MODE, false);
}

function assertInlineAllowed(context: string): void {
  if (!allowInlineMode()) {
    throw new Error(`${context} requested inline mode but APPHUB_ALLOW_INLINE_MODE is not enabled`);
  }
}

const KNOWN_SCOPES: TokenScope[] = ['metastore:read', 'metastore:write', 'metastore:delete', 'metastore:admin'];

function parsePresetScopes(raw: unknown): TokenScope[] {
  if (!raw) {
    return ['metastore:read'];
  }

  const coerceToList = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value
        .map((entry) => (typeof entry === 'string' ? entry : ''))
        .filter(Boolean);
    }
    if (typeof value === 'string') {
      return value
        .split(/[\s,]+/)
        .map((segment) => segment.trim())
        .filter(Boolean);
    }
    return [];
  };

  const normalized = new Set<TokenScope>();
  for (const candidate of coerceToList(raw)) {
    if ((KNOWN_SCOPES as string[]).includes(candidate)) {
      normalized.add(candidate as TokenScope);
    }
  }

  if (normalized.size === 0) {
    return ['metastore:read'];
  }

  return Array.from(normalized);
}

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

type RawPresetDefinition = {
  name?: unknown;
  label?: unknown;
  description?: unknown;
  filter?: unknown;
  scopes?: unknown;
  requiredScopes?: unknown;
};

function parsePresetDefinition(raw: RawPresetDefinition, source: string, index: number): SearchPresetDefinition | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) {
    console.warn(`[metastore:config] Preset at index ${index} in ${source} is missing a name`);
    return null;
  }

  if (!raw.filter) {
    console.warn(`[metastore:config] Preset "${name}" in ${source} is missing a filter definition`);
    return null;
  }

  try {
    const filter = parseFilterNode(raw.filter);
    const requiredScopes = parsePresetScopes(raw.requiredScopes ?? raw.scopes);
    const label = typeof raw.label === 'string' ? raw.label.trim() : undefined;
    const description = typeof raw.description === 'string' ? raw.description.trim() : undefined;

    return {
      name,
      label,
      description,
      filter,
      requiredScopes
    } satisfies SearchPresetDefinition;
  } catch (error) {
    console.warn(
      `[metastore:config] Failed to parse preset "${name}" in ${source}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

function resolvePresetsFromString(contents: string, source: string): SearchPresetDefinition[] {
  try {
    const parsed = JSON.parse(contents);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry, index) => parsePresetDefinition(entry as RawPresetDefinition, source, index))
      .filter((entry): entry is SearchPresetDefinition => entry !== null);
  } catch (error) {
    console.warn(`[metastore:config] Failed to parse search preset definition from ${source}:`, error);
    return [];
  }
}

function loadPresetsFromPath(rawPath: string | undefined): SearchPresetDefinition[] {
  if (!rawPath) {
    return [];
  }

  const resolved = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
  if (!existsSync(resolved)) {
    console.warn(`[metastore:config] Search preset file not found: ${resolved}`);
    return [];
  }

  try {
    const contents = readFileSync(resolved, 'utf8');
    return resolvePresetsFromString(contents, resolved);
  } catch (error) {
    console.warn(`[metastore:config] Failed to read search preset file ${resolved}:`, error);
    return [];
  }
}

function loadSearchPresets(): SearchPresetDefinition[] {
  const direct = process.env.APPHUB_METASTORE_SEARCH_PRESETS ?? '';
  const filePath = process.env.APPHUB_METASTORE_SEARCH_PRESETS_PATH;

  const fromEnv = direct ? resolvePresetsFromString(direct, 'APPHUB_METASTORE_SEARCH_PRESETS') : [];
  const fromFile = loadPresetsFromPath(filePath);

  return [...fromFile, ...fromEnv];
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
  const maxConnections = parseNumber(process.env.APPHUB_METASTORE_PGPOOL_MAX ?? process.env.PGPOOL_MAX, 5);
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
  const fallbackRedisUrl = isProductionEnv() ? null : DEFAULT_LOCAL_REDIS_URL;
  const filestoreRedisSource =
    process.env.FILESTORE_REDIS_URL || process.env.REDIS_URL || fallbackRedisUrl;
  const normalizedFilestoreRedisSource = (filestoreRedisSource ?? '').trim();
  if (!normalizedFilestoreRedisSource) {
    throw new Error('Set FILESTORE_REDIS_URL or REDIS_URL to a redis:// connection string');
  }
  const filestoreRedisUrl = normalizeRedisUrl(normalizedFilestoreRedisSource);
  const filestoreChannel = process.env.FILESTORE_EVENTS_CHANNEL || 'apphub:filestore';
  const filestoreNamespace = process.env.METASTORE_FILESTORE_NAMESPACE || 'filestore';
  const filestoreRetryDelayMs = parseInt(process.env.METASTORE_FILESTORE_RETRY_MS ?? '', 10);
  const retryDelayMs = Number.isFinite(filestoreRetryDelayMs) && filestoreRetryDelayMs > 0 ? filestoreRetryDelayMs : 3000;
  const inline = filestoreRedisUrl === 'inline';
  if (inline) {
    assertInlineAllowed('FILESTORE_REDIS_URL');
  }
  const stallThresholdCandidate = parseNumber(
    process.env.METASTORE_FILESTORE_STALL_THRESHOLD_SECONDS,
    60
  );
  const stallThresholdSeconds = stallThresholdCandidate > 0 ? stallThresholdCandidate : 60;

  const schemaCacheTtlSeconds = parseNumber(process.env.APPHUB_METASTORE_SCHEMA_CACHE_TTL_SECONDS, 300);
  const schemaCacheNegativeTtlSeconds = parseNumber(
    process.env.APPHUB_METASTORE_SCHEMA_CACHE_NEGATIVE_TTL_SECONDS,
    60
  );
  const schemaCacheRefreshAheadSeconds = parseNumber(
    process.env.APPHUB_METASTORE_SCHEMA_CACHE_REFRESH_AHEAD_SECONDS,
    60
  );
  const schemaCacheRefreshIntervalSeconds = parseNumber(
    process.env.APPHUB_METASTORE_SCHEMA_CACHE_REFRESH_INTERVAL_SECONDS,
    30
  );

  const cacheTtlMs = schemaCacheTtlSeconds > 0 ? schemaCacheTtlSeconds * 1000 : 0;
  const negativeCacheTtlMs = schemaCacheNegativeTtlSeconds > 0 ? schemaCacheNegativeTtlSeconds * 1000 : 0;
  const refreshAheadMs = schemaCacheRefreshAheadSeconds > 0 ? schemaCacheRefreshAheadSeconds * 1000 : 0;
  const refreshIntervalCandidateMs = schemaCacheRefreshIntervalSeconds > 0
    ? schemaCacheRefreshIntervalSeconds * 1000
    : 30_000;
  const refreshIntervalMs = Math.max(1_000, refreshIntervalCandidateMs);

  cachedConfig = {
    host,
    port,
    authDisabled,
    tokens,
    defaultNamespace,
    metricsEnabled,
    searchPresets: loadSearchPresets(),
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
      inline,
      stallThresholdSeconds
    },
    schemaRegistry: {
      cacheTtlMs,
      negativeCacheTtlMs,
      refreshAheadMs,
      refreshIntervalMs
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

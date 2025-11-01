import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { JsonValue } from '@apphub/shared';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export type BackendKind = 'env' | 'file' | 'vault';

export type EnvBackendConfig = {
  kind: 'env';
  name: string;
};

export type FileBackendConfig = {
  kind: 'file';
  name: string;
  path: string;
  optional: boolean;
};

export type VaultBackendConfig = {
  kind: 'vault';
  name: string;
  path: string;
  namespace?: string | null;
  optional: boolean;
};

export type BackendConfig = EnvBackendConfig | FileBackendConfig | VaultBackendConfig;

export type AdminTokenDefinition = {
  token: string;
  subject: string;
  allowedKeys: string[] | '*';
  maxTtlSeconds: number | null;
  metadata?: Record<string, JsonValue> | null;
};

export type ServiceConfig = {
  host: string;
  port: number;
  metricsEnabled: boolean;
  auditEventSource: string;
  defaultTokenTtlSeconds: number;
  maxTokenTtlSeconds: number;
  adminTokens: AdminTokenDefinition[];
  backends: BackendConfig[];
  refreshIntervalMs: number | null;
  allowInlineFallback: boolean;
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

const ADMIN_TOKEN_SCHEMA = z
  .object({
    token: z.string().min(8, 'token must contain at least 8 characters'),
    subject: z.string().min(1, 'subject is required'),
    allowedKeys: z
      .union([z.literal('*'), z.array(z.string().min(1, 'key cannot be empty'))])
      .default('*'),
    maxTtlSeconds: z
      .number()
      .int()
      .positive()
      .optional(),
    metadata: z.record(z.string(), z.any()).optional()
  })
  .transform((value) => {
    const allowedKeys = value.allowedKeys === '*' ? '*' : Array.from(new Set(value.allowedKeys));
    const trimmedMetadata = value.metadata ? (value.metadata as Record<string, JsonValue>) : null;
    return {
      token: value.token.trim(),
      subject: value.subject.trim(),
      allowedKeys,
      maxTtlSeconds: value.maxTtlSeconds ?? null,
      metadata: trimmedMetadata
    } satisfies AdminTokenDefinition;
  });

function readJsonFile(filePath: string): unknown {
  const absolute = path.resolve(filePath);
  if (!existsSync(absolute)) {
    throw new Error(`Admin token file ${absolute} does not exist`);
  }
  const contents = readFileSync(absolute, 'utf8');
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${absolute}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseAdminTokens(raw: unknown, source: string): AdminTokenDefinition[] {
  if (!raw) {
    return [];
  }
  const schema = z.array(ADMIN_TOKEN_SCHEMA);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid admin token definitions from ${source}: ${parsed.error.message}`);
  }
  const tokens = parsed.data.filter((entry) => entry.token.length > 0 && entry.subject.length > 0);
  return tokens;
}

function loadAdminTokens(): AdminTokenDefinition[] {
  const tokens: AdminTokenDefinition[] = [];
  const inlineRaw = process.env.SECRETS_SERVICE_ADMIN_TOKENS;
  if (inlineRaw) {
    try {
      const parsed = JSON.parse(inlineRaw) as unknown;
      tokens.push(...parseAdminTokens(parsed, 'SECRETS_SERVICE_ADMIN_TOKENS'));
    } catch (error) {
      throw new Error(
        `Failed to parse SECRETS_SERVICE_ADMIN_TOKENS JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  const filePath = process.env.SECRETS_SERVICE_ADMIN_TOKENS_PATH;
  if (filePath) {
    const raw = readJsonFile(filePath);
    tokens.push(...parseAdminTokens(raw, filePath));
  }
  return tokens;
}

function loadBackends(): BackendConfig[] {
  const configured = (process.env.SECRETS_SERVICE_BACKENDS ?? 'env,file')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const unique = Array.from(new Set(configured.length > 0 ? configured : ['env', 'file']));
  const backends: BackendConfig[] = [];
  for (const entry of unique) {
    if (entry === 'env') {
      backends.push({ kind: 'env', name: 'inline-env' });
      continue;
    }
    if (entry === 'file') {
      const filePath = process.env.SECRETS_SERVICE_FILE_PATH ?? process.env.APPHUB_SECRET_STORE_PATH ?? '';
      if (!filePath.trim()) {
        console.warn('[secrets-config] file backend requested but no path configured; skipping');
        continue;
      }
      backends.push({
        kind: 'file',
        name: 'config-file',
        path: path.resolve(filePath.trim()),
        optional: parseBoolean(process.env.SECRETS_SERVICE_FILE_OPTIONAL, false)
      });
      continue;
    }
    if (entry === 'vault') {
      const vaultPath = process.env.SECRETS_SERVICE_VAULT_FILE ?? '';
      if (!vaultPath.trim()) {
        console.warn('[secrets-config] vault backend requested but SECRETS_SERVICE_VAULT_FILE is not set; skipping');
        continue;
      }
      backends.push({
        kind: 'vault',
        name: 'vault',
        path: path.resolve(vaultPath.trim()),
        namespace: process.env.SECRETS_SERVICE_VAULT_NAMESPACE?.trim() || null,
        optional: parseBoolean(process.env.SECRETS_SERVICE_VAULT_OPTIONAL, true)
      });
      continue;
    }
    console.warn(`[secrets-config] unknown backend kind '${entry}', ignoring`);
  }
  if (backends.length === 0) {
    throw new Error('No secret backends configured. Set SECRETS_SERVICE_BACKENDS to include env, file, or vault.');
  }
  return backends;
}

export function loadServiceConfig(): ServiceConfig {
  const host = process.env.SECRETS_SERVICE_HOST?.trim() || '0.0.0.0';
  const port = parsePort(process.env.SECRETS_SERVICE_PORT, 4010);
  const metricsEnabled = parseBoolean(process.env.SECRETS_SERVICE_METRICS_ENABLED, true);
  const auditEventSource = process.env.SECRETS_SERVICE_AUDIT_SOURCE?.trim() || 'secrets.api';
  const defaultTokenTtlSeconds = Math.max(parseNumber(process.env.SECRETS_SERVICE_DEFAULT_TTL, 300), 30);
  const maxTokenTtlSeconds = Math.max(
    parseNumber(process.env.SECRETS_SERVICE_MAX_TTL, Math.max(defaultTokenTtlSeconds, 3600)),
    defaultTokenTtlSeconds
  );
  const refreshIntervalMsRaw = process.env.SECRETS_SERVICE_REFRESH_INTERVAL_MS;
  const refreshIntervalMs = (() => {
    if (!refreshIntervalMsRaw) {
      return null;
    }
    const parsed = Number.parseInt(refreshIntervalMsRaw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  })();
  const allowInlineFallback = parseBoolean(process.env.SECRETS_SERVICE_INLINE_FALLBACK, true);

  const adminTokens = loadAdminTokens();
  if (adminTokens.length === 0) {
    throw new Error('No admin tokens configured. Provide SECRETS_SERVICE_ADMIN_TOKENS or SECRETS_SERVICE_ADMIN_TOKENS_PATH.');
  }

  const backends = loadBackends();

  return {
    host,
    port,
    metricsEnabled,
    auditEventSource,
    defaultTokenTtlSeconds,
    maxTokenTtlSeconds,
    adminTokens,
    backends,
    refreshIntervalMs,
    allowInlineFallback
  } satisfies ServiceConfig;
}

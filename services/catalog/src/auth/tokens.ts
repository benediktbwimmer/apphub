import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyRequest } from 'fastify';
import { recordAuditLog } from '../db/audit';
import type { JsonValue } from '../db/types';

type OperatorScope =
  | 'jobs:write'
  | 'jobs:run'
  | 'workflows:write'
  | 'workflows:run'
  | 'job-bundles:write'
  | 'job-bundles:read';

const ALL_SCOPES: OperatorScope[] = [
  'jobs:write',
  'jobs:run',
  'workflows:write',
  'workflows:run',
  'job-bundles:write',
  'job-bundles:read'
];

const SCOPE_ALIASES: Record<OperatorScope, OperatorScope[]> = {
  'jobs:write': ['job-bundles:write', 'job-bundles:read'],
  'jobs:run': [],
  'workflows:write': [],
  'workflows:run': [],
  'job-bundles:write': ['job-bundles:read'],
  'job-bundles:read': []
};

type OperatorKind = 'user' | 'service';

type OperatorTokenConfig = {
  token: string;
  subject?: string;
  scopes?: OperatorScope[] | '*';
  kind?: OperatorKind;
};

type OperatorTokenSource = OperatorTokenConfig | OperatorTokenConfig[];

export type OperatorIdentity = {
  subject: string;
  scopes: Set<OperatorScope>;
  kind: OperatorKind;
  tokenHash: string;
};

export type AuthorizationResult =
  | {
      ok: true;
      identity: OperatorIdentity;
      log: (status: 'succeeded' | 'failed', metadata?: Record<string, JsonValue>) => Promise<void>;
    }
  | {
      ok: false;
      statusCode: number;
      error: string;
    };

type AuthorizationOptions = {
  action: string;
  resource: string;
  requiredScopes: OperatorScope[];
};

type TokenCacheEntry = {
  identity: OperatorIdentity;
};

let tokenCache: Map<string, TokenCacheEntry> | null = null;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function addScope(target: Set<OperatorScope>, scope: OperatorScope) {
  if (target.has(scope)) {
    return;
  }
  target.add(scope);
  const aliases = SCOPE_ALIASES[scope] ?? [];
  for (const alias of aliases) {
    if ((ALL_SCOPES as string[]).includes(alias)) {
      target.add(alias);
    }
  }
}

function normalizeScopes(scopes?: OperatorScope[] | '*' | null): OperatorScope[] {
  if (!scopes || scopes === '*') {
    return [...ALL_SCOPES];
  }
  const allowed = new Set<OperatorScope>();
  for (const scope of scopes) {
    if ((ALL_SCOPES as string[]).includes(scope)) {
      addScope(allowed, scope as OperatorScope);
    }
  }
  return allowed.size > 0 ? Array.from(allowed) : [...ALL_SCOPES];
}

function toOperatorKind(raw: unknown): OperatorKind {
  if (raw === 'service') {
    return 'service';
  }
  return 'user';
}

function parseConfigEntry(entry: unknown): OperatorTokenConfig | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const raw = entry as Record<string, unknown>;
  const token = typeof raw.token === 'string' ? raw.token.trim() : '';
  if (!token) {
    return null;
  }
  const subject = typeof raw.subject === 'string' ? raw.subject.trim() : undefined;
  const kind = toOperatorKind(raw.kind);
  const scopesRaw = raw.scopes;
  let scopes: OperatorScope[] | '*' | undefined;
  if (scopesRaw === '*') {
    scopes = '*';
  } else if (Array.isArray(scopesRaw)) {
    scopes = scopesRaw.filter((value): value is OperatorScope =>
      (ALL_SCOPES as string[]).includes(String(value))
    );
  }
  return { token, subject, scopes, kind } satisfies OperatorTokenConfig;
}

function loadFromJsonString(raw: string): OperatorTokenConfig[] {
  try {
    const parsed = JSON.parse(raw) as OperatorTokenSource;
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => parseConfigEntry(item))
        .filter((item): item is OperatorTokenConfig => Boolean(item));
    }
    const single = parseConfigEntry(parsed);
    return single ? [single] : [];
  } catch {
    return [];
  }
}

function loadFromFile(filePath: string): OperatorTokenConfig[] {
  try {
    const absolute = path.resolve(filePath);
    if (!existsSync(absolute)) {
      return [];
    }
    const contents = readFileSync(absolute, 'utf8');
    return loadFromJsonString(contents);
  } catch {
    return [];
  }
}

function buildTokenCache(): Map<string, TokenCacheEntry> {
  const cache = new Map<string, TokenCacheEntry>();
  const tokensRaw = process.env.APPHUB_OPERATOR_TOKENS ?? '';
  if (tokensRaw.trim()) {
    for (const config of loadFromJsonString(tokensRaw)) {
      registerToken(cache, config);
    }
  }
  const tokensPath = process.env.APPHUB_OPERATOR_TOKENS_PATH;
  if (tokensPath) {
    for (const config of loadFromFile(tokensPath)) {
      registerToken(cache, config);
    }
  }
  return cache;
}

function registerToken(cache: Map<string, TokenCacheEntry>, config: OperatorTokenConfig): void {
  const token = config.token.trim();
  if (!token || cache.has(token)) {
    return;
  }
  const scopes = new Set(normalizeScopes(config.scopes));
  const subject = config.subject?.trim() || 'operator';
  const tokenHash = hashToken(token);
  cache.set(token, {
    identity: {
      subject,
      scopes,
      kind: config.kind ?? 'user',
      tokenHash
    }
  });
}

function getTokenCache(): Map<string, TokenCacheEntry> {
  if (!tokenCache) {
    tokenCache = buildTokenCache();
  }
  return tokenCache;
}

function extractBearerToken(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  const match = input.trim().match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const token = match[1]?.trim();
  return token && token.length > 0 ? token : null;
}

function findIdentityForToken(token: string): OperatorIdentity | null {
  const cache = getTokenCache();
  const entry = cache.get(token);
  return entry?.identity ?? null;
}

function hasRequiredScopes(identity: OperatorIdentity, required: OperatorScope[]): boolean {
  if (required.length === 0) {
    return true;
  }
  for (const scope of required) {
    if (!identity.scopes.has(scope)) {
      return false;
    }
  }
  return true;
}

async function logAuthorizationFailure(options: {
  request: FastifyRequest;
  action: string;
  resource: string;
  token?: string | null;
  reason: string;
  detail?: JsonValue;
}): Promise<void> {
  await recordAuditLog({
    actor: null,
    actorType: 'unknown',
    tokenHash: options.token ? hashToken(options.token) : null,
    scopes: [],
    action: options.action,
    resource: options.resource,
    status: options.reason,
    ip: options.request.ip,
    userAgent: typeof options.request.headers['user-agent'] === 'string'
      ? options.request.headers['user-agent']
      : null,
    metadata: options.detail ?? null
  });
}

export async function authorizeOperatorAction(
  request: FastifyRequest,
  options: AuthorizationOptions
): Promise<AuthorizationResult> {
  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    await logAuthorizationFailure({
      request,
      action: options.action,
      resource: options.resource,
      reason: 'missing_token'
    });
    return { ok: false, statusCode: 401, error: 'authorization required' };
  }

  const identity = findIdentityForToken(token);
  if (!identity) {
    await logAuthorizationFailure({
      request,
      action: options.action,
      resource: options.resource,
      token,
      reason: 'invalid_token'
    });
    return { ok: false, statusCode: 403, error: 'forbidden' };
  }

  if (!hasRequiredScopes(identity, options.requiredScopes)) {
    await logAuthorizationFailure({
      request,
      action: options.action,
      resource: options.resource,
      token,
      reason: 'insufficient_scope',
      detail: { requiredScopes: options.requiredScopes }
    });
    return { ok: false, statusCode: 403, error: 'forbidden' };
  }

  request.operatorIdentity = identity;

  return {
    ok: true,
    identity,
    async log(status, metadata) {
      await recordAuditLog({
        actor: identity.subject,
        actorType: identity.kind,
        tokenHash: identity.tokenHash,
        scopes: Array.from(identity.scopes),
        action: options.action,
        resource: options.resource,
        status,
        ip: request.ip,
        userAgent: typeof request.headers['user-agent'] === 'string'
          ? request.headers['user-agent']
          : null,
        metadata: metadata ?? null
      });
    }
  };
}

export type { OperatorScope };

declare module 'fastify' {
  interface FastifyRequest {
    operatorIdentity?: OperatorIdentity;
  }
}

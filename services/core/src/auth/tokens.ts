import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyRequest } from 'fastify';
import { recordAuditLog } from '../db/audit';
import type { JsonValue } from '../db/types';
import { getAuthConfig } from '../config/auth';
import {
  resolveSession,
  createSessionCookieOptions,
  createExpiredSessionCookieOptions
} from './sessionManager';
import type { SessionWithAccess } from '../db/sessions';
import { findActiveApiKeyByHash, markApiKeyUsage } from '../db/apiKeys';
import { getUserWithAccess } from '../db/users';
import { hashSha256 } from './crypto';

type OperatorScope =
  | 'jobs:read'
  | 'jobs:write'
  | 'jobs:run'
  | 'workflows:read'
  | 'workflows:write'
  | 'workflows:run'
  | 'job-bundles:write'
  | 'job-bundles:read'
  | 'metastore:read'
  | 'metastore:write'
  | 'metastore:delete'
  | 'metastore:admin'
  | 'auth:manage-api-keys'
  | 'filestore:read'
  | 'filestore:write'
  | 'filestore:admin'
  | 'runtime:write'
  | 'timestore:read'
  | 'timestore:write'
  | 'timestore:admin'
  | 'timestore:sql:read'
  | 'timestore:sql:exec'
  | 'timestore:metrics'
  | 'admin:danger-zone';

const ALL_SCOPES: OperatorScope[] = [
  'jobs:read',
  'jobs:write',
  'jobs:run',
  'workflows:read',
  'workflows:write',
  'workflows:run',
  'job-bundles:write',
  'job-bundles:read',
  'metastore:read',
  'metastore:write',
  'metastore:delete',
  'metastore:admin',
  'auth:manage-api-keys',
  'filestore:read',
  'filestore:write',
  'filestore:admin',
  'runtime:write',
  'timestore:read',
  'timestore:write',
  'timestore:admin',
  'timestore:sql:read',
  'timestore:sql:exec',
  'timestore:metrics',
  'admin:danger-zone'
];

export const OPERATOR_SCOPES: readonly OperatorScope[] = [...ALL_SCOPES];

const SCOPE_ALIASES: Record<OperatorScope, OperatorScope[]> = {
  'jobs:read': [],
  'jobs:write': ['job-bundles:write', 'job-bundles:read', 'jobs:read'],
  'jobs:run': ['jobs:read'],
  'workflows:read': [],
  'workflows:write': ['workflows:read'],
  'workflows:run': ['workflows:read'],
  'job-bundles:write': ['job-bundles:read'],
  'job-bundles:read': [],
  'metastore:read': [],
  'metastore:write': ['metastore:read'],
  'metastore:delete': ['metastore:read'],
  'metastore:admin': ['metastore:write', 'metastore:delete', 'metastore:read'],
  'auth:manage-api-keys': [],
  'filestore:read': [],
  'filestore:write': ['filestore:read'],
  'filestore:admin': ['filestore:write', 'filestore:read'],
  'runtime:write': [],
  'timestore:read': [],
  'timestore:write': ['timestore:read'],
  'timestore:admin': ['timestore:write', 'timestore:read'],
  'timestore:sql:read': [],
  'timestore:sql:exec': ['timestore:sql:read'],
  'timestore:metrics': [],
  'admin:danger-zone': []
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
  authDisabled: boolean;
  userId?: string;
  sessionId?: string;
  apiKeyId?: string;
  displayName?: string | null;
  email?: string | null;
  roles?: string[];
};

const DISABLED_IDENTITY_TEMPLATE: Omit<OperatorIdentity, 'scopes'> = {
  subject: 'local-dev',
  kind: 'service',
  tokenHash: 'auth-disabled',
  authDisabled: true,
  displayName: 'Local Development',
  email: null,
  roles: ['local-admin']
};

function createFullScopeSet(): Set<OperatorScope> {
  const scopes = new Set<OperatorScope>();
  for (const scope of ALL_SCOPES) {
    addScope(scopes, scope);
  }
  return scopes;
}

function createDisabledIdentity(): OperatorIdentity {
  return {
    ...DISABLED_IDENTITY_TEMPLATE,
    scopes: createFullScopeSet()
  } satisfies OperatorIdentity;
}

type SessionCookieInstruction = {
  name: string;
  value: string;
  options: {
    httpOnly: boolean;
    sameSite: 'strict';
    secure: boolean;
    path: string;
    maxAge: number;
  };
};

type AuthorizationOptions = {
  action: string;
  resource: string;
  requiredScopes: OperatorScope[];
  anyOfScopes?: OperatorScope[][];
};

export type AuthorizationSuccess = {
  ok: true;
  identity: OperatorIdentity;
  log: (status: 'succeeded' | 'failed', metadata?: Record<string, JsonValue>) => Promise<void>;
  sessionCookie?: SessionCookieInstruction;
};

export type AuthorizationFailure = {
  ok: false;
  statusCode: number;
  error: string;
  sessionCookie?: SessionCookieInstruction;
};

export type AuthorizationResult = AuthorizationSuccess | AuthorizationFailure;

type TokenCacheEntry = {
  identity: OperatorIdentity;
};

let tokenCache: Map<string, TokenCacheEntry> | null = null;

function hashToken(token: string): string {
  return hashSha256(token);
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
      tokenHash,
      authDisabled: false
    }
  });
}

function getTokenCache(): Map<string, TokenCacheEntry> {
  if (!tokenCache) {
    tokenCache = buildTokenCache();
  }
  return tokenCache;
}

export function resetOperatorTokenCache(): void {
  tokenCache = null;
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

function buildScopeSet(rawScopes: Iterable<string>): Set<OperatorScope> {
  const scopes = new Set<OperatorScope>();
  for (const scope of rawScopes) {
    if ((ALL_SCOPES as string[]).includes(scope)) {
      addScope(scopes, scope as OperatorScope);
    }
  }
  return scopes;
}

function hasRequiredScopes(
  identity: OperatorIdentity,
  required: OperatorScope[],
  anyOfScopes?: OperatorScope[][]
): boolean {
  for (const scope of required) {
    if (!identity.scopes.has(scope)) {
      return false;
    }
  }

  if (!anyOfScopes || anyOfScopes.length === 0) {
    return true;
  }

  return anyOfScopes.some((group) => {
    if (group.length === 0) {
      return true;
    }
    for (const scope of group) {
      if (!identity.scopes.has(scope)) {
        return false;
      }
    }
    return true;
  });
}

function getCookies(request: FastifyRequest): Record<string, string> {
  const candidate = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  if (!candidate) {
    return {};
  }
  return candidate;
}

function buildIdentityFromSession(session: SessionWithAccess): OperatorIdentity {
  const scopes = buildScopeSet(session.scopes);
  if (scopes.size === 0) {
    for (const scope of ALL_SCOPES) {
      addScope(scopes, scope);
    }
  }
  const subject = session.user.primaryEmail || `user:${session.user.id}`;
  return {
    subject,
    scopes,
    kind: session.user.kind,
    tokenHash: session.session.sessionTokenHash,
    authDisabled: false,
    userId: session.user.id,
    sessionId: session.session.id,
    displayName: session.user.displayName,
    email: session.user.primaryEmail,
    roles: session.roles.map((role) => role.slug)
  } satisfies OperatorIdentity;
}

async function resolveSessionIdentity(
  request: FastifyRequest,
  cookieValue: string,
  cookieName: string
): Promise<{ identity: OperatorIdentity; sessionCookie?: SessionCookieInstruction } | null> {
  const result = await resolveSession({
    cookieValue,
    ip: request.ip,
    userAgent: typeof request.headers['user-agent'] === 'string'
      ? request.headers['user-agent']
      : null
  });
  if (!result) {
    return null;
  }
  const identity = buildIdentityFromSession(result.session);
  let sessionCookie: SessionCookieInstruction | undefined;
  if (result.renewedCookieValue) {
    sessionCookie = {
      name: cookieName,
      value: result.renewedCookieValue,
      options: createSessionCookieOptions()
    } satisfies SessionCookieInstruction;
  }
  return { identity, sessionCookie };
}

async function resolveApiKeyIdentity(token: string): Promise<OperatorIdentity | null> {
  const record = await findActiveApiKeyByHash(hashToken(token));
  if (!record) {
    return null;
  }
  const access = await getUserWithAccess(record.userId);
  if (!access) {
    return null;
  }
  const userScopeSet = new Set(access.scopes);
  const requestedScopes = record.scopes.length > 0 ? record.scopes : Array.from(userScopeSet);
  const filteredScopes = requestedScopes.filter((scope) => userScopeSet.has(scope));
  const scopes = buildScopeSet(filteredScopes);
  if (scopes.size === 0) {
    return null;
  }
  await markApiKeyUsage(record.id);
  return {
    subject: `api-key:${record.prefix}`,
    scopes,
    kind: access.user.kind,
    tokenHash: record.tokenHash,
    authDisabled: false,
    userId: access.user.id,
    apiKeyId: record.id,
    displayName: access.user.displayName,
    email: access.user.primaryEmail,
    roles: access.roles.map((role) => role.slug)
  } satisfies OperatorIdentity;
}

function buildSuccessResult(
  request: FastifyRequest,
  identity: OperatorIdentity,
  options: AuthorizationOptions,
  sessionCookie?: SessionCookieInstruction
): AuthorizationSuccess {
  request.operatorIdentity = identity;
  const userAgent = typeof request.headers['user-agent'] === 'string'
    ? request.headers['user-agent']
    : null;
  return {
    ok: true,
    identity,
    sessionCookie,
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
        userAgent,
        metadata: metadata ?? null
      });
    }
  } satisfies AuthorizationSuccess;
}

async function logAuthorizationFailure(input: {
  request: FastifyRequest;
  action: string;
  resource: string;
  reason: string;
  token?: string | null;
  tokenHash?: string | null;
  detail?: JsonValue;
}): Promise<void> {
  const userAgent = typeof input.request.headers['user-agent'] === 'string'
    ? input.request.headers['user-agent']
    : null;
  const hashed = input.tokenHash ?? (input.token ? hashToken(input.token) : null);
  await recordAuditLog({
    actor: null,
    actorType: 'unknown',
    tokenHash: hashed,
    scopes: [],
    action: input.action,
    resource: input.resource,
    status: input.reason,
    ip: input.request.ip,
    userAgent,
    metadata: input.detail ?? null
  });
}

export async function authorizeOperatorAction(
  request: FastifyRequest,
  options: AuthorizationOptions
): Promise<AuthorizationResult> {
  const config = getAuthConfig();

  if (!config.enabled) {
    const identity = createDisabledIdentity();
    request.operatorIdentity = identity;
    return {
      ok: true,
      identity,
      async log() {
        // Auth is disabled; skip audit logging for local development mode.
      }
    } satisfies AuthorizationSuccess;
  }

  const cookies = getCookies(request);
  const cookieName = config.sessionCookieName;
  const sessionCookieValue = cookies[cookieName];
  let sessionCookieInstruction: SessionCookieInstruction | undefined;

  if (config.sessionSecret && sessionCookieValue) {
    const sessionResult = await resolveSessionIdentity(request, sessionCookieValue, cookieName);
    if (sessionResult) {
      if (!hasRequiredScopes(sessionResult.identity, options.requiredScopes, options.anyOfScopes)) {
        await logAuthorizationFailure({
          request,
          action: options.action,
          resource: options.resource,
          reason: 'insufficient_scope',
          tokenHash: sessionResult.identity.tokenHash,
          detail: {
            requiredScopes: options.requiredScopes,
            anyOfScopes: options.anyOfScopes ?? []
          }
        });
        return {
          ok: false,
          statusCode: 403,
          error: 'forbidden',
          sessionCookie: sessionResult.sessionCookie
        } satisfies AuthorizationFailure;
      }
      return buildSuccessResult(request, sessionResult.identity, options, sessionResult.sessionCookie);
    }
    sessionCookieInstruction = {
      name: cookieName,
      value: '',
      options: createExpiredSessionCookieOptions()
    } satisfies SessionCookieInstruction;
  }

  const bearerToken = extractBearerToken(request.headers.authorization);
  if (bearerToken) {
    const apiKeyIdentity = await resolveApiKeyIdentity(bearerToken);
    if (apiKeyIdentity) {
      if (!hasRequiredScopes(apiKeyIdentity, options.requiredScopes, options.anyOfScopes)) {
        await logAuthorizationFailure({
          request,
          action: options.action,
          resource: options.resource,
          reason: 'insufficient_scope',
          tokenHash: apiKeyIdentity.tokenHash,
          detail: {
            requiredScopes: options.requiredScopes,
            anyOfScopes: options.anyOfScopes ?? []
          }
        });
        return {
          ok: false,
          statusCode: 403,
          error: 'forbidden',
          sessionCookie: sessionCookieInstruction
        } satisfies AuthorizationFailure;
      }
      return buildSuccessResult(request, apiKeyIdentity, options, sessionCookieInstruction);
    }

    if (config.legacyTokensEnabled) {
      const legacyIdentity = findIdentityForToken(bearerToken);
      if (legacyIdentity) {
        if (!hasRequiredScopes(legacyIdentity, options.requiredScopes, options.anyOfScopes)) {
          await logAuthorizationFailure({
            request,
            action: options.action,
            resource: options.resource,
            reason: 'insufficient_scope',
            tokenHash: legacyIdentity.tokenHash,
            detail: {
              requiredScopes: options.requiredScopes,
              anyOfScopes: options.anyOfScopes ?? []
            }
          });
          return {
            ok: false,
            statusCode: 403,
            error: 'forbidden',
            sessionCookie: sessionCookieInstruction
          } satisfies AuthorizationFailure;
        }
        return buildSuccessResult(request, legacyIdentity, options, sessionCookieInstruction);
      }
    }

    await logAuthorizationFailure({
      request,
      action: options.action,
      resource: options.resource,
      reason: 'invalid_token',
      token: bearerToken
    });
    return {
      ok: false,
      statusCode: 403,
      error: 'forbidden',
      sessionCookie: sessionCookieInstruction
    } satisfies AuthorizationFailure;
  }

  if (sessionCookieInstruction) {
    await logAuthorizationFailure({
      request,
      action: options.action,
      resource: options.resource,
      reason: 'invalid_session'
    });
    return {
      ok: false,
      statusCode: 401,
      error: 'authorization required',
      sessionCookie: sessionCookieInstruction
    } satisfies AuthorizationFailure;
  }

  await logAuthorizationFailure({
    request,
    action: options.action,
    resource: options.resource,
    reason: 'missing_token'
  });
  return {
    ok: false,
    statusCode: 401,
    error: 'authorization required'
  } satisfies AuthorizationFailure;
}

export type { OperatorScope };

declare module 'fastify' {
  interface FastifyRequest {
    operatorIdentity?: OperatorIdentity;
  }
}

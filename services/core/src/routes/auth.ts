import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireOperatorScopes } from './shared/operatorAuth';
import { getAuthConfig } from '../config/auth';
import {
  encodeLoginStateCookie,
  decodeLoginStateCookie,
  decodeSessionCookie
} from '../auth/cookies';
import {
  createSession,
  createSessionCookieOptions,
  createExpiredSessionCookieOptions
} from '../auth/sessionManager';
import {
  createAuthorizationRequest,
  exchangeAuthorizationCode
} from '../auth/oidc';
import { upsertUserIdentityWithAccess } from '../db/users';
import {
  createApiKey,
  listApiKeysForUser,
  revokeApiKey,
  type ApiKeyRecord
} from '../db/apiKeys';
import {
  loadSessionWithAccess,
  deleteSession
} from '../db/sessions';
import { hashSha256 } from '../auth/crypto';
import { recordAuditLog } from '../db/audit';
import { OPERATOR_SCOPES, type OperatorScope } from '../auth/tokens';
import { schemaRef } from '../openapi/definitions';

const loginQuerySchema = z.object({
  redirectTo: z.string().optional()
});

const callbackQuerySchema = z.object({
  state: z.string().min(3),
  code: z.string().min(3)
});

const createApiKeySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  scopes: z.array(z.string().min(1)).optional(),
  expiresAt: z.string().datetime().optional()
});

const apiKeyCreateRequestSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    scopes: { type: 'array', items: { type: 'string', minLength: 1 } },
    expiresAt: { type: 'string', format: 'date-time' }
  }
} as const;

const optionalApiKeyCreateRequestSchema = {
  anyOf: [
    apiKeyCreateRequestSchema,
    { type: 'null' },
    { type: 'object', additionalProperties: false, properties: {} }
  ]
} as const;

function sanitizeRedirect(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  if (!input.startsWith('/')) {
    return undefined;
  }
  if (input.startsWith('//')) {
    return undefined;
  }
  return input;
}

function toOperatorScope(scope: string): OperatorScope | null {
  if ((OPERATOR_SCOPES as ReadonlyArray<string>).includes(scope)) {
    return scope as OperatorScope;
  }
  return null;
}

function getRequestCookies(request: FastifyRequest): Record<string, string> {
  const candidate = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  return candidate ?? {};
}

function jsonResponse(schemaName: string, description: string) {
  return {
    description,
    content: {
      'application/json': {
        schema: schemaRef(schemaName)
      }
    }
  } as const;
}

const errorResponse = (description: string) => jsonResponse('ErrorResponse', description);

const identityResponse = jsonResponse.bind(null, 'IdentityResponse');

const apiKeyListResponse = jsonResponse.bind(null, 'ApiKeyListResponse');

const apiKeyCreateResponse = jsonResponse.bind(null, 'ApiKeyCreateResponse');

function serializeApiKey(record: ApiKeyRecord) {
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    scopes: record.scopes,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastUsedAt: record.lastUsedAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt
  };
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/auth/login',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Initiate OIDC login',
        description:
          'Generates an OAuth authorization request and redirects the browser to the configured identity provider.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            redirectTo: {
              type: 'string',
              description: 'Optional relative path to redirect to after successful authentication.'
            }
          }
        },
        response: {
          302: { description: 'Redirect to the external identity provider.' },
          400: errorResponse('The request query parameters were invalid.'),
          503: errorResponse('Single sign-on is not enabled on this instance.'),
          500: errorResponse('The identity provider request failed.')
        }
      }
    },
    async (request, reply) => {
    const config = getAuthConfig();
    if (!config.enabled) {
      reply.status(503);
      return { error: 'auth_disabled' };
    }
    if (!config.oidc.enabled) {
      reply.status(503);
      return { error: 'sso_disabled' };
    }
    if (!config.sessionSecret) {
      reply.status(500);
      return { error: 'session_secret_missing' };
    }

    const parseResult = loginQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      reply.status(400);
      return { error: 'invalid_request', details: parseResult.error.flatten() };
    }

    const redirectTo = sanitizeRedirect(parseResult.data.redirectTo);

    try {
      const authRequest = await createAuthorizationRequest();
      const loginStateCookie = encodeLoginStateCookie(
        {
          state: authRequest.state,
          codeVerifier: authRequest.codeVerifier,
          nonce: authRequest.nonce,
          issuedAt: Math.floor(Date.now() / 1000),
          redirectTo
        },
        config.sessionSecret
      );

      reply.setCookie(
        config.loginStateCookieName,
        loginStateCookie,
        {
          httpOnly: true,
          sameSite: 'lax',
          secure: config.sessionCookieSecure,
          path: '/',
          maxAge: 10 * 60
        }
      );

      reply.redirect(authRequest.authorizationUrl);
      return reply;
    } catch (err) {
      request.log.error({ err }, 'failed to initialize oidc login');
      reply.status(500);
      return { error: 'oidc_unavailable' };
    }
    }
  );

  app.get(
    '/auth/callback',
    {
      schema: {
        tags: ['Auth'],
        summary: 'OIDC login callback',
        description:
          'Handles the OAuth authorization response, issues a secure session cookie, and redirects back to the application.',
        querystring: {
          type: 'object',
          required: ['state', 'code'],
          additionalProperties: false,
          properties: {
            state: { type: 'string', description: 'Opaque login state value issued during the authorization request.' },
            code: { type: 'string', description: 'Authorization code returned by the identity provider.' }
          }
        },
        response: {
          302: { description: 'User is redirected to the requested application page.' },
          400: errorResponse('The login state or authorization payload was invalid.'),
          403: errorResponse('The authenticated identity is not allowed to access the platform.'),
          500: errorResponse('The identity provider request failed.'),
          503: errorResponse('Single sign-on is not enabled on this instance.')
        }
      }
    },
    async (request, reply) => {
    const config = getAuthConfig();
    if (!config.enabled) {
      reply.status(503);
      return { error: 'auth_disabled' };
    }
    if (!config.oidc.enabled || !config.sessionSecret) {
      reply.status(503);
      return { error: 'sso_disabled' };
    }

    const parseResult = callbackQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      reply.status(400);
      return { error: 'invalid_request', details: parseResult.error.flatten() };
    }

    const cookies = getRequestCookies(request);
    const loginStateCookie = cookies[config.loginStateCookieName];
    if (!loginStateCookie) {
      reply.status(400);
      return { error: 'missing_login_state' };
    }

    const statePayload = decodeLoginStateCookie(loginStateCookie, config.sessionSecret);
    reply.setCookie(
      config.loginStateCookieName,
      '',
      {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.sessionCookieSecure,
        path: '/',
        maxAge: 0
      }
    );

    if (!statePayload || statePayload.state !== parseResult.data.state) {
      reply.status(400);
      return { error: 'invalid_login_state' };
    }

    try {
      const tokenSet = await exchangeAuthorizationCode({
        state: parseResult.data.state,
        code: parseResult.data.code,
        codeVerifier: statePayload.codeVerifier,
        nonce: statePayload.nonce
      });

      const claims = tokenSet.claims();
      if (!claims) {
        reply.status(403);
        return { error: 'email_verification_required' };
      }
      const providerSubject = typeof claims.sub === 'string' ? claims.sub : null;
      const email = typeof claims.email === 'string' ? claims.email : null;
      const emailVerified = claims.email_verified !== false;

      if (!providerSubject || !email || !emailVerified) {
        reply.status(403);
        return { error: 'email_verification_required' };
      }

      const domain = email.split('@')[1]?.toLowerCase();
      if (config.oidc.allowedDomains.size > 0 && (!domain || !config.oidc.allowedDomains.has(domain))) {
        reply.status(403);
        return { error: 'unauthorized_domain' };
      }

      const displayName = typeof claims.name === 'string' ? claims.name : null;
      const avatarUrl = typeof claims.picture === 'string' ? claims.picture : null;

      const access = await upsertUserIdentityWithAccess({
        provider: config.oidc.issuer ?? 'oidc',
        providerSubject,
        email,
        displayName,
        avatarUrl
      });

      const sessionResult = await createSession({
        userId: access.user.id,
        ip: request.ip,
        userAgent: typeof request.headers['user-agent'] === 'string'
          ? request.headers['user-agent']
          : null
      });

      reply.setCookie(
        config.sessionCookieName,
        sessionResult.cookieValue,
        createSessionCookieOptions()
      );

      const sessionAccess = sessionResult.session;
      await recordAuditLog({
        actor: access.user.primaryEmail,
        actorType: access.user.kind,
        tokenHash: sessionAccess.session.sessionTokenHash,
        scopes: sessionAccess.scopes,
        action: 'auth.login',
        resource: 'auth/session',
        status: 'succeeded',
        ip: request.ip,
        userAgent: typeof request.headers['user-agent'] === 'string'
          ? request.headers['user-agent']
          : null,
        metadata: {
          userId: access.user.id,
          provider: config.oidc.issuer ?? 'oidc'
        }
      });

      const redirectTo = sanitizeRedirect(statePayload.redirectTo) ?? '/';
      reply.redirect(redirectTo);
      return reply;
    } catch (err) {
      request.log.error({ err }, 'oidc_callback_failed');
      reply.status(500);
      return { error: 'oidc_callback_failed' };
    }
    }
  );

  app.post(
    '/auth/logout',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Terminate current session',
        description: "Revokes the caller's active session and clears the session cookie.",
        security: [{ OperatorToken: [] }],
        response: {
          204: { description: 'The session was terminated.' }
        }
      }
    },
    async (request, reply) => {
    const config = getAuthConfig();
    if (!config.enabled) {
      reply.setCookie(
        config.sessionCookieName,
        '',
        createExpiredSessionCookieOptions()
      );
      reply.status(204);
      return reply;
    }
    const sessionCookie = getRequestCookies(request)[config.sessionCookieName];
    if (sessionCookie && config.sessionSecret) {
      const payload = decodeSessionCookie(sessionCookie, config.sessionSecret);
      if (payload) {
        const tokenHash = hashSha256(payload.token);
        const session = await loadSessionWithAccess(payload.id, tokenHash, new Date());
        if (session) {
          await recordAuditLog({
            actor: session.user.primaryEmail,
            actorType: session.user.kind,
            tokenHash: session.session.sessionTokenHash,
            scopes: session.scopes,
            action: 'auth.logout',
            resource: 'auth/session',
            status: 'succeeded',
            ip: request.ip,
            userAgent: typeof request.headers['user-agent'] === 'string'
              ? request.headers['user-agent']
              : null,
            metadata: { userId: session.user.id }
          });
        }
        await deleteSession(payload.id);
      }
    }

    reply.setCookie(
      config.sessionCookieName,
      '',
      createExpiredSessionCookieOptions()
    );
    reply.status(204);
    return reply;
    }
  );

  app.get(
    '/auth/identity',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Retrieve authenticated identity',
        description:
          'Returns the subject, scopes, and metadata for the active session, API key, or operator token.',
        security: [{ OperatorToken: [] }],
        response: {
          200: identityResponse('Identity details.'),
          401: errorResponse('No valid session or authorization token was provided.'),
          403: errorResponse('The caller did not have permission to inspect identity information.')
        }
      }
    },
    async (request, reply) => {
    const result = await requireOperatorScopes(request, reply, {
      action: 'auth.identity.read',
      resource: 'identity',
      requiredScopes: []
    });
    if (!result.ok) {
      return { error: result.error };
    }

    const identity = result.auth.identity;
    const scopes = Array.from(identity.scopes);
    reply.status(200);
    return {
      data: {
        subject: identity.subject,
        kind: identity.kind,
        scopes,
        authDisabled: identity.authDisabled,
        userId: identity.userId ?? null,
        sessionId: identity.sessionId ?? null,
        apiKeyId: identity.apiKeyId ?? null,
        displayName: identity.displayName ?? null,
        email: identity.email ?? null,
        roles: identity.roles ?? []
      }
    };
    }
  );

  app.get(
    '/auth/api-keys',
    {
      schema: {
        tags: ['Auth'],
        summary: 'List API keys',
        description: 'Returns the API keys owned by the authenticated user.',
        security: [{ OperatorToken: [] }],
        response: {
          200: apiKeyListResponse('API keys for the current user.'),
          401: errorResponse('No valid session or authorization token was provided.'),
          403: errorResponse('The caller is not authorized to list API keys.'),
          503: errorResponse('Authentication is disabled on this instance.')
        }
      }
    },
    async (request, reply) => {
    const config = getAuthConfig();
    if (!config.enabled) {
      reply.status(200);
      return {
        data: {
          keys: []
        }
      };
    }
    const result = await requireOperatorScopes(request, reply, {
      action: 'auth.api-keys.list',
      resource: 'auth/api-keys',
      requiredScopes: [config.apiKeyScope as OperatorScope]
    });
    if (!result.ok) {
      return { error: result.error };
    }

    const identity = result.auth.identity;
    if (!identity.userId) {
      reply.status(403);
      return { error: 'session_required' };
    }

    const keys = await listApiKeysForUser(identity.userId);
    reply.status(200);
    return {
      data: {
        keys: keys.map((key) => serializeApiKey(key))
      }
    };
    }
  );

  app.post(
    '/auth/api-keys',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Create API key',
        description: 'Mints a new API key scoped to the authenticated user.',
        security: [{ OperatorToken: [] }],
        body: optionalApiKeyCreateRequestSchema,
        response: {
          201: apiKeyCreateResponse('API key created successfully.'),
          400: errorResponse('The API key request payload was invalid.'),
          401: errorResponse('No valid session or authorization token was provided.'),
          403: errorResponse('The caller is not authorized to create API keys.'),
          503: errorResponse('Authentication is disabled on this instance.')
        }
      }
    },
    async (request, reply) => {
    const config = getAuthConfig();
    if (!config.enabled) {
      reply.status(503);
      return { error: 'auth_disabled' };
    }
    const result = await requireOperatorScopes(request, reply, {
      action: 'auth.api-keys.create',
      resource: 'auth/api-keys',
      requiredScopes: [config.apiKeyScope as OperatorScope]
    });
    if (!result.ok) {
      return { error: result.error };
    }

    const identity = result.auth.identity;
    if (!identity.userId) {
      reply.status(403);
      return { error: 'session_required' };
    }

    const parseResult = createApiKeySchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      await result.auth.log('failed', { reason: 'invalid_payload', details: parseResult.error.flatten() });
      reply.status(400);
      return { error: 'invalid_payload', details: parseResult.error.flatten() };
    }

    const requestedScopes = parseResult.data.scopes
      ?.map((scope) => toOperatorScope(scope))
      .filter((scope): scope is OperatorScope => scope !== null);
    const availableScopes = Array.from(identity.scopes);
    const selectedScopes = requestedScopes && requestedScopes.length > 0
      ? requestedScopes.filter((scope) => identity.scopes.has(scope))
      : availableScopes;
    const scopes = Array.from(new Set(selectedScopes));

    if (scopes.length === 0) {
      await result.auth.log('failed', { reason: 'invalid_scopes', details: parseResult.data.scopes ?? [] });
      reply.status(400);
      return { error: 'invalid_scopes' };
    }

    let expiresAt: Date | null = null;
    if (parseResult.data.expiresAt) {
      const expiresDate = new Date(parseResult.data.expiresAt);
      if (Number.isNaN(expiresDate.getTime())) {
        await result.auth.log('failed', { reason: 'invalid_expiry', value: parseResult.data.expiresAt });
        reply.status(400);
        return { error: 'invalid_expires_at' };
      }
      expiresAt = expiresDate;
    }

    const { record, token } = await createApiKey({
      userId: identity.userId,
      name: parseResult.data.name ?? null,
      scopes,
      expiresAt
    });

    await result.auth.log('succeeded', { event: 'api_key.create', apiKeyId: record.id });

    reply.status(201);
    return {
      data: {
        key: serializeApiKey(record),
        token
      }
    };
    }
  );

  app.delete(
    '/auth/api-keys/:id',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Revoke API key',
        description: 'Revokes an API key owned by the authenticated user.',
        security: [{ OperatorToken: [] }],
        params: {
          type: 'object',
          required: ['id'],
          additionalProperties: false,
          properties: {
            id: { type: 'string', description: 'Unique identifier of the API key to revoke.' }
          }
        },
        response: {
          204: { description: 'The API key was revoked.' },
          401: errorResponse('No valid session or authorization token was provided.'),
          400: errorResponse('The API key identifier was invalid.'),
          403: errorResponse('The caller is not authorized to revoke API keys.'),
          404: errorResponse('No API key matched the supplied identifier.'),
          503: errorResponse('Authentication is disabled on this instance.')
        }
      }
    },
    async (request, reply) => {
    const config = getAuthConfig();
    if (!config.enabled) {
      reply.status(503);
      return { error: 'auth_disabled' };
    }
    const result = await requireOperatorScopes(request, reply, {
      action: 'auth.api-keys.revoke',
      resource: 'auth/api-keys',
      requiredScopes: [config.apiKeyScope as OperatorScope]
    });
    if (!result.ok) {
      return { error: result.error };
    }

    const identity = result.auth.identity;
    if (!identity.userId) {
      reply.status(403);
      return { error: 'session_required' };
    }

    const apiKeyId = String((request.params as Record<string, unknown>).id ?? '').trim();
    if (!apiKeyId) {
      reply.status(400);
      return { error: 'invalid_id' };
    }

    const revoked = await revokeApiKey(apiKeyId, identity.userId);
    if (!revoked) {
      await result.auth.log('failed', { reason: 'not_found', apiKeyId });
      reply.status(404);
      return { error: 'not_found' };
    }

    await result.auth.log('succeeded', { event: 'api_key.revoke', apiKeyId });

    reply.status(204);
    return reply;
    }
  );
}

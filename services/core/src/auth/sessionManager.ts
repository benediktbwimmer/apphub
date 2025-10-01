import { randomBytes, randomUUID } from 'node:crypto';
import { encodeSessionCookie, decodeSessionCookie, type SessionCookiePayload } from './cookies';
import { hashSha256, toBase64Url } from './crypto';
import { getAuthConfig } from '../config/auth';
import {
  createSessionRecord,
  loadSessionWithAccess,
  updateSessionActivity,
  type SessionWithAccess
} from '../db/sessions';

export type CreateSessionOptions = {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
};

export type CreateSessionResult = {
  session: SessionWithAccess;
  cookieValue: string;
};

export type ResolveSessionOptions = {
  cookieValue: string | undefined;
  ip?: string | null;
  userAgent?: string | null;
};

export type ResolveSessionResult = {
  session: SessionWithAccess;
  renewedCookieValue?: string;
};

function generateSessionToken(): { id: string; token: string; tokenHash: string } {
  const id = `sess_${randomUUID()}`;
  const token = toBase64Url(randomBytes(32));
  const tokenHash = hashSha256(token);
  return { id, token, tokenHash };
}

export async function createSession(options: CreateSessionOptions): Promise<CreateSessionResult> {
  const config = getAuthConfig();
  if (!config.sessionSecret) {
    throw new Error('APPHUB_SESSION_SECRET is not configured');
  }
  const { id, token, tokenHash } = generateSessionToken();
  const now = Date.now();
  const expiresAt = new Date(now + config.sessionTtlSeconds * 1000);

  await createSessionRecord({
    id,
    userId: options.userId,
    sessionTokenHash: tokenHash,
    expiresAt,
    ip: options.ip ?? null,
    userAgent: options.userAgent ?? null
  });

  const session = await loadSessionWithAccess(id, tokenHash, new Date());
  if (!session) {
    throw new Error('Failed to load session after creation');
  }

  const cookiePayload: SessionCookiePayload = {
    id,
    token,
    issuedAt: Math.floor(now / 1000)
  };

  const cookieValue = encodeSessionCookie(cookiePayload, config.sessionSecret);

  return {
    session,
    cookieValue
  } satisfies CreateSessionResult;
}

export async function resolveSession(options: ResolveSessionOptions): Promise<ResolveSessionResult | null> {
  const config = getAuthConfig();
  if (!options.cookieValue || !config.sessionSecret) {
    return null;
  }
  const payload = decodeSessionCookie(options.cookieValue, config.sessionSecret);
  if (!payload) {
    return null;
  }

  const tokenHash = hashSha256(payload.token);
  const now = new Date();
  const session = await loadSessionWithAccess(payload.id, tokenHash, now);
  if (!session) {
    return null;
  }

  const expiresAtMs = new Date(session.session.expiresAt).getTime();
  const nowMs = now.getTime();
  const renewThresholdMs = config.sessionRenewSeconds * 1000;
  let renewedCookieValue: string | undefined;

  if (expiresAtMs - nowMs <= renewThresholdMs) {
    const newExpiresAt = new Date(nowMs + config.sessionTtlSeconds * 1000);
    await updateSessionActivity({
      sessionId: session.session.id,
      lastSeenAt: now,
      expiresAt: newExpiresAt,
      ip: options.ip ?? null,
      userAgent: options.userAgent ?? null
    });
    session.session.expiresAt = newExpiresAt.toISOString();
    const renewedPayload: SessionCookiePayload = {
      id: payload.id,
      token: payload.token,
      issuedAt: Math.floor(nowMs / 1000)
    };
    renewedCookieValue = encodeSessionCookie(renewedPayload, config.sessionSecret);
  } else {
    await updateSessionActivity({
      sessionId: session.session.id,
      lastSeenAt: now,
      ip: options.ip ?? null,
      userAgent: options.userAgent ?? null
    });
  }

  return {
    session,
    renewedCookieValue
  } satisfies ResolveSessionResult;
}

export function createSessionCookieOptions(): {
  httpOnly: boolean;
  sameSite: 'strict';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  const config = getAuthConfig();
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.sessionCookieSecure,
    path: '/',
    maxAge: config.sessionTtlSeconds
  };
}

export function createExpiredSessionCookieOptions(): {
  httpOnly: boolean;
  sameSite: 'strict';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  const config = getAuthConfig();
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.sessionCookieSecure,
    path: '/',
    maxAge: 0
  };
}

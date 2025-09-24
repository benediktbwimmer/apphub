import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  authorizeOperatorAction,
  type AuthorizationResult,
  type OperatorScope
} from '../../auth/tokens';

export type OperatorAuthSuccess = Extract<AuthorizationResult, { ok: true }>;

export type RequireOperatorScopesOptions = {
  action: string;
  resource: string;
  requiredScopes: OperatorScope[];
};

export type RequireOperatorScopesResult =
  | { ok: true; auth: OperatorAuthSuccess }
  | { ok: false; statusCode: number; error: string };

export async function requireOperatorScopes(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RequireOperatorScopesOptions
): Promise<RequireOperatorScopesResult> {
  const auth = await authorizeOperatorAction(request, options);
  if (!auth.ok) {
    reply.status(auth.statusCode);
    if (auth.sessionCookie) {
      reply.setCookie(auth.sessionCookie.name, auth.sessionCookie.value, auth.sessionCookie.options);
    }
    return { ok: false, statusCode: auth.statusCode, error: auth.error };
  }
  if (auth.sessionCookie) {
    reply.setCookie(auth.sessionCookie.name, auth.sessionCookie.value, auth.sessionCookie.options);
  }
  return { ok: true, auth };
}

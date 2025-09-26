import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TokenScope } from '../config/serviceConfig';
import { canAccessNamespace, hasScope } from '../auth/identity';

export function ensureScope(
  request: FastifyRequest,
  reply: FastifyReply,
  scope: TokenScope
): boolean {
  if (hasScope(request.identity, scope)) {
    return true;
  }
  reply.code(403).send({
    statusCode: 403,
    error: 'Forbidden',
    message: `Missing required scope: ${scope}`
  });
  return false;
}

export function ensureNamespaceAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  namespace: string
): boolean {
  if (canAccessNamespace(request.identity, namespace)) {
    return true;
  }
  reply.code(403).send({
    statusCode: 403,
    error: 'Forbidden',
    message: `Access denied for namespace ${namespace}`
  });
  return false;
}

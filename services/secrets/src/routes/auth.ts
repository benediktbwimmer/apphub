import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AdminTokenDefinition } from '../config/serviceConfig';

const BEARER_PREFIX = 'bearer ';

export function getBearerToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization ?? request.headers.Authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }
  const trimmed = authHeader.trim();
  if (!trimmed.toLowerCase().startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = trimmed.slice(BEARER_PREFIX.length).trim();
  return token || null;
}

function timingSafeCompare(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return timingSafeEqual(aBuffer, bBuffer);
}

export function findAdminToken(
  token: string,
  adminTokens: AdminTokenDefinition[]
): AdminTokenDefinition | null {
  for (const candidate of adminTokens) {
    if (timingSafeCompare(candidate.token, token)) {
      return candidate;
    }
  }
  return null;
}

export function requireAdminToken(
  request: FastifyRequest,
  reply: FastifyReply,
  adminTokens: AdminTokenDefinition[]
): AdminTokenDefinition | null {
  const bearer = getBearerToken(request);
  if (!bearer) {
    void reply.status(401).send({ error: 'unauthorized', message: 'Missing bearer token' });
    return null;
  }
  const admin = findAdminToken(bearer, adminTokens);
  if (!admin) {
    void reply.status(403).send({ error: 'forbidden', message: 'Invalid admin token' });
    return null;
  }
  return admin;
}

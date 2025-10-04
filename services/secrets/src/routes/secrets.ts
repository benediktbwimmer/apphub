import type { FastifyInstance } from 'fastify';
import type { SecretTokenManager } from '../tokens/tokenManager';
import type { SecretRegistry } from '../backends/registry';
import { getBearerToken } from './auth';
import { publishSecretAuditEvent } from '../audit/publisher';
import type { SecretAccessOutcome } from '../types';

export type SecretsRouteDependencies = {
  tokenManager: SecretTokenManager;
  registry: SecretRegistry;
  allowInlineFallback: boolean;
};

function isKeyAllowed(allowed: Set<string> | '*', key: string): boolean {
  if (allowed === '*') {
    return true;
  }
  return allowed.has(key);
}

function tryInlineFallback(key: string): { value: string; backend: string } | null {
  const raw = process.env[key];
  if (typeof raw === 'string' && raw.length > 0) {
    return { value: raw, backend: 'env-inline' };
  }
  return null;
}

export async function registerSecretRoutes(
  app: FastifyInstance,
  deps: SecretsRouteDependencies
): Promise<void> {
  app.get('/v1/secrets/:key', async (request, reply) => {
    const bearer = getBearerToken(request);
    if (!bearer) {
      return reply.status(401).send({ error: 'unauthorized', message: 'Missing bearer token' });
    }

    const tokenRecord = deps.tokenManager.get(bearer);
    if (!tokenRecord) {
      return reply.status(401).send({ error: 'unauthorized', message: 'Token expired or invalid' });
    }

    const params = request.params as { key: string };
    const key = params.key.trim();
    if (!key) {
      return reply.status(400).send({ error: 'invalid_request', message: 'Key is required' });
    }

    let outcome: SecretAccessOutcome = 'authorized';
    let reason: string | undefined;

    if (!isKeyAllowed(tokenRecord.allowedKeys, key)) {
      outcome = 'forbidden';
      reason = 'scope_mismatch';
      await publishSecretAuditEvent({
        type: 'secret.access',
        key,
        backend: 'registry',
        subject: tokenRecord.subject,
        tokenId: tokenRecord.id,
        tokenHash: tokenRecord.tokenHash,
        outcome,
        reason,
        accessedAt: new Date().toISOString(),
        issuedAt: tokenRecord.issuedAt.toISOString(),
        expiresAt: tokenRecord.expiresAt.toISOString(),
        metadata: tokenRecord.metadata ?? null
      });
      return reply.status(403).send({ error: 'forbidden', message: 'Token not authorized for key' });
    }

    let secret = deps.registry.getSecret(key);
    if (!secret && deps.allowInlineFallback) {
      const fallback = tryInlineFallback(key);
      if (fallback) {
        secret = {
          key,
          value: fallback.value,
          backend: fallback.backend,
          version: null,
          metadata: null
        };
      }
    }

    if (!secret) {
      outcome = 'missing';
      reason = 'not_found';
      await publishSecretAuditEvent({
        type: 'secret.access',
        key,
        backend: 'registry',
        subject: tokenRecord.subject,
        tokenId: tokenRecord.id,
        tokenHash: tokenRecord.tokenHash,
        outcome,
        reason,
        accessedAt: new Date().toISOString(),
        issuedAt: tokenRecord.issuedAt.toISOString(),
        expiresAt: tokenRecord.expiresAt.toISOString(),
        metadata: tokenRecord.metadata ?? null
      });
      return reply.status(404).send({ error: 'not_found', message: 'Secret not found' });
    }

    await publishSecretAuditEvent({
      type: 'secret.access',
      key,
      backend: secret.backend,
      subject: tokenRecord.subject,
      tokenId: tokenRecord.id,
      tokenHash: tokenRecord.tokenHash,
      outcome,
      version: secret.version ?? null,
      accessedAt: new Date().toISOString(),
      issuedAt: tokenRecord.issuedAt.toISOString(),
      expiresAt: tokenRecord.expiresAt.toISOString(),
      metadata: tokenRecord.metadata ?? null
    });

    return reply
      .header('cache-control', 'no-store')
      .send({
        key: secret.key,
        value: secret.value,
        version: secret.version ?? null,
        metadata: secret.metadata ?? null,
        backend: secret.backend,
        tokenExpiresAt: tokenRecord.expiresAt.toISOString()
      });
  });
}

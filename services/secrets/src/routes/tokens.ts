import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { JsonValue } from '@apphub/shared';
import type { SecretTokenManager } from '../tokens/tokenManager';
import type { ServiceConfig, AdminTokenDefinition } from '../config/serviceConfig';
import { publishSecretTokenEvent } from '../audit/publisher';
import { requireAdminToken } from './auth';
import type { SecretRegistry } from '../backends/registry';

const ISSUE_BODY_SCHEMA = z.object({
  subject: z.string().trim().min(1, 'subject is required'),
  keys: z.union([z.literal('*'), z.array(z.string().trim().min(1, 'key cannot be empty'))]),
  ttlSeconds: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.any()).optional()
});

const REFRESH_BODY_SCHEMA = z
  .object({
    ttlSeconds: z.number().int().positive().optional()
  })
  .optional();

export type TokenRouteDependencies = {
  tokenManager: SecretTokenManager;
  config: ServiceConfig;
  adminTokens: AdminTokenDefinition[];
  registry: SecretRegistry;
};

function serializeKeys(keys: Set<string> | '*'): string[] | '*'
{
  if (keys === '*') {
    return '*';
  }
  return Array.from(keys);
}

function ensureScopesAllowed(
  admin: AdminTokenDefinition,
  requested: string[] | '*'
): void {
  if (admin.allowedKeys === '*') {
    return;
  }
  if (requested === '*') {
    throw new Error('Admin token does not allow wildcard scopes');
  }
  const missing = requested.filter((key) => !admin.allowedKeys.includes(key));
  if (missing.length > 0) {
    throw new Error(`Admin token does not allow scopes: ${missing.join(', ')}`);
  }
}

function resolveTtlSeconds(
  requested: number | undefined,
  admin: AdminTokenDefinition,
  config: ServiceConfig
): number {
  const requestedTtl = requested ?? config.defaultTokenTtlSeconds;
  const adminMax = admin.maxTtlSeconds ?? config.maxTokenTtlSeconds;
  return Math.min(requestedTtl, adminMax, config.maxTokenTtlSeconds);
}

export async function registerTokenRoutes(
  app: FastifyInstance,
  deps: TokenRouteDependencies
): Promise<void> {
  app.post('/v1/tokens', async (request, reply) => {
    const admin = requireAdminToken(request, reply, deps.adminTokens);
    if (!admin) {
      return reply;
    }
    const parsed = ISSUE_BODY_SCHEMA.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_request', message: parsed.error.message });
    }
    const body = parsed.data;
    const subject = body.subject;
    const normalizedKeys = body.keys === '*' ? '*' : Array.from(new Set(body.keys.map((key) => key.trim()).filter(Boolean)));
    if (normalizedKeys !== '*' && normalizedKeys.length === 0) {
      return reply.status(400).send({ error: 'invalid_request', message: 'At least one key must be provided' });
    }

    try {
      ensureScopesAllowed(admin, normalizedKeys);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Scope validation failed';
      return reply.status(403).send({ error: 'forbidden', message });
    }

    const ttlSeconds = resolveTtlSeconds(body.ttlSeconds, admin, deps.config);
    const metadata = {
      issuedBy: admin.subject,
      ...(body.metadata ?? {})
    } as Record<string, JsonValue>;

    const issued = deps.tokenManager.issue({
      subject,
      keys: normalizedKeys,
      ttlSeconds,
      metadata
    });

    await publishSecretTokenEvent({
      type: 'secret.token.issued',
      tokenId: issued.id,
      tokenHash: issued.tokenHash,
      subject: issued.subject,
      keys: serializeKeys(issued.allowedKeys),
      issuedAt: issued.issuedAt.toISOString(),
      expiresAt: issued.expiresAt.toISOString(),
      metadata: issued.metadata ?? null
    });

    return reply.status(201).send({
      token: issued.token,
      tokenId: issued.id,
      subject: issued.subject,
      issuedAt: issued.issuedAt.toISOString(),
      expiresAt: issued.expiresAt.toISOString(),
      allowedKeys: serializeKeys(issued.allowedKeys),
      tokenHash: issued.tokenHash,
      refreshCount: issued.refreshCount
    });
  });

  app.post('/v1/tokens/:token/refresh', async (request, reply) => {
    const admin = requireAdminToken(request, reply, deps.adminTokens);
    if (!admin) {
      return reply;
    }
    const params = request.params as { token: string };
    const parsed = REFRESH_BODY_SCHEMA.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_request', message: parsed.error.message });
    }
    const ttlSeconds = resolveTtlSeconds(parsed.data?.ttlSeconds, admin, deps.config);

    const existing = deps.tokenManager.get(params.token);
    if (!existing) {
      return reply.status(404).send({ error: 'not_found', message: 'Token not found or expired' });
    }

    try {
      const existingScopes = existing.allowedKeys === '*'
        ? '*'
        : Array.from(existing.allowedKeys);
      ensureScopesAllowed(admin, existingScopes);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Scope validation failed';
      return reply.status(403).send({ error: 'forbidden', message });
    }

    const result = deps.tokenManager.refresh(params.token, ttlSeconds);
    if (!result) {
      return reply.status(404).send({ error: 'not_found', message: 'Token not found or expired' });
    }

    await publishSecretTokenEvent({
      type: 'secret.token.refreshed',
      tokenId: result.token.id,
      tokenHash: result.token.tokenHash,
      subject: result.token.subject,
      keys: serializeKeys(result.token.allowedKeys),
      issuedAt: result.token.issuedAt.toISOString(),
      previousExpiresAt: result.previousExpiresAt.toISOString(),
      expiresAt: result.token.expiresAt.toISOString(),
      metadata: result.token.metadata ?? null
    });

    return reply.send({
      tokenId: result.token.id,
      subject: result.token.subject,
      expiresAt: result.token.expiresAt.toISOString(),
      allowedKeys: serializeKeys(result.token.allowedKeys),
      refreshCount: result.token.refreshCount
    });
  });

  app.delete('/v1/tokens/:token', async (request, reply) => {
    const admin = requireAdminToken(request, reply, deps.adminTokens);
    if (!admin) {
      return reply;
    }
    const params = request.params as { token: string };
    const record = deps.tokenManager.revoke(params.token);
    if (!record) {
      return reply.status(404).send({ error: 'not_found', message: 'Token not found' });
    }

    await publishSecretTokenEvent({
      type: 'secret.token.revoked',
      tokenId: record.id,
      tokenHash: record.tokenHash,
      subject: record.subject,
      revokedAt: new Date().toISOString(),
      metadata: record.metadata ?? null
    });

    return reply.status(204).send();
  });

  app.post('/v1/secrets/refresh', async (request, reply) => {
    const admin = requireAdminToken(request, reply, deps.adminTokens);
    if (!admin) {
      return reply;
    }

    try {
      const snapshot = await deps.registry.refresh();
      return reply.send({ status: 'ok', snapshot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'refresh_failed', message });
    }
  });
}

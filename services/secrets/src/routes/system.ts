import type { FastifyInstance } from 'fastify';
import type { SecretRegistry } from '../backends/registry';
import type { SecretTokenManager } from '../tokens/tokenManager';

export type SystemRouteDependencies = {
  registry: SecretRegistry;
  tokenManager: SecretTokenManager;
};

export async function registerSystemRoutes(
  app: FastifyInstance,
  deps: SystemRouteDependencies
): Promise<void> {
  app.get('/healthz', async () => {
    const snapshot = deps.registry.getSnapshot();
    return {
      status: 'ok',
      secrets: snapshot?.total ?? 0
    };
  });

  app.get('/readyz', async (request, reply) => {
    const snapshot = deps.registry.getSnapshot();
    if (!snapshot) {
      return reply.status(503).send({ status: 'initializing' });
    }
    return {
      status: 'ready',
      refreshedAt: snapshot.refreshedAt,
      secrets: snapshot.total
    };
  });

  app.get('/v1/status', async () => {
    const snapshot = deps.registry.getSnapshot();
    const tokens = deps.tokenManager.listActive();
    return {
      secrets: snapshot,
      activeTokens: tokens.map((token) => ({
        id: token.id,
        subject: token.subject,
        expiresAt: token.expiresAt.toISOString(),
        issuedAt: token.issuedAt.toISOString(),
        refreshCount: token.refreshCount,
        allowedKeys: token.allowedKeys === '*' ? '*' : Array.from(token.allowedKeys)
      }))
    };
  });
}

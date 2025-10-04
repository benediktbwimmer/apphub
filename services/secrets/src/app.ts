import Fastify, { type FastifyInstance } from 'fastify';
import { loadServiceConfig, type ServiceConfig } from './config/serviceConfig';
import { EnvSecretBackend } from './backends/envBackend';
import { FileSecretBackend } from './backends/fileBackend';
import { VaultSecretBackend } from './backends/vaultBackend';
import { SecretRegistry } from './backends/registry';
import { SecretTokenManager } from './tokens/tokenManager';
import { registerSystemRoutes } from './routes/system';
import { registerTokenRoutes } from './routes/tokens';
import { registerSecretRoutes } from './routes/secrets';
import { closeAuditPublisher } from './audit/publisher';
import type { SecretBackend } from './backends/base';

export type BuildAppOptions = {
  config?: ServiceConfig;
  skipInitialRefresh?: boolean;
};

function createBackends(config: ServiceConfig): SecretBackend[] {
  return config.backends.map((backend) => {
    switch (backend.kind) {
      case 'env':
        return new EnvSecretBackend({ name: backend.name });
      case 'file':
        return new FileSecretBackend({ path: backend.path, name: backend.name, optional: backend.optional });
      case 'vault':
        return new VaultSecretBackend({ path: backend.path, namespace: backend.namespace, name: backend.name, optional: backend.optional });
      default: {
        const unknownBackend: never = backend;
        throw new Error(`Unsupported backend kind: ${(unknownBackend as { kind: string }).kind}`);
      }
    }
  });
}

export async function buildApp(options?: BuildAppOptions): Promise<{
  app: FastifyInstance;
  config: ServiceConfig;
  registry: SecretRegistry;
  tokenManager: SecretTokenManager;
}> {
  const config = options?.config ?? loadServiceConfig();
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info'
    }
  });

  const backends = createBackends(config);
  const registry = new SecretRegistry(backends);
  if (!options?.skipInitialRefresh) {
    await registry.refresh();
  }

  const tokenManager = new SecretTokenManager({
    defaultTtlSeconds: config.defaultTokenTtlSeconds,
    maxTtlSeconds: config.maxTokenTtlSeconds
  });

  const pruneTimer = setInterval(() => {
    const removed = tokenManager.pruneExpired();
    if (removed > 0) {
      app.log.debug({ removed }, 'pruned expired secret tokens');
    }
  }, 60_000);
  pruneTimer.unref();

  let refreshTimer: NodeJS.Timeout | null = null;
  if (config.refreshIntervalMs && config.refreshIntervalMs > 0) {
    refreshTimer = setInterval(() => {
      registry
        .refresh()
        .then((snapshot) => {
          app.log.debug({ total: snapshot.total }, 'refreshed secrets registry');
        })
        .catch((error) => {
          app.log.error({ err: error }, 'failed to refresh secrets registry');
        });
    }, config.refreshIntervalMs);
    refreshTimer.unref();
  }

  await registerSystemRoutes(app, { registry, tokenManager });
  await registerTokenRoutes(app, {
    tokenManager,
    config,
    adminTokens: config.adminTokens,
    registry
  });
  await registerSecretRoutes(app, {
    tokenManager,
    registry,
    allowInlineFallback: config.allowInlineFallback
  });

  app.addHook('onClose', async () => {
    clearInterval(pruneTimer);
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    await closeAuditPublisher();
  });

  return { app, config, registry, tokenManager };
}

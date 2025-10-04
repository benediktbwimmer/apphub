import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerTokenRoutes } from '../src/routes/tokens';
import { SecretTokenManager } from '../src/tokens/tokenManager';
import type { AdminTokenDefinition, ServiceConfig } from '../src/config/serviceConfig';
import type { SecretRegistry } from '../src/backends/registry';
import * as auditPublisher from '../src/audit/publisher';

const noopPublish = mock.method(auditPublisher, 'publishSecretTokenEvent', async () => {
  // no-op for tests
});

test('refresh denies when admin scopes do not cover token allowed keys', async () => {
  const app = Fastify();
  const manager = new SecretTokenManager({ defaultTtlSeconds: 60, maxTtlSeconds: 300 });
  const adminToken: AdminTokenDefinition = {
    token: 'admin-token',
    subject: 'test-admin',
    allowedKeys: ['foo'],
    maxTtlSeconds: null,
    metadata: null
  };
  const config: ServiceConfig = {
    host: '127.0.0.1',
    port: 0,
    metricsEnabled: false,
    auditEventSource: 'test',
    defaultTokenTtlSeconds: 60,
    maxTokenTtlSeconds: 300,
    adminTokens: [adminToken],
    backends: [],
    refreshIntervalMs: null,
    allowInlineFallback: false
  };
  const registry = {
    refresh: async () => ({ total: 0, backends: [], refreshedAt: new Date().toISOString(), durationMs: 0 }),
    getSecret: () => null,
    listSecrets: () => [],
    getSnapshot: () => null
  } as unknown as SecretRegistry;

  await registerTokenRoutes(app, {
    tokenManager: manager,
    config,
    adminTokens: [adminToken],
    registry
  });

  noopPublish.mock.resetCalls();

  const issued = manager.issue({ subject: 'worker', keys: ['bar'] });

  const response = await app.inject({
    method: 'POST',
    url: `/v1/tokens/${issued.token}/refresh`,
    headers: {
      authorization: `Bearer ${adminToken.token}`
    }
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.payload), {
    error: 'forbidden',
    message: 'Admin token does not allow scopes: bar'
  });
  assert.equal(noopPublish.mock.callCount(), 0);

  await app.close();
});

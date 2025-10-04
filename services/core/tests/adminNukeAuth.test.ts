import { ensureEmbeddedPostgres } from './setupTestEnv';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { registerAdminRoutes } from '../src/routes/admin';
import { ensureDatabase } from '../src/db';
import { resetOperatorTokenCache } from '../src/auth/tokens';

test('admin nuke routes require the admin danger scope', async (t) => {
  const viewerToken = 'admin-nuke-auth-viewer';
  const adminToken = 'admin-nuke-auth-admin';
  const originalTokensEnv = process.env.APPHUB_OPERATOR_TOKENS;

  process.env.APPHUB_OPERATOR_TOKENS = JSON.stringify([
    {
      subject: 'viewer',
      token: viewerToken,
      scopes: ['jobs:read', 'workflows:read', 'job-bundles:read', 'filestore:read']
    },
    {
      subject: 'admin',
      token: adminToken,
      scopes: ['admin:danger-zone']
    }
  ]);
  resetOperatorTokenCache();

  await ensureEmbeddedPostgres();
  await ensureDatabase();

  const app = Fastify();
  await app.register(cookie);
  await registerAdminRoutes(app);

  t.after(async () => {
    await app.close();
    process.env.APPHUB_OPERATOR_TOKENS = originalTokensEnv;
    resetOperatorTokenCache();
  });

  const unauthorizedResponse = await app.inject({
    method: 'POST',
    url: '/admin/core/nuke',
    headers: { authorization: `Bearer ${viewerToken}` }
  });
  assert.equal(unauthorizedResponse.statusCode, 403, unauthorizedResponse.body);

  const runDataResponse = await app.inject({
    method: 'POST',
    url: '/admin/core/nuke/run-data',
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert.equal(runDataResponse.statusCode, 200, runDataResponse.body);

  const coreResponse = await app.inject({
    method: 'POST',
    url: '/admin/core/nuke',
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert.equal(coreResponse.statusCode, 200, coreResponse.body);

  const everythingResponse = await app.inject({
    method: 'POST',
    url: '/admin/core/nuke/everything',
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert.equal(everythingResponse.statusCode, 200, everythingResponse.body);
});

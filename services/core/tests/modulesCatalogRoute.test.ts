import './setupTestEnv';
import assert from 'node:assert/strict';
import path from 'node:path';

async function run(): Promise<void> {
  process.env.APPHUB_EVENTS_MODE = 'inline';
  process.env.REDIS_URL = 'inline';
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';
  process.env.APPHUB_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
  const [{ buildServer }, { queueManager }, { invalidateModuleCatalog }] = await Promise.all([
    import('../src/server'),
    import('../src/queueManager'),
    import('../src/modules/catalogService')
  ]);
  await invalidateModuleCatalog();
  const app = await buildServer();
  await app.ready();

  try {
    const response = await app.inject({ method: 'GET', url: '/modules/catalog' });
    assert.equal(response.statusCode, 200, 'module catalog route should respond with 200');
    const payload = response.json() as {
      data?: { catalog: { scenarios: unknown[]; jobs: unknown[]; workflows: unknown[] } };
    };
    assert(payload.data, 'core payload should include data');
    assert(Array.isArray(payload.data?.catalog.scenarios), 'scenarios should be an array');
    assert(Array.isArray(payload.data?.catalog.jobs), 'jobs should be an array');
    assert(Array.isArray(payload.data?.catalog.workflows), 'workflows should be an array');
    assert((payload.data?.catalog.jobs.length ?? 0) > 0, 'jobs should not be empty');
    assert((payload.data?.catalog.workflows.length ?? 0) > 0, 'workflows should not be empty');
  } finally {
    await app.close();
    await queueManager.closeConnection();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

import './setupTestEnv';
import assert from 'node:assert/strict';
import path from 'node:path';

async function run(): Promise<void> {
  process.env.APPHUB_EVENTS_MODE = 'inline';
  process.env.REDIS_URL = 'inline';
  process.env.APPHUB_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
  const [{ buildServer }, { queueManager }, { invalidateExampleCatalog }] = await Promise.all([
    import('../src/server'),
    import('../src/queueManager'),
    import('../src/examples/catalogService')
  ]);
  await invalidateExampleCatalog();
  const app = await buildServer();
  await app.ready();

  try {
    const response = await app.inject({ method: 'GET', url: '/examples/catalog' });
    assert.equal(response.statusCode, 200, 'catalog route should respond with 200');
    const payload = response.json() as {
      data?: { catalog: { scenarios: unknown[]; jobs: unknown[]; workflows: unknown[] } };
    };
    assert(payload.data, 'catalog payload should include data');
    assert(Array.isArray(payload.data?.catalog.scenarios), 'scenarios should be an array');
    assert(Array.isArray(payload.data?.catalog.jobs), 'jobs should be an array');
    assert(Array.isArray(payload.data?.catalog.workflows), 'workflows should be an array');
    assert(payload.data?.catalog.scenarios.length ?? 0 > 0, 'scenarios should not be empty');
  } finally {
    await app.close();
    await queueManager.closeConnection();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

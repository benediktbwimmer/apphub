import './setupTestEnv';
import assert from 'node:assert/strict';
import path from 'node:path';

async function run(): Promise<void> {
  process.env.APPHUB_EVENTS_MODE = 'inline';
process.env.REDIS_URL = 'inline';
process.env.APPHUB_ALLOW_INLINE_MODE = 'true';
  process.env.APPHUB_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
  const [{ buildServer }, { queueManager }, { invalidateExampleCore }] = await Promise.all([
    import('../src/server'),
    import('../src/queueManager'),
    import('../src/examples/coreService')
  ]);
  await invalidateExampleCore();
  const app = await buildServer();
  await app.ready();

  try {
    const response = await app.inject({ method: 'GET', url: '/examples/core' });
    assert.equal(response.statusCode, 200, 'core route should respond with 200');
    const payload = response.json() as {
      data?: { core: { scenarios: unknown[]; jobs: unknown[]; workflows: unknown[] } };
    };
    assert(payload.data, 'core payload should include data');
    assert(Array.isArray(payload.data?.core.scenarios), 'scenarios should be an array');
    assert(Array.isArray(payload.data?.core.jobs), 'jobs should be an array');
    assert(Array.isArray(payload.data?.core.workflows), 'workflows should be an array');
    assert(payload.data?.core.scenarios.length ?? 0 > 0, 'scenarios should not be empty');
  } finally {
    await app.close();
    await queueManager.closeConnection();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

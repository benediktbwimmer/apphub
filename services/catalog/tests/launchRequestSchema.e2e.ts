// Smoke-test the launch request schema to ensure optional command and launchId are accepted.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function run() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'launch-schema-'));
  const dbPath = path.join(tempRoot, 'catalog.db');
  process.env.CATALOG_DB_PATH = dbPath;
  process.env.REDIS_URL = 'inline';

  const { launchRequestSchema } = await import('../src/server');

  const validPayload = {
    buildId: 'build-1',
    resourceProfile: 'standard',
    env: [
      { key: 'HELLO', value: 'world' },
      { key: 'PORT', value: '8080' }
    ],
    command: 'docker run -d apphub-image',
    launchId: 'launch-123'
  };

  const parsed = launchRequestSchema.safeParse(validPayload);
  assert(parsed.success, `Expected payload to be valid: ${parsed.success ? '' : parsed.error.message}`);

  const invalid = launchRequestSchema.safeParse({ ...validPayload, extra: 'nope' });
  assert(!invalid.success, 'Unexpected success when payload includes unknown properties');

  await rm(tempRoot, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

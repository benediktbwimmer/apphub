// Smoke-test the launch request schema to ensure optional command and launchId are accepted.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runE2E } from '@apphub/test-helpers';

runE2E(async ({ registerCleanup }) => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'launch-schema-'));
  registerCleanup(() => rm(tempRoot, { recursive: true, force: true }));

  const previousCoreDbPath = process.env.CORE_DB_PATH;
  const previousRedisUrl = process.env.REDIS_URL;

  process.env.CORE_DB_PATH = path.join(tempRoot, 'core.db');
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

  registerCleanup(() => {
    if (previousCoreDbPath === undefined) {
      delete process.env.CORE_DB_PATH;
    } else {
      process.env.CORE_DB_PATH = previousCoreDbPath;
    }
    if (previousRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previousRedisUrl;
    }
  });

  const { launchRequestSchema } = await import('../src/routes/repositories');

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
}, { name: 'core-launchRequestSchema.e2e' });

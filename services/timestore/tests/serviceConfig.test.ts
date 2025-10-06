import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

let originalScratch: string | undefined;
let originalStaging: string | undefined;
let originalRedis: string | undefined;
let originalDatabase: string | undefined;
let originalInline: string | undefined;
let configModule: typeof import('../src/config/serviceConfig');
let scratchRoot: string;

beforeEach(async () => {
  originalScratch = process.env.APPHUB_SCRATCH_ROOT;
  originalStaging = process.env.TIMESTORE_STAGING_DIRECTORY;
  originalRedis = process.env.REDIS_URL;
  originalDatabase = process.env.TIMESTORE_DATABASE_URL;
  originalInline = process.env.APPHUB_ALLOW_INLINE_MODE;

  process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  process.env.TIMESTORE_DATABASE_URL =
    process.env.TIMESTORE_DATABASE_URL ?? 'postgres://apphub:apphub@localhost:5432/apphub';
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';

  scratchRoot = await mkdtemp(path.join(tmpdir(), 'timestore-scratch-'));
  configModule = await import('../src/config/serviceConfig');
});

afterEach(async () => {
  process.env.APPHUB_SCRATCH_ROOT = originalScratch;
  if (originalStaging === undefined) {
    delete process.env.TIMESTORE_STAGING_DIRECTORY;
  } else {
    process.env.TIMESTORE_STAGING_DIRECTORY = originalStaging;
  }
  if (originalRedis === undefined) {
    delete process.env.REDIS_URL;
  } else {
    process.env.REDIS_URL = originalRedis;
  }
  if (originalDatabase === undefined) {
    delete process.env.TIMESTORE_DATABASE_URL;
  } else {
    process.env.TIMESTORE_DATABASE_URL = originalDatabase;
  }
  if (originalInline === undefined) {
    delete process.env.APPHUB_ALLOW_INLINE_MODE;
  } else {
    process.env.APPHUB_ALLOW_INLINE_MODE = originalInline;
  }
  configModule.resetCachedServiceConfig();
  await rm(scratchRoot, { recursive: true, force: true });
});

test('staging directory defaults to scratch root when not provided', () => {
  process.env.APPHUB_SCRATCH_ROOT = scratchRoot;
  delete process.env.TIMESTORE_STAGING_DIRECTORY;
  configModule.resetCachedServiceConfig();

  const config = configModule.loadServiceConfig();
  assert.equal(config.staging.directory, path.join(scratchRoot, 'timestore', 'staging'));
  assert.equal(config.staging.flush.eagerWhenBytesOnly, false);
});

test('legacy staging directory rewrites to scratch root when available', () => {
  const legacyPath = path.resolve(process.cwd(), 'services', 'data', 'timestore', 'staging');
  process.env.APPHUB_SCRATCH_ROOT = scratchRoot;
  process.env.TIMESTORE_STAGING_DIRECTORY = legacyPath;
  configModule.resetCachedServiceConfig();

  const config = configModule.loadServiceConfig();
  assert.equal(config.staging.directory, path.join(scratchRoot, 'timestore', 'staging'));
  assert.equal(config.staging.flush.eagerWhenBytesOnly, false);
});

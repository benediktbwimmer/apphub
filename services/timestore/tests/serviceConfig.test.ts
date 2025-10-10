import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

let originalRedis: string | undefined;
let originalDatabase: string | undefined;
let originalInline: string | undefined;
let originalStreaming: string | undefined;
let originalClickHouseHost: string | undefined;
let scratchRoot: string;
let configModule: typeof import('../src/config/serviceConfig');

beforeEach(async () => {
  scratchRoot = await mkdtemp(path.join(tmpdir(), 'timestore-scratch-'));
  originalRedis = process.env.REDIS_URL;
  originalDatabase = process.env.TIMESTORE_DATABASE_URL;
  originalInline = process.env.APPHUB_ALLOW_INLINE_MODE;
  originalStreaming = process.env.APPHUB_STREAMING_ENABLED;
  originalClickHouseHost = process.env.TIMESTORE_CLICKHOUSE_HOST;

  process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  process.env.TIMESTORE_DATABASE_URL =
    process.env.TIMESTORE_DATABASE_URL ?? 'postgres://apphub:apphub@localhost:5432/apphub';
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';

  configModule = await import('../src/config/serviceConfig');
  configModule.resetCachedServiceConfig();
});

afterEach(async () => {
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
  if (originalStreaming === undefined) {
    delete process.env.APPHUB_STREAMING_ENABLED;
  } else {
    process.env.APPHUB_STREAMING_ENABLED = originalStreaming;
  }
  if (originalClickHouseHost === undefined) {
    delete process.env.TIMESTORE_CLICKHOUSE_HOST;
  } else {
    process.env.TIMESTORE_CLICKHOUSE_HOST = originalClickHouseHost;
  }
  configModule.resetCachedServiceConfig();
  await rm(scratchRoot, { recursive: true, force: true });
});

test('loadServiceConfig respects clickhouse host override', () => {
  process.env.TIMESTORE_CLICKHOUSE_HOST = 'demo-clickhouse';
  configModule.resetCachedServiceConfig();

  const config = configModule.loadServiceConfig();
  assert.equal(config.clickhouse.host, 'demo-clickhouse');
});

test('streaming feature flag mirrors APPHUB_STREAMING_ENABLED env', () => {
  process.env.APPHUB_STREAMING_ENABLED = 'false';
  configModule.resetCachedServiceConfig();

  const disabledConfig = configModule.loadServiceConfig();
  assert.equal(disabledConfig.features.streaming.enabled, false);

  process.env.APPHUB_STREAMING_ENABLED = 'true';
  configModule.resetCachedServiceConfig();
  const enabledConfig = configModule.loadServiceConfig();
  assert.equal(enabledConfig.features.streaming.enabled, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { EnvConfigError } from '@apphub/shared/envConfig';
import { getMetastoreRuntimeConfig, clearMetastoreRuntimeConfigCache } from '../src/config/metastore';

type EnvOverrides = Record<string, string | undefined>;

async function withEnv<T>(overrides: EnvOverrides, fn: () => Promise<T> | T): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    clearMetastoreRuntimeConfigCache();
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearMetastoreRuntimeConfigCache();
  }
}

test('hydrates runtime config from environment', async () => {
  await withEnv(
    {
      CORE_METASTORE_BASE_URL: 'https://metastore.example.com/v1/',
      CORE_METASTORE_TOKEN: '  secret-token  ',
      CORE_METASTORE_TIMEOUT_MS: '2500',
      CORE_METASTORE_USER_AGENT: 'custom-agent/2.0'
    },
    async () => {
      const config = await getMetastoreRuntimeConfig();
      assert.equal(config.baseUrl, 'https://metastore.example.com/v1');
      assert.equal(config.token, 'secret-token');
      assert.equal(config.fetchTimeoutMs, 2500);
      assert.equal(config.userAgent, 'custom-agent/2.0');
      assert.equal(config.source, 'env');
    }
  );
});

test('zero timeout disables fetch deadline', async () => {
  await withEnv(
    {
      CORE_METASTORE_BASE_URL: 'https://metastore.example.com',
      CORE_METASTORE_TIMEOUT_MS: '0'
    },
    async () => {
      const config = await getMetastoreRuntimeConfig();
      assert.equal(config.fetchTimeoutMs, null);
    }
  );
});

test('invalid timeout surfaces env config error', async () => {
  await withEnv(
    {
      CORE_METASTORE_BASE_URL: 'https://metastore.example.com',
      CORE_METASTORE_TIMEOUT_MS: 'NaN'
    },
    async () => {
      await assert.rejects(
        () => getMetastoreRuntimeConfig(),
        (error: unknown) => {
          assert(error instanceof EnvConfigError);
          assert.match(error.message, /core:metastore-runtime/);
          assert.match(error.message, /CORE_METASTORE_TIMEOUT_MS/);
          return true;
        }
      );
    }
  );
});


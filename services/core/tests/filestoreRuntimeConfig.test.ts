import test from 'node:test';
import assert from 'node:assert/strict';
import { EnvConfigError } from '@apphub/shared/envConfig';
import { getFilestoreRuntimeConfig, clearFilestoreRuntimeConfigCache } from '../src/config/filestore';

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
    clearFilestoreRuntimeConfigCache();
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearFilestoreRuntimeConfigCache();
  }
}

test('uses env configured base URL and token', async () => {
  await withEnv(
    {
      CORE_FILESTORE_BASE_URL: 'https://filestore.example.com/api ',
      CORE_FILESTORE_TOKEN: '  token-123  ',
      CORE_FILESTORE_USER_AGENT: 'custom-agent/1.0',
      CORE_FILESTORE_TIMEOUT_MS: '4500'
    },
    async () => {
      const config = await getFilestoreRuntimeConfig();
      assert.equal(config.baseUrl, 'https://filestore.example.com/api');
      assert.equal(config.token, 'token-123');
      assert.equal(config.userAgent, 'custom-agent/1.0');
      assert.equal(config.fetchTimeoutMs, 4500);
      assert.equal(config.source, 'env');
    }
  );
});

test('treats zero timeout as null', async () => {
  await withEnv(
    {
      CORE_FILESTORE_BASE_URL: 'https://filestore.example.com',
      CORE_FILESTORE_TIMEOUT_MS: '0'
    },
    async () => {
      const config = await getFilestoreRuntimeConfig();
      assert.equal(config.fetchTimeoutMs, null);
    }
  );
});

test('throws helpful error on invalid timeout', async () => {
  await withEnv(
    {
      CORE_FILESTORE_BASE_URL: 'https://filestore.example.com',
      CORE_FILESTORE_TIMEOUT_MS: 'not-a-number'
    },
    async () => {
      await assert.rejects(
        () => getFilestoreRuntimeConfig(),
        (error: unknown) => {
          assert(error instanceof EnvConfigError);
          assert.match(error.message, /core:filestore-runtime/);
          assert.match(error.message, /CORE_FILESTORE_TIMEOUT_MS/);
          return true;
        }
      );
    }
  );
});


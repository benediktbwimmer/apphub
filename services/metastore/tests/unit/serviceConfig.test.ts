import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServiceConfig, resetServiceConfigCache } from '../../src/config/serviceConfig';

type EnvOverrides = Record<string, string | undefined>;

function withEnv<T>(overrides: EnvOverrides, fn: () => T): T {
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
    resetServiceConfigCache();
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetServiceConfigCache();
  }
}

test('returns defaults when metastore env vars are unset', () => {
  withEnv(
    {
      NODE_ENV: 'development',
      FILESTORE_REDIS_URL: undefined,
      REDIS_URL: undefined
    },
    () => {
      const config = loadServiceConfig();
      assert.equal(config.host, '::');
      assert.equal(config.port, 4100);
      assert.equal(config.metricsEnabled, true);
      assert.equal(config.database.schema, 'metastore');
      assert.equal(config.filestoreSync.inline, false);
      assert.equal(config.filestoreSync.redisUrl, 'redis://127.0.0.1:6379');
      assert.deepEqual(config.tokens, []);
    }
  );
});

test('parses inline redis mode when allowed', () => {
  withEnv(
    {
      NODE_ENV: 'development',
      FILESTORE_REDIS_URL: 'inline',
      APPHUB_ALLOW_INLINE_MODE: 'on'
    },
    () => {
      const config = loadServiceConfig();
      assert.equal(config.filestoreSync.inline, true);
      assert.equal(config.filestoreSync.redisUrl, 'inline');
    }
  );
});

test('rejects inline redis mode when not allowed', () => {
  withEnv(
    {
      NODE_ENV: 'development',
      FILESTORE_REDIS_URL: 'inline',
      APPHUB_ALLOW_INLINE_MODE: 'off'
    },
    () => {
      assert.throws(() => loadServiceConfig(), (error: unknown) => {
        assert(error instanceof Error);
        assert.match(error.message, /APPHUB_ALLOW_INLINE_MODE/);
        return true;
      });
    }
  );
});

test('throws formatted error for invalid redis configuration', () => {
  withEnv(
    {
      NODE_ENV: 'production',
      FILESTORE_REDIS_URL: undefined,
      REDIS_URL: undefined
    },
    () => {
      assert.throws(() => loadServiceConfig(), /Set FILESTORE_REDIS_URL/);
    }
  );
});

test('parses token definitions from env json', () => {
  const tokenPayload = JSON.stringify([
    { token: 'abcdefghi', subject: 'service-a', scopes: ['metastore:write'] }
  ]);

  withEnv(
    {
      NODE_ENV: 'development',
      FILESTORE_REDIS_URL: 'redis://localhost:6379',
      APPHUB_METASTORE_TOKENS: tokenPayload
    },
    () => {
      const config = loadServiceConfig();
      assert.equal(config.tokens.length, 1);
      assert.equal(config.tokens[0]?.subject, 'service-a');
      assert.deepEqual(config.tokens[0]?.scopes, ['metastore:write']);
    }
  );
});

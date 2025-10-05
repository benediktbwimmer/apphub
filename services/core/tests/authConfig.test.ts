import test from 'node:test';
import assert from 'node:assert/strict';
import { EnvConfigError } from '@apphub/shared/envConfig';
import { getAuthConfig, resetAuthConfigCache } from '../src/config/auth';

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
    resetAuthConfigCache();
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetAuthConfigCache();
  }
}

test('uses defaults when auth env vars are unset', () => {
  withEnv(
    {
      APPHUB_AUTH_DISABLED: undefined,
      APPHUB_SESSION_SECRET: undefined,
      APPHUB_SESSION_COOKIE_SECURE: undefined,
      NODE_ENV: 'development'
    },
    () => {
      const config = getAuthConfig();
      assert.equal(config.enabled, true);
      assert.equal(config.sessionSecret, '');
      assert.equal(config.sessionCookieSecure, false);
      assert.equal(config.sessionTtlSeconds, 12 * 60 * 60);
      assert.equal(config.sessionRenewSeconds, 30 * 60);
      assert.deepEqual(Array.from(config.oidc.allowedDomains), []);
    }
  );
});

test('parses booleans, numbers, and lists consistently', () => {
  withEnv(
    {
      APPHUB_AUTH_DISABLED: 'yes',
      APPHUB_SESSION_TTL_SECONDS: '900',
      APPHUB_SESSION_RENEW_SECONDS: '120',
      APPHUB_SESSION_COOKIE_SECURE: 'no',
      APPHUB_LEGACY_OPERATOR_TOKENS: 'off',
      APPHUB_OIDC_ALLOWED_DOMAINS: 'Example.com, apphub.dev, example.com'
    },
    () => {
      const config = getAuthConfig();
      assert.equal(config.enabled, false);
      assert.equal(config.sessionCookieSecure, false);
      assert.equal(config.sessionTtlSeconds, 900);
      assert.equal(config.sessionRenewSeconds, 120);
      assert.equal(config.legacyTokensEnabled, false);
      assert.deepEqual(Array.from(config.oidc.allowedDomains), ['example.com', 'apphub.dev']);
    }
  );
});

test('throws helpful error for invalid boolean values', () => {
  withEnv(
    {
      APPHUB_SESSION_COOKIE_SECURE: 'maybe',
      NODE_ENV: 'production'
    },
    () => {
      assert.throws(() => getAuthConfig(), (error: unknown) => {
        assert(error instanceof EnvConfigError);
        assert.match(error.message, /core:auth/);
        assert.match(error.message, /APPHUB_SESSION_COOKIE_SECURE/);
        return true;
      });
    }
  );
});

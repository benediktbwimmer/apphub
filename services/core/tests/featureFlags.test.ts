import test from 'node:test';
import assert from 'node:assert/strict';
import { EnvConfigError } from '@apphub/shared/envConfig';
import { getFeatureFlags, resetFeatureFlagsCache } from '../src/config/featureFlags';

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
    resetFeatureFlagsCache();
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetFeatureFlagsCache();
  }
}

test('defaults to streaming disabled', () => {
  withEnv({ APPHUB_STREAMING_ENABLED: undefined }, () => {
    const flags = getFeatureFlags();
    assert.equal(flags.streaming.enabled, false);
  });
});

test('parses streaming flag booleans via helper', () => {
  withEnv({ APPHUB_STREAMING_ENABLED: 'yes' }, () => {
    const flags = getFeatureFlags();
    assert.equal(flags.streaming.enabled, true);
  });

  withEnv({ APPHUB_STREAMING_ENABLED: 'no' }, () => {
    const flags = getFeatureFlags();
    assert.equal(flags.streaming.enabled, false);
  });
});

test('surfaces helpful error for invalid streaming flag', () => {
  withEnv({ APPHUB_STREAMING_ENABLED: 'maybe' }, () => {
    assert.throws(() => getFeatureFlags(), (error: unknown) => {
      assert(error instanceof EnvConfigError);
      assert.match(error.message, /core:feature-flags/);
      assert.match(error.message, /APPHUB_STREAMING_ENABLED/);
      return true;
    });
  });
});


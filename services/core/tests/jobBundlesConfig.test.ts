import test from 'node:test';
import assert from 'node:assert/strict';
import { EnvConfigError } from '@apphub/shared/envConfig';
import {
  shouldAllowLegacyFallback,
  shouldUseJobBundle,
  resetJobBundleConfigCache
} from '../src/config/jobBundles';

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
    resetJobBundleConfigCache();
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetJobBundleConfigCache();
  }
}

test('uses default bundle behaviour', () => {
  withEnv(
    {
      APPHUB_JOB_BUNDLES_ENABLED: undefined,
      APPHUB_JOB_BUNDLES_DISABLE_FALLBACK: undefined,
      APPHUB_JOB_BUNDLES_ENABLE_SLUGS: undefined,
      APPHUB_JOB_BUNDLES_DISABLE_SLUGS: undefined,
      APPHUB_JOB_BUNDLES_DISABLE_FALLBACK_SLUGS: undefined
    },
    () => {
      assert.equal(shouldUseJobBundle('demo-job'), false);
      assert.equal(shouldAllowLegacyFallback('demo-job'), true);
    }
  );
});

test('honours slug allow and deny lists', () => {
  withEnv(
    {
      APPHUB_JOB_BUNDLES_ENABLED: 'true',
      APPHUB_JOB_BUNDLES_ENABLE_SLUGS: 'alpha,beta',
      APPHUB_JOB_BUNDLES_DISABLE_SLUGS: 'beta'
    },
    () => {
      assert.equal(shouldUseJobBundle('alpha'), true);
      assert.equal(shouldUseJobBundle('beta'), false);
      assert.equal(shouldUseJobBundle('gamma'), true);
    }
  );
});

test('controls legacy fallback through env', () => {
  withEnv(
    {
      APPHUB_JOB_BUNDLES_DISABLE_FALLBACK: 'true',
      APPHUB_JOB_BUNDLES_DISABLE_FALLBACK_SLUGS: 'legacy-job'
    },
    () => {
      assert.equal(shouldAllowLegacyFallback('legacy-job'), false);
      assert.equal(shouldAllowLegacyFallback('other'), false);
    }
  );
});

test('throws descriptive error for invalid boolean values', () => {
  withEnv({ APPHUB_JOB_BUNDLES_ENABLED: 'maybe' }, () => {
    assert.throws(() => shouldUseJobBundle('alpha'), (error: unknown) => {
      assert(error instanceof EnvConfigError);
      assert.match(error.message, /core:job-bundles/);
      assert.match(error.message, /APPHUB_JOB_BUNDLES_ENABLED/);
      return true;
    });
  });
});


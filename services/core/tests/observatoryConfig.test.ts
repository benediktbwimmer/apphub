import test from 'node:test';
import assert from 'node:assert/strict';
import { EnvConfigError } from '@apphub/shared/envConfig';
import {
  getObservatoryCalibrationConfig,
  clearObservatoryCalibrationConfigCache
} from '../src/config/observatory';
import { clearFilestoreRuntimeConfigCache } from '../src/config/filestore';
import { clearMetastoreRuntimeConfigCache } from '../src/config/metastore';

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
    clearObservatoryCalibrationConfigCache();
    clearFilestoreRuntimeConfigCache();
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
    clearObservatoryCalibrationConfigCache();
    clearFilestoreRuntimeConfigCache();
    clearMetastoreRuntimeConfigCache();
  }
}

test('builds observatory config with defaults and clamping', async () => {
  await withEnv(
    {
      OBSERVATORY_FILESTORE_BACKEND_ID: '5',
      CORE_FILESTORE_BASE_URL: 'https://filestore.local',
      CORE_METASTORE_BASE_URL: 'https://metastore.local',
      OBSERVATORY_REPROCESS_MAX_CONCURRENCY_DEFAULT: '25',
      OBSERVATORY_REPROCESS_POLL_INTERVAL_MS_DEFAULT: '50',
      OBSERVATORY_CORE_API_TOKEN: 'secret-token'
    },
    async () => {
      const config = await getObservatoryCalibrationConfig();
      assert.equal(config.filestore.backendId, 5);
      assert.equal(config.filestore.calibrationsPrefix, 'datasets/observatory/calibrations');
      assert.equal(config.filestore.plansPrefix, 'datasets/observatory/calibrations/plans');
      assert.equal(config.metastore.calibrationNamespace, 'observatory.calibrations');
      assert.equal(config.metastore.planNamespace, 'observatory.reprocess.plans');
      assert.equal(config.workflows.ingestSlug, null);
      assert.equal(config.defaults.maxConcurrency, 10);
      assert.equal(config.defaults.pollIntervalMs, 250);
      assert.equal(config.core.apiToken, 'secret-token');
    }
  );
});

test('throws descriptive error when backend id missing', async () => {
  await withEnv(
    {
      OBSERVATORY_FILESTORE_BACKEND_ID: undefined,
      CORE_OBSERVATORY_FILESTORE_BACKEND_ID: undefined,
      FILESTORE_BACKEND_ID: undefined,
      CORE_FILESTORE_BASE_URL: 'https://filestore.local',
      CORE_METASTORE_BASE_URL: 'https://metastore.local'
    },
    async () => {
      await assert.rejects(
        () => getObservatoryCalibrationConfig(),
        (error: unknown) => {
          assert(error instanceof Error);
          assert.match(error.message, /Observatory filestore backend id is not configured/);
          return true;
        }
      );
    }
  );
});

test('fails fast on invalid backend id input', async () => {
  await withEnv(
    {
      OBSERVATORY_FILESTORE_BACKEND_ID: '0',
      CORE_FILESTORE_BASE_URL: 'https://filestore.local',
      CORE_METASTORE_BASE_URL: 'https://metastore.local'
    },
    async () => {
      await assert.rejects(
        () => getObservatoryCalibrationConfig(),
        (error: unknown) => {
          assert(error instanceof EnvConfigError);
          assert.match(error.message, /OBSERVATORY_FILESTORE_BACKEND_ID/);
          return true;
        }
      );
    }
  );
});


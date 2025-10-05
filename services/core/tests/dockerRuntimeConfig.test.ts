import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { EnvConfigError } from '@apphub/shared/envConfig';
import {
  getDockerRuntimeConfig,
  clearDockerRuntimeConfigCache
} from '../src/config/dockerRuntime';

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
    clearDockerRuntimeConfigCache();
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearDockerRuntimeConfigCache();
  }
}

test('uses defaults when docker env vars are unset', () => {
  withEnv(
    {
      CORE_ENABLE_DOCKER_JOBS: undefined,
      CORE_DOCKER_WORKSPACE_ROOT: undefined,
      CORE_DOCKER_IMAGE_ALLOWLIST: undefined,
      CORE_DOCKER_IMAGE_DENYLIST: undefined,
      CORE_DOCKER_MAX_WORKSPACE_BYTES: undefined,
      CORE_DOCKER_ENABLE_GPU: undefined,
      CORE_DOCKER_ENFORCE_NETWORK_ISOLATION: undefined,
      CORE_DOCKER_ALLOW_NETWORK_OVERRIDE: undefined,
      CORE_DOCKER_ALLOWED_NETWORK_MODES: undefined,
      CORE_DOCKER_DEFAULT_NETWORK_MODE: undefined,
      CORE_DOCKER_PERSIST_LOG_TAIL: undefined
    },
    () => {
      const config = getDockerRuntimeConfig();
      assert.equal(config.enabled, false);
      assert.equal(
        config.workspaceRoot,
        path.join(os.tmpdir(), 'apphub-docker-workspaces')
      );
      assert.deepEqual(config.imageAllowList, []);
      assert.deepEqual(config.imageDenyList, []);
      assert.equal(config.maxWorkspaceBytes, 10 * 1024 * 1024 * 1024);
      assert.equal(config.gpuEnabled, false);
      assert.equal(config.network.isolationEnabled, true);
      assert.equal(config.network.defaultMode, 'none');
      assert.deepEqual(Array.from(config.network.allowedModes).sort(), ['bridge', 'none']);
      assert.equal(config.persistLogTailInContext, true);
    }
  );
});

test('parses unlimited workspace limit and allow list patterns', () => {
  withEnv(
    {
      CORE_ENABLE_DOCKER_JOBS: 'true',
      CORE_DOCKER_MAX_WORKSPACE_BYTES: 'unlimited',
      CORE_DOCKER_IMAGE_ALLOWLIST: 'node:16, ubuntu:*',
      CORE_DOCKER_IMAGE_DENYLIST: 'bad/image'
    },
    () => {
      const config = getDockerRuntimeConfig();
      assert.equal(config.enabled, true);
      assert.equal(config.maxWorkspaceBytes, null);
      assert.equal(config.imageAllowList.length, 2);
      assert.equal(config.imageDenyList.length, 1);
    }
  );
});

test('throws env config error for invalid workspace limit', () => {
  withEnv({ CORE_DOCKER_MAX_WORKSPACE_BYTES: '-5' }, () => {
    assert.throws(() => getDockerRuntimeConfig(), (error: unknown) => {
      assert(error instanceof EnvConfigError);
      assert.match(error.message, /CORE_DOCKER_MAX_WORKSPACE_BYTES/);
      return true;
    });
  });
});

test('enforces allowed network modes', () => {
  withEnv(
    {
      CORE_DOCKER_ALLOWED_NETWORK_MODES: 'bridge',
      CORE_DOCKER_DEFAULT_NETWORK_MODE: 'bridge',
      CORE_DOCKER_ENFORCE_NETWORK_ISOLATION: 'false'
    },
    () => {
      const config = getDockerRuntimeConfig();
      assert.equal(config.network.isolationEnabled, false);
      assert.equal(config.network.defaultMode, 'bridge');
      assert.deepEqual(Array.from(config.network.allowedModes), ['bridge']);
    }
  );
});

test('rejects unsupported network modes', () => {
  withEnv({ CORE_DOCKER_ALLOWED_NETWORK_MODES: 'host' }, () => {
    assert.throws(() => getDockerRuntimeConfig(), /Unsupported Docker network mode/);
  });
});


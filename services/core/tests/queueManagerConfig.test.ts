import test from 'node:test';
import assert from 'node:assert/strict';
import { EnvConfigError } from '@apphub/shared/envConfig';
import type { Redis } from 'ioredis';

process.env.REDIS_URL = 'inline';
process.env.APPHUB_ALLOW_INLINE_MODE = 'true';

const queueModulePromise = import('../src/queueManager');

type EnvOverrides = Record<string, string | undefined>;

async function withEnv<T>(overrides: EnvOverrides, fn: (mod: typeof import('../src/queueManager')) => Promise<T> | T): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  const mod = await queueModulePromise;
  try {
    return await fn(mod);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function createMockRedis(): Redis {
  return {
    status: 'ready',
    on: () => undefined,
    connect: async () => undefined,
    ping: async () => 'PONG',
    quit: async () => undefined
  } as unknown as Redis;
}

test('defaults to queue mode when inline not requested', async () => {
  await withEnv({ REDIS_URL: 'redis://127.0.0.1:6379', APPHUB_EVENTS_MODE: undefined }, async ({ QueueManager }) => {
    const manager = new QueueManager({ createRedis: () => createMockRedis() });
    assert.equal(manager.isInlineMode(), false);
  });
});

test('enables inline mode when requested and allowed', async () => {
  await withEnv({ REDIS_URL: 'inline', APPHUB_ALLOW_INLINE_MODE: 'true' }, async ({ QueueManager }) => {
    const manager = new QueueManager({ createRedis: () => createMockRedis() });
    assert.equal(manager.isInlineMode(), true);
  });
});

test('rejects inline mode when not allowed', async () => {
  await withEnv({ REDIS_URL: 'inline', APPHUB_ALLOW_INLINE_MODE: 'false' }, async ({ QueueManager }) => {
    assert.throws(() => new QueueManager({ createRedis: () => createMockRedis() }), (error: unknown) => {
      assert(error instanceof Error);
      assert.match(error.message, /APPHUB_ALLOW_INLINE_MODE is not enabled/);
      return true;
    });
  });
});

test('throws descriptive error when REDIS_URL missing', async () => {
  await withEnv({ REDIS_URL: undefined }, async ({ QueueManager }) => {
    assert.throws(() => new QueueManager({ createRedis: () => createMockRedis() }), (error: unknown) => {
      assert(error instanceof EnvConfigError);
      assert.match(error.message, /core:queue-manager/);
      assert.match(error.message, /REDIS_URL/);
      return true;
    });
  });
});

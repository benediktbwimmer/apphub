import assert from 'node:assert/strict';
import test from 'node:test';
import IORedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { QueueManager } from '../src/queueManager';

type TelemetryEvent = {
  type: string;
  queue: string;
  mode: string;
  meta?: Record<string, unknown>;
};

test('queue manager runs worker loader once in inline mode', async () => {
  const originalRedisUrl = process.env.REDIS_URL;
  const originalEventsMode = process.env.APPHUB_EVENTS_MODE;
  const originalAllowInline = process.env.APPHUB_ALLOW_INLINE_MODE;

  process.env.REDIS_URL = 'inline';
  delete process.env.APPHUB_EVENTS_MODE;
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';

  const telemetryEvents: TelemetryEvent[] = [];
  const loaderCalls: string[] = [];

  const manager = new QueueManager({
    telemetry: (event) => {
      telemetryEvents.push(event);
    }
  });

  try {
    manager.registerQueue({
      key: 'test:inline',
      queueName: 'apphub_inline_test',
      workerLoader: async () => {
        loaderCalls.push('inline');
      }
    });

    assert.equal(manager.isInlineMode(), true);

    await manager.ensureWorker('test:inline');
    await manager.ensureWorker('test:inline');

    assert.deepEqual(loaderCalls, ['inline']);
    assert.equal(manager.tryGetQueue('test:inline'), null);

    const workerLoaded = telemetryEvents.find((event) => event.type === 'worker-loaded');
    assert.ok(workerLoaded, 'worker-loaded telemetry event not emitted');
    assert.equal(workerLoaded?.mode, 'inline');
  } finally {
    await manager.closeConnection();

    if (typeof originalRedisUrl === 'string') {
      process.env.REDIS_URL = originalRedisUrl;
    } else {
      delete process.env.REDIS_URL;
    }

    if (typeof originalEventsMode === 'string') {
      process.env.APPHUB_EVENTS_MODE = originalEventsMode;
    } else {
      delete process.env.APPHUB_EVENTS_MODE;
    }

    if (typeof originalAllowInline === 'string') {
      process.env.APPHUB_ALLOW_INLINE_MODE = originalAllowInline;
    } else {
      delete process.env.APPHUB_ALLOW_INLINE_MODE;
    }
  }
});

test('queue manager registers queues under redis mode and reports telemetry', async () => {
  const originalRedisUrl = process.env.REDIS_URL;
  const originalEventsMode = process.env.APPHUB_EVENTS_MODE;
  const originalAllowInline = process.env.APPHUB_ALLOW_INLINE_MODE;

  process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  delete process.env.APPHUB_EVENTS_MODE;
  delete process.env.APPHUB_ALLOW_INLINE_MODE;

  const telemetryEvents: TelemetryEvent[] = [];

  const manager = new QueueManager({
    telemetry: (event) => {
      telemetryEvents.push(event);
    },
    createRedis: () => new IORedisMock() as unknown as Redis
  });

  try {
    manager.registerQueue({
      key: 'test:redis',
      queueName: 'apphub_redis_test',
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 1
      }
    });

    assert.equal(manager.isInlineMode(), false);

    const queue = manager.getQueue('test:redis');
    assert.equal(queue.name, 'apphub_redis_test');

    const counts = await manager.getQueueCounts('test:redis');
    assert.equal(typeof counts, 'object');

    const created = telemetryEvents.find((event) => event.type === 'queue-created');
    assert.ok(created, 'queue-created telemetry event not emitted');
    assert.equal(created?.mode, 'queue');

    process.env.APPHUB_ALLOW_INLINE_MODE = 'true';
    process.env.REDIS_URL = 'inline';
    assert.equal(manager.isInlineMode(), true);

    const modeChange = telemetryEvents.find((event) => event.type === 'mode-change');
    assert.ok(modeChange, 'mode-change telemetry event not emitted');
    assert.equal(modeChange?.mode, 'inline');
  } finally {
    await manager.closeConnection();

    if (typeof originalRedisUrl === 'string') {
      process.env.REDIS_URL = originalRedisUrl;
    } else {
      delete process.env.REDIS_URL;
    }

    if (typeof originalEventsMode === 'string') {
      process.env.APPHUB_EVENTS_MODE = originalEventsMode;
    } else {
      delete process.env.APPHUB_EVENTS_MODE;
    }

    if (typeof originalAllowInline === 'string') {
      process.env.APPHUB_ALLOW_INLINE_MODE = originalAllowInline;
    } else {
      delete process.env.APPHUB_ALLOW_INLINE_MODE;
    }
  }
});

test('queue manager rejects inline mode when not explicitly allowed', async (t) => {
  const originalRedisUrl = process.env.REDIS_URL;
  const originalAllowInline = process.env.APPHUB_ALLOW_INLINE_MODE;

  process.env.REDIS_URL = 'inline';
  delete process.env.APPHUB_ALLOW_INLINE_MODE;

  await t.test('throws on construction', () => {
    const telemetryEvents: TelemetryEvent[] = [];
    try {
      new QueueManager({
        telemetry: (event) => {
          telemetryEvents.push(event);
        }
      });
      assert.fail('Expected constructor to throw when inline mode disabled');
    } catch (err) {
      assert.ok(
        err instanceof Error && err.message.includes('APPHUB_ALLOW_INLINE_MODE'),
        'unexpected error message'
      );
    }
    assert.equal(telemetryEvents.length, 0);
  });

  if (typeof originalRedisUrl === 'string') {
    process.env.REDIS_URL = originalRedisUrl;
  } else {
    delete process.env.REDIS_URL;
  }

  if (typeof originalAllowInline === 'string') {
    process.env.APPHUB_ALLOW_INLINE_MODE = originalAllowInline;
  } else {
    delete process.env.APPHUB_ALLOW_INLINE_MODE;
  }
});

test('verifyConnectivity fails when redis is unreachable', async () => {
  const originalRedisUrl = process.env.REDIS_URL;
  const originalAllowInline = process.env.APPHUB_ALLOW_INLINE_MODE;

  process.env.REDIS_URL = 'redis://unreachable:6379';
  delete process.env.APPHUB_ALLOW_INLINE_MODE;

  const manager = new QueueManager({
    telemetry: () => undefined,
    createRedis: () => {
      const stub: any = {
        status: 'wait',
        connect: () => Promise.reject(new Error('ECONNREFUSED')),
        ping: () => Promise.resolve('PONG'),
        quit: () => Promise.resolve('OK'),
        on: () => stub
      };
      return stub as Redis;
    }
  });

  manager.registerQueue({
    key: 'test:connectivity',
    queueName: 'apphub_connectivity_test'
  });

  await assert.rejects(manager.verifyConnectivity(), /ECONNREFUSED/);
  await manager.closeConnection();

  if (typeof originalRedisUrl === 'string') {
    process.env.REDIS_URL = originalRedisUrl;
  } else {
    delete process.env.REDIS_URL;
  }

  if (typeof originalAllowInline === 'string') {
    process.env.APPHUB_ALLOW_INLINE_MODE = originalAllowInline;
  } else {
    delete process.env.APPHUB_ALLOW_INLINE_MODE;
  }
});

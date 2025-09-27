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

  process.env.REDIS_URL = 'inline';
  delete process.env.APPHUB_EVENTS_MODE;

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
  }
});

test('queue manager registers queues under redis mode and reports telemetry', async () => {
  const originalRedisUrl = process.env.REDIS_URL;
  const originalEventsMode = process.env.APPHUB_EVENTS_MODE;

  process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  delete process.env.APPHUB_EVENTS_MODE;

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
  }
});

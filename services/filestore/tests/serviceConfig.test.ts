import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServiceConfig, resetCachedServiceConfig } from '../src/config/serviceConfig';

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
    resetCachedServiceConfig();
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetCachedServiceConfig();
  }
}

test('builds configuration from env overrides', () => {
  withEnv(
    {
      FILESTORE_HOST: 'filestore.internal',
      FILESTORE_PORT: '4500',
      FILESTORE_LOG_LEVEL: 'debug',
      FILESTORE_DATABASE_URL: 'postgres://filestore-db',
      FILESTORE_PG_SCHEMA: 'fs',
      FILESTORE_PGPOOL_MAX: '10',
      FILESTORE_PGPOOL_IDLE_TIMEOUT_MS: '1000',
      FILESTORE_PGPOOL_CONNECTION_TIMEOUT_MS: '2000',
      FILESTORE_METRICS_ENABLED: 'false',
      FILESTORE_REDIS_URL: 'redis://cache:6379',
      FILESTORE_REDIS_KEY_PREFIX: 'fs',
      FILESTORE_ROLLUP_QUEUE_NAME: 'fs_rollup',
      FILESTORE_ROLLUP_CACHE_TTL_SECONDS: '100',
      FILESTORE_ROLLUP_CACHE_MAX_ENTRIES: '512',
      FILESTORE_ROLLUP_RECALC_DEPTH_THRESHOLD: '8',
      FILESTORE_ROLLUP_RECALC_CHILD_THRESHOLD: '100',
      FILESTORE_ROLLUP_MAX_CASCADE_DEPTH: '32',
      FILESTORE_ROLLUP_QUEUE_CONCURRENCY: '3',
      FILESTORE_RECONCILE_QUEUE_NAME: 'fs_reconcile',
      FILESTORE_RECONCILE_QUEUE_CONCURRENCY: '2',
      FILESTORE_RECONCILE_AUDIT_INTERVAL_MS: '150000',
      FILESTORE_RECONCILE_AUDIT_BATCH_SIZE: '50',
      FILESTORE_JOURNAL_RETENTION_DAYS: '7',
      FILESTORE_JOURNAL_PRUNE_BATCH_SIZE: '250',
      FILESTORE_JOURNAL_PRUNE_INTERVAL_MS: '1000',
      FILESTORE_EVENTS_MODE: 'redis',
      FILESTORE_EVENTS_CHANNEL: 'fs:events'
    },
    () => {
      const config = loadServiceConfig();
      assert.equal(config.host, 'filestore.internal');
      assert.equal(config.port, 4500);
      assert.equal(config.logLevel, 'debug');
      assert.equal(config.database.url, 'postgres://filestore-db');
      assert.equal(config.database.schema, 'fs');
      assert.equal(config.database.maxConnections, 10);
      assert.equal(config.metricsEnabled, false);
      assert.equal(config.redis.url, 'redis://cache:6379');
      assert.equal(config.redis.keyPrefix, 'fs');
      assert.equal(config.rollups.queueName, 'fs_rollup');
      assert.equal(config.rollups.cacheTtlSeconds, 100);
      assert.equal(config.events.mode, 'redis');
      assert.equal(config.events.channel, 'fs:events');
    }
  );
});

test('enforces inline mode flag', () => {
  withEnv(
    {
      FILESTORE_REDIS_URL: 'inline',
      APPHUB_ALLOW_INLINE_MODE: 'true'
    },
    () => {
      const config = loadServiceConfig();
      assert.equal(config.redis.inline, true);
      assert.equal(config.events.mode, 'inline');
    }
  );

  withEnv(
    {
      FILESTORE_REDIS_URL: 'inline',
      APPHUB_ALLOW_INLINE_MODE: 'false'
    },
    () => {
      assert.throws(() => loadServiceConfig(), /APPHUB_ALLOW_INLINE_MODE/);
    }
  );
});

test('throws when redis url missing in production', () => {
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

test('invalid numeric env falls back to safe defaults', () => {
  withEnv({ FILESTORE_ROLLUP_QUEUE_CONCURRENCY: '0' }, () => {
    const config = loadServiceConfig();
    assert.equal(config.rollups.queueConcurrency, 1);
  });
});

import './testEnv';

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, test } from 'node:test';
import type { ServiceConfig } from '../src/config/serviceConfig';
import { configureS3Support } from '../src/query/executor';

const createdDirs: string[] = [];

afterEach(async () => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (!dir) {
      continue;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

function createTestConfig(cacheDir: string): ServiceConfig {
  return {
    host: '127.0.0.1',
    port: 4100,
    logLevel: 'info',
    database: {
      url: 'postgres://example',
      schema: 'public',
      maxConnections: 5,
      idleTimeoutMs: 1_000,
      connectionTimeoutMs: 5_000
    },
    storage: {
      driver: 's3',
      root: '/tmp/timestore',
      s3: {
        bucket: 'test-bucket',
        endpoint: 'http://127.0.0.1:9000',
        region: 'us-east-1',
        accessKeyId: 'AKIA-test',
        secretAccessKey: 'secret-test',
        sessionToken: 'session-test',
        forcePathStyle: true
      }
    },
    query: {
      cache: {
        enabled: true,
        directory: cacheDir,
        maxBytes: 256 * 1024
      }
    },
    sql: {
      maxQueryLength: 10_000,
      statementTimeoutMs: 30_000
    },
    lifecycle: {
      enabled: true,
      queueName: 'queue',
      intervalSeconds: 60,
      jitterSeconds: 5,
      jobConcurrency: 1,
      compaction: {
        smallPartitionBytes: 10,
        targetPartitionBytes: 20,
        maxPartitionsPerGroup: 2
      },
      retention: {
        defaultRules: {},
        deleteGraceMinutes: 5
      },
      exports: {
        enabled: false,
        outputFormat: 'parquet',
        outputPrefix: 'exports',
        minIntervalHours: 24
      }
    },
    observability: {
      metrics: {
        enabled: true,
        collectDefaultMetrics: false,
        prefix: 'timestore_',
        scope: null
      },
      tracing: {
        enabled: false,
        serviceName: 'test'
      }
    },
    filestore: {
      enabled: false,
      redisUrl: 'inline',
      channel: 'apphub:filestore',
      datasetSlug: 'filestore_activity',
      datasetName: 'Filestore Activity',
      tableName: 'filestore_activity',
      retryDelayMs: 3_000,
      inline: true
    }
  } satisfies ServiceConfig;
}

test('configureS3Support applies httpfs and cache settings', async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'timestore-cache-test-'));
  createdDirs.push(cacheDir);

  const config = createTestConfig(cacheDir);
  const executed: string[] = [];

  const connection = {
    run(sql: string, ...params: unknown[]) {
      executed.push(sql);
      const callback = params[params.length - 1] as (err: Error | null) => void;
      callback(null);
    }
  };

  await configureS3Support(connection, config);

  assert.ok(executed.includes('INSTALL httpfs'));
  assert.ok(executed.includes('LOAD httpfs'));
  assert.ok(executed.includes("SET s3_region='us-east-1'"));
  assert.ok(executed.includes("SET s3_endpoint='127.0.0.1:9000'"));
  assert.ok(executed.includes('SET s3_use_ssl=false'));
  assert.ok(executed.includes("SET s3_access_key_id='AKIA-test'"));
  assert.ok(executed.includes("SET s3_secret_access_key='secret-test'"));
  assert.ok(executed.includes("SET s3_session_token='session-test'"));
  assert.ok(executed.includes("SET s3_url_style='path'"));
  assert.ok(executed.includes(`SET s3_cache_directory='${cacheDir}'`));
  assert.ok(executed.includes("SET s3_cache_size='262144'"));
});

test('configureS3Support throws when s3 configuration missing', async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'timestore-cache-test-'));
  createdDirs.push(cacheDir);
  const config = createTestConfig(cacheDir);
  config.storage.s3 = undefined;

  const connection = {
    run(_sql: string, ...params: unknown[]) {
      const callback = params[params.length - 1] as (err: Error | null) => void;
      callback(null);
    }
  };

  await assert.rejects(() => configureS3Support(connection, config), /S3 configuration/);
});

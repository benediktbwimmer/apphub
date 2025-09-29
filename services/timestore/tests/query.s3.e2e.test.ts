/// <reference path="../src/types/embeddedPostgres.d.ts" />

import './testEnv';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import S3rver from 's3rver';
import { resetCachedServiceConfig } from '../src/config/serviceConfig';

let schemaModule: typeof import('../src/db/schema');
let clientModule: typeof import('../src/db/client');
let migrationsModule: typeof import('../src/db/migrations');
let bootstrapModule: typeof import('../src/service/bootstrap');
let ingestionModule: typeof import('../src/ingestion/processor');
let ingestionTypesModule: typeof import('../src/ingestion/types');
let queryPlannerModule: typeof import('../src/query/planner');

let postgres: EmbeddedPostgres | null = null;
let dataDirectory: string | null = null;
let s3Directory: string | null = null;
let cacheDirectory: string | null = null;
let s3rver: S3rver | null = null;
let bucketName: string;

before(async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'timestore-s3-pg-'));
  dataDirectory = dataRoot;
  const port = 57500 + Math.floor(Math.random() * 1000);
  const embedded = new EmbeddedPostgres({
    databaseDir: dataRoot,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    postgresFlags: ['-c', 'dynamic_shared_memory_type=posix'],
    onError(message) {
      console.error('[embedded-postgres:s3]', message);
    }
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('apphub');
  postgres = embedded;

  s3Directory = await mkdtemp(path.join(tmpdir(), 'timestore-s3-store-'));
  cacheDirectory = await mkdtemp(path.join(tmpdir(), 'timestore-s3-cache-'));
  bucketName = `timestore-e2e-${randomUUID().slice(0, 8)}`;
  const s3Port = 58000 + Math.floor(Math.random() * 1000);
  const server = new S3rver({
    address: '127.0.0.1',
    port: s3Port,
    silent: true,
    resetOnClose: true,
    allowMismatchedSignatures: true,
    directory: s3Directory,
    configureBuckets: [{ name: bucketName }]
  });
  await server.run();
  s3rver = server;

  process.env.TIMESTORE_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.TIMESTORE_PG_SCHEMA = `timestore_s3_${randomUUID().slice(0, 8)}`;
  process.env.TIMESTORE_PGPOOL_MAX = '4';
  process.env.TIMESTORE_STORAGE_DRIVER = 's3';
  process.env.TIMESTORE_S3_BUCKET = bucketName;
  process.env.TIMESTORE_S3_ENDPOINT = `http://127.0.0.1:${s3Port}`;
  process.env.TIMESTORE_S3_REGION = 'us-east-1';
  process.env.TIMESTORE_S3_ACCESS_KEY_ID = 'S3RVER';
  process.env.TIMESTORE_S3_SECRET_ACCESS_KEY = 'S3RVER';
  process.env.TIMESTORE_S3_FORCE_PATH_STYLE = 'true';
  process.env.TIMESTORE_QUERY_CACHE_DIR = cacheDirectory;
  process.env.TIMESTORE_QUERY_CACHE_MAX_BYTES = String(16 * 1024 * 1024);
  process.env.TIMESTORE_QUERY_CACHE_ENABLED = 'false';
  process.env.REDIS_URL = 'inline';
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';
  process.env.TIMESTORE_METRICS_ENABLED = 'false';

  resetCachedServiceConfig();

  schemaModule = await import('../src/db/schema');
  clientModule = await import('../src/db/client');
  migrationsModule = await import('../src/db/migrations');
  bootstrapModule = await import('../src/service/bootstrap');
  ingestionModule = await import('../src/ingestion/processor');
  ingestionTypesModule = await import('../src/ingestion/types');
  queryPlannerModule = await import('../src/query/planner');

  await schemaModule.ensureSchemaExists(clientModule.POSTGRES_SCHEMA);
  await migrationsModule.runMigrations();
  await bootstrapModule.ensureDefaultStorageTarget();
});

after(async () => {
  if (clientModule) {
    await clientModule.closePool();
  }
  if (postgres) {
    await postgres.stop();
  }
  if (s3rver) {
    await s3rver.close();
  }
  if (dataDirectory) {
    await rm(dataDirectory, { recursive: true, force: true });
  }
  if (s3Directory) {
    await rm(s3Directory, { recursive: true, force: true });
  }
  if (cacheDirectory) {
    await rm(cacheDirectory, { recursive: true, force: true });
  }

  delete process.env.TIMESTORE_STORAGE_DRIVER;
  delete process.env.TIMESTORE_S3_BUCKET;
  delete process.env.TIMESTORE_S3_ENDPOINT;
  delete process.env.TIMESTORE_S3_REGION;
  delete process.env.TIMESTORE_S3_ACCESS_KEY_ID;
  delete process.env.TIMESTORE_S3_SECRET_ACCESS_KEY;
  delete process.env.TIMESTORE_S3_FORCE_PATH_STYLE;
  delete process.env.TIMESTORE_QUERY_CACHE_DIR;
  delete process.env.TIMESTORE_QUERY_CACHE_MAX_BYTES;
  delete process.env.TIMESTORE_QUERY_CACHE_ENABLED;

  resetCachedServiceConfig();
});

test('ingests partitions into s3 and retrieves them through queries', async () => {
  const datasetSlug = `s3-observations-${randomUUID().slice(0, 8)}`;
  const payload = ingestionTypesModule.ingestionJobPayloadSchema.parse({
    datasetSlug,
    datasetName: 'S3 Ingestion Dataset',
    tableName: 'observations',
    schema: {
      fields: [
        { name: 'timestamp', type: 'timestamp' },
        { name: 'temperature_c', type: 'double' },
        { name: 'humidity_percent', type: 'double' }
      ]
    },
    partition: {
      key: { window: '2024-02-01', region: 's3-west' },
      timeRange: {
        start: '2024-02-01T00:00:00.000Z',
        end: '2024-02-01T01:00:00.000Z'
      }
    },
    rows: [
      {
        timestamp: '2024-02-01T00:05:00.000Z',
        temperature_c: 12.5,
        humidity_percent: 48.2
      },
      {
        timestamp: '2024-02-01T00:25:00.000Z',
        temperature_c: 13.1,
        humidity_percent: 47.9
      }
    ],
    idempotencyKey: `s3-batch-${randomUUID()}`,
    receivedAt: new Date().toISOString()
  });

  const ingestionResult = await ingestionModule.processIngestionJob(payload);
  assert.equal(ingestionResult.storageTarget.kind, 's3');

  const partition = ingestionResult.manifest.partitions[0]!;
  const s3Client = new S3Client({
    region: 'us-east-1',
    endpoint: process.env.TIMESTORE_S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: 'S3RVER',
      secretAccessKey: 'S3RVER'
    }
  });
  const listed = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: partition.filePath
    })
  );
  assert.equal(listed.KeyCount ?? 0, 1);
  const downloaded = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: partition.filePath
    })
  );
  const body = await downloaded.Body?.transformToByteArray();
  assert.ok(body);
  assert.ok(body.length > 0);
  const plan = await queryPlannerModule.buildQueryPlan(datasetSlug, {
    timeRange: {
      start: '2024-02-01T00:00:00.000Z',
      end: '2024-02-01T02:00:00.000Z'
    },
    columns: ['timestamp', 'temperature_c', 'humidity_percent'],
    timestampColumn: 'timestamp'
  });

  assert.equal(plan.partitions.length, 1);
  assert.ok(plan.partitions[0]?.location.startsWith(`s3://${bucketName}/`));
  assert.equal(plan.partitions[0]?.storageTarget.kind, 's3');
});

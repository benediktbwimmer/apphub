/// <reference path="../src/types/embeddedPostgres.d.ts" />

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createEmbeddedPostgres, stopEmbeddedPostgres } from '../../../tests/helpers';
import type { FastifyBaseLogger } from 'fastify';
import { runE2E } from '../../../tests/helpers';

runE2E(async ({ registerCleanup }) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'filestore-auto-provision-pg-'));
  registerCleanup(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const port = 59000 + Math.floor(Math.random() * 1000);
  const postgres = createEmbeddedPostgres({
    databaseDir: dataDir,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    postgresFlags: ['-c', 'dynamic_shared_memory_type=posix']
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('apphub');
  registerCleanup(async () => {
    await stopEmbeddedPostgres(postgres);
  });

  const schemaSuffix = randomUUID().slice(0, 8);
  process.env.FILESTORE_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.FILESTORE_PG_SCHEMA = `filestore_auto_${schemaSuffix}`;
  process.env.FILESTORE_PGPOOL_MAX = '4';
  process.env.FILESTORE_METRICS_ENABLED = 'false';
  process.env.FILESTORE_AUTOPROVISION_DEFAULT_BACKEND = '1';
  process.env.FILESTORE_AUTOPROVISION_MOUNT_KEY = 'auto-test-s3';
  process.env.FILESTORE_AUTOPROVISION_S3_BUCKET = 'auto-test-bucket';
  process.env.FILESTORE_AUTOPROVISION_S3_ENDPOINT = 'http://127.0.0.1:19000';
  process.env.FILESTORE_AUTOPROVISION_S3_REGION = 'us-west-2';
  process.env.FILESTORE_AUTOPROVISION_S3_FORCE_PATH_STYLE = 'true';
  process.env.FILESTORE_AUTOPROVISION_S3_ACCESS_KEY_ID = 'AKIAAUTOTEST';
  process.env.FILESTORE_AUTOPROVISION_S3_SECRET_ACCESS_KEY = 'secretAuto';
  process.env.FILESTORE_AUTOPROVISION_LABELS = 'dev,example';

  const clearModule = (modulePath: string) => {
    const resolved = require.resolve(modulePath);
    delete require.cache[resolved];
  };

  clearModule('../src/config/serviceConfig');
  clearModule('../src/db/client');

  const dbClientModule = await import('../src/db/client');
  const schemaModule = await import('../src/db/schema');
  const migrationsModule = await import('../src/db/migrations');
  const { autoProvisionDefaultBackend } = await import('../src/startup/autoProvision');

  registerCleanup(async () => {
    await dbClientModule.closePool();
  });

  await schemaModule.ensureSchemaExists(dbClientModule.POSTGRES_SCHEMA);
  await migrationsModule.runMigrationsWithConnection();

  const createLogger = (): FastifyBaseLogger => {
    const base: Partial<FastifyBaseLogger> & { level: string } = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
      fatal: () => undefined,
      level: 'info'
    };
    base.child = () => base as FastifyBaseLogger;
    return base as FastifyBaseLogger;
  };

  const logger = createLogger();

  await autoProvisionDefaultBackend({ logger });

  const initial = await dbClientModule.withConnection((client) =>
    client.query<{
      mount_key: string;
      backend_kind: string;
      bucket: string;
      prefix: string | null;
      access_mode: string;
      state: string;
      config: Record<string, unknown>;
    }>(
      'SELECT mount_key, backend_kind, bucket, prefix, access_mode, state, config FROM backend_mounts'
    )
  );

  assert.equal(initial.rowCount, 1);
  const firstRecord = initial.rows[0];
  assert.equal(firstRecord.mount_key, 'auto-test-s3');
  assert.equal(firstRecord.backend_kind, 's3');
  assert.equal(firstRecord.bucket, 'auto-test-bucket');
  assert.equal(firstRecord.prefix, null);
  assert.equal(firstRecord.access_mode, 'rw');
  assert.equal(firstRecord.state, 'active');
  assert.equal(firstRecord.config?.region, 'us-west-2');
  assert.equal(firstRecord.config?.endpoint, 'http://127.0.0.1:19000');
  assert.equal(firstRecord.config?.forcePathStyle, true);
  assert.equal(firstRecord.config?.accessKeyId, 'AKIAAUTOTEST');
  assert.equal(firstRecord.config?.secretAccessKey, 'secretAuto');

  process.env.FILESTORE_AUTOPROVISION_S3_ENDPOINT = 'http://127.0.0.1:29000';
  await autoProvisionDefaultBackend({ logger });

  const afterUpdate = await dbClientModule.withConnection((client) =>
    client.query<{ config: Record<string, unknown> }>(
      'SELECT config FROM backend_mounts WHERE mount_key = $1',
      ['auto-test-s3']
    )
  );

  assert.equal(afterUpdate.rowCount, 1);
  assert.equal(afterUpdate.rows[0].config?.endpoint, 'http://127.0.0.1:29000');
});

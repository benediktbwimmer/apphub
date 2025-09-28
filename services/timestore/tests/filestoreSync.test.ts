/// <reference path="../src/types/embeddedPostgres.d.ts" />

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, beforeEach, test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
import type { FastifyBaseLogger } from 'fastify';
import type {
  FilestoreNodeEventPayload,
  FilestoreNodeReconciledPayload,
  FilestoreCommandCompletedPayload
} from '@apphub/shared/filestoreEvents';
import { loadDuckDb } from '@apphub/shared';

let postgres: EmbeddedPostgres | null = null;
let dataDirectory: string | null = null;
let storageRoot: string | null = null;

let configModule: typeof import('../src/config/serviceConfig');
let schemaModule: typeof import('../src/db/schema');
let dbClientModule: typeof import('../src/db/client');
let migrationsModule: typeof import('../src/db/migrations');
let bootstrapModule: typeof import('../src/service/bootstrap');
let consumerModule: typeof import('../src/filestore/consumer');
let stateModule: typeof import('../src/filestore/stateRepository');

function createTestLogger(): FastifyBaseLogger {
  const noop = () => undefined;
  const logger: FastifyBaseLogger = {
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    silent: noop,
    level: 'info',
    child() {
      return logger;
    }
  } as FastifyBaseLogger;
  return logger;
}

before(async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'timestore-filestore-pg-'));
  dataDirectory = dataRoot;
  const port = 57000 + Math.floor(Math.random() * 500);
  const embedded = new EmbeddedPostgres({
    databaseDir: dataRoot,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('apphub');
  postgres = embedded;

  storageRoot = await mkdtemp(path.join(tmpdir(), 'timestore-filestore-storage-'));

  process.env.TIMESTORE_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.TIMESTORE_PG_SCHEMA = `timestore_test_${randomUUID().slice(0, 8)}`;
  process.env.TIMESTORE_PGPOOL_MAX = '4';
  process.env.TIMESTORE_STORAGE_ROOT = storageRoot;
  process.env.TIMESTORE_STORAGE_DRIVER = 'local';
  process.env.REDIS_URL = 'inline';
  process.env.FILESTORE_REDIS_URL = 'inline';
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';
  process.env.FILESTORE_EVENTS_CHANNEL = 'apphub:filestore';
  process.env.TIMESTORE_FILESTORE_DATASET_SLUG = `filestore_activity_${randomUUID().slice(0, 6)}`;
  process.env.TIMESTORE_FILESTORE_SYNC_ENABLED = 'true';
  process.env.TIMESTORE_METRICS_ENABLED = 'false';

  configModule = await import('../src/config/serviceConfig');
  schemaModule = await import('../src/db/schema');
  dbClientModule = await import('../src/db/client');
  migrationsModule = await import('../src/db/migrations');
  bootstrapModule = await import('../src/service/bootstrap');
  consumerModule = await import('../src/filestore/consumer');
  stateModule = await import('../src/filestore/stateRepository');

  configModule.resetCachedServiceConfig();
  consumerModule.resetFilestoreActivityForTests();

  const config = configModule.loadServiceConfig();
  await schemaModule.ensureSchemaExists(config.database.schema);
});

beforeEach(async () => {
  consumerModule.resetFilestoreActivityForTests();
  await consumerModule.shutdownFilestoreActivity().catch(() => undefined);
  await migrationsModule.runMigrations();
  await bootstrapModule.ensureDefaultStorageTarget();
});

after(async () => {
  await consumerModule.shutdownFilestoreActivity().catch(() => undefined);
  await dbClientModule.closePool().catch(() => undefined);
  if (postgres) {
    await postgres.stop();
  }
  if (dataDirectory) {
    await rm(dataDirectory, { recursive: true, force: true });
  }
  if (storageRoot) {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test('ingests filestore activity rows into timestore dataset', async () => {
  const config = configModule.loadServiceConfig();
  const logger = createTestLogger();
  await consumerModule.initializeFilestoreActivity({ config, logger });

  const createdEvent: FilestoreNodeEventPayload = {
    backendMountId: 10,
    nodeId: 9001,
    path: 'datasets/reports/monthly.parquet',
    kind: 'file',
    state: 'active',
    parentId: 812,
    version: 1,
    sizeBytes: 128,
    checksum: 'abc123',
    contentHash: null,
    metadata: { format: 'parquet' },
    journalId: 501,
    command: 'uploadFile',
    idempotencyKey: 'upload-123',
    principal: 'analytics-bot',
    observedAt: new Date().toISOString()
  };

  consumerModule.emitFilestoreActivityInline({ type: 'filestore.node.created', data: createdEvent });
  await consumerModule.waitForFilestoreActivityIdle();

  const updatedEvent: FilestoreNodeEventPayload = {
    ...createdEvent,
    version: 2,
    sizeBytes: 256,
    observedAt: new Date(Date.now() + 1_000).toISOString()
  };

  consumerModule.emitFilestoreActivityInline({ type: 'filestore.node.updated', data: updatedEvent });

  const reconciliationEvent: FilestoreNodeReconciledPayload = {
    backendMountId: createdEvent.backendMountId,
    nodeId: createdEvent.nodeId!,
    path: createdEvent.path,
    kind: 'file',
    state: 'active',
    parentId: createdEvent.parentId,
    version: 3,
    sizeBytes: 512,
    checksum: 'def456',
    contentHash: null,
    metadata: { format: 'parquet' },
    consistencyState: 'active',
    consistencyCheckedAt: new Date().toISOString(),
    lastReconciledAt: new Date().toISOString(),
    previousState: 'inconsistent',
    reason: 'audit',
    observedAt: new Date(Date.now() + 2_000).toISOString()
  };

  consumerModule.emitFilestoreActivityInline({ type: 'filestore.node.reconciled', data: reconciliationEvent });

  const commandEvent: FilestoreCommandCompletedPayload = {
    journalId: 999,
    command: 'uploadFile',
    backendMountId: createdEvent.backendMountId,
    nodeId: createdEvent.nodeId,
    path: createdEvent.path,
    idempotencyKey: 'upload-123',
    principal: 'analytics-bot',
    result: { durationMs: 1200 },
    observedAt: new Date(Date.now() + 3_000).toISOString()
  };

  consumerModule.emitFilestoreActivityInline({ type: 'filestore.command.completed', data: commandEvent });

  await consumerModule.waitForFilestoreActivityIdle();

  const state = await dbClientModule.withConnection((client) => stateModule.getFilestoreNodeState(client, createdEvent.nodeId!));
  assert.ok(state);
  assert.equal(state?.sizeBytes, 512);
  assert.equal(state?.consistencyState, 'active');

  const datasetSlug = config.filestore.datasetSlug;
  const partitions = await dbClientModule.withConnection(async (client) => {
    const result = await client.query(
      `SELECT p.file_path
         FROM dataset_partitions p
         JOIN datasets d ON d.id = p.dataset_id
        WHERE d.slug = $1
        ORDER BY p.created_at ASC`,
      [datasetSlug]
    );
    return result.rows;
  });

  assert.ok(storageRoot);
  const duckdb = loadDuckDb();
  const rows: any[] = [];

  for (const record of partitions) {
    const duckdbPath = path.join(storageRoot!, record.file_path.split('/').join(path.sep));
    const fileStats = await stat(duckdbPath);
    assert.ok(fileStats.size > 0);

    const db = new duckdb.Database(duckdbPath);
    const connection = db.connect();
    const fileRows = await new Promise<any[]>((resolve, reject) => {
      connection.all(
        `SELECT * FROM ${config.filestore.tableName} ORDER BY observed_at ASC`,
        (err: Error | null, result?: any[]) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(result ?? []);
        }
      );
    });
    connection.close();
    db.close();
    rows.push(...fileRows);
  }

  rows.sort((a, b) => String(a.observed_at).localeCompare(String(b.observed_at)));

  assert.ok(rows.length >= 3, `eventTypes=${rows.map((row: any) => row.event_type).join(',')}`);

  const first = rows[0];
  assert.equal(first.event_type, 'filestore.node.created');
  assert.equal(first.size_bytes, 128);
  assert.equal(first.size_delta, 128);

  const second = rows[1];
  assert.equal(second.event_type, 'filestore.node.updated');
  assert.equal(second.size_bytes, 256);
  assert.equal(second.size_delta, 128);

  const reconciled = rows.find((row: any) => row.event_type === 'filestore.node.reconciled');
  assert.ok(reconciled);
  assert.equal(reconciled.reconciliation_reason, 'audit');
  assert.equal(reconciled.size_bytes, 512);
});

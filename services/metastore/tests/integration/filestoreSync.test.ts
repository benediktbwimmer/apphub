/// <reference path="../../src/types/embeddedPostgres.d.ts" />

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, beforeEach, test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
import type { FastifyBaseLogger } from 'fastify';
import type { FilestoreNodeEventPayload, FilestoreNodeReconciledPayload } from '@apphub/shared/filestoreEvents';

let postgres: EmbeddedPostgres | null = null;
let dataDirectory: string | null = null;

let configModule: typeof import('../../src/config/serviceConfig');
let dbClientModule: typeof import('../../src/db/client');
let migrationsModule: typeof import('../../src/db/migrations');
let consumerModule: typeof import('../../src/filestore/consumer');
let recordsModule: typeof import('../../src/db/recordsRepository');

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
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'metastore-filestore-pg-'));
  dataDirectory = dataRoot;
  const port = 56000 + Math.floor(Math.random() * 500);
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

  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.FILESTORE_REDIS_URL = 'inline';
  process.env.FILESTORE_EVENTS_CHANNEL = 'apphub:filestore';
  process.env.METASTORE_FILESTORE_NAMESPACE = `filestore_sync_${randomUUID().slice(0, 6)}`;
  process.env.METASTORE_FILESTORE_SYNC_ENABLED = 'true';
  process.env.APPHUB_METRICS_ENABLED = 'false';

  configModule = await import('../../src/config/serviceConfig');
  dbClientModule = await import('../../src/db/client');
  migrationsModule = await import('../../src/db/migrations');
  consumerModule = await import('../../src/filestore/consumer');
  recordsModule = await import('../../src/db/recordsRepository');

  configModule.resetServiceConfigCache();
  consumerModule.resetFilestoreSyncForTests();

  await dbClientModule.withConnection(async () => undefined);
});

beforeEach(async () => {
  await dbClientModule.withConnection(async (client) => {
    await migrationsModule.runMigrations(client);
  });
  await consumerModule.shutdownFilestoreSync().catch(() => undefined);
  consumerModule.resetFilestoreSyncForTests();
});

after(async () => {
  await consumerModule.shutdownFilestoreSync().catch(() => undefined);
  await dbClientModule.closePool().catch(() => undefined);
  if (postgres) {
    await postgres.stop();
  }
  if (dataDirectory) {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('synchronises filestore node events into metastore records', async () => {
  const config = configModule.loadServiceConfig();
  const logger = createTestLogger();
  await consumerModule.initializeFilestoreSync({ config, logger });

  const nodeEvent: FilestoreNodeEventPayload = {
    backendMountId: 101,
    nodeId: 501,
    path: 'datasets/raw/sales',
    kind: 'directory',
    state: 'active',
    parentId: 300,
    version: 1,
    sizeBytes: 0,
    checksum: null,
    contentHash: null,
    metadata: { owner: 'analytics' },
    journalId: 9901,
    command: 'createDirectory',
    idempotencyKey: 'create-sales-dir',
    principal: 'test-user',
    observedAt: new Date().toISOString()
  };

  consumerModule.emitFilestoreEventInline({ type: 'filestore.node.created', data: nodeEvent });
  await consumerModule.waitForFilestoreSyncIdle();

  const record = await dbClientModule.withConnection(async (client) => {
    const result = await client.query(
      `SELECT metadata, tags, deleted_at FROM metastore_records WHERE namespace = $1 AND record_key = $2`,
      [config.filestoreSync.namespace, String(nodeEvent.nodeId)]
    );
    assert.equal(result.rowCount, 1);
    return result.rows[0];
  });

  assert.ok(record.metadata);
  assert.equal(record.deleted_at, null);
  assert.deepEqual(record.tags, []);
  assert.equal(record.metadata.filestore.path, nodeEvent.path);
  assert.equal(record.metadata.filestore.backendMountId, nodeEvent.backendMountId);
  assert.equal(record.metadata.filestore.state, 'active');

  await dbClientModule.withConnection(async (client) => {
    await recordsModule.updateRecord(client, {
      namespace: config.filestoreSync.namespace,
      key: String(nodeEvent.nodeId),
      metadata: record.metadata,
      tags: ['gold'],
      actor: 'test-user'
    });
  });

  const updatedEvent: FilestoreNodeEventPayload = {
    ...nodeEvent,
    version: 2,
    sizeBytes: 2048,
    metadata: { owner: 'analytics', lifecycle: 'hot' },
    observedAt: new Date(Date.now() + 5000).toISOString()
  };

  consumerModule.emitFilestoreEventInline({ type: 'filestore.node.updated', data: updatedEvent });
  await consumerModule.waitForFilestoreSyncIdle();

  const updatedRecord = await dbClientModule.withConnection(async (client) => {
    const result = await client.query(
      `SELECT metadata, tags FROM metastore_records WHERE namespace = $1 AND record_key = $2`,
      [config.filestoreSync.namespace, String(nodeEvent.nodeId)]
    );
    assert.equal(result.rowCount, 1);
    return result.rows[0];
  });

  assert.equal(updatedRecord.tags.includes('gold'), true);
  assert.equal(updatedRecord.metadata.filestore.sizeBytes, 2048);
  assert.equal(updatedRecord.metadata.filestore.version, 2);
  assert.equal(updatedRecord.metadata.filestore.nodeMetadata.lifecycle, 'hot');

  const reconciliationEvent: FilestoreNodeReconciledPayload = {
    backendMountId: nodeEvent.backendMountId,
    nodeId: nodeEvent.nodeId!,
    path: nodeEvent.path,
    kind: 'directory',
    state: 'active',
    parentId: nodeEvent.parentId,
    version: 3,
    sizeBytes: 3072,
    checksum: null,
    contentHash: null,
    metadata: { owner: 'analytics' },
    consistencyState: 'active',
    consistencyCheckedAt: new Date().toISOString(),
    lastReconciledAt: new Date().toISOString(),
    previousState: 'inconsistent',
    reason: 'audit',
    observedAt: new Date().toISOString()
  };

  consumerModule.emitFilestoreEventInline({ type: 'filestore.node.reconciled', data: reconciliationEvent });
  await consumerModule.waitForFilestoreSyncIdle();

  const reconciledRecord = await dbClientModule.withConnection(async (client) => {
    const result = await client.query(
      `SELECT metadata FROM metastore_records WHERE namespace = $1 AND record_key = $2`,
      [config.filestoreSync.namespace, String(nodeEvent.nodeId)]
    );
    assert.equal(result.rowCount, 1);
    return result.rows[0];
  });

  assert.equal(reconciledRecord.metadata.filestore.consistencyState, 'active');
  assert.equal(reconciledRecord.metadata.filestore.reconciliationReason, 'audit');

  consumerModule.emitFilestoreEventInline({ type: 'filestore.node.deleted', data: { ...nodeEvent, state: 'deleted' } });
  await consumerModule.waitForFilestoreSyncIdle();

  const deletedRecord = await dbClientModule.withConnection(async (client) => {
    const result = await client.query(
      `SELECT deleted_at FROM metastore_records WHERE namespace = $1 AND record_key = $2`,
      [config.filestoreSync.namespace, String(nodeEvent.nodeId)]
    );
    assert.equal(result.rowCount, 1);
    return result.rows[0];
  });

  assert.notEqual(deletedRecord.deleted_at, null);
});

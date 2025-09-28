/// <reference path="../src/types/embeddedPostgres.d.ts" />

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, afterEach, before, test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client
} from '@aws-sdk/client-s3';

import { createS3Executor } from '../src/executors/s3Executor';
import { FilestoreError } from '../src/errors';
import type { FilestoreEvent } from '../src/events/publisher';

let postgres: EmbeddedPostgres | null = null;
let dataDirectory: string | null = null;

let clientModule: typeof import('../src/db/client');
let schemaModule: typeof import('../src/db/schema');
let migrationsModule: typeof import('../src/db/migrations');
let configModule: typeof import('../src/config/serviceConfig');
let orchestratorModule: typeof import('../src/commands/orchestrator');
let rollupManagerModule: typeof import('../src/rollup/manager');
let reconciliationManagerModule: typeof import('../src/reconciliation/manager');
let nodesModule: typeof import('../src/db/nodes');
let eventsModule: typeof import('../src/events/publisher');
let serviceConfig: import('../src/config/serviceConfig').ServiceConfig;

class InMemoryS3Client {
  constructor(private readonly store: Map<string, string>) {}

  async send(command: unknown): Promise<unknown> {
    if (command instanceof PutObjectCommand) {
      const key = command.input.Key;
      if (!key) {
        throw new Error('Key is required');
      }
      this.store.set(key, String(command.input.Body ?? ''));
      return {};
    }

    if (command instanceof DeleteObjectCommand) {
      const key = command.input.Key;
      if (key) {
        this.store.delete(key);
      }
      return {};
    }

    if (command instanceof DeleteObjectsCommand) {
      const objects = command.input.Delete?.Objects ?? [];
      for (const object of objects) {
        if (object?.Key) {
          this.store.delete(object.Key);
        }
      }
      return {};
    }

    if (command instanceof ListObjectsV2Command) {
      const prefix = command.input.Prefix ?? '';
      const keys = Array.from(this.store.keys()).filter((key) => key.startsWith(prefix));
      const slice = keys.slice(0, command.input.MaxKeys ?? 1000);
      return {
        Contents: slice.map((key) => ({ Key: key })),
        KeyCount: slice.length,
        IsTruncated: slice.length < keys.length,
        NextContinuationToken: undefined
      } satisfies {
        Contents: { Key: string }[];
        KeyCount: number;
        IsTruncated: boolean;
        NextContinuationToken?: string;
      };
    }

    throw new Error(`Unsupported command: ${command?.constructor?.name ?? 'unknown'}`);
  }
}

before(async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'filestore-s3-pg-'));
  dataDirectory = dataRoot;
  const port = 56500 + Math.floor(Math.random() * 1000);
  const embedded = new EmbeddedPostgres({
    databaseDir: dataRoot,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    postgresFlags: ['-c', 'dynamic_shared_memory_type=posix']
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('apphub');
  postgres = embedded;

  const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.FILESTORE_DATABASE_URL = connectionString;
  process.env.FILESTORE_PG_SCHEMA = `filestore_s3_${randomUUID().slice(0, 8)}`;
  process.env.FILESTORE_PGPOOL_MAX = '4';
  process.env.FILESTORE_METRICS_ENABLED = 'false';
  process.env.FILESTORE_REDIS_URL = 'inline';
  process.env.FILESTORE_ROLLUP_CACHE_TTL_SECONDS = '60';
  process.env.FILESTORE_EVENTS_MODE = 'inline';
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';

  const modulePaths = [
    '../src/db/migrations',
    '../src/db/schema',
    '../src/db/client',
    '../src/config/serviceConfig',
    '../src/commands/orchestrator',
    '../src/rollup/manager',
    '../src/reconciliation/manager',
    '../src/events/publisher',
    '../src/db/nodes'
  ];

  for (const modulePath of modulePaths) {
    const resolved = require.resolve(modulePath);
    delete require.cache[resolved];
  }

  configModule = await import('../src/config/serviceConfig');
  configModule.resetCachedServiceConfig();

  clientModule = await import('../src/db/client');
  schemaModule = await import('../src/db/schema');
  migrationsModule = await import('../src/db/migrations');
  orchestratorModule = await import('../src/commands/orchestrator');
  rollupManagerModule = await import('../src/rollup/manager');
  reconciliationManagerModule = await import('../src/reconciliation/manager');
  nodesModule = await import('../src/db/nodes');
  eventsModule = await import('../src/events/publisher');
  rollupManagerModule.resetRollupManagerForTests();
  reconciliationManagerModule.resetReconciliationManagerForTests();
  eventsModule.resetFilestoreEventsForTests();
  serviceConfig = configModule.loadServiceConfig();
  await eventsModule.initializeFilestoreEvents({ config: serviceConfig });

  await schemaModule.ensureSchemaExists(clientModule.POSTGRES_SCHEMA);
  await migrationsModule.runMigrationsWithConnection();
});

after(async () => {
  if (rollupManagerModule) {
    await rollupManagerModule.shutdownRollupManager();
  }
  if (reconciliationManagerModule) {
    await reconciliationManagerModule.shutdownReconciliationManager();
  }
  if (eventsModule) {
    await eventsModule.shutdownFilestoreEvents().catch(() => undefined);
    eventsModule.resetFilestoreEventsForTests();
  }
  if (clientModule) {
    await clientModule.closePool();
  }
  if (postgres) {
    await postgres.stop();
  }
  if (dataDirectory) {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

afterEach(async () => {
  if (rollupManagerModule) {
    await rollupManagerModule.shutdownRollupManager();
    rollupManagerModule.resetRollupManagerForTests();
  }
  if (reconciliationManagerModule) {
    await reconciliationManagerModule.shutdownReconciliationManager().catch(() => undefined);
    reconciliationManagerModule.resetReconciliationManagerForTests();
  }
  if (eventsModule) {
    await eventsModule.shutdownFilestoreEvents().catch(() => undefined);
    eventsModule.resetFilestoreEventsForTests();
    await eventsModule.initializeFilestoreEvents({ config: serviceConfig });
  }
});

async function createS3BackendMount(store: Map<string, string>, prefix?: string): Promise<{ mountId: number }>
{
  const { rows } = await clientModule.withConnection(async (client) =>
    client.query<{ id: number }>(
      `INSERT INTO backend_mounts (mount_key, backend_kind, bucket, prefix, config)
       VALUES ($1, 's3', $2, $3, $4::jsonb)
       RETURNING id`,
      [
        `s3-${randomUUID().slice(0, 8)}`,
        'in-memory-bucket',
        prefix ?? null,
        JSON.stringify({})
      ]
    )
  );
  const mountId = rows[0].id;
  clientModule.withConnection(async (client) => {
    await client.query(
      `UPDATE backend_mounts
          SET config = config || $2::jsonb
        WHERE id = $1`,
      [mountId, JSON.stringify({ __testStoreId: mountId })]
    );
  }).catch(() => undefined);
  stores.set(mountId, store);
  return { mountId };
}

const stores = new Map<number, Map<string, string>>();
(globalThis as { __filestoreTestS3Stores?: Map<number, Map<string, string>> }).__filestoreTestS3Stores = stores;

function createExecutorMap(store: Map<string, string>) {
  return new Map([
    [
      's3',
      createS3Executor({
        clientFactory: (backend) => {
          const bucketStore = stores.get(backend.id) ?? store;
          return new InMemoryS3Client(bucketStore) as unknown as S3Client;
        }
      })
    ]
  ]);
}

test('createDirectory creates placeholder object in S3', async () => {
  const store = new Map<string, string>();
  const { mountId } = await createS3BackendMount(store);

  await orchestratorModule.runCommand({
    command: {
      type: 'createDirectory',
      backendMountId: mountId,
      path: 'datasets'
    },
    executors: createExecutorMap(store)
  });

  const result = await orchestratorModule.runCommand({
    command: {
      type: 'createDirectory',
      backendMountId: mountId,
      path: 'datasets/observatory'
    },
    executors: createExecutorMap(store)
  });

  assert.equal(result.idempotent, false);
  assert.ok(store.has('datasets/observatory/'));
});

test('deleteNode recursive removes objects within prefix', async () => {
  const store = new Map<string, string>();
  const { mountId } = await createS3BackendMount(store, 'workspace');

  await orchestratorModule.runCommand({
    command: {
      type: 'createDirectory',
      backendMountId: mountId,
      path: 'workspace'
    },
    executors: createExecutorMap(store)
  });
  store.delete('workspace/');

  await orchestratorModule.runCommand({
    command: {
      type: 'createDirectory',
      backendMountId: mountId,
      path: 'workspace/datasets'
    },
    executors: createExecutorMap(store)
  });

  store.set('workspace/datasets/file.txt', 'payload');

  const result = await orchestratorModule.runCommand({
    command: {
      type: 'deleteNode',
      backendMountId: mountId,
      path: 'workspace/datasets',
      recursive: true
    },
    executors: createExecutorMap(store)
  });

  assert.equal(result.node?.state, 'deleted');
  const allKeys = Array.from(store.keys());
  const remainingKeys = allKeys.filter((key) => key.startsWith('workspace/datasets'));
  assert.equal(remainingKeys.length, 0);
});

test('deleteNode non-recursive prevents removal when children exist', async () => {
  const store = new Map<string, string>();
  const { mountId } = await createS3BackendMount(store);

  await orchestratorModule.runCommand({
    command: {
      type: 'createDirectory',
      backendMountId: mountId,
      path: 'datasets'
    },
    executors: createExecutorMap(store)
  });

  await orchestratorModule.runCommand({
    command: {
      type: 'createDirectory',
      backendMountId: mountId,
      path: 'datasets/reports'
    },
    executors: createExecutorMap(store)
  });
  store.set('datasets/reports/report.json', '{}');

  await assert.rejects(
    orchestratorModule.runCommand({
      command: {
        type: 'deleteNode',
        backendMountId: mountId,
        path: 'datasets/reports'
      },
      executors: createExecutorMap(store)
    }),
    (err: unknown) => err instanceof FilestoreError && err.code === 'CHILDREN_EXIST'
  );
});

test('reconciliation worker heals S3 drift and emits events', async () => {
  const store = new Map<string, string>();
  const { mountId } = await createS3BackendMount(store);

  await orchestratorModule.runCommand({
    command: {
      type: 'createDirectory',
      backendMountId: mountId,
      path: 'datasets'
    },
    executors: createExecutorMap(store)
  });

  await orchestratorModule.runCommand({
    command: {
      type: 'createDirectory',
      backendMountId: mountId,
      path: 'datasets/reconcile'
    },
    executors: createExecutorMap(store)
  });

  const nodeRecord = await clientModule.withConnection((client) =>
    nodesModule.getNodeByPath(client, mountId, 'datasets/reconcile')
  );
  assert.ok(nodeRecord);

  const events: FilestoreEvent[] = [];
  const unsubscribe = eventsModule.subscribeToFilestoreEvents((event) => {
    if (event.type === 'filestore.node.missing' || event.type === 'filestore.node.reconciled') {
      events.push(event);
    }
  });

  store.delete('datasets/reconcile/');

  await reconciliationManagerModule.initializeReconciliationManager({
    config: serviceConfig,
    metricsEnabled: false
  });
  const manager = reconciliationManagerModule.ensureReconciliationManager();

  await manager.enqueue({
    backendMountId: mountId,
    nodeId: nodeRecord.id,
    path: 'datasets/reconcile',
    reason: 'audit'
  });

  const missingNode = await clientModule.withConnection((client) =>
    nodesModule.getNodeById(client, nodeRecord.id)
  );
  assert.ok(missingNode);
  assert.equal(missingNode?.state, 'missing');
  assert.equal(missingNode?.consistencyState, 'missing');

  const missingEvent = events.find(
    (event) => event.type === 'filestore.node.missing' && event.data.nodeId === nodeRecord.id
  );
  assert.ok(missingEvent);

  store.set('datasets/reconcile/', 'placeholder');

  await manager.enqueue({
    backendMountId: mountId,
    nodeId: nodeRecord.id,
    path: 'datasets/reconcile',
    reason: 'manual'
  });

  const reconciledNode = await clientModule.withConnection((client) =>
    nodesModule.getNodeById(client, nodeRecord.id)
  );
  assert.ok(reconciledNode);
  assert.equal(reconciledNode?.state, 'active');
  assert.equal(reconciledNode?.consistencyState, 'active');

  const reconciledEvent = events.find(
    (event) => event.type === 'filestore.node.reconciled' && event.data.nodeId === nodeRecord.id
  );
  assert.ok(reconciledEvent);

  unsubscribe();
});

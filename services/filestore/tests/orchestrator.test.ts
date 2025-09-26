/// <reference path="../src/types/embeddedPostgres.d.ts" />

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { after, afterEach, before, test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';

import type { CommandExecutor } from '../src/executors/types';
import { filestoreEvents } from '../src/events/bus';
import type { FilestoreEvent } from '../src/events/publisher';

let postgres: EmbeddedPostgres | null = null;
let dataDirectory: string | null = null;
const backendRoots: string[] = [];

let clientModule: typeof import('../src/db/client');
let schemaModule: typeof import('../src/db/schema');
let migrationsModule: typeof import('../src/db/migrations');
let configModule: typeof import('../src/config/serviceConfig');
let nodesModule: typeof import('../src/db/nodes');
let orchestratorModule: typeof import('../src/commands/orchestrator');
let rollupManagerModule: typeof import('../src/rollup/manager');
let eventsModule: typeof import('../src/events/publisher');
let serviceConfig: import('../src/config/serviceConfig').ServiceConfig;

before(async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'filestore-orchestrator-pg-'));
  dataDirectory = dataRoot;
  const port = 56000 + Math.floor(Math.random() * 1000);
  const embedded = new EmbeddedPostgres({
    databaseDir: dataRoot,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    postgresFlags: ['-c', 'dynamic_shared_memory_type=posix'],
    onError(message) {
      console.error('[embedded-postgres:filestore-orchestrator]', message);
    }
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('apphub');
  postgres = embedded;

  const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.FILESTORE_DATABASE_URL = connectionString;
  process.env.FILESTORE_PG_SCHEMA = `filestore_test_${randomUUID().slice(0, 8)}`;
  process.env.FILESTORE_PGPOOL_MAX = '4';
  process.env.FILESTORE_METRICS_ENABLED = 'false';
  process.env.FILESTORE_REDIS_URL = 'inline';
  process.env.FILESTORE_ROLLUP_CACHE_TTL_SECONDS = '60';
  process.env.FILESTORE_EVENTS_MODE = 'inline';

  const modulePaths = [
    '../src/db/nodes',
    '../src/db/migrations',
    '../src/db/schema',
    '../src/db/client',
    '../src/config/serviceConfig',
    '../src/rollup/manager',
    '../src/events/publisher'
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
  nodesModule = await import('../src/db/nodes');
  orchestratorModule = await import('../src/commands/orchestrator');
  rollupManagerModule = await import('../src/rollup/manager');
  eventsModule = await import('../src/events/publisher');
  rollupManagerModule.resetRollupManagerForTests();
  eventsModule.resetFilestoreEventsForTests();
  serviceConfig = configModule.loadServiceConfig();

  await schemaModule.ensureSchemaExists(clientModule.POSTGRES_SCHEMA);
  await migrationsModule.runMigrationsWithConnection();
  await eventsModule.initializeFilestoreEvents({ config: serviceConfig });
});

after(async () => {
  if (eventsModule) {
    await eventsModule.shutdownFilestoreEvents().catch(() => undefined);
    eventsModule.resetFilestoreEventsForTests();
  }
  if (rollupManagerModule) {
    await rollupManagerModule.shutdownRollupManager();
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
  for (const dir of backendRoots) {
    await rm(dir, { recursive: true, force: true });
  }
});

afterEach(async () => {
  if (rollupManagerModule) {
    await rollupManagerModule.shutdownRollupManager();
    rollupManagerModule.resetRollupManagerForTests();
  }
  if (eventsModule) {
    await eventsModule.shutdownFilestoreEvents().catch(() => undefined);
    eventsModule.resetFilestoreEventsForTests();
    await eventsModule.initializeFilestoreEvents({ config: serviceConfig });
  }
});

async function createBackendMount(): Promise<number> {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'filestore-local-executor-'));
  backendRoots.push(rootDir);
  const { rows } = await clientModule.withConnection(async (client) =>
    client.query<{ id: number }>(
      `INSERT INTO backend_mounts (mount_key, backend_kind, root_path)
       VALUES ($1, 'local', $2)
       RETURNING id`,
      [`local-${randomUUID().slice(0, 8)}`, rootDir]
    )
  );
  return rows[0].id;
}

async function getJournalCount(): Promise<number> {
  const result = await clientModule.withConnection(async (client) =>
    client.query('SELECT COUNT(*)::int AS count FROM journal_entries')
  );
  return result.rows[0].count as number;
}

test('createDirectory inserts node, journal entry, and emits event', async () => {
  const backendMountId = await createBackendMount();

  const executorCalls: string[] = [];
  const executor: CommandExecutor = {
    kind: 'local',
    async execute(command) {
      executorCalls.push(command.type);
      return {};
    }
  };
  const executors = new Map<string, CommandExecutor>([['local', executor]]);

  const countBeforeParent = await getJournalCount();
  await orchestratorModule.runCommand({
    command: {
      type: 'createDirectory',
      backendMountId,
      path: 'datasets'
    },
    executors
  });
  const countAfterParent = await getJournalCount();

  const recordedFilestoreEvents: FilestoreEvent[] = [];
  const unsubscribeFilestoreEvents = eventsModule.subscribeToFilestoreEvents((event) => {
    recordedFilestoreEvents.push(event);
  });

  const recordedEvents: unknown[] = [];
  const listener = (payload: unknown) => recordedEvents.push(payload);
  filestoreEvents.on('command.completed', listener);

  const result = await orchestratorModule.runCommand({
    command: {
      type: 'createDirectory',
      backendMountId,
      path: 'datasets/observatory'
    },
    principal: 'test-user',
    idempotencyKey: 'create-dir-1',
    executors
  });

  filestoreEvents.off('command.completed', listener);
  unsubscribeFilestoreEvents();

  assert.equal(result.idempotent, false);
  assert.ok(result.node);
  assert.equal(result.node?.path, 'datasets/observatory');
  assert.equal(result.node?.state, 'active');
  assert.equal(result.result.nodeId, result.node?.id);
  assert.equal(executorCalls.length, 2);
  assert.equal(executorCalls[executorCalls.length - 1], 'createDirectory');
  assert.equal(recordedEvents.length, 1);

  const node = await clientModule.withConnection(async (client) =>
    nodesModule.getNodeByPath(client, backendMountId, 'datasets/observatory')
  );
  assert.ok(node);
  assert.equal(node?.state, 'active');

  const parentNode = await clientModule.withConnection(async (client) =>
    nodesModule.getNodeByPath(client, backendMountId, 'datasets')
  );
  assert.ok(parentNode);

  const childRollup = await rollupManagerModule.getRollupSummary(node!.id);
  assert.ok(childRollup);
  assert.equal(childRollup?.directoryCount, 0);
  assert.equal(childRollup?.childCount, 0);
  assert.equal(childRollup?.state, 'up_to_date');

  const parentRollup = await rollupManagerModule.getRollupSummary(parentNode!.id);
  assert.ok(parentRollup);
  assert.equal(parentRollup?.directoryCount, 1);
  assert.equal(parentRollup?.childCount, 1);

  const cachedParent = await rollupManagerModule.getRollupSummary(parentNode!.id);
  assert.equal(cachedParent?.directoryCount, parentRollup?.directoryCount);

  const commandEvent = recordedFilestoreEvents.find(
    (event) => event.type === 'filestore.command.completed' && event.data.path === 'datasets/observatory'
  );
  assert.ok(commandEvent);
  if (!commandEvent || commandEvent.type !== 'filestore.command.completed') {
    assert.fail('expected command completed event for datasets/observatory');
  }

  const nodeEvent = recordedFilestoreEvents.find(
    (event) =>
      (event.type === 'filestore.node.created' || event.type === 'filestore.node.updated') &&
      event.data.path === 'datasets/observatory'
  );
  assert.ok(nodeEvent);
  if (!nodeEvent) {
    assert.fail('expected node event for datasets/observatory');
  }
  if (nodeEvent.type !== 'filestore.node.created' && nodeEvent.type !== 'filestore.node.updated') {
    assert.fail('unexpected node event type');
  }
  assert.equal(nodeEvent.type, 'filestore.node.created');
  assert.equal(nodeEvent.data.backendMountId, backendMountId);
  assert.equal(nodeEvent.data.state, 'active');

  const finalCount = await getJournalCount();
  assert.equal(countAfterParent - countBeforeParent, 1);
  assert.equal(finalCount - countAfterParent, 1);
});

test('idempotent createDirectory returns existing result', async () => {
  const backendMountId = await createBackendMount();

  const executor: CommandExecutor = {
    kind: 'local',
    async execute() {
      return {};
    }
  };
  const executors = new Map<string, CommandExecutor>([['local', executor]]);

  const command = {
    type: 'createDirectory' as const,
    backendMountId,
    path: 'datasets/shared'
  };

  const countBeforeParent = await getJournalCount();
  await orchestratorModule.runCommand({
    command: {
      type: 'createDirectory',
      backendMountId,
      path: 'datasets'
    },
    executors
  });
  const countAfterParent = await getJournalCount();

  const first = await orchestratorModule.runCommand({
    command,
    idempotencyKey: 'idem-create-1',
    executors
  });

  assert.equal(first.idempotent, false);
  const countAfterFirst = await getJournalCount();
  assert.equal(countAfterFirst - countAfterParent, 1);

  const second = await orchestratorModule.runCommand({
    command,
    idempotencyKey: 'idem-create-1',
    executors
  });

  assert.equal(second.idempotent, true);
  assert.equal(second.journalEntryId, first.journalEntryId);
  assert.equal(second.node?.id, first.node?.id);

  const countAfterSecond = await getJournalCount();
  assert.equal(countAfterSecond - countAfterFirst, 0);
  assert.equal(countAfterParent - countBeforeParent, 1);
});

test('deleteNode marks node as deleted', async () => {
  const backendMountId = await createBackendMount();

  const executor: CommandExecutor = {
    kind: 'local',
    async execute() {
      return {};
    }
  };
  const executors = new Map<string, CommandExecutor>([['local', executor]]);

  await orchestratorModule.runCommand({
    command: {
      type: 'createDirectory',
      backendMountId,
      path: 'datasets'
    },
    executors
  });

  await orchestratorModule.runCommand({
    command: {
      type: 'createDirectory',
      backendMountId,
      path: 'datasets/to-delete'
    },
    executors
  });

  const parentNode = await clientModule.withConnection(async (client) =>
    nodesModule.getNodeByPath(client, backendMountId, 'datasets')
  );
  assert.ok(parentNode);

  const preDeleteParentRollup = await rollupManagerModule.getRollupSummary(parentNode!.id);
  assert.ok(preDeleteParentRollup);
  assert.equal(preDeleteParentRollup?.directoryCount, 1);
  assert.equal(preDeleteParentRollup?.childCount, 1);

  const recordedFilestoreEvents: FilestoreEvent[] = [];
  const unsubscribeFilestoreEvents = eventsModule.subscribeToFilestoreEvents((event) => {
    recordedFilestoreEvents.push(event);
  });

  const result = await orchestratorModule.runCommand({
    command: {
      type: 'deleteNode',
      backendMountId,
      path: 'datasets/to-delete'
    },
    executors,
    idempotencyKey: 'delete-1'
  });

  unsubscribeFilestoreEvents();

  assert.equal(result.idempotent, false);
  assert.equal(result.node?.state, 'deleted');
  assert.equal(result.result.state, 'deleted');

  const node = await clientModule.withConnection(async (client) =>
    nodesModule.getNodeByPath(client, backendMountId, 'datasets/to-delete')
  );
  assert.ok(node);
  assert.equal(node?.state, 'deleted');

  const deleteEvent = recordedFilestoreEvents.find(
    (event) => event.type === 'filestore.node.deleted' && event.data.path === 'datasets/to-delete'
  );
  assert.ok(deleteEvent);
  if (!deleteEvent || deleteEvent.type !== 'filestore.node.deleted') {
    assert.fail('expected node deleted event for datasets/to-delete');
  }
  assert.equal(deleteEvent.data.state, 'deleted');

  const deletedRollup = await rollupManagerModule.getRollupSummary(node!.id);
  assert.ok(deletedRollup);
  assert.equal(deletedRollup?.state, 'invalid');
  assert.equal(deletedRollup?.directoryCount, 0);
  assert.equal(deletedRollup?.childCount, 0);

  const parentRollup = await rollupManagerModule.getRollupSummary(parentNode!.id);
  assert.ok(parentRollup);
  assert.equal(parentRollup?.directoryCount, 0);
  assert.equal(parentRollup?.childCount, 0);
});

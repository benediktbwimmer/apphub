import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import Database from 'better-sqlite3';

import {
  TicketConflictError,
  TicketNotFoundError,
  TicketStore
} from '../dist';

const makeTempDir = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ticket-store-'));
  await mkdir(dir, { recursive: true });
  return dir;
};

test('creates tickets and builds derived artifacts', async (t) => {
  const dir = await makeTempDir();
  t.after(async () => rm(dir, { recursive: true, force: true }));

  const store = new TicketStore({ rootDir: dir, defaultActor: 'alice' });
  await store.init();

  const first = await store.createTicket({
    id: 'ticket-101',
    title: 'Set up persistence',
    description: 'Define schema and write pipeline'
  });

  assert.equal(first.id, 'ticket-101');
  assert.equal(first.revision, 1);
  assert.equal(first.history.length, 1);
  assert.equal(first.history[0].actor, 'alice');

  const second = await store.createTicket({
    title: 'Wire dependency graph',
    description: 'Ensure dependents update',
    dependencies: [first.id]
  }, { actor: 'bob' });

  assert.ok(second.id.startsWith('wire-dependency-graph'));
  assert.equal(second.dependencies.length, 1);
  assert.equal(second.history.at(-1)?.actor, 'bob');

  const storedFirst = await store.getTicket(first.id);
  assert.deepEqual(storedFirst.dependents, [second.id]);

  const index = await store.getIndex();
  assert.equal(index.tickets.length, 2);
  const firstIndex = index.tickets.find((entry) => entry.id === first.id);
  assert(firstIndex);
  assert.deepEqual(firstIndex.dependencies, []);
  assert.deepEqual(firstIndex.dependents, [second.id]);

  const databasePath = store.getDatabasePath();
  const stats = await stat(databasePath);
  assert.equal(stats.isFile(), true);

  const dependencyGraph = await store.getDependencyGraph();
  assert.equal(typeof dependencyGraph.generatedAt, 'string');
  assert.ok(dependencyGraph.nodes[first.id]);
  assert.deepEqual(dependencyGraph.nodes[first.id]?.dependents ?? [], [second.id]);
});

test('updates tickets with optimistic locking', async (t) => {
  const dir = await makeTempDir();
  t.after(async () => rm(dir, { recursive: true, force: true }));

  const store = new TicketStore({ rootDir: dir, defaultActor: 'chris' });
  await store.init();

  const ticket = await store.createTicket({
    title: 'Initial ticket',
    description: 'Needs updates',
    tags: ['initial']
  });

  const next = await store.updateTicket(ticket.id, {
    status: 'in_progress',
    tags: [],
    comment: 'Starting work'
  }, {
    expectedRevision: ticket.revision,
    actor: 'dana'
  });

  assert.equal(next.status, 'in_progress');
  assert.equal(next.tags.length, 0);
  assert.equal(next.history.at(-1)?.action, 'comment');
  assert.equal(next.history.at(-1)?.message, 'Starting work');
  assert.equal(next.revision, 2);

  await assert.rejects(
    store.updateTicket(ticket.id, { status: 'done' }, { expectedRevision: ticket.revision }),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'TICKET_CONFLICT'
  );
});

test('deletes tickets and updates artifacts', async (t) => {
  const dir = await makeTempDir();
  t.after(async () => rm(dir, { recursive: true, force: true }));

  const store = new TicketStore({ rootDir: dir });
  await store.init();

  const first = await store.createTicket({
    id: 'ticket-alpha',
    title: 'First',
    description: 'First ticket'
  });

  const second = await store.createTicket({
    id: 'ticket-beta',
    title: 'Second',
    description: 'Second ticket',
    dependencies: [first.id]
  });

  await store.deleteTicket(first.id, { expectedRevision: first.revision });

  await assert.rejects(
    () => store.getTicket(first.id),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'TICKET_NOT_FOUND'
  );

  const index = await store.getIndex();
  assert.equal(index.tickets.length, 1);
  assert.equal(index.tickets[0]?.id, second.id);
});

test('ensures unique ticket ids when not supplied', async (t) => {
  const dir = await makeTempDir();
  t.after(async () => rm(dir, { recursive: true, force: true }));

  const store = new TicketStore({ rootDir: dir });
  await store.init();

  const a = await store.createTicket({ title: 'Duplicate Id', description: 'First' });
  const b = await store.createTicket({ title: 'Duplicate Id', description: 'Second' });

  assert.notEqual(a.id, b.id);
  assert.ok(b.id.startsWith(a.id));

  await assert.rejects(
    store.createTicket({ id: a.id, title: 'Conflict', description: 'should fail' }),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'TICKET_CONFLICT'
  );
});


test('listTickets and getTicket read latest state without refresh', async (t) => {
  const dir = await makeTempDir();
  t.after(async () => rm(dir, { recursive: true, force: true }));

  const primary = new TicketStore({ rootDir: dir, defaultActor: 'primary' });
  await primary.init();
  await primary.createTicket({
    id: 'ticket-initial',
    title: 'Initial ticket',
    description: 'From primary store'
  });

  const secondary = new TicketStore({ rootDir: dir, defaultActor: 'secondary' });
  await secondary.init();
  await secondary.createTicket({
    id: 'ticket-secondary',
    title: 'Secondary ticket',
    description: 'Created via secondary store'
  });

  const listed = await primary.listTickets();
  assert.equal(listed.length, 2);
  assert.equal(listed.some((ticket) => ticket.id === 'ticket-secondary'), true);

  const fetched = await primary.getTicket('ticket-secondary');
  assert.equal(fetched.description, 'Created via secondary store');
});


test('refreshFromDisk picks up manual edits', async (t) => {
  const dir = await makeTempDir();
  t.after(async () => rm(dir, { recursive: true, force: true }));

  const store = new TicketStore({ rootDir: dir });
  await store.init();

  const ticket = await store.createTicket({
    id: 'ticket-refresh',
    title: 'Needs refresh',
    description: 'Initial description'
  });

  const db = new Database(store.getDatabasePath());
  try {
    const row = db.prepare('SELECT data FROM tickets WHERE id = ?').get(ticket.id) as { data: string } | undefined;
    assert(row, 'expected ticket row to exist');
    const payload = JSON.parse(row.data) as Record<string, unknown>;
    payload['description'] = 'Updated manually';
    payload['revision'] = 10;
    payload['updatedAt'] = new Date().toISOString();
    db.prepare(
      'UPDATE tickets SET data = @data, revision = @revision, updated_at = @updatedAt WHERE id = @id'
    ).run({
      id: ticket.id,
      data: JSON.stringify(payload),
      revision: 10,
      updatedAt: payload['updatedAt']
    });
  } finally {
    db.close();
  }

  await store.refreshFromDisk();

  const refreshed = await store.getTicket(ticket.id);
  assert.equal(refreshed.description, 'Updated manually');
  assert.equal(refreshed.revision, 10);
});

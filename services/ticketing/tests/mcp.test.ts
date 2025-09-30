import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { TicketStore } from '@apphub/ticketing';

import { buildToolHandlers, toolSchemas } from '../src/mcp/tools';

const makeStore = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ticketing-mcp-'));
  const store = new TicketStore({ rootDir: dir, defaultActor: 'system' });
  await store.init();
  return { dir, store };
};

const extractPayload = (result: Awaited<ReturnType<ReturnType<typeof buildToolHandlers>['createTicket']>>) => {
  const jsonBlock = result.content
    .filter((entry): entry is { type: 'text'; text: string } => entry.type === 'text')
    .map((entry) => entry.text)
    .reverse()
    .find((text) => text.trim().startsWith('{'));
  if (!jsonBlock) {
    throw new Error('Expected JSON payload in tool result');
  }
  return JSON.parse(jsonBlock) as Record<string, unknown>;
};

test('MCP handlers require auth when tokens configured', async (t) => {
  const { dir, store } = await makeStore();
  t.after(async () => rm(dir, { recursive: true, force: true }));

  const handlers = buildToolHandlers({ store, tokens: ['secret'], defaultActor: 'agent' });

  await assert.rejects(
    handlers.createTicket(toolSchemas.createTicket.parse({
      ticket: {
        title: 'No auth',
        description: 'Should fail'
      }
    })),
    /token/i
  );

  const created = await handlers.createTicket(
    toolSchemas.createTicket.parse({
      authToken: 'secret',
      ticket: {
        title: 'Valid ticket',
        description: 'Created via handler'
      }
    })
  );

  const ticket = extractPayload(created).ticket as { id: string };
  assert.ok(ticket.id);

  const history = await handlers.history(
    toolSchemas.history.parse({ authToken: 'secret', id: ticket.id })
  );
  const historyJson = extractPayload(history) as { history: unknown[] };
  assert.equal(historyJson.history.length > 0, true);
});

test('MCP handlers cover status updates, dependencies, assignments, and listing', async (t) => {
  const { dir, store } = await makeStore();
  t.after(async () => rm(dir, { recursive: true, force: true }));

  const handlers = buildToolHandlers({ store, tokens: [], defaultActor: 'agent' });

  await handlers.createTicket(
    toolSchemas.createTicket.parse({
      ticket: {
        id: 'ticket-a',
        title: 'Implement feature',
        description: 'Initial'
      }
    })
  );

  await handlers.createTicket(
    toolSchemas.createTicket.parse({
      ticket: {
        id: 'ticket-b',
        title: 'Follow-up',
        description: 'Depends on A'
      }
    })
  );

  const addDep = await handlers.addDependency(
    toolSchemas.addDependency.parse({ id: 'ticket-b', dependencyId: 'ticket-a' })
  );
  const depTicket = extractPayload(addDep).ticket as { dependencies: string[] };
  assert.deepEqual(depTicket.dependencies, ['ticket-a']);

  const statusUpdated = await handlers.updateStatus(
    toolSchemas.updateStatus.parse({ id: 'ticket-a', status: 'in_progress', comment: 'Working' })
  );
  const statusTicket = extractPayload(statusUpdated).ticket as { status: string };
  assert.equal(statusTicket.status, 'in_progress');

  const assign = await handlers.assign(
    toolSchemas.assign.parse({ id: 'ticket-a', assignees: ['alice'], mode: 'set' })
  );
  const assignedTicket = extractPayload(assign).ticket as { assignees: string[] };
  assert.deepEqual(assignedTicket.assignees, ['alice']);

  await handlers.comment(
    toolSchemas.comment.parse({ id: 'ticket-a', comment: 'Progress noted' })
  );

  const list = await handlers.list(toolSchemas.list.parse({ status: ['in_progress'] }));
  const listJson = extractPayload(list) as { tickets: Array<{ id: string }> };
  assert.equal(listJson.tickets.length, 1);
  assert.equal(listJson.tickets[0].id, 'ticket-a');
});

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createApp } from '../src/app';
import type { TicketingConfig } from '../src/config';

const makeConfig = async (): Promise<TicketingConfig> => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ticketing-service-'));
  return {
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    ticketsDir: tmp,
    enableWatcher: false
  };
};

test('creates and retrieves tickets via REST API', async (t) => {
  const config = await makeConfig();
  const { app, ctx } = await createApp(config);
  t.after(async () => {
    await app.close();
    await rm(config.ticketsDir, { recursive: true, force: true });
  });

  const createResponse = await app.inject({
    method: 'POST',
    url: '/tickets',
    payload: {
      ticket: {
        title: 'Build backend',
        description: 'Implement MCP ticketing backend',
        tags: ['backend']
      },
      actor: 'test-user',
      message: 'Created in test'
    }
  });

  assert.equal(createResponse.statusCode, 201);
  const created = createResponse.json();
  assert.equal(created.title, 'Build backend');
  assert.equal(created.history.length, 1);

  const listResponse = await app.inject({ method: 'GET', url: '/tickets' });
  assert.equal(listResponse.statusCode, 200);
  const listBody = listResponse.json();
  assert.equal(listBody.tickets.length, 1);

  const indexResponse = await app.inject({ method: 'GET', url: '/tickets?view=index' });
  assert.equal(indexResponse.statusCode, 200);
  const indexBody = indexResponse.json();
  assert.equal(indexBody.tickets.length, 1);
  assert.equal(indexBody.tickets[0].id, created.id);

  const fetchResponse = await app.inject({ method: 'GET', url: `/tickets/${created.id}` });
  assert.equal(fetchResponse.statusCode, 200);
  const fetched = fetchResponse.json();
  assert.equal(fetched.description, 'Implement MCP ticketing backend');

  const updateResponse = await app.inject({
    method: 'PATCH',
    url: `/tickets/${created.id}`,
    payload: {
      updates: {
        status: 'in_progress',
        comment: 'Work started'
      },
      actor: 'tester',
      expectedRevision: created.revision
    }
  });
  assert.equal(updateResponse.statusCode, 200);
  const updated = updateResponse.json();
  assert.equal(updated.status, 'in_progress');
  assert.equal(updated.history.at(-1).action, 'comment');

  const badUpdate = await app.inject({
    method: 'PATCH',
    url: `/tickets/${created.id}`,
    payload: {
      updates: { status: 'done' },
      expectedRevision: created.revision
    }
  });
  assert.equal(badUpdate.statusCode, 409);

  const deleteResponse = await app.inject({
    method: 'DELETE',
    url: `/tickets/${created.id}`,
    payload: {
      expectedRevision: updated.revision
    }
  });
  assert.equal(deleteResponse.statusCode, 204);

  const missingResponse = await app.inject({ method: 'GET', url: `/tickets/${created.id}` });
  assert.equal(missingResponse.statusCode, 404);

});

test('health and readiness endpoints reflect readiness state', async (t) => {
  const config = await makeConfig();
  const { app } = await createApp(config);
  t.after(async () => {
    await app.close();
    await rm(config.ticketsDir, { recursive: true, force: true });
  });

  const health = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: 'ok' });

  const ready = await app.inject({ method: 'GET', url: '/readyz' });
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.json().status, 'ready');

  const metrics = await app.inject({ method: 'GET', url: '/metrics' });
  assert.equal(metrics.statusCode, 200);
  assert.match(metrics.body, /ticketing_component_ready/);
});

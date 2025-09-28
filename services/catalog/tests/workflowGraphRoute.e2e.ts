import './setupTestEnv';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import type { FastifyInstance } from 'fastify';
import { runE2E } from '@apphub/test-helpers';

type CatalogDbModule = typeof import('../src/db');

const OPERATOR_TOKEN = 'workflow-graph-operator-token';
process.env.APPHUB_OPERATOR_TOKENS = JSON.stringify([
  {
    subject: 'workflow-graph-route-test',
    token: OPERATOR_TOKEN,
    scopes: ['workflows:write']
  }
]);
process.env.SERVICE_REGISTRY_TOKEN = 'workflow-graph-test-token';
process.env.APPHUB_WORKFLOW_GRAPH_CACHE_TTL_MS = process.env.APPHUB_WORKFLOW_GRAPH_CACHE_TTL_MS ?? '30000';

let embeddedPostgres: EmbeddedPostgres | null = null;
let embeddedCleanup: (() => Promise<void>) | null = null;

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address) {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to determine available port')));
      }
    });
  });
}

async function ensureEmbeddedPostgres(): Promise<void> {
  if (embeddedPostgres) {
    return;
  }

  const dataRoot = await mkdtemp(path.join(tmpdir(), 'apphub-workflow-graph-pg-'));
  const port = await findAvailablePort();

  const postgres = new EmbeddedPostgres({
    databaseDir: dataRoot,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false
  });

  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('apphub');

  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.PGPOOL_MAX = '6';

  embeddedCleanup = async () => {
    try {
      await postgres.stop();
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  };
  embeddedPostgres = postgres;
}

async function shutdownEmbeddedPostgres(): Promise<void> {
  if (!embeddedCleanup) {
    return;
  }
  const cleanup = embeddedCleanup;
  embeddedCleanup = null;
  embeddedPostgres = null;
  await cleanup();
}

async function withCatalogServer(
  handler: (app: FastifyInstance, db: CatalogDbModule) => Promise<void>
): Promise<void> {
  await ensureEmbeddedPostgres();
  process.env.APPHUB_EVENTS_MODE = 'inline';
  process.env.REDIS_URL = 'inline';
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';

  const db = await import('../src/db');
  await db.ensureDatabase();

  const { buildServer } = await import('../src/server');
  const app = await buildServer();
  await app.ready();

  try {
    await handler(app, db);
  } finally {
    await app.close();
    await db.closePool();
  }
}

runE2E(async ({ registerCleanup }) => {
  registerCleanup(async () => shutdownEmbeddedPostgres());

  await withCatalogServer(async (app, db) => {
    const workflowSlug = `wf-${randomUUID()}`.toLowerCase();
    await db.createWorkflowDefinition({
      slug: workflowSlug,
      name: 'Workflow Graph Fixture',
      steps: [
        {
          id: 'extract',
          name: 'Extract',
          type: 'service',
          serviceSlug: 'svc.extract',
          request: {
            method: 'GET',
            path: '/healthz'
          }
        }
      ]
    });

    const unauthorized = await app.inject({ method: 'GET', url: '/workflows/graph' });
    assert.equal(unauthorized.statusCode, 401);

    const firstResponse = await app.inject({
      method: 'GET',
      url: '/workflows/graph',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      }
    });
    assert.equal(firstResponse.statusCode, 200);
    const firstBody = firstResponse.json() as {
      data: { version: string };
      meta: { cache: { hit: boolean; generatedAt: string } };
    };
    assert.equal(firstBody.data.version, 'v2');
    assert.equal(firstBody.meta.cache.hit, false, 'first request should miss cache');

    const secondResponse = await app.inject({
      method: 'GET',
      url: '/workflows/graph',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      }
    });
    assert.equal(secondResponse.statusCode, 200);
    const secondBody = secondResponse.json() as {
      meta: { cache: { hit: boolean } };
    };
    assert.equal(secondBody.meta.cache.hit, true, 'second request should hit cache');

    await db.updateWorkflowDefinition(workflowSlug, {
      description: 'Updated to trigger cache invalidation'
    });

    const thirdResponse = await app.inject({
      method: 'GET',
      url: '/workflows/graph',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      }
    });
    assert.equal(thirdResponse.statusCode, 200);
    const thirdBody = thirdResponse.json() as {
      meta: { cache: { hit: boolean; lastInvalidationReason: string | null } };
    };
    assert.equal(thirdBody.meta.cache.hit, false, 'post-update request should rebuild cache');
    assert.equal(
      thirdBody.meta.cache.lastInvalidationReason,
      'workflow.definition.updated',
      'expected invalidation reason to track workflow updates'
    );

    const fourthResponse = await app.inject({
      method: 'GET',
      url: '/workflows/graph',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      }
    });
    assert.equal(fourthResponse.statusCode, 200);
    const fourthBody = fourthResponse.json() as { meta: { cache: { hit: boolean } } };
    assert.equal(fourthBody.meta.cache.hit, true, 'subsequent request should reuse rebuilt cache');
  });
}, { name: 'catalog-workflow-graph-route.e2e' });

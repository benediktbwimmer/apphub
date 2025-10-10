import './setupTestEnv';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { createEmbeddedPostgres, stopEmbeddedPostgres, runE2E } from '@apphub/test-helpers';
import type EmbeddedPostgres from 'embedded-postgres';
import type { FastifyInstance } from 'fastify';
import type * as CoreDbModule from '../src/db';
import { useConnection } from '../src/db/utils';

const OPERATOR_TOKEN = 'module-scope-operator-token';

process.env.APPHUB_OPERATOR_TOKENS = JSON.stringify([
  {
    subject: 'module-scope-e2e',
    token: OPERATOR_TOKEN,
    scopes: ['workflows:read']
  }
]);
process.env.SERVICE_REGISTRY_TOKEN = 'module-scope-service-token';

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

  const dataRoot = await mkdtemp(path.join(tmpdir(), 'apphub-module-scope-pg-'));
  const port = await findAvailablePort();

  const postgres: EmbeddedPostgres = createEmbeddedPostgres({
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
      await stopEmbeddedPostgres(postgres);
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  };

  embeddedPostgres = postgres;
}

async function shutdownEmbeddedPostgres(): Promise<void> {
  const cleanup = embeddedCleanup;
  embeddedCleanup = null;
  embeddedPostgres = null;
  if (cleanup) {
    await cleanup();
  }
}

async function withCoreServer(handler: (app: FastifyInstance, db: CoreDbModule) => Promise<void>): Promise<void> {
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

  await withCoreServer(async (app, db) => {
    const moduleId = 'module-scope-fixture';
    const moduleVersion = '1.0.0';
    const moduleDisplayName = 'Module Scope Fixture';

    await useConnection(async (client) => {
      await client.query(
        `INSERT INTO modules (id, display_name, description, latest_version)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id)
         DO UPDATE SET
           display_name = EXCLUDED.display_name,
           description = EXCLUDED.description,
           latest_version = EXCLUDED.latest_version,
           updated_at = NOW()`,
        [moduleId, moduleDisplayName, 'Fixture module for scope tests', moduleVersion]
      );
    });

    const workflowSlugBase = randomUUID().replace(/-/g, '').slice(0, 8);
    const moduleWorkflowSlug = `module-wf-${workflowSlugBase}`;
    const otherWorkflowSlug = `other-wf-${workflowSlugBase}`;

    const moduleWorkflow = await db.createWorkflowDefinition({
      slug: moduleWorkflowSlug,
      name: 'Module scoped workflow',
      steps: []
    });
    const otherWorkflow = await db.createWorkflowDefinition({
      slug: otherWorkflowSlug,
      name: 'Unscoped workflow',
      steps: []
    });

    await db.upsertModuleResourceContext({
      moduleId,
      moduleVersion,
      resourceType: 'workflow-definition',
      resourceId: moduleWorkflow.id,
      resourceSlug: moduleWorkflow.slug,
      resourceName: moduleWorkflow.name,
      resourceVersion: String(moduleWorkflow.version),
      metadata: { slug: moduleWorkflow.slug, name: moduleWorkflow.name }
    });

    const moduleRun = await db.createWorkflowRun(moduleWorkflow.id, {
      status: 'pending',
      runKey: 'module-run'
    });
    const otherRun = await db.createWorkflowRun(otherWorkflow.id, {
      status: 'pending',
      runKey: 'other-run'
    });

    const moduleRunContexts = await db.listModuleAssignmentsForResource('workflow-run', moduleRun.id);
    assert.equal(moduleRunContexts.length, 1, 'module workflow run should be assigned to module');
    assert.equal(moduleRunContexts[0]?.moduleId, moduleId);

    const unscopedRunContexts = await db.listModuleAssignmentsForResource('workflow-run', otherRun.id);
    assert.equal(unscopedRunContexts.length, 0, 'unscoped workflow run should not have module assignments');

    const allRunsResponse = await app.inject({
      method: 'GET',
      url: '/workflow-runs',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      }
    });
    assert.equal(allRunsResponse.statusCode, 200, 'unscoped request should succeed');
    const allRunsBody = allRunsResponse.json() as {
      data: Array<{ run: { id: string }; workflow: { slug: string } }>;
    };
    const allRunSlugs = new Set(allRunsBody.data.map((entry) => entry.workflow.slug));
    assert.ok(allRunSlugs.has(moduleWorkflow.slug), 'unscoped response should include module workflow');
    assert.ok(allRunSlugs.has(otherWorkflow.slug), 'unscoped response should include other workflow');

    const scopedRunsResponse = await app.inject({
      method: 'GET',
      url: '/workflow-runs',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`,
        'X-AppHub-Module-Id': moduleId
      }
    });
    assert.equal(scopedRunsResponse.statusCode, 200, 'module-scoped request should succeed');
    const scopedRunsBody = scopedRunsResponse.json() as {
      data: Array<{ run: { id: string }; workflow: { slug: string } }>;
    };
    assert.equal(scopedRunsBody.data.length, 1, 'module-scoped runs should only include module workflow');
    assert.equal(scopedRunsBody.data[0]?.workflow.slug, moduleWorkflow.slug);

    const queryScopedRunsResponse = await app.inject({
      method: 'GET',
      url: `/workflow-runs?moduleId=${encodeURIComponent(moduleId)}`,
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      }
    });
    assert.equal(queryScopedRunsResponse.statusCode, 200);
    const queryScopedRunsBody = queryScopedRunsResponse.json() as {
      data: Array<{ run: { id: string }; workflow: { slug: string } }>;
    };
    assert.equal(queryScopedRunsBody.data.length, 1);
    assert.equal(queryScopedRunsBody.data[0]?.workflow.slug, moduleWorkflow.slug);

    const missingModuleResponse = await app.inject({
      method: 'GET',
      url: '/workflow-runs',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`,
        'X-AppHub-Module-Id': 'missing-module'
      }
    });
    assert.equal(missingModuleResponse.statusCode, 404, 'unknown module should yield 404');

    const workflowsResponse = await app.inject({
      method: 'GET',
      url: '/workflows',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      }
    });
    assert.equal(workflowsResponse.statusCode, 200);
    const workflowsBody = workflowsResponse.json() as { data: Array<{ slug: string }> };
    const workflowSlugs = workflowsBody.data.map((entry) => entry.slug);
    assert.ok(workflowSlugs.includes(moduleWorkflow.slug));
    assert.ok(workflowSlugs.includes(otherWorkflow.slug));

    const scopedWorkflowsResponse = await app.inject({
      method: 'GET',
      url: `/workflows?moduleId=${encodeURIComponent(moduleId)}`,
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      }
    });
    assert.equal(scopedWorkflowsResponse.statusCode, 200);
    const scopedWorkflowsBody = scopedWorkflowsResponse.json() as { data: Array<{ slug: string }> };
    assert.equal(scopedWorkflowsBody.data.length, 1);
    assert.equal(scopedWorkflowsBody.data[0]?.slug, moduleWorkflow.slug);
  });
});

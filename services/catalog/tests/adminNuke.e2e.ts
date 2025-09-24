import './setupTestEnv';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
let embeddedPostgres: EmbeddedPostgres | null = null;
let embeddedPostgresCleanup: (() => Promise<void>) | null = null;

type CatalogDbModule = typeof import('../src/db');
type CatalogDbUtilsModule = typeof import('../src/db/utils');

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

  const dataRoot = await mkdtemp(path.join(tmpdir(), 'apphub-admin-nuke-pg-'));
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
  process.env.PGPOOL_MAX = '8';

  embeddedPostgresCleanup = async () => {
    try {
      await postgres.stop();
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  };
  embeddedPostgres = postgres;
}

async function shutdownEmbeddedPostgres(): Promise<void> {
  const cleanup = embeddedPostgresCleanup;
  embeddedPostgres = null;
  embeddedPostgresCleanup = null;
  if (cleanup) {
    await cleanup();
  }
}

async function seedTestData(db: CatalogDbModule): Promise<void> {
  const jobDefinition = await db.createJobDefinition({
    slug: `admin-nuke-job-${randomUUID()}`,
    name: 'Admin nuke job',
    type: 'batch',
    entryPoint: 'tests.admin.nuke',
    retryPolicy: { maxAttempts: 1 }
  });
  const jobRun = await db.createJobRun(jobDefinition.id, {
    parameters: { example: true }
  });

  const workflowDefinition = await db.createWorkflowDefinition({
    slug: `admin-nuke-workflow-${randomUUID()}`,
    name: 'Admin nuke workflow',
    steps: [],
    triggers: []
  });
  const workflowRun = await db.createWorkflowRun(workflowDefinition.id, {
    parameters: { sample: 'value' }
  });
  assert(jobRun.id.length > 0);
  assert(workflowRun.id.length > 0);
}

async function assertRunTablesAreEmpty(dbUtils: CatalogDbUtilsModule): Promise<void> {
  await dbUtils.useConnection(async (client) => {
    const { rows: jobRunRows } = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM job_runs'
    );
    assert.equal(Number(jobRunRows[0]?.count ?? '0'), 0);

    const { rows: workflowRunRows } = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM workflow_runs'
    );
    assert.equal(Number(workflowRunRows[0]?.count ?? '0'), 0);
  });
}

let dbModule: CatalogDbModule | null = null;
let dbUtilsModule: CatalogDbUtilsModule | null = null;

async function run(): Promise<void> {
  await ensureEmbeddedPostgres();
  dbModule = await import('../src/db');
  dbUtilsModule = await import('../src/db/utils');

  await dbModule.ensureDatabase();

  await seedTestData(dbModule);

  const counts = await dbModule.nukeCatalogEverything();
  assert.ok(counts.job_runs && counts.job_runs >= 1, 'job_runs should be truncated');
  assert.ok(counts.workflow_runs && counts.workflow_runs >= 1, 'workflow_runs should be truncated');

  dbModule.markDatabaseUninitialized();
  await dbModule.ensureDatabase();

  await assertRunTablesAreEmpty(dbUtilsModule);

  await dbModule.closePool();
  await shutdownEmbeddedPostgres();
}

run().catch(async (err) => {
  console.error(err);
  try {
    if (dbModule) {
      await dbModule.closePool();
    }
  } catch {
    // ignore cleanup errors
  } finally {
    try {
      await shutdownEmbeddedPostgres();
    } catch {
      // ignore cleanup errors
    }
    process.exit(1);
  }
});

import './setupTestEnv';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { FastifyInstance } from 'fastify';

let embeddedPostgres: EmbeddedPostgres | null = null;
let embeddedPostgresCleanup: (() => Promise<void>) | null = null;

const OPERATOR_TOKEN = 'jobs-e2e-operator-token';

process.env.APPHUB_OPERATOR_TOKENS = JSON.stringify([
  {
    subject: 'jobs-e2e',
    token: OPERATOR_TOKEN,
    scopes: ['jobs:write', 'jobs:run', 'workflows:write', 'workflows:run']
  }
]);

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

  const dataRoot = await mkdtemp(path.join(tmpdir(), 'apphub-jobs-pg-'));
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

async function withServer(fn: (app: FastifyInstance) => Promise<void>): Promise<void> {
  await ensureEmbeddedPostgres();
  process.env.REDIS_URL = 'inline';
  const { buildServer } = await import('../src/server');
  const app = await buildServer();
  await app.ready();
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

async function testJobEndpoints(): Promise<void> {
  await withServer(async (app) => {
    const jobsResponse = await app.inject({ method: 'GET', url: '/jobs' });
    assert.equal(jobsResponse.statusCode, 200);
    const jobsBody = JSON.parse(jobsResponse.payload) as {
      data: Array<{ slug: string; entryPoint: string; registryRef?: string | null }>;
    };
    assert(jobsBody.data.length >= 2);
    const jobSlugs = jobsBody.data.map((job) => job.slug);
    assert(jobSlugs.includes('repository-ingest'));
    assert(jobSlugs.includes('repository-build'));

    const fsReadJob = jobsBody.data.find((job) => job.slug === 'fs-read-file');
    assert(fsReadJob);
    assert.equal(fsReadJob.entryPoint, 'bundle:fs-read-file@1.0.0');
    assert.equal(fsReadJob.registryRef, 'fs-read-file@1.0.0');

    const fsWriteJob = jobsBody.data.find((job) => job.slug === 'fs-write-file');
    assert(fsWriteJob);
    assert.equal(fsWriteJob.entryPoint, 'bundle:fs-write-file@1.0.0');
    assert.equal(fsWriteJob.registryRef, 'fs-write-file@1.0.0');

    const unauthorizedCreate = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: {
        slug: 'jobs-unauthorized',
        name: 'Unauthorized',
        type: 'manual',
        entryPoint: 'tests.jobs.unauthorized'
      }
    });
    assert.equal(unauthorizedCreate.statusCode, 401);

    const createJobResponse = await app.inject({
      method: 'POST',
      url: '/jobs',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      },
      payload: {
        slug: 'jobs-test-basic',
        name: 'Jobs Test',
        type: 'batch',
        entryPoint: 'tests.jobs.test',
        timeoutMs: 5_000,
        retryPolicy: { maxAttempts: 2, strategy: 'fixed', initialDelayMs: 1_000 },
        parametersSchema: { type: 'object' },
        defaultParameters: {}
      }
    });
    assert.equal(createJobResponse.statusCode, 201);
    const createdJob = JSON.parse(createJobResponse.payload) as { data: { slug: string } };
    assert.equal(createdJob.data.slug, 'jobs-test-basic');

    const conflictResponse = await app.inject({
      method: 'POST',
      url: '/jobs',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      },
      payload: {
        slug: 'jobs-test-basic',
        name: 'Jobs Test Duplicate',
        type: 'manual',
        entryPoint: 'tests.jobs.duplicate'
      }
    });
    assert.equal(conflictResponse.statusCode, 409);

    const schemaPreviewResponse = await app.inject({
      method: 'POST',
      url: '/jobs/schema-preview',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      },
      payload: {
        entryPoint: 'tests.jobs.nonbundle',
        runtime: 'python'
      }
    });
    assert.equal(schemaPreviewResponse.statusCode, 200);
    const schemaPreviewBody = JSON.parse(schemaPreviewResponse.payload) as {
      data: {
        parametersSchema: unknown;
        outputSchema: unknown;
        parametersSource: unknown;
        outputSource: unknown;
      };
    };
    assert(schemaPreviewBody.data);
    assert.equal(schemaPreviewBody.data.parametersSchema, null);
    assert.equal(schemaPreviewBody.data.outputSchema, null);
    assert.equal(schemaPreviewBody.data.parametersSource, null);
    assert.equal(schemaPreviewBody.data.outputSource, null);

    const fetchJobResponse = await app.inject({ method: 'GET', url: '/jobs/jobs-test-basic' });
    assert.equal(fetchJobResponse.statusCode, 200);
    const fetchJobBody = JSON.parse(fetchJobResponse.payload) as {
      data: { job: { slug: string }; runs: unknown[] };
    };
    assert.equal(fetchJobBody.data.job.slug, 'jobs-test-basic');
    assert(Array.isArray(fetchJobBody.data.runs));

    const repositoryId = `jobs-test-repo-${Date.now()}`;
    const createRepoResponse = await app.inject({
      method: 'POST',
      url: '/apps',
      payload: {
        id: repositoryId,
        name: 'Jobs Test Repo',
        description: 'Jobs test repository',
        repoUrl: 'https://example.com/nonexistent.git',
        dockerfilePath: 'Dockerfile',
        tags: []
      }
    });
    assert.equal(createRepoResponse.statusCode, 201);

    const manualIngestResponse = await app.inject({
      method: 'POST',
      url: '/jobs/repository-ingest/run',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      },
      payload: {
        parameters: { repositoryId }
      }
    });
    assert.equal(manualIngestResponse.statusCode, 202);
    const manualIngestBody = JSON.parse(manualIngestResponse.payload) as {
      data: { status: string; parameters: { repositoryId: string } };
    };
    assert.equal(manualIngestBody.data.parameters.repositoryId, repositoryId);
    assert.notEqual(manualIngestBody.data.status, 'pending');

    const ingestRunsResponse = await app.inject({ method: 'GET', url: '/jobs/repository-ingest' });
    assert.equal(ingestRunsResponse.statusCode, 200);
    const ingestRunsBody = JSON.parse(ingestRunsResponse.payload) as {
      data: { runs: Array<{ parameters: { repositoryId?: string } }> };
    };
    assert(ingestRunsBody.data.runs.some((run) => run.parameters.repositoryId === repositoryId));

    const buildTriggerResponse = await app.inject({
      method: 'POST',
      url: `/apps/${repositoryId}/builds`,
      payload: {}
    });
    assert.equal(buildTriggerResponse.statusCode, 202);
    const buildTriggerBody = JSON.parse(buildTriggerResponse.payload) as {
      data: { id: string };
    };
    const buildId = buildTriggerBody.data.id;

    const manualBuildResponse = await app.inject({
      method: 'POST',
      url: '/jobs/repository-build/run',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      },
      payload: {
        parameters: { buildId, repositoryId }
      }
    });
    assert.equal(manualBuildResponse.statusCode, 202);
    const manualBuildBody = JSON.parse(manualBuildResponse.payload) as {
      data: { status: string; parameters: { buildId: string } };
    };
    assert.equal(manualBuildBody.data.parameters.buildId, buildId);
    assert.notEqual(manualBuildBody.data.status, 'pending');

    const missingJobRunResponse = await app.inject({
      method: 'POST',
      url: '/jobs/does-not-exist/run',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      },
      payload: {}
    });
    assert.equal(missingJobRunResponse.statusCode, 404);
  });
}

async function run() {
  try {
    await testJobEndpoints();
  } finally {
    await shutdownEmbeddedPostgres();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

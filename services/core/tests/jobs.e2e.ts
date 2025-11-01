import './setupTestEnv';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { KubectlMock } from '@apphub/kubectl-mock';
import { createEmbeddedPostgres, stopEmbeddedPostgres, runE2E } from '@apphub/test-helpers';
import type EmbeddedPostgres from 'embedded-postgres';
import type { FastifyInstance } from 'fastify';

let embeddedPostgres: EmbeddedPostgres | null = null;
let embeddedPostgresCleanup: (() => Promise<void>) | null = null;

const exec = promisify(execCallback);

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
  process.env.PGPOOL_MAX = '8';

  embeddedPostgresCleanup = async () => {
    try {
      await stopEmbeddedPostgres(postgres);
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

async function createLocalRepository(root: string): Promise<{ repoDir: string; dockerfilePath: string }> {
  const repoDir = path.join(root, 'repo');
  await exec(`git init ${repoDir}`);
  await exec('git config user.name "Jobs Test"', { cwd: repoDir });
  await exec('git config user.email "jobs@example.com"', { cwd: repoDir });

  const dockerfilePath = 'Dockerfile';
  const dockerfile = `FROM node:18-alpine\nWORKDIR /app\nCOPY package.json package.json\nRUN npm install --production\nCOPY index.js index.js\nCMD [\"node\", \"index.js\"]\n`;
  const packageJson = {
    name: 'jobs-e2e',
    version: '0.0.1',
    scripts: { start: 'node index.js' }
  };

  await writeFile(path.join(repoDir, dockerfilePath), dockerfile, 'utf8');
  await writeFile(path.join(repoDir, 'package.json'), JSON.stringify(packageJson, null, 2), 'utf8');
  await writeFile(path.join(repoDir, 'index.js'), 'console.log("jobs e2e");\n', 'utf8');

  await exec('git add .', { cwd: repoDir });
  await exec('git commit -m "Initial commit"', { cwd: repoDir });

  return { repoDir, dockerfilePath };
}

async function withServer(fn: (app: FastifyInstance) => Promise<void>): Promise<void> {
  await ensureEmbeddedPostgres();
  const kubectlMock = new KubectlMock();
  const kubectlPaths = await kubectlMock.start();
  const previousPath = process.env.PATH;
  const previousKubectlLogs = process.env.KUBECTL_MOCK_DEFAULT_LOGS;
  const pathEntries = [kubectlPaths.pathPrefix];
  if (previousPath && previousPath.length > 0) {
    pathEntries.push(previousPath);
  }
  process.env.PATH = pathEntries.join(path.delimiter);
  if (previousKubectlLogs === undefined) {
    process.env.KUBECTL_MOCK_DEFAULT_LOGS = '[kubectl-mock] job run completed\n';
  }
  const previousRedisUrl = process.env.REDIS_URL;
  process.env.REDIS_URL = 'inline';
  const previousInlineFlag = process.env.APPHUB_ALLOW_INLINE_MODE;
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';
  const storageDir = await mkdtemp(path.join(tmpdir(), 'apphub-job-bundles-'));
  const previousStorageDir = process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR;
  process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR = storageDir;
  const { buildServer } = await import('../src/server');
  let app: FastifyInstance | null = null;
  try {
    app = await buildServer();
    await app.ready();
    await fn(app);
  } finally {
    if (app) {
      await app.close();
    }
    if (previousStorageDir === undefined) {
      delete process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR;
    } else {
      process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR = previousStorageDir;
    }
    if (previousRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previousRedisUrl;
    }
    if (previousInlineFlag === undefined) {
      delete process.env.APPHUB_ALLOW_INLINE_MODE;
    } else {
      process.env.APPHUB_ALLOW_INLINE_MODE = previousInlineFlag;
    }
    await rm(storageDir, { recursive: true, force: true });
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
    if (previousKubectlLogs === undefined) {
      delete process.env.KUBECTL_MOCK_DEFAULT_LOGS;
    } else {
      process.env.KUBECTL_MOCK_DEFAULT_LOGS = previousKubectlLogs;
    }
    await kubectlMock.stop();
  }
}

async function testJobEndpoints(): Promise<void> {
  await withServer(async (app) => {
    const tempRepoRoot = await mkdtemp(path.join(tmpdir(), 'jobs-e2e-repo-'));
    const { repoDir, dockerfilePath } = await createLocalRepository(tempRepoRoot);
    try {
      const jobsResponse = await app.inject({ method: 'GET', url: '/jobs' });
      assert.equal(jobsResponse.statusCode, 200);
      const jobsBody = JSON.parse(jobsResponse.payload) as {
        data: Array<{ slug: string; entryPoint: string; registryRef?: string | null }>;
      };
      assert(jobsBody.data.length >= 2);
      const jobSlugs = jobsBody.data.map((job) => job.slug);
      assert(jobSlugs.includes('repository-ingest'));
      assert(jobSlugs.includes('repository-build'));
      assert(!jobSlugs.includes('fs-read-file'));
      assert(!jobSlugs.includes('fs-write-file'));

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
          repoUrl: repoDir,
          dockerfilePath,
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
      assert([202, 500].includes(manualIngestResponse.statusCode));
      if (manualIngestResponse.statusCode === 202) {
        const manualIngestBody = JSON.parse(manualIngestResponse.payload) as {
          data: { status: string; parameters: { repositoryId: string } };
        };
        assert.equal(manualIngestBody.data.parameters.repositoryId, repositoryId);
        assert.notEqual(manualIngestBody.data.status, 'pending');
      }

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
      assert([202, 500].includes(manualBuildResponse.statusCode));
      if (manualBuildResponse.statusCode === 202) {
        const manualBuildBody = JSON.parse(manualBuildResponse.payload) as {
          data: { status: string; parameters: { buildId: string } };
        };
        assert.equal(manualBuildBody.data.parameters.buildId, buildId);
        assert.notEqual(manualBuildBody.data.status, 'pending');
      }

      const pythonSnippet = [
        'from pydantic import BaseModel',
        '',
        '',
        'class GreetingInput(BaseModel):',
        '  name: str',
        '',
        '',
        'class GreetingOutput(BaseModel):',
        '  greeting: str',
        '',
        '',
        'def build_greeting(payload: GreetingInput) -> GreetingOutput:',
        "  return GreetingOutput(greeting=f'Hello {payload.name}!')",
        ''
      ].join('\n');

      const snippetPreviewResponse = await app.inject({
        method: 'POST',
        url: '/jobs/python-snippet/preview',
        headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` },
        payload: { snippet: pythonSnippet }
      });
      if (snippetPreviewResponse.statusCode === 200) {
        const snippetPreviewBody = JSON.parse(snippetPreviewResponse.payload) as {
          data: { handlerName: string; inputModel: { name: string }; outputModel: { name: string } };
        };
        assert.equal(snippetPreviewBody.data.handlerName, 'build_greeting');
        assert.equal(snippetPreviewBody.data.inputModel.name, 'GreetingInput');
        assert.equal(snippetPreviewBody.data.outputModel.name, 'GreetingOutput');

        const snippetCreateResponse = await app.inject({
          method: 'POST',
          url: '/jobs/python-snippet',
          headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` },
          payload: {
            slug: 'jobs-python-snippet',
            name: 'Python Snippet Job',
            type: 'manual',
            snippet: pythonSnippet,
            timeoutMs: 15_000
          }
        });
        assert.equal(snippetCreateResponse.statusCode, 201);
        const snippetCreateBody = JSON.parse(snippetCreateResponse.payload) as {
          data: {
            job: { slug: string; runtime: string; entryPoint: string; version: number };
            bundle: { slug: string; version: string };
          };
        };
        assert.equal(snippetCreateBody.data.job.slug, 'jobs-python-snippet');
        assert.equal(snippetCreateBody.data.job.runtime, 'python');
        assert(snippetCreateBody.data.job.entryPoint.includes('@1.0.0'));
        assert.equal(snippetCreateBody.data.bundle.slug, 'jobs-python-snippet');
        assert.equal(snippetCreateBody.data.bundle.version, '1.0.0');

        const updatedSnippet = pythonSnippet.replace('Hello', 'Hi');
        const snippetUpdateResponse = await app.inject({
          method: 'POST',
          url: '/jobs/python-snippet',
          headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` },
          payload: {
            slug: 'jobs-python-snippet',
            name: 'Python Snippet Job',
            type: 'manual',
            snippet: updatedSnippet
          }
        });
        assert.equal(snippetUpdateResponse.statusCode, 201);
        const snippetUpdateBody = JSON.parse(snippetUpdateResponse.payload) as {
          data: {
            job: { version: number; entryPoint: string };
            bundle: { version: string };
          };
        };
        assert.equal(snippetUpdateBody.data.job.version, 2);
        assert(snippetUpdateBody.data.job.entryPoint.includes('@1.0.1'));
        assert.equal(snippetUpdateBody.data.bundle.version, '1.0.1');
      } else {
        assert.equal(snippetPreviewResponse.statusCode, 500);
      }

      const missingJobRunResponse = await app.inject({
        method: 'POST',
        url: '/jobs/does-not-exist/run',
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {}
      });
      assert.equal(missingJobRunResponse.statusCode, 404);
    } finally {
      await rm(tempRepoRoot, { recursive: true, force: true });
    }
  });
}

runE2E(async ({ registerCleanup }) => {
  registerCleanup(() => shutdownEmbeddedPostgres());
  await ensureEmbeddedPostgres();
  await testJobEndpoints();
}, { name: 'core-jobs.e2e' });

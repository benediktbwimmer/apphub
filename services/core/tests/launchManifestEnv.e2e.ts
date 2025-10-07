import './setupTestEnv';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { runE2E } from '@apphub/test-helpers';
import { KubectlMock } from '@apphub/kubectl-mock';
import type { FastifyInstance } from 'fastify';

const SERVICE_MODULE = 'observatory';
const REPOSITORY_ID = 'observatory-event-gateway';

async function loadModule<T>(modulePath: string): Promise<any> {
  const mod = await import(modulePath);
  return (mod as { default?: T } & T).default ?? mod;
}

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
        server.close(() => reject(new Error('failed to determine available port')));
      }
    });
  });
}

let embeddedPostgres: EmbeddedPostgres | null = null;
let embeddedPostgresCleanup: (() => Promise<void>) | null = null;

async function ensureEmbeddedPostgres(): Promise<void> {
  if (embeddedPostgres) {
    return;
  }

  const dataRoot = await mkdtemp(path.join(tmpdir(), 'launch-manifest-env-pg-'));
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
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const { buildServer } = await import('../src/server');
  const app = await buildServer();
  await app.ready();
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

runE2E(async ({ registerCleanup }) => {
  const kubectlMock = new KubectlMock();
  const kubectlPaths = await kubectlMock.start();
  registerCleanup(() => kubectlMock.stop());

  const previousPath = process.env.PATH;
  process.env.PATH = `${kubectlPaths.pathPrefix}:${previousPath ?? ''}`;
  registerCleanup(() => {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
  });

  const previousBuildMode = process.env.APPHUB_BUILD_EXECUTION_MODE;
  process.env.APPHUB_BUILD_EXECUTION_MODE = 'kubernetes';
  registerCleanup(() => {
    if (previousBuildMode === undefined) {
      delete process.env.APPHUB_BUILD_EXECUTION_MODE;
    } else {
      process.env.APPHUB_BUILD_EXECUTION_MODE = previousBuildMode;
    }
  });

  const previousLaunchMode = process.env.APPHUB_LAUNCH_EXECUTION_MODE;
  process.env.APPHUB_LAUNCH_EXECUTION_MODE = 'kubernetes';
  registerCleanup(() => {
    if (previousLaunchMode === undefined) {
      delete process.env.APPHUB_LAUNCH_EXECUTION_MODE;
    } else {
      process.env.APPHUB_LAUNCH_EXECUTION_MODE = previousLaunchMode;
    }
  });

  const previousPreviewTemplate = process.env.APPHUB_K8S_PREVIEW_URL_TEMPLATE;
  process.env.APPHUB_K8S_PREVIEW_URL_TEMPLATE = 'http://preview.local/{launch}';
  registerCleanup(() => {
    if (previousPreviewTemplate === undefined) {
      delete process.env.APPHUB_K8S_PREVIEW_URL_TEMPLATE;
    } else {
      process.env.APPHUB_K8S_PREVIEW_URL_TEMPLATE = previousPreviewTemplate;
    }
  });

  await withServer(async (app) => {
    const [dbInit, db, buildRunner, launchRunner, serviceRegistry] = await Promise.all([
      loadModule('../src/db/init'),
      loadModule('../src/db'),
      loadModule('../src/buildRunner'),
      loadModule('../src/launchRunner'),
      loadModule('../src/serviceRegistry')
    ]);

    await dbInit.ensureDatabase();
    serviceRegistry.resetServiceManifestState();

    const repoRoot = path.resolve(__dirname, '../../..');
    const importResponse = await app.inject({
      method: 'POST',
      url: '/service-networks/import',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        path: repoRoot,
        configPath: 'examples/environmental-observatory/config.json',
        module: SERVICE_MODULE,
        variables: {
          FILE_WATCH_ROOT: path.join(repoRoot, 'examples/environmental-observatory/data/inbox'),
          FILE_WATCH_STAGING_DIR: path.join(repoRoot, 'examples/environmental-observatory/data/staging'),
          TIMESTORE_BASE_URL: 'http://127.0.0.1:4200',
          TIMESTORE_DATASET_SLUG: 'observatory-timeseries',
          TIMESTORE_DATASET_NAME: 'Observatory Time Series',
          TIMESTORE_TABLE_NAME: 'observations',
          CORE_API_TOKEN: 'dev-token'
        }
      }
    });
    assert.equal(importResponse.statusCode, 201, `service manifest import failed: ${importResponse.payload}`);

    const appCreateResponse = await app.inject({
      method: 'POST',
      url: '/apps',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        id: REPOSITORY_ID,
        name: 'Observatory Event Gateway',
        description:
          'Brokers observatory ingest events for minute-level CSV drops and triggers workflows automatically.',
        repoUrl: 'https://github.com/benediktbwimmer/apphub.git',
        dockerfilePath: 'services/observatory-event-gateway/Dockerfile',
        tags: [
          { key: 'language', value: 'typescript' },
          { key: 'framework', value: 'fastify' }
        ],
        metadataStrategy: 'explicit'
      }
    });
    assert.equal(appCreateResponse.statusCode, 201, `app registration failed: ${appCreateResponse.payload}`);

    const repositoryAfterCreate = await db.getRepositoryById(REPOSITORY_ID);
    assert(repositoryAfterCreate, 'repository should exist after registration');
    assert(repositoryAfterCreate!.launchEnvTemplates.length > 0, 'manifest defaults should populate launch env templates');

    await db.upsertRepository({
      id: REPOSITORY_ID,
      name: repositoryAfterCreate!.name,
      description: repositoryAfterCreate!.description,
      repoUrl: repoRoot,
      dockerfilePath: repositoryAfterCreate!.dockerfilePath,
      ingestStatus: 'ready',
      tags: repositoryAfterCreate!.tags,
      launchEnvTemplates: repositoryAfterCreate!.launchEnvTemplates,
      metadataStrategy: repositoryAfterCreate!.metadataStrategy
    });

    const build = await db.createBuild(REPOSITORY_ID, { commitSha: 'abc1234' });
    await buildRunner.runBuildJob(build.id);

    const updatedBuild = await db.getBuildById(build.id);
    assert(updatedBuild, 'build record missing after run');
    assert.equal(updatedBuild!.status, 'succeeded', 'expected build to succeed via kubectl mock');

    const launch = await db.createLaunch(REPOSITORY_ID, build.id);
    await launchRunner.runLaunchStart(launch.id);

    const finalLaunch = await db.getLaunchById(launch.id);
    assert(finalLaunch, 'launch record missing after start');
    assert(finalLaunch!.env.length > 0, 'expected launch env array to be populated');

    const envMap = new Map(finalLaunch!.env.map((entry) => [entry.key, entry.value]));
    assert.equal(envMap.get('PORT'), '4310');
    const fileWatchRoot = envMap.get('FILE_WATCH_ROOT') ?? '';
    assert(fileWatchRoot.endsWith('examples/environmental-observatory/data/inbox'));
    assert.equal(envMap.get('CORE_API_TOKEN'), 'dev-token');
    assert(envMap.size >= 5, 'expected multiple env vars to be applied');
  });

  await shutdownEmbeddedPostgres();
}, { name: 'core-launch-manifest-env', timeoutMs: 120_000 });

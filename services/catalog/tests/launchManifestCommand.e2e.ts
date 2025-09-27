import './setupTestEnv';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { runE2E } from '@apphub/test-helpers';
import { DockerMock } from '@apphub/docker-mock';
import type { FastifyInstance } from 'fastify';

const SERVICE_MODULE = 'github.com/apphub/examples/environmental-observatory';
const REPOSITORY_ID = 'observatory-file-watcher';

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

  const dataRoot = await mkdtemp(path.join(tmpdir(), 'launch-manifest-command-pg-'));
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
  const previousHostRoot = process.env.APPHUB_HOST_ROOT;
  process.env.APPHUB_HOST_ROOT = '/';
  registerCleanup(() => {
    if (previousHostRoot === undefined) {
      delete process.env.APPHUB_HOST_ROOT;
    } else {
      process.env.APPHUB_HOST_ROOT = previousHostRoot;
    }
  });

  const dockerMock = new DockerMock({ mappedPort: 32770, containerIp: '172.18.0.4' });
  const dockerPaths = await dockerMock.start();
  registerCleanup(() => dockerMock.stop());

  const previousPath = process.env.PATH;
  process.env.PATH = `${dockerPaths.pathPrefix}:${previousPath ?? ''}`;
  registerCleanup(() => {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
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
    const dataDir = path.join(repoRoot, 'examples/environmental-observatory/data');
    const inboxDir = path.join(dataDir, 'inbox');
    const stagingDir = path.join(dataDir, 'staging');
    const archiveDir = path.join(dataDir, 'archive');

    const importResponse = await app.inject({
      method: 'POST',
      url: '/service-networks/import',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        path: repoRoot,
        configPath: 'examples/environmental-observatory/service-manifests/service-config.json',
        module: SERVICE_MODULE,
        variables: {
          FILE_WATCH_ROOT: inboxDir,
          FILE_WATCH_STAGING_DIR: stagingDir,
          FILE_ARCHIVE_DIR: archiveDir,
          TIMESTORE_BASE_URL: 'http://127.0.0.1:4200',
          TIMESTORE_DATASET_SLUG: 'observatory-timeseries',
          TIMESTORE_DATASET_NAME: 'Observatory Time Series',
          TIMESTORE_TABLE_NAME: 'observations',
          CATALOG_API_TOKEN: 'dev-token'
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
        name: 'Observatory File Watcher',
        description:
          'Watches the observatory inbox for minute-level CSV drops and triggers ingest workflows automatically.',
        repoUrl: 'https://github.com/benediktbwimmer/apphub.git',
        dockerfilePath: 'examples/environmental-observatory/services/observatory-file-watcher/Dockerfile',
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

    const build = await db.createBuild(REPOSITORY_ID, { commitSha: 'def5678' });
    await buildRunner.runBuildJob(build.id);

    const updatedBuild = await db.getBuildById(build.id);
    assert(updatedBuild, 'build record missing after run');
    assert.equal(updatedBuild!.status, 'succeeded', 'expected build to succeed via docker mock');

    const launch = await db.createLaunch(REPOSITORY_ID, build.id);
    await launchRunner.runLaunchStart(launch.id);

    const finalLaunch = await db.getLaunchById(launch.id);
    assert(finalLaunch, 'launch record missing after start');
    assert(finalLaunch!.command, 'expected docker command to be recorded');

    const command = finalLaunch!.command ?? '';
    const expectedMounts = [inboxDir, stagingDir, archiveDir];
    for (const sourcePath of expectedMounts) {
      const normalized = path.resolve(sourcePath);
      const mountToken = `-v ${normalized}:${normalized}:rw`;
      assert(
        command.includes(mountToken),
        `expected docker command to include bind mount for ${normalized}`
      );
    }
  });

  await shutdownEmbeddedPostgres();
}, { name: 'catalog-launch-manifest-command', timeoutMs: 120_000 });

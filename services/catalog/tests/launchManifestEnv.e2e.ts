import './setupTestEnv';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { runE2E } from '@apphub/test-helpers';
import { DockerMock } from '@apphub/docker-mock';
import type { LaunchEnvVar } from '../src/db/types';

runE2E(async ({ registerCleanup }) => {
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

  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousPgPoolMax = process.env.PGPOOL_MAX;
  const previousRunnerMode = process.env.LAUNCH_RUNNER_MODE;
  const previousRedisUrl = process.env.REDIS_URL;
  const previousPath = process.env.PATH;

  const dataRoot = await mkdtemp(path.join(tmpdir(), 'launch-env-pg-'));
  registerCleanup(() => rm(dataRoot, { recursive: true, force: true }));

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

  registerCleanup(async () => {
    await postgres.stop();
  });

  const dockerMock = new DockerMock({ mappedPort: 32768, containerIp: '172.18.0.2' });
  const dockerPaths = await dockerMock.start();
  registerCleanup(() => dockerMock.stop());

  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.PGPOOL_MAX = '4';
  process.env.LAUNCH_RUNNER_MODE = 'docker';
  process.env.REDIS_URL = 'inline';
  process.env.PATH = `${dockerPaths.pathPrefix}:${previousPath ?? ''}`;

  registerCleanup(() => {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    if (previousPgPoolMax === undefined) {
      delete process.env.PGPOOL_MAX;
    } else {
      process.env.PGPOOL_MAX = previousPgPoolMax;
    }
    if (previousRunnerMode === undefined) {
      delete process.env.LAUNCH_RUNNER_MODE;
    } else {
      process.env.LAUNCH_RUNNER_MODE = previousRunnerMode;
    }
    if (previousRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previousRedisUrl;
    }
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
  });

  const [{ ensureDatabase }, serviceConfigLoader, serviceRegistry, db, launchRunner] = await Promise.all([
    import('../src/db/init'),
    import('../src/serviceConfigLoader'),
    import('../src/serviceRegistry'),
    import('../src/db'),
    import('../src/launchRunner')
  ]);

  await ensureDatabase();

  const manifestDir = path.resolve(__dirname, '../../../examples/environmental-observatory/service-manifests');
  const preview = await serviceConfigLoader.previewServiceConfigImport({
    path: manifestDir,
    configPath: 'service-config.json',
    module: 'github.com/apphub/examples/environmental-observatory'
  });

  assert(preview.entries.length > 0, 'expected manifest entries to be discovered');

  await serviceRegistry.importServiceManifestModule({
    moduleId: preview.moduleId,
    entries: preview.entries,
    networks: preview.networks
  });

  const repositoryId = 'observatory-file-watcher';

  const manifestDefaults = await serviceRegistry.resolveManifestEnvForRepository(repositoryId);
  assert(manifestDefaults.length > 0, 'expected manifest env defaults to be discoverable');

  await db.addRepository({
    id: repositoryId,
    name: 'Observatory File Watcher',
    description: 'Test repository for manifest env propagation',
    repoUrl: 'https://example.com/observatory.git',
    dockerfilePath: 'examples/environmental-observatory/services/observatory-file-watcher/Dockerfile',
    ingestStatus: 'ready',
    tags: []
  });

  const build = await db.createBuild(repositoryId, { commitSha: 'abc1234' });
  await db.completeBuild(build.id, 'succeeded', {
    imageTag: 'apphub/observatory-file-watcher:test',
    completedAt: new Date().toISOString()
  });

  const launch = await db.createLaunch(repositoryId, build.id);

  await launchRunner.runLaunchStart(launch.id);

  const finalLaunch = await db.getLaunchById(launch.id);
  assert(finalLaunch, 'launch record missing after start');

  const envEntries = finalLaunch!.env;
  assert(envEntries.length > 0, 'expected launch env array to be populated');

  const envMap = new Map<string, string>((envEntries as LaunchEnvVar[]).map((entry) => [entry.key, entry.value]));

  assert.equal(envMap.get('PORT'), '4310', 'expected PORT env to match manifest');
  assert.equal(
    envMap.get('FILE_WATCH_ROOT'),
    'examples/environmental-observatory/data/inbox',
    'expected FILE_WATCH_ROOT default to propagate'
  );
  assert.equal(envMap.get('CATALOG_API_TOKEN'), 'dev-token', 'expected placeholder default token');
  assert(envMap.size >= 5, 'expected multiple env vars to be applied');
}, { name: 'catalog-launch-manifest-env' });

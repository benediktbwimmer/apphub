import './setupTestEnv';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { runE2E } from '@apphub/test-helpers';

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

runE2E(async ({ registerCleanup }) => {

  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousPgPoolMax = process.env.PGPOOL_MAX;

  const dataRoot = await mkdtemp(path.join(tmpdir(), 'ingest-launch-env-pg-'));
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

  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.PGPOOL_MAX = '4';

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
  });

  const [{ ensureDatabase }, db] = await Promise.all([
    import('../src/db/init'),
    import('../src/db')
  ]);

  await ensureDatabase();

  const repositoryId = 'observatory-event-gateway';
  const launchEnvTemplates = [
    { key: 'PORT', value: '4310' },
    { key: 'FILE_WATCH_ROOT', value: 'examples/environmental-observatory/data/inbox' },
    { key: 'FILE_WATCH_STAGING_DIR', value: 'examples/environmental-observatory/data/staging' },
    { key: 'TIMESTORE_BASE_URL', value: 'http://127.0.0.1:4200' },
    { key: 'TIMESTORE_DATASET_SLUG', value: 'observatory-timeseries' },
    { key: 'TIMESTORE_DATASET_NAME', value: 'Observatory Time Series' },
    { key: 'TIMESTORE_TABLE_NAME', value: 'observations' },
    { key: 'CORE_API_TOKEN', value: 'dev-token' }
  ];

  await db.addRepository({
    id: repositoryId,
    name: 'Observatory Event Gateway',
    description: 'Test repository for launch env persistence',
    repoUrl: 'https://example.com/observatory.git',
    dockerfilePath: 'services/observatory-event-gateway/Dockerfile',
    ingestStatus: 'ready',
    tags: [],
    launchEnvTemplates
  });

  const initial = await db.getRepositoryById(repositoryId);
  assert(initial, 'expected repository to be created');
  assert(initial.launchEnvTemplates.length > 0, 'expected initial launch env templates to be stored');

  const now = new Date().toISOString();

  await db.upsertRepository({
    id: repositoryId,
    name: 'Observatory Event Gateway',
    description: 'Test repository for launch env persistence',
    repoUrl: 'https://example.com/observatory.git',
    dockerfilePath: 'services/observatory-event-gateway/Dockerfile',
    ingestStatus: 'ready',
    updatedAt: now,
    lastIngestedAt: now,
    ingestError: null,
    tags: [],
    ingestAttempts: initial.ingestAttempts,
    metadataStrategy: initial.metadataStrategy
    // intentionally omit launchEnvTemplates to mirror ingestion updates
  });

  const updated = await db.getRepositoryById(repositoryId);
  assert(updated, 'expected repository to persist after upsert');

  const envMap = new Map(updated.launchEnvTemplates.map((entry) => [entry.key, entry.value]));
  assert(envMap.size >= launchEnvTemplates.length, 'expected launch env templates to be preserved after upsert');
  for (const { key, value } of launchEnvTemplates) {
    assert.equal(envMap.get(key), value, `expected ${key} launch env template to persist`);
  }
}, { name: 'core-ingestion-launch-env-templates' });

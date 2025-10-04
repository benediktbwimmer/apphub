import './setupTestEnv';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import EmbeddedPostgres from 'embedded-postgres';
import { backfillServiceRegistry } from '../src/serviceRegistryBackfill';
import {
  getServiceBySlug,
  listServiceNetworkRepositoryIds,
  listActiveServiceManifests,
  closePool
} from '../src/db';
import { resetDatabasePool } from '../src/db/client';
import {
  initializeServiceRegistry,
  resetServiceManifestState,
  getServiceManifest,
  getServiceHealthSnapshot,
  __testing
} from '../src/serviceRegistry';
import { queueManager } from '../src/queueManager';

const EVENT_MODULE_ID = 'environmental-observatory';
const EVENT_MODULE_PATH = 'modules/environmental-observatory/resources';
const DASHBOARD_SLUG = 'observatory-dashboard';

let postgres: EmbeddedPostgres | null = null;
let cleanupDir: string | null = null;

async function ensureEmbeddedPostgres(): Promise<void> {
  if (postgres) {
    return;
  }
  cleanupDir = await mkdtemp(path.join(tmpdir(), 'service-registry-backfill-'));
  const port = 49_000 + Math.floor(Math.random() * 1000);
  const instance = new EmbeddedPostgres({
    databaseDir: cleanupDir,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false
  });
  await instance.initialise();
  await instance.start();
  await instance.createDatabase('apphub');
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  await resetDatabasePool({ connectionString: process.env.DATABASE_URL });
  postgres = instance;
}

async function shutdownEmbeddedPostgres(): Promise<void> {
  const instance = postgres;
  postgres = null;
  const dir = cleanupDir;
  cleanupDir = null;
  if (instance) {
    await instance.stop();
  }
  if (dir) {
    await rm(dir, { recursive: true, force: true });
  }
}

async function setupRegistry() {
  process.env.APPHUB_EVENTS_MODE = 'inline';
process.env.REDIS_URL = 'inline';
process.env.APPHUB_ALLOW_INLINE_MODE = 'true';
  process.env.APPHUB_DISABLE_SERVICE_POLLING = '1';
  await ensureEmbeddedPostgres();
  return initializeServiceRegistry({ enablePolling: false });
}

async function run() {
  const registry = await setupRegistry();

  try {
    const backfillResults = await backfillServiceRegistry({
      targets: [{ path: EVENT_MODULE_PATH, moduleId: EVENT_MODULE_ID }]
    });

    assert.equal(backfillResults.length, 1, 'expected single module backfill result');
    assert.equal(backfillResults[0]?.moduleId, EVENT_MODULE_ID);
    assert.equal(backfillResults[0]?.servicesApplied, 1);

    const manifest = await getServiceManifest(DASHBOARD_SLUG);
    assert(manifest, 'dashboard manifest should be available after backfill');
    assert.equal(manifest?.baseUrl, 'http://127.0.0.1:4311');

    const networkRepositoryIds = await listServiceNetworkRepositoryIds();
    assert.equal(networkRepositoryIds.length, 0, 'event-driven example does not define service networks');

    resetServiceManifestState();
    const manifestAfterReset = await getServiceManifest(DASHBOARD_SLUG);
    assert(manifestAfterReset, 'manifest should reload from shared store after reset');

    const manifestList = await listActiveServiceManifests();
    assert.equal(
      manifestList.filter((entry) => entry.serviceSlug === DASHBOARD_SLUG).length,
      1,
      'exactly one active manifest record should exist per service'
    );

    const service = await getServiceBySlug(DASHBOARD_SLUG);
    assert(service, 'service row should exist after backfill');

    const previousFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });

    try {
      const initialSnapshot = await getServiceHealthSnapshot(DASHBOARD_SLUG);
      assert.equal(initialSnapshot, null, 'no health snapshot expected before poll');

      await __testing.checkServiceHealth(service!);
      await __testing.waitForInvalidations();

      const snapshot = await getServiceHealthSnapshot(DASHBOARD_SLUG);
      assert(snapshot, 'health snapshot should be recorded after poll');
      assert.equal(snapshot?.status, 'healthy');
      assert.equal(snapshot?.statusCode, 200);
      assert(snapshot?.checkedAt, 'health snapshot should include timestamp');
    } finally {
      global.fetch = previousFetch;
    }

    const secondPass = await backfillServiceRegistry({
      targets: [{ path: EVENT_MODULE_PATH, moduleId: EVENT_MODULE_ID }]
    });
    assert.equal(secondPass[0]?.servicesApplied, 1, 'second pass should report single service count');

    const activeManifests = await listActiveServiceManifests();
    const dashboardActive = activeManifests.filter((entry) => entry.serviceSlug === DASHBOARD_SLUG);
    assert.equal(dashboardActive.length, 1, 'backfill should remain idempotent for dashboard manifest');
  } finally {
    registry.stop();
    await closePool();
    await shutdownEmbeddedPostgres();
    await queueManager.closeConnection().catch(() => undefined);
  }
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await shutdownEmbeddedPostgres();
    process.exit(1);
  });

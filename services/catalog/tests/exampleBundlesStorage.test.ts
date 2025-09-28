import './setupTestEnv';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { ExampleBundleArtifactRecord } from '../src/db';

let embeddedPostgres: EmbeddedPostgres | null = null;
let cleanupFn: (() => Promise<void>) | null = null;

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

async function startEmbeddedPostgres(): Promise<void> {
  if (embeddedPostgres) {
    return;
  }
  const dataDir = await mkdtemp(path.join(tmpdir(), 'example-bundle-pg-'));
  const port = await findAvailablePort();
  const postgres = new EmbeddedPostgres({
    databaseDir: dataDir,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('apphub');
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.PGPOOL_MAX = '4';
  embeddedPostgres = postgres;
  cleanupFn = async () => {
    try {
      await postgres.stop();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  };
}

async function stopEmbeddedPostgres(): Promise<void> {
  const cleanup = cleanupFn;
  cleanupFn = null;
  embeddedPostgres = null;
  if (cleanup) {
    await cleanup();
  }
}

async function run(): Promise<void> {
  const storageRoot = await mkdtemp(path.join(tmpdir(), 'example-bundle-storage-'));
  process.env.APPHUB_BUNDLE_STORAGE_BACKEND = 'local';
  process.env.APPHUB_BUNDLE_STORAGE_ROOT = storageRoot;
  process.env.APPHUB_BUNDLE_STORAGE_SIGNING_SECRET = 'example-bundles-test-secret';

  await startEmbeddedPostgres();

  const statusStore = await import('../src/exampleBundles/statusStore');
  const bundleStorage = await import('../src/exampleBundles/bundleStorage');

  // verify progress lifecycle
  const queued = await statusStore.recordProgress('demo', 'fingerprint', 'queued');
  assert.equal(queued.state, 'queued');
  assert.equal(queued.jobId, null);

  const running = await statusStore.recordProgress('demo', 'fingerprint', 'running', {
    jobId: 'job-123',
    message: 'installing'
  });
  assert.equal(running.state, 'running');
  assert.equal(running.jobId, 'job-123');
  assert.equal(running.message, 'installing');

  // migrate to completion
  const bundleBuffer = Buffer.from('example bundle artifact');
  const checksum = createHash('sha256').update(bundleBuffer).digest('hex');
  const completed = await statusStore.recordCompletion(
    {
      slug: 'demo',
      fingerprint: 'fingerprint',
      version: '0.1.0',
      checksum,
      filename: 'demo-0.1.0.tgz',
      createdAt: new Date().toISOString(),
      size: bundleBuffer.byteLength,
      manifest: { name: 'demo', version: '0.1.0' },
      manifestObject: { name: 'demo', version: '0.1.0' },
      buffer: bundleBuffer,
      tarballPath: null,
      contentType: 'application/gzip',
      cached: false
    },
    { jobId: 'job-123' }
  );

  assert.equal(completed.state, 'completed');
  assert.equal(completed.storageKind, 'local');
  assert(completed.storageKey, 'storage key should be recorded');
  assert(completed.downloadUrl, 'download URL should be generated');
  assert.match(
    completed.downloadUrl ?? '',
    /\/examples\/bundles\/demo\/fingerprints\/fingerprint\/download\?/,
    'download URL should target local streaming route'
  );

  const artifactPath = path.join(storageRoot, completed.storageKey ?? '');
  const storedData = await readFile(artifactPath);
  assert.equal(storedData.toString('utf8'), bundleBuffer.toString('utf8'));

  const parsedDownloadUrl = new URL(
    completed.downloadUrl ?? '',
    'http://localhost:4000'
  );
  const expiresParam = Number(parsedDownloadUrl.searchParams.get('expires'));
  const tokenParam = parsedDownloadUrl.searchParams.get('token') ?? '';
  const artifactRecord: ExampleBundleArtifactRecord = {
    id: completed.artifactId ?? 'artifact-id',
    slug: completed.slug,
    fingerprint: completed.fingerprint,
    version: completed.version,
    checksum: completed.checksum ?? '',
    filename: completed.filename,
    storageKind: 'local' as const,
    storageKey: completed.storageKey ?? '',
    storageUrl: completed.storageUrl,
    contentType: completed.contentType,
    size: completed.size,
    jobId: completed.jobId,
    uploadedAt: completed.artifactUploadedAt ?? completed.updatedAt,
    createdAt: completed.artifactUploadedAt ?? completed.createdAt
  } satisfies bundleStorage.ExampleBundleArtifactRecord;

  assert(
    bundleStorage.verifyLocalExampleBundleDownload(artifactRecord, tokenParam, expiresParam),
    'signed token should verify for local downloads'
  );

  const statuses = await statusStore.listStatuses();
  assert.equal(statuses.length >= 1, true, 'list should include completed status');
  const storedStatus = await statusStore.getStatus('demo');
  assert(storedStatus, 'status should be retrievable');
  assert.equal(storedStatus?.state, 'completed');

  const failed = await statusStore.recordProgress('broken', 'oops', 'failed', {
    error: 'bundle exploded'
  });
  assert.equal(failed.state, 'failed');
  assert.equal(failed.error, 'bundle exploded');

  await statusStore.clearStatus('broken');
  const cleared = await statusStore.getStatus('broken');
  assert.equal(cleared, null, 'cleared status should disappear');

  const db = await import('../src/db');
  await db.closePool();

  await stopEmbeddedPostgres();
  await rm(storageRoot, { recursive: true, force: true });
  delete process.env.APPHUB_BUNDLE_STORAGE_BACKEND;
  delete process.env.APPHUB_BUNDLE_STORAGE_ROOT;
  delete process.env.APPHUB_BUNDLE_STORAGE_SIGNING_SECRET;
  delete process.env.DATABASE_URL;
  delete process.env.PGPOOL_MAX;
}

run().catch(async (err) => {
  await stopEmbeddedPostgres().catch(() => undefined);
  console.error(err);
  process.exitCode = 1;
});

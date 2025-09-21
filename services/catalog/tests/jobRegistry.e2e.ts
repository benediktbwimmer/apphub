import './setupTestEnv';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import type { FastifyInstance } from 'fastify';

let embeddedPostgres: EmbeddedPostgres | null = null;
let embeddedPostgresCleanup: (() => Promise<void>) | null = null;
let bundleStorageDir: string | null = null;

const OPERATOR_TOKEN = 'job-registry-e2e-token';

process.env.APPHUB_OPERATOR_TOKENS = JSON.stringify([
  {
    subject: 'job-registry-e2e',
    token: OPERATOR_TOKEN,
    scopes: ['jobs:write', 'job-bundles:write', 'job-bundles:read', 'workflows:write', 'workflows:run']
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

  const dataRoot = await mkdtemp(path.join(tmpdir(), 'apphub-job-registry-pg-'));
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
  const storageRoot = await mkdtemp(path.join(tmpdir(), 'apphub-job-bundles-'));
  bundleStorageDir = storageRoot;
  process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR = storageRoot;
  process.env.APPHUB_JOB_BUNDLE_STORAGE_BACKEND = 'local';
  process.env.APPHUB_JOB_BUNDLE_SIGNING_SECRET = 'job-registry-e2e-secret';
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

async function publishAndVerifyBundle(app: FastifyInstance) {
  const artifactContent = Buffer.from('console.log("bundle alpha");', 'utf8');
  const artifactBase64 = artifactContent.toString('base64');
  const checksum = createHash('sha256').update(artifactContent).digest('hex');

  const publishResponse = await app.inject({
    method: 'POST',
    url: '/job-bundles',
    headers: {
      Authorization: `Bearer ${OPERATOR_TOKEN}`
    },
    payload: {
      slug: 'bundle-alpha',
      version: '1.0.0',
      manifest: {
        name: 'Bundle Alpha',
        version: '1.0.0',
        entry: 'index.js',
        capabilities: ['fs']
      },
      capabilityFlags: ['custom-flag'],
      artifact: {
        data: artifactBase64,
        filename: 'bundle-alpha.tgz',
        contentType: 'application/gzip',
        checksum
      }
    }
  });

  assert.equal(publishResponse.statusCode, 201);
  const publishBody = JSON.parse(publishResponse.payload) as {
    data: {
      bundle: { slug: string };
      version: {
        version: string;
        capabilityFlags: string[];
        download: { url: string };
      };
    };
  };

  assert.equal(publishBody.data.bundle.slug, 'bundle-alpha');
  assert.equal(publishBody.data.version.version, '1.0.0');
  assert(publishBody.data.version.capabilityFlags.includes('fs'));
  assert(publishBody.data.version.capabilityFlags.includes('custom-flag'));
  assert.ok(publishBody.data.version.download?.url?.length > 0);

  const listResponse = await app.inject({ method: 'GET', url: '/job-bundles' });
  assert.equal(listResponse.statusCode, 200);
  const listBody = JSON.parse(listResponse.payload) as {
    data: Array<{ slug: string; latestVersion: string | null }>;
  };
  assert(listBody.data.some((bundle) => bundle.slug === 'bundle-alpha'));

  const showResponse = await app.inject({ method: 'GET', url: '/job-bundles/bundle-alpha' });
  assert.equal(showResponse.statusCode, 200);
  const showBody = JSON.parse(showResponse.payload) as {
    data: { versions: Array<{ version: string; status: string }> };
  };
  assert(showBody.data.versions.some((entry) => entry.version === '1.0.0'));

  const detailsResponse = await app.inject({
    method: 'GET',
    url: '/job-bundles/bundle-alpha/versions/1.0.0'
  });
  assert.equal(detailsResponse.statusCode, 200);
  const detailsBody = JSON.parse(detailsResponse.payload) as {
    data: { version: { manifest: { entry: string }; download: { url: string } } };
  };
  assert.equal(detailsBody.data.version.manifest.entry, 'index.js');

  const downloadPath = detailsBody.data.version.download.url;
  assert.equal(typeof downloadPath, 'string');
  const downloadResponse = await app.inject({ method: 'GET', url: downloadPath });
  assert.equal(downloadResponse.statusCode, 200);
  assert.equal(downloadResponse.headers['content-type'], 'application/gzip');
  assert.deepEqual(downloadResponse.rawPayload, artifactContent);

  return downloadPath;
}

async function testJobBundleLifecycle(): Promise<void> {
  await withServer(async (app) => {
    const downloadPath = await publishAndVerifyBundle(app);

    const mismatchResponse = await app.inject({
      method: 'POST',
      url: '/job-bundles',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      },
      payload: {
        slug: 'bundle-alpha',
        version: '2.0.0',
        manifest: {
          name: 'Bundle Alpha',
          version: '1.0.0',
          entry: 'index.js'
        },
        artifact: {
          data: Buffer.from('noop').toString('base64')
        }
      }
    });
    assert.equal(mismatchResponse.statusCode, 400);

    const conflictResponse = await app.inject({
      method: 'POST',
      url: '/job-bundles',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      },
      payload: {
        slug: 'bundle-alpha',
        version: '1.0.0',
        manifest: {
          name: 'Bundle Alpha',
          version: '1.0.0',
          entry: 'index.js'
        },
        artifact: {
          data: Buffer.from('noop').toString('base64')
        }
      }
    });
    assert.equal(conflictResponse.statusCode, 409);

    const deprecateResponse = await app.inject({
      method: 'PATCH',
      url: '/job-bundles/bundle-alpha/versions/1.0.0',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      },
      payload: {
        deprecated: true
      }
    });
    assert.equal(deprecateResponse.statusCode, 200);
    const deprecateBody = JSON.parse(deprecateResponse.payload) as {
      data: { version: { status: string } };
    };
    assert.equal(deprecateBody.data.version.status, 'deprecated');

    const restoreResponse = await app.inject({
      method: 'PATCH',
      url: '/job-bundles/bundle-alpha/versions/1.0.0',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      },
      payload: {
        deprecated: false
      }
    });
    assert.equal(restoreResponse.statusCode, 200);
    const restoreBody = JSON.parse(restoreResponse.payload) as {
      data: { version: { status: string } };
    };
    assert.equal(restoreBody.data.version.status, 'published');

    const parsedUrl = new URL(downloadPath, 'http://localhost');
    parsedUrl.searchParams.set('token', 'invalid');
    const invalidTokenResponse = await app.inject({
      method: 'GET',
      url: `${parsedUrl.pathname}${parsedUrl.search}`
    });
    assert.equal(invalidTokenResponse.statusCode, 403);
  });
}

async function run() {
  try {
    await testJobBundleLifecycle();
  } finally {
    await shutdownEmbeddedPostgres();
    if (bundleStorageDir) {
      await rm(bundleStorageDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

import './setupTestEnv';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as tar from 'tar';
import { createEmbeddedPostgres, stopEmbeddedPostgres, runE2E } from '@apphub/test-helpers';
import type EmbeddedPostgres from 'embedded-postgres';
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

async function createBundleArchive(files: Record<string, string>): Promise<Buffer> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'job-import-archive-'));
  try {
    const entries = Object.entries(files);
    for (const [relativePath, contents] of entries) {
      const fullPath = path.join(tempRoot, relativePath);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, contents, 'utf8');
    }
    const archivePath = path.join(tempRoot, 'bundle.tgz');
    await tar.c(
      {
        cwd: tempRoot,
        gzip: true,
        file: archivePath
      },
      entries.map(([relativePath]) => relativePath)
    );
    return await readFile(archivePath);
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function withServer(fn: (app: FastifyInstance) => Promise<void>): Promise<void> {
  await ensureEmbeddedPostgres();
  const storageRoot = await mkdtemp(path.join(tmpdir(), 'apphub-job-bundles-'));
  bundleStorageDir = storageRoot;
  const previousStorageDir = process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR;
  const previousStorageBackend = process.env.APPHUB_JOB_BUNDLE_STORAGE_BACKEND;
  const previousStorageSecret = process.env.APPHUB_JOB_BUNDLE_SIGNING_SECRET;
  const previousRedisUrl = process.env.REDIS_URL;
  process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR = storageRoot;
  process.env.APPHUB_JOB_BUNDLE_STORAGE_BACKEND = 'local';
  process.env.APPHUB_JOB_BUNDLE_SIGNING_SECRET = 'job-registry-e2e-secret';
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

  const { buildServer } = await import('../src/server');
  const app = await buildServer();
  await app.ready();
  try {
    await fn(app);
  } finally {
    await app.close();
    await rm(storageRoot, { recursive: true, force: true });
    if (previousStorageDir === undefined) {
      delete process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR;
    } else {
      process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR = previousStorageDir;
    }
    if (previousStorageBackend === undefined) {
      delete process.env.APPHUB_JOB_BUNDLE_STORAGE_BACKEND;
    } else {
      process.env.APPHUB_JOB_BUNDLE_STORAGE_BACKEND = previousStorageBackend;
    }
    if (previousStorageSecret === undefined) {
      delete process.env.APPHUB_JOB_BUNDLE_SIGNING_SECRET;
    } else {
      process.env.APPHUB_JOB_BUNDLE_SIGNING_SECRET = previousStorageSecret;
    }
    if (previousRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previousRedisUrl;
    }
    bundleStorageDir = null;
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

    const createJobResponse = await app.inject({
      method: 'POST',
      url: '/jobs',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      },
      payload: {
        slug: 'bundle-editor-job',
        name: 'Bundle Editor Job',
        type: 'manual',
        entryPoint: 'bundle:bundle-alpha@1.0.0',
        version: 1
      }
    });
    assert.equal(createJobResponse.statusCode, 201);

    const editorResponse = await app.inject({
      method: 'GET',
      url: '/jobs/bundle-editor-job/bundle-editor',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      }
    });
    assert.equal(editorResponse.statusCode, 200);
    const editorBody = JSON.parse(editorResponse.payload) as {
      data: {
        binding: { version: string };
        bundle: { capabilityFlags: string[]; metadata: unknown };
        editor: {
          entryPoint: string;
          manifestPath: string;
          manifest: Record<string, unknown>;
          files: Array<{ path: string; contents: string; encoding: string }>;
        };
      };
    };
    assert.equal(editorBody.data.binding.version, '1.0.0');
    assert.equal(editorBody.data.editor.entryPoint, 'index.js');
    assert(editorBody.data.editor.files.length >= 1);

    const primaryFile = editorBody.data.editor.files[0];
    const updatedContents = `${
      primaryFile.encoding === 'base64'
        ? Buffer.from(primaryFile.contents, 'base64').toString('utf8')
        : primaryFile.contents
    }\nconsole.log('updated bundle');\n`;

    const updatedManifest = { ...editorBody.data.editor.manifest, version: '1.0.1' };

    const regenerateResponse = await app.inject({
      method: 'POST',
      url: '/jobs/bundle-editor-job/bundle/regenerate',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      },
      payload: {
        entryPoint: editorBody.data.editor.entryPoint,
        manifestPath: editorBody.data.editor.manifestPath,
        manifest: updatedManifest,
        files: [
          {
            path: primaryFile.path,
            contents: updatedContents,
            encoding: 'utf8'
          }
        ],
        capabilityFlags: editorBody.data.bundle.capabilityFlags,
        metadata: editorBody.data.bundle.metadata ?? undefined,
        version: '1.0.1'
      }
    });
    assert.equal(regenerateResponse.statusCode, 201);
    const regenerateBody = JSON.parse(regenerateResponse.payload) as {
      data: {
        binding: { version: string };
        bundle: { version: string };
        job: { entryPoint: string };
      };
    };
    assert.equal(regenerateBody.data.bundle.version, '1.0.1');
    assert.equal(regenerateBody.data.binding.version, '1.0.1');
    assert.equal(regenerateBody.data.job.entryPoint, 'bundle:bundle-alpha@1.0.1');

    const jobDetailResponse = await app.inject({
      method: 'GET',
      url: '/jobs/bundle-editor-job',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      }
    });
    assert.equal(jobDetailResponse.statusCode, 200);
    const jobDetailBody = JSON.parse(jobDetailResponse.payload) as {
      data: { job: { entryPoint: string } };
    };
    assert.equal(jobDetailBody.data.job.entryPoint, 'bundle:bundle-alpha@1.0.1');

    const editorAfterResponse = await app.inject({
      method: 'GET',
      url: '/jobs/bundle-editor-job/bundle-editor',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      }
    });
    assert.equal(editorAfterResponse.statusCode, 200);
    const editorAfterBody = JSON.parse(editorAfterResponse.payload) as {
      data: {
        binding: { version: string };
        editor: { files: Array<{ contents: string; encoding: string }> };
        bundle: { version: string };
      };
    };
    assert.equal(editorAfterBody.data.binding.version, '1.0.1');
    assert.equal(editorAfterBody.data.bundle.version, '1.0.1');
    assert(editorAfterBody.data.editor.files[0]);

    const parsedUrl = new URL(downloadPath, 'http://localhost');
    parsedUrl.searchParams.set('token', 'invalid');
    const invalidTokenResponse = await app.inject({
      method: 'GET',
      url: `${parsedUrl.pathname}${parsedUrl.search}`
    });
    assert.equal(invalidTokenResponse.statusCode, 403);
  });
}

async function testJobImportHandlesExistingArtifact(): Promise<void> {
  await withServer(async (app) => {
    const slug = 'file-relocator';
    const manifest = {
      name: 'File Relocator',
      slug,
      version: '1.0.0',
      entry: 'index.js',
      runtime: 'node',
      capabilities: ['fs']
    };
    const archiveBuffer = await createBundleArchive({
      'manifest.json': JSON.stringify(manifest, null, 2),
      'index.js': "module.exports.handler = async () => ({ status: 'succeeded' });\n"
    });
    const archiveBase64 = archiveBuffer.toString('base64');

    const previewResponse = await app.inject({
      method: 'POST',
      url: '/job-imports/preview',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`,
        'Content-Type': 'application/json'
      },
      payload: {
        source: 'upload',
        reference: `${slug}@${manifest.version}`,
        archive: {
          data: archiveBase64,
          filename: `${slug}-${manifest.version}.tgz`,
          contentType: 'application/gzip'
        }
      }
    });
    assert.equal(previewResponse.statusCode, 200, previewResponse.payload);
    const previewBody = JSON.parse(previewResponse.payload) as {
      data: { bundle: { slug: string; version: string } };
    };
    const reference = `${previewBody.data.bundle.slug}@${previewBody.data.bundle.version}`;
    const importPayload = {
      source: 'upload' as const,
      reference,
      archive: {
        data: archiveBase64,
        filename: `${slug}-${manifest.version}.tgz`,
        contentType: 'application/gzip'
      }
    };

    const initialImport = await app.inject({
      method: 'POST',
      url: '/job-imports',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`,
        'Content-Type': 'application/json'
      },
      payload: importPayload
    });
    assert.equal(initialImport.statusCode, 201, initialImport.payload);

    const { useConnection } = await import('../src/db/utils');

    await useConnection(async (client) => {
      await client.query('DELETE FROM job_definitions WHERE slug = $1', [slug]);
      await client.query('DELETE FROM job_bundle_versions WHERE slug = $1', [slug]);
      await client.query('DELETE FROM job_bundles WHERE slug = $1', [slug]);
    });

    const reimportResponse = await app.inject({
      method: 'POST',
      url: '/job-imports',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`,
        'Content-Type': 'application/json'
      },
      payload: importPayload
    });
    assert.equal(reimportResponse.statusCode, 201, reimportResponse.payload);
  });
}

async function testJobBundleAiEdit(): Promise<void> {
  const fixtureDir = path.join(__dirname, 'fixtures', 'codex');
  process.env.APPHUB_CODEX_MOCK_DIR = fixtureDir;
  try {
    await withServer(async (app) => {
      const bundleSlug = 'bundle-ai-edit';
      const artifactContent = Buffer.from('module.exports.handler = async () => ({ status: "succeeded" });', 'utf8');
      const artifactBase64 = artifactContent.toString('base64');
      const checksum = createHash('sha256').update(artifactContent).digest('hex');

      const publishResponse = await app.inject({
        method: 'POST',
        url: '/job-bundles',
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          slug: bundleSlug,
          version: '1.0.0',
          manifest: {
            name: 'AI Edit Bundle',
            version: '1.0.0',
            entry: 'index.js',
            capabilities: ['ai']
          },
          capabilityFlags: ['ai'],
          artifact: {
            data: artifactBase64,
            filename: 'bundle-ai-edit.tgz',
            contentType: 'application/gzip',
            checksum
          }
        }
      });
      assert.equal(publishResponse.statusCode, 201, publishResponse.payload);

      const createJobResponse = await app.inject({
        method: 'POST',
        url: '/jobs',
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          slug: 'ai-edit-job',
          name: 'AI Edit Job',
          type: 'manual',
          entryPoint: `bundle:${bundleSlug}@1.0.0`,
          version: 1
        }
      });
      assert.equal(createJobResponse.statusCode, 201);

      const aiEditResponse = await app.inject({
        method: 'POST',
        url: '/jobs/ai-edit-job/bundle/ai-edit',
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        },
        payload: {
          prompt: 'Refactor the handler to log execution while preserving the bundle slug.',
          provider: 'codex'
        }
      });
      assert.equal(aiEditResponse.statusCode, 201, aiEditResponse.payload);

      const aiEditBody = JSON.parse(aiEditResponse.payload) as {
        data: {
          binding: { version: string; slug: string };
          bundle: { version: string; capabilityFlags: string[] };
          editor: {
            files: Array<{ path: string; contents: string; encoding?: string }>;
          };
          job: { entryPoint: string };
        };
      };

      assert.equal(aiEditBody.data.binding.slug, bundleSlug);
      assert.equal(aiEditBody.data.binding.version, '1.0.1');
      assert.equal(aiEditBody.data.bundle.version, '1.0.1');
      assert.equal(aiEditBody.data.job.entryPoint, `bundle:${bundleSlug}@1.0.1`);
      assert(aiEditBody.data.bundle.capabilityFlags.includes('ai'));

      const mainFile = aiEditBody.data.editor.files.find((file) => file.path === 'index.js');
      assert(mainFile);
      const mainContents =
        mainFile?.encoding === 'base64'
          ? Buffer.from(mainFile.contents, 'base64').toString('utf8')
          : mainFile?.contents ?? '';
      assert(mainContents.includes('Fixture bundle executed'));

      const editorFetchResponse = await app.inject({
        method: 'GET',
        url: '/jobs/ai-edit-job/bundle-editor',
        headers: {
          Authorization: `Bearer ${OPERATOR_TOKEN}`
        }
      });
      assert.equal(editorFetchResponse.statusCode, 200);
      const editorFetchBody = JSON.parse(editorFetchResponse.payload) as {
        data: {
          binding: { version: string };
          bundle: { version: string };
        };
      };
      assert.equal(editorFetchBody.data.binding.version, '1.0.1');
      assert.equal(editorFetchBody.data.bundle.version, '1.0.1');
    });
  } finally {
    delete process.env.APPHUB_CODEX_MOCK_DIR;
  }
}

async function cleanup(): Promise<void> {
  if (bundleStorageDir) {
    await rm(bundleStorageDir, { recursive: true, force: true });
    bundleStorageDir = null;
  }
  await shutdownEmbeddedPostgres();
}

runE2E(async ({ registerCleanup }) => {
  registerCleanup(() => cleanup());
  await ensureEmbeddedPostgres();
  await testJobBundleLifecycle();
  await testJobImportHandlesExistingArtifact();
  await testJobBundleAiEdit();
}, { name: 'core-jobRegistry.e2e' });

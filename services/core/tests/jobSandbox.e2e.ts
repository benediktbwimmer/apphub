import './setupTestEnv';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import { createHash } from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import { runE2E } from '@apphub/test-helpers';

let embeddedPostgres: EmbeddedPostgres | null = null;
let embeddedPostgresCleanup: (() => Promise<void>) | null = null;
let bundleStorageDir: string | null = null;
let bundleCacheDir: string | null = null;

let runtimeModule: typeof import('../src/jobs/runtime') | null = null;
let registryModule: typeof import('../src/jobs/registryService') | null = null;
let jobsDbModule: typeof import('../src/db/jobs') | null = null;
let dbModule: typeof import('../src/db') | null = null;

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

  const dataRoot = await mkdtemp(path.join(tmpdir(), 'apphub-sandbox-pg-'));
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

  const { ensureDatabase } = await import('../src/db/init');
  await ensureDatabase();
}

async function ensureModulesLoaded(): Promise<void> {
  if (!runtimeModule) {
    runtimeModule = await import('../src/jobs/runtime');
  }
  if (!registryModule) {
    registryModule = await import('../src/jobs/registryService');
  }
  if (!jobsDbModule) {
    jobsDbModule = await import('../src/db/jobs');
  }
  if (!dbModule) {
    dbModule = await import('../src/db');
  }
}

type BundleSpec = {
  slug: string;
  version: string;
  manifest: Record<string, unknown>;
  files: Record<string, string>;
};

async function createBundleArtifact(spec: BundleSpec): Promise<Buffer> {
  const workDir = await mkdtemp(path.join(tmpdir(), `bundle-${spec.slug}-`));
  try {
    await writeFile(
      path.join(workDir, 'manifest.json'),
      JSON.stringify(spec.manifest, null, 2),
      'utf8'
    );

    for (const [relativePath, contents] of Object.entries(spec.files)) {
      const targetPath = path.join(workDir, relativePath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, contents, 'utf8');
    }

    const archiveEntries = new Set<string>(['manifest.json']);
    for (const relativePath of Object.keys(spec.files)) {
      archiveEntries.add(relativePath);
    }

    const tarballPath = path.join(workDir, `${spec.slug}-${spec.version}.tgz`);
    await tar.c({ gzip: true, cwd: workDir, file: tarballPath }, Array.from(archiveEntries));
    const data = await readFile(tarballPath);
    return data;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function setupSandboxEnvironment(): Promise<void> {
  await ensureEmbeddedPostgres();
  bundleStorageDir = await mkdtemp(path.join(tmpdir(), 'apphub-sandbox-bundles-'));
  bundleCacheDir = await mkdtemp(path.join(tmpdir(), 'apphub-sandbox-cache-'));
  process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR = bundleStorageDir;
  process.env.APPHUB_JOB_BUNDLE_STORAGE_BACKEND = 'local';
  process.env.APPHUB_JOB_BUNDLE_SIGNING_SECRET = 'sandbox-test-secret';
  process.env.APPHUB_JOB_BUNDLE_CACHE_DIR = bundleCacheDir;
  await ensureModulesLoaded();
}

async function publishTestBundle(spec: BundleSpec): Promise<void> {
  const artifact = await createBundleArtifact(spec);
  const checksum = createHash('sha256').update(artifact).digest('hex');
  const rawCapabilities = Array.isArray(spec.manifest.capabilities)
    ? (spec.manifest.capabilities as unknown[])
    : [];
  const manifestCapabilities = rawCapabilities
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  await registryModule!.publishBundleVersion(
    {
      slug: spec.slug,
      version: spec.version,
      manifest: spec.manifest,
      capabilityFlags: manifestCapabilities,
      artifact: {
        data: artifact,
        filename: `${spec.slug}-${spec.version}.tgz`,
        contentType: 'application/gzip',
        checksum
      }
    },
    {
      subject: 'sandbox-test'
    }
  );
}

async function runSandboxSuccessScenario(): Promise<void> {

  const handlerSource = `exports.handler = async function (context) {\n  context.logger('echo-handler start', { parameters: context.parameters });\n  await context.update({ context: { progress: 'halfway' } });\n  return {\n    status: 'succeeded',\n    result: { echoed: context.parameters },\n    metrics: { handler: 'ok' },\n    context: { notes: 'finished' }\n  };\n};\n`;

  await publishTestBundle({
    slug: 'sandbox-echo',
    version: '1.0.0',
    manifest: {
      name: 'Bundle sandbox-echo',
      version: '1.0.0',
      runtime: 'node18',
      entry: 'index.js',
      description: 'Sandbox test bundle',
      capabilities: []
    },
    files: {
      'index.js': handlerSource
    }
  });

  await jobsDbModule!.createJobDefinition({
    slug: 'sandbox-echo',
    name: 'Sandbox Echo',
    type: 'batch',
    entryPoint: 'bundle:sandbox-echo@1.0.0',
    parametersSchema: { type: 'object' },
    defaultParameters: {}
  });

  const run = await runtimeModule!.createJobRunForSlug('sandbox-echo', {
    parameters: { message: 'hello' }
  });

  const completed = await runtimeModule!.executeJobRun(run.id);
  assert(completed);
  assert.equal(completed.status, 'succeeded');
  assert.deepEqual(completed.result, { echoed: { message: 'hello' } });

  assert(completed.metrics && typeof completed.metrics === 'object');
  const metrics = completed.metrics as Record<string, any>;
  assert(metrics.sandbox);
  assert.equal(typeof metrics.sandbox.taskId, 'string');
  assert.equal(typeof metrics.sandbox.durationMs, 'number');

  const context = completed.context as Record<string, any>;
  assert(context.sandbox);
  assert(Array.isArray(context.sandbox.logs));
  assert(context.sandbox.logs.length >= 1);
  assert.equal(context.sandbox.truncatedLogCount, 0);
}

async function runPythonSandboxScenario(): Promise<void> {
  const handlerSource = `"""Sandbox Python handler"""\nimport asyncio\n\nasync def handler(context):\n    context.logger('python-handler start', {'parameters': context.parameters})\n    await context.update({'context': {'progress': 'py-halfway'}})\n    return {\n        'status': 'succeeded',\n        'result': {'echoed': context.parameters},\n        'metrics': {'handler': 'python-ok'},\n        'context': {'notes': 'python-finished'}\n    }\n`;

  await publishTestBundle({
    slug: 'sandbox-python',
    version: '1.0.0',
    manifest: {
      name: 'Bundle sandbox-python',
      version: '1.0.0',
      runtime: 'python3.11',
      pythonEntry: 'main.py',
      description: 'Sandbox test python bundle',
      capabilities: []
    },
    files: {
      'main.py': handlerSource
    }
  });

  await jobsDbModule!.createJobDefinition({
    slug: 'sandbox-python',
    name: 'Sandbox Python',
    type: 'batch',
    runtime: 'python',
    entryPoint: 'bundle:sandbox-python@1.0.0#handler',
    parametersSchema: { type: 'object' },
    defaultParameters: {}
  });

  const run = await runtimeModule!.createJobRunForSlug('sandbox-python', {
    parameters: { number: 42 }
  });

  const completed = await runtimeModule!.executeJobRun(run.id);
  assert(completed);
  assert.equal(completed.status, 'succeeded');
  assert.deepEqual(completed.result, { echoed: { number: 42 } });

  const metrics = completed.metrics as Record<string, any>;
  assert(metrics);
  assert(metrics.sandbox);
  assert.equal(metrics.handler, 'python-ok');

  const context = completed.context as Record<string, any>;
  assert(context);
  assert(context.sandbox);
  assert.equal(context.notes, 'python-finished');
}

async function runSandboxCapabilityViolationScenario(): Promise<void> {
  const handlerSource = `exports.handler = async function () {\n  const fs = require('fs');\n  return { status: 'succeeded', result: fs.existsSync('/') };\n};\n`;

  await publishTestBundle({
    slug: 'sandbox-fs',
    version: '1.0.0',
    manifest: {
      name: 'Bundle sandbox-fs',
      version: '1.0.0',
      runtime: 'node18',
      entry: 'index.js',
      description: 'Sandbox test bundle',
      capabilities: []
    },
    files: {
      'index.js': handlerSource
    }
  });

  await jobsDbModule!.createJobDefinition({
    slug: 'sandbox-fs',
    name: 'Sandbox FS Access',
    type: 'batch',
    entryPoint: 'bundle:sandbox-fs@1.0.0',
    parametersSchema: { type: 'object' },
    defaultParameters: {}
  });

  const run = await runtimeModule!.createJobRunForSlug('sandbox-fs', {
    parameters: {}
  });

  const completed = await runtimeModule!.executeJobRun(run.id);
  assert(completed);
  assert.equal(completed.status, 'failed');
  assert(completed.errorMessage && completed.errorMessage.includes("not authorized to require built-in module \"fs\""));
  const context = completed.context as Record<string, any>;
  assert(context.bundle);
  assert.equal(context.bundle.slug, 'sandbox-fs');
  assert.equal(context.bundle.version, '1.0.0');
}

async function cleanup(): Promise<void> {
  if (bundleStorageDir) {
    await rm(bundleStorageDir, { recursive: true, force: true });
    bundleStorageDir = null;
  }
  if (bundleCacheDir) {
    await rm(bundleCacheDir, { recursive: true, force: true });
    bundleCacheDir = null;
  }
  delete process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR;
  delete process.env.APPHUB_JOB_BUNDLE_STORAGE_BACKEND;
  delete process.env.APPHUB_JOB_BUNDLE_SIGNING_SECRET;
  delete process.env.APPHUB_JOB_BUNDLE_CACHE_DIR;
  if (dbModule) {
    await dbModule.closePool();
    dbModule = null;
  }
  runtimeModule = null;
  registryModule = null;
  jobsDbModule = null;
  if (embeddedPostgresCleanup) {
    await embeddedPostgresCleanup();
    embeddedPostgresCleanup = null;
  }
  embeddedPostgres = null;
}

runE2E(async ({ registerCleanup }) => {
  registerCleanup(() => cleanup());
  await setupSandboxEnvironment();
  await runSandboxSuccessScenario();
  await runPythonSandboxScenario();
  await runSandboxCapabilityViolationScenario();
}, { name: 'core-jobSandbox.e2e' });

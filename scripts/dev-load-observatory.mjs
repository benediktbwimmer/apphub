#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const MODULE_DIR = path.join(ROOT_DIR, 'modules', 'observatory');
const SCRATCH_ROOT_DEFAULT = path.join(ROOT_DIR, 'data', 'local', 'scratch');

function resolveScratchPrefixes(current, moduleDir) {
  const scratchEntries = [moduleDir, path.join(moduleDir, 'dist')];
  const normalized = current?.trim();
  return normalized && normalized.length > 0
    ? `${normalized}:${scratchEntries.join(':')}`
    : scratchEntries.join(':');
}

function configureArtifactStorage(env) {
  const useS3 =
    env.APPHUB_MODULE_ARTIFACT_STORAGE_BACKEND === 's3' ||
    env.APPHUB_BUNDLE_STORAGE_BACKEND === 's3' ||
    env.APPHUB_MODULE_ARTIFACT_BUCKET ||
    env.APPHUB_MODULE_ARTIFACT_S3_BUCKET ||
    env.APPHUB_BUNDLE_STORAGE_BUCKET ||
    env.APPHUB_JOB_BUNDLE_S3_BUCKET ||
    env.APPHUB_MODULE_ARTIFACT_ENDPOINT ||
    env.APPHUB_MODULE_ARTIFACT_S3_ENDPOINT ||
    env.APPHUB_BUNDLE_STORAGE_ENDPOINT ||
    env.APPHUB_JOB_BUNDLE_S3_ENDPOINT;

  if (!useS3) {
    return;
  }

  const bucket =
    env.APPHUB_MODULE_ARTIFACT_BUCKET?.trim() ||
    env.APPHUB_MODULE_ARTIFACT_S3_BUCKET?.trim() ||
    env.APPHUB_BUNDLE_STORAGE_BUCKET?.trim() ||
    env.APPHUB_JOB_BUNDLE_S3_BUCKET?.trim() ||
    'apphub-job-bundles';
  const endpoint =
    env.APPHUB_MODULE_ARTIFACT_ENDPOINT?.trim() ||
    env.APPHUB_MODULE_ARTIFACT_S3_ENDPOINT?.trim() ||
    env.APPHUB_BUNDLE_STORAGE_ENDPOINT?.trim() ||
    env.APPHUB_JOB_BUNDLE_S3_ENDPOINT?.trim() ||
    'http://127.0.0.1:9000';

  env.APPHUB_MODULE_ARTIFACT_STORAGE_BACKEND = 's3';
  env.APPHUB_MODULE_ARTIFACT_BUCKET = bucket;
  env.APPHUB_MODULE_ARTIFACT_REGION =
    env.APPHUB_MODULE_ARTIFACT_REGION?.trim() ||
    env.APPHUB_MODULE_ARTIFACT_S3_REGION?.trim() ||
    env.APPHUB_BUNDLE_STORAGE_REGION?.trim() ||
    'us-east-1';
  env.APPHUB_MODULE_ARTIFACT_ENDPOINT = endpoint;
  env.APPHUB_MODULE_ARTIFACT_FORCE_PATH_STYLE =
    env.APPHUB_MODULE_ARTIFACT_FORCE_PATH_STYLE ??
    env.APPHUB_MODULE_ARTIFACT_S3_FORCE_PATH_STYLE ??
    env.APPHUB_BUNDLE_STORAGE_FORCE_PATH_STYLE ??
    'true';
  env.APPHUB_MODULE_ARTIFACT_ACCESS_KEY_ID =
    env.APPHUB_MODULE_ARTIFACT_ACCESS_KEY_ID ??
    env.APPHUB_MODULE_ARTIFACT_S3_ACCESS_KEY_ID ??
    env.APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID ??
    env.APPHUB_JOB_BUNDLE_S3_ACCESS_KEY_ID ??
    'apphub';
  env.APPHUB_MODULE_ARTIFACT_SECRET_ACCESS_KEY =
    env.APPHUB_MODULE_ARTIFACT_SECRET_ACCESS_KEY ??
    env.APPHUB_MODULE_ARTIFACT_S3_SECRET_ACCESS_KEY ??
    env.APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY ??
    env.APPHUB_JOB_BUNDLE_S3_SECRET_ACCESS_KEY ??
    'apphub123';
  if (!env.APPHUB_MODULE_ARTIFACT_PREFIX) {
    env.APPHUB_MODULE_ARTIFACT_PREFIX = 'modules';
  }

  if (env.APPHUB_MODULE_ARTIFACT_STORAGE_BACKEND !== 's3') {
    env.APPHUB_SKIP_BUCKETS = env.APPHUB_SKIP_BUCKETS ?? '1';
  }
}

async function run() {
  if (!fs.existsSync(MODULE_DIR)) {
    console.error('[dev-load-observatory] Module directory not found at', MODULE_DIR);
    process.exitCode = 1;
    return;
  }

  const extraArgs = process.argv.slice(2);
  const resolvedModuleDir = path.resolve(MODULE_DIR);
  const coreUrl = (process.env.APPHUB_CORE_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
  const coreToken = (process.env.APPHUB_CORE_TOKEN ?? process.env.OBSERVATORY_CORE_TOKEN ?? 'dev-token').trim();

  if (process.env.OBSERVATORY_SKIP_BUILD !== '1') {
    const build = spawnSync('npm', ['run', 'build', '--workspace', '@apphub/observatory-module'], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: process.env
    });
    if (build.error) {
      throw build.error;
    }
    if (typeof build.status === 'number' && build.status !== 0) {
      process.exit(build.status);
      return;
    }
  }

  const runArgs = [
    '--enable-source-maps',
    '--import',
    'tsx',
    path.join('apps', 'cli', 'src', 'index.ts'),
    'module',
    'deploy',
    '--module',
    resolvedModuleDir,
    '--core-url',
    coreUrl,
    '--core-token',
    coreToken,
    ...extraArgs
  ];

  const env = {
    ...process.env,
    APPHUB_CORE_URL: coreUrl,
    APPHUB_CORE_TOKEN: coreToken,
    OBSERVATORY_CORE_TOKEN: process.env.OBSERVATORY_CORE_TOKEN ?? coreToken,
    APPHUB_SCRATCH_PREFIXES: resolveScratchPrefixes(process.env.APPHUB_SCRATCH_PREFIXES, resolvedModuleDir)
  };

  if (!env.APPHUB_SCRATCH_ROOT || env.APPHUB_SCRATCH_ROOT.trim() === '') {
    env.APPHUB_SCRATCH_ROOT = SCRATCH_ROOT_DEFAULT;
  }
  if (!env.APPHUB_RUNTIME_SCRATCH_ROOT || env.APPHUB_RUNTIME_SCRATCH_ROOT.trim() === '') {
    env.APPHUB_RUNTIME_SCRATCH_ROOT = env.APPHUB_SCRATCH_ROOT;
  }
  if (!env.OBSERVATORY_DATA_ROOT || env.OBSERVATORY_DATA_ROOT.trim() === '') {
    env.OBSERVATORY_DATA_ROOT = path.join(env.APPHUB_SCRATCH_ROOT, 'observatory');
  }
  if (!env.OBSERVATORY_CONFIG_OUTPUT || env.OBSERVATORY_CONFIG_OUTPUT.trim() === '') {
    env.OBSERVATORY_CONFIG_OUTPUT = path.join(env.OBSERVATORY_DATA_ROOT, 'config', 'observatory-config.json');
  }
  if (!env.REDIS_URL || env.REDIS_URL.trim() === '') {
    env.REDIS_URL = 'redis://127.0.0.1:6379';
  }
  if (!env.DATABASE_URL || env.DATABASE_URL.trim() === '') {
    env.DATABASE_URL = 'postgres://apphub:apphub@127.0.0.1:5432/apphub';
  }
  if (!env.APPHUB_ALLOW_INLINE_MODE || env.APPHUB_ALLOW_INLINE_MODE.trim() === '') {
    env.APPHUB_ALLOW_INLINE_MODE = '1';
  }
  if (!env.OBSERVATORY_FILESTORE_BASE_URL || env.OBSERVATORY_FILESTORE_BASE_URL.trim() === '') {
    env.OBSERVATORY_FILESTORE_BASE_URL = 'http://127.0.0.1:4300';
  }
  if (!env.OBSERVATORY_FILESTORE_BACKEND_KEY || env.OBSERVATORY_FILESTORE_BACKEND_KEY.trim() === '') {
    env.OBSERVATORY_FILESTORE_BACKEND_KEY = 'observatory-local';
  }
  if (!env.OBSERVATORY_FILESTORE_DEFAULT_KEY || env.OBSERVATORY_FILESTORE_DEFAULT_KEY.trim() === '') {
    env.OBSERVATORY_FILESTORE_DEFAULT_KEY = env.OBSERVATORY_FILESTORE_BACKEND_KEY;
  }

  if (!env.APPHUB_MODULE_ARTIFACT_STORAGE_BACKEND) {
    env.APPHUB_MODULE_ARTIFACT_STORAGE_BACKEND = 'inline';
  }
  configureArtifactStorage(env);
  if (env.APPHUB_MODULE_ARTIFACT_STORAGE_BACKEND === 'inline') {
    env.APPHUB_SKIP_BUCKETS = env.APPHUB_SKIP_BUCKETS ?? '1';
  }

  if (!env.APPHUB_AUTH_DISABLED || env.APPHUB_AUTH_DISABLED.trim() === '') {
    env.APPHUB_AUTH_DISABLED = '1';
  }

  const waitForPort = async (host, port, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const ok = await new Promise((resolve) => {
        const socket = net.createConnection({ host, port }, () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('error', () => {
          socket.destroy();
          resolve(false);
        });
        socket.setTimeout(2000, () => {
          socket.destroy();
          resolve(false);
        });
      });
      if (ok) {
        return;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${host}:${port}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };

  try {
    const parsed = new URL(coreUrl);
    const host = parsed.hostname || '127.0.0.1';
    const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
    console.log(`[dev-load-observatory] Waiting for Core API at ${host}:${port}...`);
    await waitForPort(host, port, 60_000);
    const healthUrl = `${coreUrl.replace(/\/+$/, '')}/health`;
    try {
      const res = await fetch(healthUrl, { method: 'GET' });
      if (!res.ok) {
        console.error(
          `[dev-load-observatory] Core health check failed (${res.status} ${res.statusText}). Start the stack (npm run local-dev) and retry.`
        );
        process.exit(1);
      }
    } catch (err) {
      console.error(
        '[dev-load-observatory] Core health check errored; is npm run local-dev running?',
        err?.message ?? err
      );
      process.exit(1);
    }
  } catch (err) {
    console.error('[dev-load-observatory] Unable to verify Core availability before deploy', err?.message ?? err);
    process.exit(1);
  }

  const label = path.relative(ROOT_DIR, resolvedModuleDir) || resolvedModuleDir;
  console.log(`[dev-load-observatory] Deploying module from ${label}`);

  const result = spawnSync('node', runArgs, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env
  });

  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

run().catch((err) => {
  console.error('[dev-load-observatory] Failed to publish module:', err?.message ?? err);
  process.exitCode = 1;
});

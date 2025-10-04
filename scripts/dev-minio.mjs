#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const dataDir = path.resolve(process.env.APPHUB_MINIO_DATA_DIR ?? path.join(ROOT, '.dev', 'minio'));
const containerName = process.env.APPHUB_MINIO_CONTAINER ?? 'apphub-dev-minio';
const image = process.env.APPHUB_MINIO_IMAGE ?? 'minio/minio:latest';
const mcImage = process.env.APPHUB_MINIO_MC_IMAGE ?? 'minio/mc:latest';
const rootUser = process.env.APPHUB_MINIO_ROOT_USER ?? 'apphub';
const rootPassword = process.env.APPHUB_MINIO_ROOT_PASSWORD ?? 'apphub123';
const apiPort = Number.parseInt(process.env.APPHUB_MINIO_PORT ?? '9000', 10) || 9000;
const consolePort = Number.parseInt(process.env.APPHUB_MINIO_CONSOLE_PORT ?? '9001', 10) || 9001;
const buckets = (process.env.APPHUB_MINIO_BUCKETS ?? 'apphub-job-bundles,apphub-filestore,apphub-timestore')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`Command ${command} ${args.join(' ')} exited with status ${result.status}`);
  }
}

function runDocker(args) {
  run('docker', args);
}

function dockerOutput(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    return '';
  }
  return result.stdout?.trim() ?? '';
}

function ensureDockerAvailable() {
  try {
    runDocker(['version', '--format', '{{.Server.Version}}']);
  } catch (error) {
    throw new Error('Docker CLI is required to run local MinIO. Install Docker Desktop or export APPHUB_MINIO_CONTAINER to an existing instance.');
  }
}

function ensureDataDirectory() {
  mkdirSync(dataDir, { recursive: true });
}

function containerExists() {
  const output = dockerOutput(['ps', '-a', '--filter', `name=^/${containerName}$`, '--format', '{{.Names}}']);
  return output.split('\n').some((line) => line.trim() === containerName);
}

function containerRunning() {
  const output = dockerOutput(['ps', '--filter', `name=^/${containerName}$`, '--format', '{{.Names}}']);
  return output.split('\n').some((line) => line.trim() === containerName);
}

function startContainer() {
  if (containerRunning()) {
    console.log(`[dev-minio] ${containerName} is already running.`);
    return;
  }

  if (containerExists()) {
    console.log(`[dev-minio] Starting existing container ${containerName}...`);
    runDocker(['start', containerName]);
    return;
  }

  console.log(`[dev-minio] Launching ${containerName} bound to ${apiPort}/tcp...`);
  runDocker([
    'run',
    '-d',
    '--name',
    containerName,
    '-p',
    `${apiPort}:9000`,
    '-p',
    `${consolePort}:9001`,
    '-e',
    `MINIO_ROOT_USER=${rootUser}`,
    '-e',
    `MINIO_ROOT_PASSWORD=${rootPassword}`,
    '-v',
    `${dataDir}:/data`,
    image,
    'server',
    '/data',
    '--address',
    ':9000',
    '--console-address',
    ':9001'
  ]);
}

function ensureBuckets() {
  if (buckets.length === 0) {
    return;
  }
  console.log('[dev-minio] Ensuring buckets exist...');
  const encodedUser = encodeURIComponent(rootUser);
  const encodedPassword = encodeURIComponent(rootPassword);
  const mcEndpointEnv = `MC_HOST_local=http://${encodedUser}:${encodedPassword}@127.0.0.1:9000`;

  const runMc = (...mcArgs) => {
    runDocker([
      'run',
      '--rm',
      '--network',
      `container:${containerName}`,
      '-e',
      mcEndpointEnv,
      mcImage,
      ...mcArgs
    ]);
  };
  for (const bucket of buckets) {
    runMc('mb', '--ignore-existing', `local/${bucket}`);
  }
  if (buckets.includes('apphub-job-bundles')) {
    try {
      runMc('anonymous', 'set', 'download', 'local/apphub-job-bundles');
    } catch (error) {
      console.warn('[dev-minio] Failed to set anonymous policy (non-fatal):', error?.message ?? error);
    }
  }
}

async function main() {
  ensureDockerAvailable();
  ensureDataDirectory();
  startContainer();
  ensureBuckets();
  console.log('[dev-minio] MinIO ready at http://127.0.0.1:' + apiPort);
}

main().catch((error) => {
  console.error('[dev-minio] Failed to start MinIO:', error.message ?? error);
  process.exitCode = 1;
});

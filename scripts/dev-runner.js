#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { concurrently } = require('concurrently');
const { runPreflight } = require('./dev-preflight');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_REDIS_URL = process.env.APPHUB_DEV_REDIS_URL ?? 'redis://127.0.0.1:6379';

const BASE_COMMANDS = [
  {
    name: 'redis',
    command: 'redis-server --save "" --appendonly no',
    cwd: ROOT_DIR
  },
  {
    name: 'api',
    command: 'npm run dev --workspace @apphub/catalog',
    cwd: ROOT_DIR,
    env: {
      PORT: '4000',
      HOST: '::'
    }
  },
  {
    name: 'worker',
    command: 'npm run ingest --workspace @apphub/catalog'
  },
  {
    name: 'builds',
    command: 'npm run builds --workspace @apphub/catalog'
  },
  {
    name: 'launches',
    command: 'npm run launches --workspace @apphub/catalog'
  },
  {
    name: 'workflows',
    command: 'npm run workflows --workspace @apphub/catalog'
  },
  {
    name: 'events',
    command: 'npm run events --workspace @apphub/catalog'
  },
  {
    name: 'event-triggers',
    command: 'npm run event-triggers --workspace @apphub/catalog'
  },
  {
    name: 'materializer',
    command: 'npm run materializer --workspace @apphub/catalog'
  },
  {
    name: 'examples',
    command: 'npm run examples --workspace @apphub/catalog'
  },
  {
    name: 'metastore',
    command: 'npm run dev --workspace @apphub/metastore'
  },
  {
    name: 'services',
    command: 'node scripts/dev-services.js'
  },
  {
    name: 'filestore',
    command: 'npm run dev --workspace @apphub/filestore'
  },
  {
    name: 'timestore',
    command: 'npm run dev --workspace @apphub/timestore'
  },
  {
    name: 'timestore:ingest',
    command: 'npm run ingest --workspace @apphub/timestore'
  },
  {
    name: 'timestore:partition',
    command: 'npm run partition-build --workspace @apphub/timestore'
  },
  {
    name: 'frontend',
    command: 'npm run dev --workspace @apphub/frontend'
  }
];

async function main() {
  let preflightResult;
  try {
    preflightResult = await runPreflight();
  } catch (err) {
    console.error('[dev-runner] ' + (err?.message ?? err));
    process.exit(1);
  }

  const baseEnv = { ...process.env };
  if (!baseEnv.NODE_ENV) {
    baseEnv.NODE_ENV = 'development';
  }
  if (!baseEnv.APPHUB_AUTH_DISABLED || baseEnv.APPHUB_AUTH_DISABLED.trim() === '') {
    baseEnv.APPHUB_AUTH_DISABLED = '1';
  }
  if (!baseEnv.APPHUB_SESSION_SECRET || baseEnv.APPHUB_SESSION_SECRET.trim() === '') {
    baseEnv.APPHUB_SESSION_SECRET = 'dev-session-secret';
  }
  const normalizedRedis = baseEnv.REDIS_URL?.trim();
  if (!normalizedRedis || normalizedRedis === '127.0.0.1' || normalizedRedis === 'localhost') {
    baseEnv.REDIS_URL = DEFAULT_REDIS_URL;
  }
  if (baseEnv.REDIS_URL && !/^redis:\/\//i.test(baseEnv.REDIS_URL)) {
    baseEnv.REDIS_URL = `redis://${baseEnv.REDIS_URL}`;
  }
  for (const alias of ['FILESTORE_REDIS_URL', 'METASTORE_REDIS_URL', 'TIMESTORE_REDIS_URL']) {
    if (!baseEnv[alias]) {
      baseEnv[alias] = baseEnv.REDIS_URL;
    }
  }
  if (!baseEnv.APPHUB_FILESTORE_BASE_URL) {
    baseEnv.APPHUB_FILESTORE_BASE_URL = 'http://127.0.0.1:4300';
  }
  if (!baseEnv.APPHUB_METASTORE_BASE_URL) {
    baseEnv.APPHUB_METASTORE_BASE_URL = 'http://127.0.0.1:4100';
  }

  const ensureEnv = (key, value) => {
    const current = baseEnv[key];
    if (typeof current !== 'string' || current.trim() === '') {
      baseEnv[key] = value;
    }
  };

  // Catalog bundle storage (example bundles + job bundles) now defaults to MinIO.
  ensureEnv('APPHUB_BUNDLE_STORAGE_BACKEND', 's3');
  ensureEnv('APPHUB_BUNDLE_STORAGE_BUCKET', 'apphub-example-bundles');
  ensureEnv('APPHUB_BUNDLE_STORAGE_ENDPOINT', 'http://127.0.0.1:9000');
  ensureEnv('APPHUB_BUNDLE_STORAGE_REGION', 'us-east-1');
  ensureEnv('APPHUB_BUNDLE_STORAGE_FORCE_PATH_STYLE', 'true');
  ensureEnv('APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID', 'apphub');
  ensureEnv('APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY', 'apphub123');

  ensureEnv('APPHUB_JOB_BUNDLE_STORAGE_BACKEND', 's3');
  ensureEnv('APPHUB_JOB_BUNDLE_S3_BUCKET', 'apphub-example-bundles');
  ensureEnv('APPHUB_JOB_BUNDLE_S3_ENDPOINT', 'http://127.0.0.1:9000');
  ensureEnv('APPHUB_JOB_BUNDLE_S3_REGION', 'us-east-1');
  ensureEnv('APPHUB_JOB_BUNDLE_S3_FORCE_PATH_STYLE', 'true');

  // Timestore partitions and exports rely on the shared MinIO instance as well.
  ensureEnv('TIMESTORE_STORAGE_DRIVER', 's3');
  ensureEnv('TIMESTORE_S3_BUCKET', 'apphub-timestore');
  ensureEnv('TIMESTORE_S3_ENDPOINT', 'http://127.0.0.1:9000');
  ensureEnv('TIMESTORE_S3_REGION', 'us-east-1');
  ensureEnv('TIMESTORE_S3_FORCE_PATH_STYLE', 'true');
  ensureEnv('TIMESTORE_S3_ACCESS_KEY_ID', baseEnv.TIMESTORE_S3_ACCESS_KEY_ID ?? baseEnv.APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID ?? 'apphub');
  ensureEnv('TIMESTORE_S3_SECRET_ACCESS_KEY', baseEnv.TIMESTORE_S3_SECRET_ACCESS_KEY ?? baseEnv.APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY ?? 'apphub123');

  // Provide defaults for observatory tooling that now provisions an S3-backed mount.
  ensureEnv('OBSERVATORY_FILESTORE_BASE_URL', baseEnv.APPHUB_FILESTORE_BASE_URL);
  ensureEnv('OBSERVATORY_FILESTORE_TOKEN', baseEnv.FILESTORE_TOKEN ?? '');
  ensureEnv('OBSERVATORY_FILESTORE_S3_BUCKET', 'apphub-filestore');
  ensureEnv('OBSERVATORY_FILESTORE_S3_ENDPOINT', 'http://127.0.0.1:9000');
  ensureEnv('OBSERVATORY_FILESTORE_S3_REGION', 'us-east-1');
  ensureEnv('OBSERVATORY_FILESTORE_S3_FORCE_PATH_STYLE', 'true');
  ensureEnv('OBSERVATORY_FILESTORE_S3_ACCESS_KEY_ID', baseEnv.APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID ?? 'apphub');
  ensureEnv('OBSERVATORY_FILESTORE_S3_SECRET_ACCESS_KEY', baseEnv.APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY ?? 'apphub123');

  const normalizeEnvValue = (value) => (typeof value === 'string' ? value.trim() : '');
  const tooling = preflightResult?.tooling ?? {};
  const preferKubernetes = normalizeEnvValue(baseEnv.APPHUB_DEV_FORCE_KUBERNETES) === '1';
  const preferDocker = normalizeEnvValue(baseEnv.APPHUB_DEV_FORCE_DOCKER) === '1';
  const buildMode = normalizeEnvValue(baseEnv.APPHUB_BUILD_EXECUTION_MODE);
  const launchMode = normalizeEnvValue(baseEnv.APPHUB_LAUNCH_EXECUTION_MODE);

  const kubernetesAvailable = preferKubernetes || (!preferDocker && tooling.kubectl?.available === true);
  const defaultExecutionMode = kubernetesAvailable ? 'kubernetes' : 'docker';
  let loggedFallback = false;

  if (!buildMode) {
    baseEnv.APPHUB_BUILD_EXECUTION_MODE = defaultExecutionMode;
    if (!kubernetesAvailable && tooling.kubectl?.reason && !loggedFallback) {
      console.log(`[dev-runner] Defaulting build execution mode to docker: ${tooling.kubectl.reason}.`);
      loggedFallback = true;
    }
  }

  if (!launchMode) {
    baseEnv.APPHUB_LAUNCH_EXECUTION_MODE = defaultExecutionMode;
    if (!kubernetesAvailable && tooling.kubectl?.reason && !loggedFallback) {
      console.log(`[dev-runner] Defaulting launch execution mode to docker: ${tooling.kubectl.reason}.`);
      loggedFallback = true;
    }
  }

  if (!kubernetesAvailable && tooling.docker?.available === false) {
    console.warn('[dev-runner] Docker CLI not detected; build jobs may fail. Install Docker or export APPHUB_BUILD_EXECUTION_MODE=kubernetes to opt back in.');
  }

  const commands = BASE_COMMANDS.filter((entry) => {
    if (entry.name === 'redis' && preflightResult?.skipRedis) {
      return false;
    }
    return true;
  }).map((entry) => ({
    ...entry,
    env: {
      ...baseEnv,
      ...(entry.env ?? {})
    },
    cwd: entry.cwd ?? ROOT_DIR
  }));

  if (commands.length === 0) {
    console.error('[dev-runner] No commands to execute.');
    process.exit(1);
  }

  const controller = concurrently(commands, {
    prefix: 'name',
    killOthersOn: ['failure', 'success'],
    restartTries: 0
  });

  const { commands: spawned, result } = controller;

  const terminate = (signal) => {
    for (const command of spawned) {
      if (command && typeof command.kill === 'function') {
        try {
          command.kill(signal);
        } catch (err) {
          if (err && err.code !== 'ESRCH') {
            console.warn(`[dev-runner] Failed to send ${signal} to ${command.name ?? 'command'}: ${err.message ?? err}`);
          }
        }
      }
    }
  };

  process.on('SIGINT', () => terminate('SIGINT'));
  process.on('SIGTERM', () => terminate('SIGTERM'));

  try {
    await result;
    process.exit(0);
  } catch (errors) {
    if (Array.isArray(errors)) {
      const allInterrupted = errors.every((event) => event?.killed || event?.signal);
      if (allInterrupted) {
        process.exit(0);
      }
      const first = errors.find((event) => typeof event.exitCode === 'number');
      if (first) {
        process.exit(first.exitCode);
      }
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[dev-runner] ' + (err?.message ?? err));
  process.exit(1);
});

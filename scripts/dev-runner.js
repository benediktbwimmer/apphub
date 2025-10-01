#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { concurrently, Logger } = require('concurrently');
const stripAnsi = require('strip-ansi');
const { runPreflight } = require('./dev-preflight');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEV_LOG_DIR = path.join(ROOT_DIR, 'logs', 'dev');

const sanitizeLogSlug = (value, index) => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `command-${index + 1}`;
};
const DEFAULT_REDIS_URL = process.env.APPHUB_DEV_REDIS_URL ?? 'redis://127.0.0.1:6379';

const BASE_COMMANDS = [
  {
    name: 'redis',
    command: 'redis-server --save "" --appendonly no',
    cwd: ROOT_DIR
  },
  {
    name: 'api',
    command: 'npm run dev --workspace @apphub/core',
    cwd: ROOT_DIR,
    env: {
      PORT: '4000',
      HOST: '::'
    }
  },
  {
    name: 'worker',
    command: 'npm run ingest --workspace @apphub/core'
  },
  {
    name: 'builds',
    command: 'npm run builds --workspace @apphub/core'
  },
  {
    name: 'launches',
    command: 'npm run launches --workspace @apphub/core'
  },
  {
    name: 'workflows',
    command: 'npm run workflows --workspace @apphub/core'
  },
  {
    name: 'events',
    command: 'npm run events --workspace @apphub/core'
  },
  {
    name: 'event-triggers',
    command: 'npm run event-triggers --workspace @apphub/core'
  },
  {
    name: 'materializer',
    command: 'npm run materializer --workspace @apphub/core'
  },
  {
    name: 'examples',
    command: 'npm run examples --workspace @apphub/core'
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

  // Core bundle storage (example bundles + job bundles) now defaults to MinIO.
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
  ensureEnv(
    'APPHUB_JOB_BUNDLE_S3_ACCESS_KEY_ID',
    baseEnv.APPHUB_JOB_BUNDLE_S3_ACCESS_KEY_ID ?? baseEnv.APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID ?? 'apphub'
  );
  ensureEnv(
    'APPHUB_JOB_BUNDLE_S3_SECRET_ACCESS_KEY',
    baseEnv.APPHUB_JOB_BUNDLE_S3_SECRET_ACCESS_KEY ?? baseEnv.APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY ?? 'apphub123'
  );

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

  const logNameUsage = new Map();
  const logFilesByIndex = new Map();
  commands.forEach((command, index) => {
    const label = command.name && command.name.trim() ? command.name : `command-${index + 1}`;
    const slug = sanitizeLogSlug(label, index);
    const usage = logNameUsage.get(slug) ?? 0;
    logNameUsage.set(slug, usage + 1);
    const suffix = usage === 0 ? '' : `-${usage + 1}`;
    const finalSlug = `${slug}${suffix}`;
    logFilesByIndex.set(index, {
      label,
      fileName: `${finalSlug}.log`,
      finalSlug
    });
  });

  await fsPromises.mkdir(DEV_LOG_DIR, { recursive: true });
  const relativeLogDir = path.relative(ROOT_DIR, DEV_LOG_DIR) || '.';
  const logger = new Logger({ prefixFormat: 'name' });
  const globalLogPath = path.join(DEV_LOG_DIR, '_dev-runner.log');
  const globalLogStream = fs.createWriteStream(globalLogPath, { flags: 'a' });
  const sessionHeader = `[dev-runner] Logging session started ${new Date().toISOString()}\n`;
  globalLogStream.write(sessionHeader);
  console.log(`[dev-runner] Writing service logs to ${relativeLogDir}.`);
  globalLogStream.write(`[dev-runner] Writing service logs to ${relativeLogDir}.\n`);
  for (const { label, fileName } of logFilesByIndex.values()) {
    const mappingLine = `[dev-runner]   ${label} -> ${path.join(relativeLogDir, fileName)}\n`;
    console.log(mappingLine.trimEnd());
    globalLogStream.write(mappingLine);
  }
  const commandLogStreams = new Map();

  const ensureCommandStream = (command) => {
    const key = command.index;
    if (commandLogStreams.has(key)) {
      return commandLogStreams.get(key);
    }
    const meta = logFilesByIndex.get(key);
    if (!meta) {
      return globalLogStream;
    }
    const stream = fs.createWriteStream(path.join(DEV_LOG_DIR, meta.fileName), { flags: 'a' });
    commandLogStreams.set(key, stream);
    return stream;
  };

  logger.output.subscribe(({ command, text }) => {
    const clean = stripAnsi(text);
    if (!globalLogStream.destroyed) {
      globalLogStream.write(clean);
    }
    if (command) {
      const stream = ensureCommandStream(command);
      if (!stream.destroyed) {
        stream.write(clean);
      }
    }
  });

  const controller = concurrently(commands, {
    prefix: 'name',
    killOthersOn: ['failure', 'success'],
    restartTries: 0,
    logger
  });

  const { commands: spawned, result } = controller;

  for (const command of spawned) {
    command.close.subscribe(() => {
      const stream = commandLogStreams.get(command.index);
      if (stream && !stream.destroyed) {
        stream.end();
      }
      commandLogStreams.delete(command.index);
    });
  }

  const finalizeLogging = async () => {
    const pending = [];
    for (const stream of commandLogStreams.values()) {
      if (stream && !stream.destroyed) {
        pending.push(new Promise((resolve) => stream.end(resolve)));
      }
    }
    if (!globalLogStream.destroyed) {
      pending.push(new Promise((resolve) => globalLogStream.end(resolve)));
    }
    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
  };

  const terminationTimers = new Set();
  let terminationRequested = false;
  let interruptCount = 0;

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

  const scheduleTermination = (signal, delay) => {
    const timer = setTimeout(() => {
      terminationTimers.delete(timer);
      terminate(signal);
    }, delay);
    terminationTimers.add(timer);
  };

  const clearTerminationTimers = () => {
    for (const timer of terminationTimers) {
      clearTimeout(timer);
    }
    terminationTimers.clear();
  };

  const handleTerminationRequest = (incomingSignal) => {
    let signal = incomingSignal;
    if (signal === 'SIGINT') {
      interruptCount += 1;
      if (interruptCount > 1) {
        signal = 'SIGKILL';
      }
    }

    terminate(signal);

    if (!terminationRequested) {
      terminationRequested = true;
      if (signal === 'SIGINT') {
        scheduleTermination('SIGTERM', 1500);
        scheduleTermination('SIGKILL', 4000);
      } else if (signal === 'SIGTERM') {
        scheduleTermination('SIGKILL', 3000);
      }
    }
  };

  process.on('SIGINT', () => handleTerminationRequest('SIGINT'));
  process.on('SIGTERM', () => handleTerminationRequest('SIGTERM'));

  const finalizeAndExit = (code) => {
    clearTerminationTimers();
    finalizeLogging()
      .catch((err) => {
        console.warn('[dev-runner] Failed to finalize logs', err);
      })
      .finally(() => {
        process.exit(code);
      });
  };

  let exitCode = 0;
  try {
    await result;
  } catch (errors) {
    if (Array.isArray(errors)) {
      const allInterrupted = errors.every((event) => event?.killed || event?.signal);
      if (!allInterrupted) {
        const first = errors.find((event) => typeof event.exitCode === 'number');
        exitCode = typeof first?.exitCode === 'number' ? first.exitCode : 1;
      }
    } else {
      exitCode = 1;
    }
  } finally {
    finalizeAndExit(exitCode);
  }
}

main().catch((err) => {
  console.error('[dev-runner] ' + (err?.message ?? err));
  process.exit(1);
});

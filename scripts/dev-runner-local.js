#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { concurrently, Logger } = require('concurrently');
const stripAnsi = require('strip-ansi');
const { runPreflight } = require('./dev-preflight');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEV_LOG_DIR = path.join(ROOT_DIR, 'logs', 'dev');
const LOCAL_DATA_DIR = path.join(ROOT_DIR, 'data', 'local');

const sanitizeLogSlug = (value, index) => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `command-${index + 1}`;
};

const DEFAULT_REDIS_URL = process.env.APPHUB_DEV_REDIS_URL ?? 'redis://127.0.0.1:6379';

const parsePort = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const LOCAL_POSTGRES = {
  host: process.env.APPHUB_DEV_POSTGRES_HOST ?? '127.0.0.1',
  port: parsePort(process.env.APPHUB_DEV_POSTGRES_PORT, 5432),
  user: process.env.APPHUB_DEV_POSTGRES_USER ?? 'apphub',
  password: process.env.APPHUB_DEV_POSTGRES_PASSWORD ?? 'apphub',
  database: process.env.APPHUB_DEV_POSTGRES_DB ?? 'apphub',
  dataDir: path.join(LOCAL_DATA_DIR, 'postgres')
};

const LOCAL_REDIS = {
  host: '127.0.0.1',
  port: 6379,
  dataDir: path.join(LOCAL_DATA_DIR, 'redis')
};

const LOCAL_STORAGE = {
  baseDir: path.join(LOCAL_DATA_DIR, 'storage'),
  buckets: ['apphub-job-bundles', 'apphub-filestore', 'apphub-timestore', 'apphub-flink-checkpoints']
};

const DEFAULT_DATABASE_URL = `postgres://${LOCAL_POSTGRES.user}:${encodeURIComponent(
  LOCAL_POSTGRES.password
)}@${LOCAL_POSTGRES.host}:${LOCAL_POSTGRES.port}/${LOCAL_POSTGRES.database}`;

function commandExists(command) {
  try {
    const result = spawnSync('which', [command], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

async function setupLocalStorage() {
  await fsPromises.mkdir(LOCAL_STORAGE.baseDir, { recursive: true });

  for (const bucket of LOCAL_STORAGE.buckets) {
    const bucketDir = path.join(LOCAL_STORAGE.baseDir, bucket);
    await fsPromises.mkdir(bucketDir, { recursive: true });
  }

  console.log(`[dev-runner-local] Created local storage directories in ${LOCAL_STORAGE.baseDir}`);
}

async function setupLocalPostgres() {
  try {
    await waitForPort(LOCAL_POSTGRES.host, LOCAL_POSTGRES.port, 1000, 'PostgreSQL');
    console.log('[dev-runner-local] PostgreSQL already running, skipping local setup');
    return null;
  } catch {
    // PostgreSQL not running, we continue to start it
  }

  if (!commandExists('postgres')) {
    console.warn('[dev-runner-local] PostgreSQL not found. The services will use embedded PostgreSQL instances.');
    console.warn('[dev-runner-local] For better performance, consider installing PostgreSQL and running it on port 5432.');
    return null;
  }

  await fsPromises.mkdir(LOCAL_POSTGRES.dataDir, { recursive: true });

  const pgVersionFile = path.join(LOCAL_POSTGRES.dataDir, 'PG_VERSION');
  if (!fs.existsSync(pgVersionFile)) {
    console.log('[dev-runner-local] Initializing PostgreSQL data directory...');
    const initResult = spawnSync('initdb', ['-D', LOCAL_POSTGRES.dataDir, '-U', LOCAL_POSTGRES.user], {
      stdio: 'inherit',
      env: { ...process.env, PGPASSWORD: LOCAL_POSTGRES.password }
    });

    if (initResult.status !== 0) {
      throw new Error('[dev-runner-local] Failed to initialize PostgreSQL data directory');
    }
  }

  console.log('[dev-runner-local] Starting local PostgreSQL...');
  const pgProcess = spawn('postgres', [
    '-D', LOCAL_POSTGRES.dataDir,
    '-p', LOCAL_POSTGRES.port.toString(),
    '-h', LOCAL_POSTGRES.host
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PGUSER: LOCAL_POSTGRES.user }
  });

  await waitForPort(LOCAL_POSTGRES.host, LOCAL_POSTGRES.port, 30000, 'PostgreSQL');

  await setupPostgresDatabase();

  return {
    process: pgProcess,
    cleanup: async () => {
      if (pgProcess && !pgProcess.killed) {
        pgProcess.kill('SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (!pgProcess.killed) {
          pgProcess.kill('SIGKILL');
        }
      }
    }
  };
}

async function setupPostgresDatabase() {
  try {
    const { Client } = require('pg');
    const client = new Client({
      host: LOCAL_POSTGRES.host,
      port: LOCAL_POSTGRES.port,
      user: 'postgres',
      database: 'postgres'
    });

    try {
      await client.connect();

      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${LOCAL_POSTGRES.user}') THEN
            CREATE ROLE "${LOCAL_POSTGRES.user}" LOGIN PASSWORD '${LOCAL_POSTGRES.password}' SUPERUSER CREATEDB CREATEROLE;
          END IF;
        END $$;
      `);

      const { rowCount } = await client.query(`SELECT 1 FROM pg_database WHERE datname = '${LOCAL_POSTGRES.database}'`);
      if (rowCount === 0) {
        await client.query(`CREATE DATABASE "${LOCAL_POSTGRES.database}" OWNER "${LOCAL_POSTGRES.user}"`);
        console.log(`[dev-runner-local] Created database ${LOCAL_POSTGRES.database}`);
      }
    } catch (err) {
      console.warn(`[dev-runner-local] Failed to setup PostgreSQL database: ${err.message}`);
    } finally {
      await client.end().catch(() => {});
    }
  } catch (err) {
    console.warn(`[dev-runner-local] pg module not available, skipping database setup: ${err.message}`);
  }
}

async function setupLocalRedis() {
  try {
    await waitForPort(LOCAL_REDIS.host, LOCAL_REDIS.port, 1000, 'Redis');
    console.log('[dev-runner-local] Redis already running, skipping local setup');
    return null;
  } catch {
    // Redis not running, we continue to start it
  }

  if (!commandExists('redis-server')) {
    throw new Error('[dev-runner-local] Redis not found. Please install Redis or ensure it\'s running on port 6379');
  }

  await fsPromises.mkdir(LOCAL_REDIS.dataDir, { recursive: true });

  console.log('[dev-runner-local] Starting local Redis...');
  const redisProcess = spawn('redis-server', [
    '--dir', LOCAL_REDIS.dataDir,
    '--port', LOCAL_REDIS.port.toString(),
    '--bind', LOCAL_REDIS.host,
    '--save', '""',
    '--appendonly', 'no'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await waitForPort(LOCAL_REDIS.host, LOCAL_REDIS.port, 10000, 'Redis');

  return {
    process: redisProcess,
    cleanup: async () => {
      if (redisProcess && !redisProcess.killed) {
        redisProcess.kill('SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (!redisProcess.killed) {
          redisProcess.kill('SIGKILL');
        }
      }
    }
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPort(host, port, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const attempt = await new Promise((resolve) => {
      const socket = net.connect({ host, port });
      const done = (success) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(success);
      };
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
      socket.setTimeout(2000);
    });
    if (attempt) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`[dev-runner-local] Timed out waiting for ${label} on ${host}:${port}`);
    }
    await sleep(500);
  }
}

const BASE_COMMANDS = [
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
    name: 'module-services',
    command: 'npm run module:services --workspace @apphub/core'
  },
  {
    name: 'materializer',
    command: 'npm run materializer --workspace @apphub/core'
  },
  {
    name: 'metastore',
    command: 'npm run dev --workspace @apphub/metastore'
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
  console.log('[dev-runner-local] Starting local development environment...');

  await fsPromises.mkdir(LOCAL_DATA_DIR, { recursive: true });
  await fsPromises.mkdir(DEV_LOG_DIR, { recursive: true });

  await setupLocalStorage();

  const localServices = [];

  try {
    const pgService = await setupLocalPostgres();
    if (pgService) {
      localServices.push(pgService);
    }

    const redisService = await setupLocalRedis();
    if (redisService) {
      localServices.push(redisService);
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

    baseEnv.DATABASE_URL = baseEnv.DATABASE_URL ?? DEFAULT_DATABASE_URL;
    for (const alias of ['FILESTORE_DATABASE_URL', 'METASTORE_DATABASE_URL', 'TIMESTORE_DATABASE_URL']) {
      if (!baseEnv[alias]) {
        baseEnv[alias] = baseEnv.DATABASE_URL;
      }
    }
    baseEnv.PGHOST = LOCAL_POSTGRES.host;
    baseEnv.PGPORT = String(LOCAL_POSTGRES.port);
    baseEnv.PGUSER = LOCAL_POSTGRES.user;
    baseEnv.PGPASSWORD = LOCAL_POSTGRES.password;
    baseEnv.PGDATABASE = LOCAL_POSTGRES.database;

    baseEnv.REDIS_URL = DEFAULT_REDIS_URL;
    for (const alias of ['FILESTORE_REDIS_URL', 'METASTORE_REDIS_URL', 'TIMESTORE_REDIS_URL']) {
      if (!baseEnv[alias]) {
        baseEnv[alias] = baseEnv.REDIS_URL;
      }
    }

    baseEnv.APPHUB_BUNDLE_STORAGE_BACKEND = 'local';
    baseEnv.APPHUB_BUNDLE_STORAGE_PATH = path.join(LOCAL_STORAGE.baseDir, 'apphub-job-bundles');

    baseEnv.APPHUB_JOB_BUNDLE_STORAGE_BACKEND = 'local';
    baseEnv.APPHUB_JOB_BUNDLE_LOCAL_PATH = path.join(LOCAL_STORAGE.baseDir, 'apphub-job-bundles');

    baseEnv.TIMESTORE_STORAGE_DRIVER = 'local';
    baseEnv.TIMESTORE_LOCAL_PATH = path.join(LOCAL_STORAGE.baseDir, 'apphub-timestore');

    baseEnv.APPHUB_FILESTORE_BASE_URL = 'http://127.0.0.1:4200';
    baseEnv.APPHUB_METASTORE_BASE_URL = 'http://127.0.0.1:4100';

    baseEnv.APPHUB_STREAMING_ENABLED = 'false';

    baseEnv.APPHUB_BUILD_EXECUTION_MODE = 'local';
    baseEnv.APPHUB_LAUNCH_EXECUTION_MODE = 'local';

    const commands = BASE_COMMANDS.map((entry) => ({
      ...entry,
      env: {
        ...baseEnv,
        ...(entry.env ?? {})
      },
      cwd: entry.cwd ?? ROOT_DIR
    }));

    if (commands.length === 0) {
      console.error('[dev-runner-local] No commands to execute.');
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

    const relativeLogDir = path.relative(ROOT_DIR, DEV_LOG_DIR) || '.';
    const logger = new Logger({ prefixFormat: 'name' });
    const globalLogPath = path.join(DEV_LOG_DIR, '_dev-runner-local.log');
    const globalLogStream = fs.createWriteStream(globalLogPath, { flags: 'a' });
    const sessionHeader = `[dev-runner-local] Logging session started ${new Date().toISOString()}\n`;
    globalLogStream.write(sessionHeader);
    console.log(`[dev-runner-local] Writing service logs to ${relativeLogDir}.`);
    globalLogStream.write(`[dev-runner-local] Writing service logs to ${relativeLogDir}.\n`);

    for (const { label, fileName } of logFilesByIndex.values()) {
      const mappingLine = `[dev-runner-local]   ${label} -> ${path.join(relativeLogDir, fileName)}\n`;
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

    const terminate = (signal) => {
      for (const command of spawned) {
        if (command && typeof command.kill === 'function') {
          try {
            command.kill(signal);
          } catch (err) {
            if (err && err.code !== 'ESRCH') {
              console.warn(`[dev-runner-local] Failed to send ${signal} to ${command.name ?? 'command'}: ${err.message ?? err}`);
            }
          }
        }
      }
    };

    const cleanup = async () => {
      console.log('[dev-runner-local] Cleaning up local services...');

      terminate('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 2000));
      terminate('SIGKILL');

      for (const service of localServices.reverse()) {
        try {
          await service.cleanup();
        } catch (err) {
          console.warn(`[dev-runner-local] Failed to cleanup service: ${err.message}`);
        }
      }

      await finalizeLogging();
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

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
      await cleanup();
      process.exit(exitCode);
    }

  } catch (err) {
    console.error('[dev-runner-local] Setup failed:', err.message);

    for (const service of localServices.reverse()) {
      try {
        await service.cleanup();
      } catch (cleanupErr) {
        console.warn(`[dev-runner-local] Failed to cleanup service: ${cleanupErr.message}`);
      }
    }

    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[dev-runner-local] ' + (err?.message ?? err));
  process.exit(1);
});

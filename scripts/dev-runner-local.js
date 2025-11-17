#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { concurrently, Logger } = require('concurrently');
const stripAnsi = require('strip-ansi');
const { runPreflight } = require('./dev-preflight');
const { startResourceMonitor } = require('./dev-resource-monitor');

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

const parseBooleanFlag = (value) => {
  if (!value || typeof value !== 'string') {
    return false;
  }
  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    default:
      return false;
  }
};

const LOCAL_POSTGRES = {
  host: process.env.APPHUB_DEV_POSTGRES_HOST ?? '127.0.0.1',
  port: parsePort(process.env.APPHUB_DEV_POSTGRES_PORT, 5432),
  user: process.env.APPHUB_DEV_POSTGRES_USER ?? 'apphub',
  password: process.env.APPHUB_DEV_POSTGRES_PASSWORD ?? 'apphub',
  database: process.env.APPHUB_DEV_POSTGRES_DB ?? 'apphub'
};

const DEFAULT_POSTGRES_IMAGE = process.env.APPHUB_DEV_POSTGRES_IMAGE || 'postgres:16-alpine';
const DEFAULT_POSTGRES_CONTAINER = process.env.APPHUB_DEV_POSTGRES_CONTAINER || 'apphub-local-postgres';

const LOCAL_REDIS = {
  host: '127.0.0.1',
  port: 6379
};

const DEFAULT_REDIS_IMAGE = process.env.APPHUB_DEV_REDIS_IMAGE || 'redis:7-alpine';
const DEFAULT_REDIS_CONTAINER = process.env.APPHUB_DEV_REDIS_CONTAINER || 'apphub-local-redis';

const LOCAL_STORAGE = {
  baseDir: path.join(LOCAL_DATA_DIR, 'storage'),
  buckets: ['apphub-job-bundles', 'apphub-filestore', 'apphub-timestore', 'apphub-flink-checkpoints'],
  scratchDir: path.join(LOCAL_DATA_DIR, 'scratch')
};

const DEFAULT_CLICKHOUSE_IMAGE = process.env.APPHUB_DEV_CLICKHOUSE_IMAGE || 'clickhouse/clickhouse-server:24.11';

function resolveClickhouseConfigDir() {
  const override = process.env.APPHUB_DEV_CLICKHOUSE_CONFIG_DIR;
  if (override && override.trim()) {
    const candidate = override.trim();
    return path.isAbsolute(candidate) ? candidate : path.join(ROOT_DIR, candidate);
  }
  const localConfigDir = path.join(ROOT_DIR, 'docker', 'clickhouse', 'local-config.d');
  if (fs.existsSync(localConfigDir)) {
    return localConfigDir;
  }
  return path.join(ROOT_DIR, 'docker', 'clickhouse', 'config.d');
}

const LOCAL_CLICKHOUSE = {
  host: process.env.APPHUB_DEV_CLICKHOUSE_HOST ?? '127.0.0.1',
  httpPort: parsePort(process.env.APPHUB_DEV_CLICKHOUSE_HTTP_PORT, 8123),
  nativePort: parsePort(process.env.APPHUB_DEV_CLICKHOUSE_NATIVE_PORT, 9000),
  user: process.env.APPHUB_DEV_CLICKHOUSE_USER ?? process.env.TIMESTORE_CLICKHOUSE_USER ?? 'apphub',
  password: process.env.APPHUB_DEV_CLICKHOUSE_PASSWORD ?? process.env.TIMESTORE_CLICKHOUSE_PASSWORD ?? 'apphub',
  database: process.env.APPHUB_DEV_CLICKHOUSE_DATABASE ?? process.env.TIMESTORE_CLICKHOUSE_DATABASE ?? 'apphub',
  containerName: process.env.APPHUB_DEV_CLICKHOUSE_CONTAINER ?? 'apphub-local-clickhouse',
  dataDir: path.join(LOCAL_DATA_DIR, 'clickhouse'),
  configDir: resolveClickhouseConfigDir()
};

async function setupLocalStorage() {
  await fsPromises.mkdir(LOCAL_STORAGE.baseDir, { recursive: true });
  await fsPromises.mkdir(LOCAL_STORAGE.scratchDir, { recursive: true });

  for (const bucket of LOCAL_STORAGE.buckets) {
    const bucketDir = path.join(LOCAL_STORAGE.baseDir, bucket);
    await fsPromises.mkdir(bucketDir, { recursive: true });
  }

  console.log(`[dev-runner-local] Created local storage directories in ${LOCAL_STORAGE.baseDir}`);
}

function buildDatabaseUrl(config = LOCAL_POSTGRES) {
  return `postgres://${config.user}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${config.database}`;
}

function isPortAvailable(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      server.close(() => resolve(false));
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen({ host, port });
  });
}

async function findAvailablePort(startPort, host) {
  const MIN_PORT = 1025;
  const MAX_PORT = 65535;
  const attempts = 20;
  let candidate = Math.max(MIN_PORT, startPort);

  for (let i = 0; i < attempts && candidate <= MAX_PORT; i += 1, candidate += 1) {
    // eslint-disable-next-line no-await-in-loop
    const available = await isPortAvailable(candidate, host);
    if (available) {
      return candidate;
    }
  }

  throw new Error(`[dev-runner-local] Unable to find available PostgreSQL port near ${startPort}`);
}

async function canConnectWithManagedCredentials({ host, port, user, password }) {
  try {
    const { Client } = require('pg');
    const client = new Client({ host, port, user, password, database: 'postgres' });
    try {
      await client.connect();
      await client.end();
      return true;
    } catch (err) {
      await client.end().catch(() => undefined);
      if (err && err.code === '28P01') {
        return false;
      }
      if (err && err.code === '3D000') {
        // Database missing but credentials work; we will handle database creation later.
        return true;
      }
      return false;
    }
  } catch (err) {
    console.warn('[dev-runner-local] Unable to verify PostgreSQL credentials:', err?.message ?? err);
    return false;
  }
}

function ensureDockerAvailable() {
  try {
    const { status } = spawnSync('docker', ['info'], { stdio: 'ignore' });
    return status === 0;
  } catch {
    return false;
  }
}

function startDockerContainer({ name, image, args }) {
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  const run = spawnSync('docker', ['run', '--detach', '--name', name, ...args, image], { encoding: 'utf8' });
  if (typeof run.status !== 'number' || run.status !== 0) {
    const stderr = run.stderr?.trim();
    const stdout = run.stdout?.trim();
    throw new Error(stderr || stdout || 'unknown error');
  }
  return run.stdout?.trim() || name;
}

async function startDockerPostgres(port) {
  await fsPromises.mkdir(path.join(LOCAL_DATA_DIR, 'postgres'), { recursive: true });
  const args = [
    '--pull', 'missing',
    '-p', `${port}:5432`,
    '-e', `POSTGRES_USER=${LOCAL_POSTGRES.user}`,
    '-e', `POSTGRES_PASSWORD=${LOCAL_POSTGRES.password}`,
    '-e', `POSTGRES_DB=${LOCAL_POSTGRES.database}`,
    '-v', `${path.join(LOCAL_DATA_DIR, 'postgres')}:/var/lib/postgresql/data`
  ];
  const containerId = startDockerContainer({ name: DEFAULT_POSTGRES_CONTAINER, image: DEFAULT_POSTGRES_IMAGE, args });
  await waitForPort(LOCAL_POSTGRES.host, port, 60000, 'PostgreSQL (docker)');
  console.log(`[dev-runner-local] PostgreSQL container ready (${containerId}).`);
  await sleep(3000);
  return {
    cleanup: async () => {
      spawnSync('docker', ['stop', '-t', '5', DEFAULT_POSTGRES_CONTAINER], { stdio: 'ignore' });
      spawnSync('docker', ['rm', '-f', DEFAULT_POSTGRES_CONTAINER], { stdio: 'ignore' });
    }
  };
}

async function startDockerRedis(port) {
  const args = ['--pull', 'missing', '-p', `${port}:6379`];
  const containerId = startDockerContainer({ name: DEFAULT_REDIS_CONTAINER, image: DEFAULT_REDIS_IMAGE, args });
  await waitForPort(LOCAL_REDIS.host, port, 20000, 'Redis (docker)');
  console.log(`[dev-runner-local] Redis container ready (${containerId}).`);
  await sleep(1000);
  return {
    cleanup: async () => {
      spawnSync('docker', ['stop', '-t', '5', DEFAULT_REDIS_CONTAINER], { stdio: 'ignore' });
      spawnSync('docker', ['rm', '-f', DEFAULT_REDIS_CONTAINER], { stdio: 'ignore' });
    }
  };
}

async function setupLocalPostgres({ dockerAvailable }) {
  const host = LOCAL_POSTGRES.host;
  const port = LOCAL_POSTGRES.port;

  if (await isPortAvailable(port, host)) {
    if (dockerAvailable) {
      console.log(`[dev-runner-local] PostgreSQL not detected on ${host}:${port}; starting local container.`);
      return startDockerPostgres(port);
    }
    throw new Error(
      `[dev-runner-local] PostgreSQL is not listening on ${host}:${port}. Install and start PostgreSQL (e.g. 'brew services start postgresql@16' or 'docker run -p ${port}:5432 ${DEFAULT_POSTGRES_IMAGE}'), or point APPHUB_DEV_POSTGRES_* at a reachable database.`
    );
  }

  try {
    const { Client } = require('pg');
    const clientConfig = {
      host,
      port,
      user: LOCAL_POSTGRES.user,
      database: LOCAL_POSTGRES.database
    };
    if (LOCAL_POSTGRES.password) {
      clientConfig.password = LOCAL_POSTGRES.password;
    }
    const client = new Client(clientConfig);
    await client.connect();
    await client.end();
    console.log(
      `[dev-runner-local] Using PostgreSQL at ${host}:${port} (database ${LOCAL_POSTGRES.database}).`
    );
  } catch (err) {
    const detail = err && err.message ? err.message : err;
    throw new Error(
      `[dev-runner-local] Unable to authenticate with PostgreSQL at ${host}:${port}: ${detail}. Ensure the database/user exist or update APPHUB_DEV_POSTGRES_* environment variables.`
    );
  }

  return null;
}

async function setupLocalRedis({ dockerAvailable }) {
  try {
    await waitForPort(LOCAL_REDIS.host, LOCAL_REDIS.port, 1000, 'Redis');
    console.log(`[dev-runner-local] Using Redis at ${LOCAL_REDIS.host}:${LOCAL_REDIS.port}.`);
    return null;
  } catch {
    if (dockerAvailable) {
      console.log(`[dev-runner-local] Redis not detected on ${LOCAL_REDIS.host}:${LOCAL_REDIS.port}; starting local container.`);
      return startDockerRedis(LOCAL_REDIS.port);
    }
    throw new Error(
      `[dev-runner-local] Redis is not reachable at ${LOCAL_REDIS.host}:${LOCAL_REDIS.port}. Install and start Redis (e.g. 'brew services start redis' or 'docker run -p ${LOCAL_REDIS.port}:6379 ${DEFAULT_REDIS_IMAGE}'), or set APPHUB_DEV_REDIS_URL to a reachable instance.`
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setupLocalClickhouse({ dockerAvailable }) {
  if (parseBooleanFlag(process.env.APPHUB_DEV_CLICKHOUSE_SKIP)) {
    console.log('[dev-runner-local] Skipping local ClickHouse because APPHUB_DEV_CLICKHOUSE_SKIP is set.');
    return null;
  }

  const explicitHost = process.env.TIMESTORE_CLICKHOUSE_HOST?.trim();
  if (explicitHost && explicitHost !== 'clickhouse' && explicitHost !== LOCAL_CLICKHOUSE.host) {
    console.log(`[dev-runner-local] Using external ClickHouse at ${explicitHost}.`);
    return null;
  }

  const httpAvailable = await isPortAvailable(LOCAL_CLICKHOUSE.httpPort, LOCAL_CLICKHOUSE.host);
  const nativeAvailable = await isPortAvailable(LOCAL_CLICKHOUSE.nativePort, LOCAL_CLICKHOUSE.host);
  if (!httpAvailable || !nativeAvailable) {
    console.log(
      `[dev-runner-local] Detected ClickHouse on ${LOCAL_CLICKHOUSE.host}:${LOCAL_CLICKHOUSE.httpPort}; skipping bundled container.`
    );
    return null;
  }

  if (!dockerAvailable) {
    throw new Error(
      '[dev-runner-local] Docker CLI unavailable. Install Docker or point TIMESTORE_CLICKHOUSE_HOST at an existing ClickHouse endpoint.'
    );
  }

  await fsPromises.mkdir(LOCAL_CLICKHOUSE.dataDir, { recursive: true });

  console.log('[dev-runner-local] Starting local ClickHouse container...');
  spawnSync('docker', ['rm', '-f', LOCAL_CLICKHOUSE.containerName], { stdio: 'ignore' });

  const args = [
    'run',
    '--detach',
    '--name',
    LOCAL_CLICKHOUSE.containerName,
    '--pull',
    'missing',
    '-p',
    `${LOCAL_CLICKHOUSE.httpPort}:8123`,
    '-p',
    `${LOCAL_CLICKHOUSE.nativePort}:9000`,
    '-e',
    `CLICKHOUSE_DB=${LOCAL_CLICKHOUSE.database}`,
    '-e',
    `CLICKHOUSE_USER=${LOCAL_CLICKHOUSE.user}`,
    '-e',
    `CLICKHOUSE_PASSWORD=${LOCAL_CLICKHOUSE.password}`,
    '-e',
    'CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1',
    '-v',
    `${LOCAL_CLICKHOUSE.dataDir}:/var/lib/clickhouse`
  ];

  if (fs.existsSync(LOCAL_CLICKHOUSE.configDir)) {
    args.push('-v', `${LOCAL_CLICKHOUSE.configDir}:/etc/clickhouse-server/config.d:ro`);
  }

  args.push(DEFAULT_CLICKHOUSE_IMAGE);

  const run = spawnSync('docker', args, { encoding: 'utf8' });
  if (typeof run.status !== 'number' || run.status !== 0) {
    const stderr = run.stderr?.trim();
    const stdout = run.stdout?.trim();
    throw new Error(
      `[dev-runner-local] Failed to start ClickHouse container: ${stderr || stdout || 'unknown error'}`
    );
  }

  const containerId = run.stdout?.trim() || LOCAL_CLICKHOUSE.containerName;

  try {
    await waitForPort(LOCAL_CLICKHOUSE.host, LOCAL_CLICKHOUSE.httpPort, 60000, 'ClickHouse');
  } catch (err) {
    spawnSync('docker', ['rm', '-f', LOCAL_CLICKHOUSE.containerName], { stdio: 'ignore' });
    throw err;
  }

  console.log(`[dev-runner-local] ClickHouse container ready (${containerId}).`);

  return {
    cleanup: async () => {
      spawnSync('docker', ['stop', '-t', '5', LOCAL_CLICKHOUSE.containerName], { stdio: 'ignore' });
      spawnSync('docker', ['rm', '-f', LOCAL_CLICKHOUSE.containerName], { stdio: 'ignore' });
    }
  };
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
    name: 'frontend',
    command: 'npm run dev --workspace @apphub/frontend'
  }
];

async function main() {
  console.log('[dev-runner-local] Starting local development environment...');

  let preflightResult;
  try {
    preflightResult = await runPreflight();
  } catch (err) {
    console.error('[dev-runner-local] ' + (err?.message ?? err));
    process.exit(1);
  }
  const skipRedis = Boolean(preflightResult?.skipRedis);
  const dockerAvailable = Boolean(
    (preflightResult?.tooling?.docker?.available ?? false) || ensureDockerAvailable()
  );

  await fsPromises.mkdir(LOCAL_DATA_DIR, { recursive: true });
  await fsPromises.mkdir(DEV_LOG_DIR, { recursive: true });

  await setupLocalStorage();

  const localServices = [];

  try {
    const setDefaultEnv = (env, key, value) => {
      if (typeof env[key] !== 'string' || env[key].trim() === '') {
        env[key] = value;
      }
    };

    const pgService = await setupLocalPostgres({ dockerAvailable });
    if (pgService) {
      localServices.push(pgService);
    }

    if (skipRedis) {
      console.log('[dev-runner-local] Using Redis detected during preflight.');
    }
    const redisService = await setupLocalRedis({ dockerAvailable });
    if (redisService) {
      localServices.push(redisService);
    }

    const clickhouseService = await setupLocalClickhouse({ dockerAvailable });
    if (clickhouseService) {
      localServices.push(clickhouseService);
    }

    const defaultDatabaseUrl = buildDatabaseUrl();

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

    baseEnv.DATABASE_URL = baseEnv.DATABASE_URL ?? defaultDatabaseUrl;
    for (const alias of ['FILESTORE_DATABASE_URL', 'METASTORE_DATABASE_URL', 'TIMESTORE_DATABASE_URL']) {
      if (!baseEnv[alias]) {
        baseEnv[alias] = baseEnv.DATABASE_URL ?? defaultDatabaseUrl;
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

    if (!baseEnv.APPHUB_SCRATCH_ROOT || baseEnv.APPHUB_SCRATCH_ROOT.trim() === '') {
      baseEnv.APPHUB_SCRATCH_ROOT = LOCAL_STORAGE.scratchDir;
    }
    const scratchPrefixes = new Set(
      (baseEnv.APPHUB_SCRATCH_PREFIXES ? baseEnv.APPHUB_SCRATCH_PREFIXES.split(':') : [])
        .map((entry) => entry.trim())
        .filter(Boolean)
    );
    scratchPrefixes.add(LOCAL_STORAGE.scratchDir);
    baseEnv.APPHUB_SCRATCH_PREFIXES = Array.from(scratchPrefixes).join(':');

    baseEnv.APPHUB_BUNDLE_STORAGE_BACKEND = 'local';
    baseEnv.APPHUB_BUNDLE_STORAGE_PATH = path.join(LOCAL_STORAGE.baseDir, 'apphub-job-bundles');

    baseEnv.APPHUB_JOB_BUNDLE_STORAGE_BACKEND = 'local';
    baseEnv.APPHUB_JOB_BUNDLE_LOCAL_PATH = path.join(LOCAL_STORAGE.baseDir, 'apphub-job-bundles');

    baseEnv.TIMESTORE_STORAGE_DRIVER = 'local';
    baseEnv.TIMESTORE_LOCAL_PATH = path.join(LOCAL_STORAGE.baseDir, 'apphub-timestore');
    if (!baseEnv.TIMESTORE_CLICKHOUSE_HOST || baseEnv.TIMESTORE_CLICKHOUSE_HOST.trim() === '' || baseEnv.TIMESTORE_CLICKHOUSE_HOST === 'clickhouse') {
      baseEnv.TIMESTORE_CLICKHOUSE_HOST = LOCAL_CLICKHOUSE.host;
    }
    if (!baseEnv.TIMESTORE_CLICKHOUSE_HTTP_PORT || baseEnv.TIMESTORE_CLICKHOUSE_HTTP_PORT.trim() === '') {
      baseEnv.TIMESTORE_CLICKHOUSE_HTTP_PORT = String(LOCAL_CLICKHOUSE.httpPort);
    }
    if (!baseEnv.TIMESTORE_CLICKHOUSE_NATIVE_PORT || baseEnv.TIMESTORE_CLICKHOUSE_NATIVE_PORT.trim() === '') {
      baseEnv.TIMESTORE_CLICKHOUSE_NATIVE_PORT = String(LOCAL_CLICKHOUSE.nativePort);
    }
    if (!baseEnv.TIMESTORE_CLICKHOUSE_USER || baseEnv.TIMESTORE_CLICKHOUSE_USER.trim() === '') {
      baseEnv.TIMESTORE_CLICKHOUSE_USER = LOCAL_CLICKHOUSE.user;
    }
    if (!baseEnv.TIMESTORE_CLICKHOUSE_PASSWORD || baseEnv.TIMESTORE_CLICKHOUSE_PASSWORD.trim() === '') {
      baseEnv.TIMESTORE_CLICKHOUSE_PASSWORD = LOCAL_CLICKHOUSE.password;
    }
    if (!baseEnv.TIMESTORE_CLICKHOUSE_DATABASE || baseEnv.TIMESTORE_CLICKHOUSE_DATABASE.trim() === '') {
      baseEnv.TIMESTORE_CLICKHOUSE_DATABASE = LOCAL_CLICKHOUSE.database;
    }
    if (!baseEnv.TIMESTORE_CLICKHOUSE_SECURE || baseEnv.TIMESTORE_CLICKHOUSE_SECURE.trim() === '') {
      baseEnv.TIMESTORE_CLICKHOUSE_SECURE = 'false';
    }

    baseEnv.APPHUB_FILESTORE_BASE_URL = 'http://127.0.0.1:4300';
    baseEnv.APPHUB_METASTORE_BASE_URL = 'http://127.0.0.1:4100';

    const filestoreRoot = path.join(LOCAL_STORAGE.baseDir, 'apphub-filestore');
    if (!baseEnv.OBSERVATORY_FILESTORE_BASE_URL || baseEnv.OBSERVATORY_FILESTORE_BASE_URL.trim() === '') {
      baseEnv.OBSERVATORY_FILESTORE_BASE_URL = baseEnv.APPHUB_FILESTORE_BASE_URL;
    }
    if (!baseEnv.OBSERVATORY_FILESTORE_BACKEND_KEY || baseEnv.OBSERVATORY_FILESTORE_BACKEND_KEY.trim() === '') {
      baseEnv.OBSERVATORY_FILESTORE_BACKEND_KEY = 'observatory-local';
    }
    if (!baseEnv.FILESTORE_AUTOPROVISION_BACKEND_KIND || baseEnv.FILESTORE_AUTOPROVISION_BACKEND_KIND.trim() === '') {
      baseEnv.FILESTORE_AUTOPROVISION_BACKEND_KIND = 'local';
    }
    if (!baseEnv.FILESTORE_AUTOPROVISION_LOCAL_ROOT || baseEnv.FILESTORE_AUTOPROVISION_LOCAL_ROOT.trim() === '') {
      baseEnv.FILESTORE_AUTOPROVISION_LOCAL_ROOT = filestoreRoot;
    }
    if (!baseEnv.OBSERVATORY_FILESTORE_LOCAL_ROOT || baseEnv.OBSERVATORY_FILESTORE_LOCAL_ROOT.trim() === '') {
      baseEnv.OBSERVATORY_FILESTORE_LOCAL_ROOT = filestoreRoot;
    }
    if (!baseEnv.OBSERVATORY_FILESTORE_DEFAULT_KEY || baseEnv.OBSERVATORY_FILESTORE_DEFAULT_KEY.trim() === '') {
      baseEnv.OBSERVATORY_FILESTORE_DEFAULT_KEY = baseEnv.OBSERVATORY_FILESTORE_BACKEND_KEY;
    }
    if (!baseEnv.FILESTORE_AUTOPROVISION_MOUNT_KEY || baseEnv.FILESTORE_AUTOPROVISION_MOUNT_KEY.trim() === '') {
      baseEnv.FILESTORE_AUTOPROVISION_MOUNT_KEY = baseEnv.OBSERVATORY_FILESTORE_BACKEND_KEY;
    }
    if (!baseEnv.FILESTORE_AUTOPROVISION_DISPLAY_NAME || baseEnv.FILESTORE_AUTOPROVISION_DISPLAY_NAME.trim() === '') {
      baseEnv.FILESTORE_AUTOPROVISION_DISPLAY_NAME = 'Observatory (Local)';
    }
    if (!baseEnv.FILESTORE_AUTOPROVISION_DESCRIPTION || baseEnv.FILESTORE_AUTOPROVISION_DESCRIPTION.trim() === '') {
      baseEnv.FILESTORE_AUTOPROVISION_DESCRIPTION = 'Local filesystem backend for the observatory demo.';
    }

    baseEnv.APPHUB_STREAMING_ENABLED = 'true';
    setDefaultEnv(baseEnv, 'APPHUB_STREAM_BROKER_URL', 'redpanda:9092');
    // If the broker isn't reachable, disable streaming so timestore doesn't crash the dev stack.
    const brokerUrl = (baseEnv.APPHUB_STREAM_BROKER_URL || '').trim() || 'redpanda:9092';
    const parseHostPort = (input) => {
      try {
        const url = new URL(input.startsWith('http') ? input : `tcp://${input}`);
        const portNum = url.port ? Number(url.port) : 9092;
        return { host: url.hostname || 'redpanda', port: Number.isFinite(portNum) ? portNum : 9092 };
      } catch {
        const [hostPart, portPart] = input.split(':');
        const portNum = Number.parseInt(portPart ?? '9092', 10);
        return { host: hostPart || 'redpanda', port: Number.isFinite(portNum) ? portNum : 9092 };
      }
    };
    const { host: brokerHost, port: brokerPort } = parseHostPort(brokerUrl);
    try {
      await waitForPort(brokerHost, brokerPort, 4000, 'Streaming broker');
      console.log(`[dev-runner-local] Streaming broker reachable at ${brokerHost}:${brokerPort}; streaming enabled.`);
    } catch (err) {
      console.warn(
        `[dev-runner-local] Streaming broker ${brokerHost}:${brokerPort} unreachable; disabling streaming for dev. (${err?.message ?? err})`
      );
      baseEnv.APPHUB_STREAMING_ENABLED = 'false';
    }

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
    const stopMonitor = startResourceMonitor({ prefix: 'dev-runner-local', commands: spawned });

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
      stopMonitor();

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

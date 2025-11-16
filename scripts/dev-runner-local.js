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

const LOCAL_REDIS = {
  host: '127.0.0.1',
  port: 6379,
  dataDir: path.join(LOCAL_DATA_DIR, 'redis')
};

const LOCAL_STORAGE = {
  baseDir: path.join(LOCAL_DATA_DIR, 'storage'),
  buckets: ['apphub-job-bundles', 'apphub-filestore', 'apphub-timestore', 'apphub-flink-checkpoints'],
  scratchDir: path.join(LOCAL_DATA_DIR, 'scratch')
};

const DEFAULT_CLICKHOUSE_IMAGE = process.env.APPHUB_DEV_CLICKHOUSE_IMAGE || 'clickhouse/clickhouse-server:24.11';

const LOCAL_MINIO = {
  host: '127.0.0.1',
  apiPort: parsePort(process.env.APPHUB_DEV_MINIO_PORT, 9000),
  consolePort: parsePort(process.env.APPHUB_DEV_MINIO_CONSOLE_PORT, 9001),
  containerName: process.env.APPHUB_DEV_MINIO_CONTAINER ?? 'apphub-dev-minio',
  image: process.env.APPHUB_DEV_MINIO_IMAGE ?? 'minio/minio:latest',
  mcImage: process.env.APPHUB_DEV_MINIO_MC_IMAGE ?? 'minio/mc:latest',
  rootUser: process.env.APPHUB_DEV_MINIO_ROOT_USER ?? 'apphub',
  rootPassword: process.env.APPHUB_DEV_MINIO_ROOT_PASSWORD ?? 'apphub123',
  dataDir: process.env.APPHUB_DEV_MINIO_DATA_DIR
    ? path.resolve(process.env.APPHUB_DEV_MINIO_DATA_DIR)
    : path.join(LOCAL_DATA_DIR, 'minio'),
  buckets: (process.env.APPHUB_DEV_MINIO_BUCKETS ?? 'apphub-job-bundles,apphub-filestore,apphub-timestore,apphub-flink-checkpoints')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
};

const MINIO_API_ENDPOINT = `http://${LOCAL_MINIO.host}:${LOCAL_MINIO.apiPort}`;

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
  nativePort: parsePort(process.env.APPHUB_DEV_CLICKHOUSE_NATIVE_PORT, 19000),
  user: process.env.APPHUB_DEV_CLICKHOUSE_USER ?? process.env.TIMESTORE_CLICKHOUSE_USER ?? 'apphub',
  password: process.env.APPHUB_DEV_CLICKHOUSE_PASSWORD ?? process.env.TIMESTORE_CLICKHOUSE_PASSWORD ?? 'apphub',
  database: process.env.APPHUB_DEV_CLICKHOUSE_DATABASE ?? process.env.TIMESTORE_CLICKHOUSE_DATABASE ?? 'apphub',
  containerName: process.env.APPHUB_DEV_CLICKHOUSE_CONTAINER ?? 'apphub-local-clickhouse',
  dataDir: path.join(LOCAL_DATA_DIR, 'clickhouse'),
  configDir: resolveClickhouseConfigDir()
};

function commandExists(command) {
  try {
    const result = spawnSync('which', [command], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

function dockerImageExists(image) {
  const result = spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore', timeout: 5000 });
  return result.status === 0;
}

function dockerContainerExists(name) {
  const result = spawnSync('docker', ['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'], {
    encoding: 'utf8',
    timeout: 5000
  });
  if (result.status !== 0) {
    return false;
  }
  return (result.stdout ?? '').split('\n').some((line) => line.trim() === name);
}

function dockerContainerRunning(name) {
  const result = spawnSync('docker', ['ps', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'], {
    encoding: 'utf8',
    timeout: 5000
  });
  if (result.status !== 0) {
    return false;
  }
  return (result.stdout ?? '').split('\n').some((line) => line.trim() === name);
}

function dockerVolumeExists(name) {
  const result = spawnSync('docker', ['volume', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8', timeout: 5000 });
  if (result.status !== 0) {
    return false;
  }
  return (result.stdout ?? '').split('\n').some((line) => line.trim() === name);
}

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

async function startEmbeddedPostgres(port) {
  console.warn('[dev-runner-local] Embedded PostgreSQL is disabled. Start a local Postgres and set APPHUB_DEV_POSTGRES_*.');
  return null;
}

async function setupDockerPostgres({ dockerAvailable, attemptClean = true }) {
  throw new Error('[dev-runner-local] Managed Docker/PostgreSQL is disabled. Please run a local Postgres instance.');
}

async function setupLocalPostgres({ dockerAvailable }) {
  const host = LOCAL_POSTGRES.host;
  const port = LOCAL_POSTGRES.port;

  const credentialsValid = await canConnectWithManagedCredentials(LOCAL_POSTGRES);
  if (credentialsValid) {
    console.log('[dev-runner-local] PostgreSQL already running, skipping local setup');
    await setupPostgresDatabase();
    return null;
  }

  throw new Error(
    `[dev-runner-local] Local PostgreSQL required. Start Postgres on ${host}:${port} with user=${LOCAL_POSTGRES.user} password=${LOCAL_POSTGRES.password} db=${LOCAL_POSTGRES.database}.`
  );
}

async function setupPostgresDatabase() {
  try {
    const { Client } = require('pg');
    const client = new Client({
      host: LOCAL_POSTGRES.host,
      port: LOCAL_POSTGRES.port,
      user: 'postgres',
      password: LOCAL_POSTGRES.password,
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

async function waitForPostgresReady({ attempts = 10, delayMs = 500 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const { Client } = require('pg');
      const client = new Client({
        host: LOCAL_POSTGRES.host,
        port: LOCAL_POSTGRES.port,
        user: 'postgres',
        password: LOCAL_POSTGRES.password,
        database: 'postgres'
      });
      await client.connect();
      await client.end().catch(() => {});
      return;
    } catch (err) {
      lastError = err;
      await sleep(delayMs);
    }
  }
  if (lastError) {
    throw lastError;
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

async function ensureMinioBuckets() {
  if (LOCAL_MINIO.buckets.length === 0) {
    return;
  }

  if (!dockerImageExists(LOCAL_MINIO.mcImage)) {
    throw new Error(
      `[dev-runner-local] MinIO client image ${LOCAL_MINIO.mcImage} not found locally. Run "docker pull ${LOCAL_MINIO.mcImage}" or set APPHUB_DEV_MINIO_SKIP=1 to skip managed MinIO.`
    );
  }

  const encodedUser = encodeURIComponent(LOCAL_MINIO.rootUser);
  const encodedPassword = encodeURIComponent(LOCAL_MINIO.rootPassword);
  const endpointEnv = `MC_HOST_local=http://${encodedUser}:${encodedPassword}@${LOCAL_MINIO.host}:${LOCAL_MINIO.apiPort}`;

  for (const bucket of LOCAL_MINIO.buckets) {
    const result = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        `container:${LOCAL_MINIO.containerName}`,
        '-e',
        endpointEnv,
        LOCAL_MINIO.mcImage,
        'mb',
        '--ignore-existing',
        `local/${bucket}`
      ],
      { stdio: 'inherit' }
    );

    if (typeof result.status === 'number' && result.status !== 0) {
      throw new Error(`[dev-runner-local] Failed to provision MinIO bucket ${bucket}`);
    }
  }

  if (LOCAL_MINIO.buckets.includes('apphub-job-bundles')) {
    const policy = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        `container:${LOCAL_MINIO.containerName}`,
        '-e',
        endpointEnv,
        LOCAL_MINIO.mcImage,
        'anonymous',
        'set',
        'download',
        'local/apphub-job-bundles'
      ],
      { stdio: 'ignore' }
    );
    if (typeof policy.status === 'number' && policy.status !== 0) {
      console.warn('[dev-runner-local] Failed to enable anonymous download policy for job bundles (non-fatal).');
    }
  }
}

async function setupLocalMinio({ dockerAvailable }) {
  const skipMinio = parseBooleanFlag(process.env.APPHUB_DEV_MINIO_SKIP);
  if (skipMinio) {
    console.log('[dev-runner-local] Skipping MinIO because APPHUB_DEV_MINIO_SKIP is set.');
    return null;
  }

  const apiAvailable = await isPortAvailable(LOCAL_MINIO.apiPort, LOCAL_MINIO.host);
  const consoleAvailable = await isPortAvailable(LOCAL_MINIO.consolePort, LOCAL_MINIO.host);

  if (!apiAvailable || !consoleAvailable) {
    try {
      await waitForPort(LOCAL_MINIO.host, LOCAL_MINIO.apiPort, 2000, 'MinIO');
      console.log(
        `[dev-runner-local] Detected MinIO on ${LOCAL_MINIO.host}:${LOCAL_MINIO.apiPort}; using existing instance.`
      );
      return {
        endpoint: MINIO_API_ENDPOINT,
        accessKeyId: LOCAL_MINIO.rootUser,
        secretAccessKey: LOCAL_MINIO.rootPassword,
        managed: false,
        cleanup: async () => {}
      };
    } catch (err) {
      const ports = `${LOCAL_MINIO.apiPort}/${LOCAL_MINIO.consolePort}`;
      throw new Error(
        `[dev-runner-local] Ports ${ports} are in use and MinIO is not responding. Free the ports, set APPHUB_DEV_MINIO_PORT/APPHUB_DEV_MINIO_CONSOLE_PORT, or export APPHUB_DEV_MINIO_SKIP=1 to skip MinIO.`
      );
    }
  }

  if (!dockerAvailable) {
    throw new Error(
      '[dev-runner-local] Docker CLI unavailable. Install Docker or set APPHUB_DEV_MINIO_SKIP=1 to disable the managed MinIO instance.'
    );
  }

  if (!dockerImageExists(LOCAL_MINIO.image)) {
    throw new Error(
      `[dev-runner-local] MinIO image ${LOCAL_MINIO.image} not found locally. Run "docker pull ${LOCAL_MINIO.image}" or set APPHUB_DEV_MINIO_SKIP=1 to skip the managed instance.`
    );
  }

  await fsPromises.mkdir(LOCAL_MINIO.dataDir, { recursive: true });

  const containerAlreadyRunning = dockerContainerRunning(LOCAL_MINIO.containerName);
  const containerExists = containerAlreadyRunning || dockerContainerExists(LOCAL_MINIO.containerName);
  let manageContainer = false;

  if (containerAlreadyRunning) {
    console.log(`[dev-runner-local] Reusing running MinIO container ${LOCAL_MINIO.containerName}.`);
  } else if (containerExists) {
    console.log(`[dev-runner-local] Starting existing MinIO container ${LOCAL_MINIO.containerName}...`);
    const startResult = spawnSync('docker', ['start', LOCAL_MINIO.containerName], { stdio: 'inherit' });
    if (typeof startResult.status === 'number' && startResult.status !== 0) {
      throw new Error(`[dev-runner-local] Failed to start MinIO container ${LOCAL_MINIO.containerName}`);
    }
    manageContainer = true;
  } else {
    console.log('[dev-runner-local] Launching managed MinIO container...');
    const runArgs = [
      'run',
      '--detach',
      '--name',
      LOCAL_MINIO.containerName,
      '-p',
      `${LOCAL_MINIO.apiPort}:9000`,
      '-p',
      `${LOCAL_MINIO.consolePort}:9001`,
      '-e',
      `MINIO_ROOT_USER=${LOCAL_MINIO.rootUser}`,
      '-e',
      `MINIO_ROOT_PASSWORD=${LOCAL_MINIO.rootPassword}`,
      '-v',
      `${LOCAL_MINIO.dataDir}:/data`,
      LOCAL_MINIO.image,
      'server',
      '/data',
      '--address',
      ':9000',
      '--console-address',
      ':9001'
    ];
    const run = spawnSync('docker', runArgs, { encoding: 'utf8', timeout: 30000 });
    if (typeof run.status !== 'number' || run.status !== 0) {
      const stderr = run.stderr?.trim();
      const stdout = run.stdout?.trim();
      throw new Error(`[dev-runner-local] Failed to start MinIO container: ${stderr || stdout || 'unknown error'}`);
    }
    manageContainer = true;
  }

  await waitForPort(LOCAL_MINIO.host, LOCAL_MINIO.apiPort, 20000, 'MinIO');

  await ensureMinioBuckets();

  console.log(`[dev-runner-local] MinIO ready at ${MINIO_API_ENDPOINT}.`);

  return {
    managed: manageContainer,
    endpoint: MINIO_API_ENDPOINT,
    accessKeyId: LOCAL_MINIO.rootUser,
    secretAccessKey: LOCAL_MINIO.rootPassword,
    cleanup: async () => {
      if (!manageContainer) {
        return;
      }
      spawnSync('docker', ['stop', '-t', '5', LOCAL_MINIO.containerName], { stdio: 'ignore' });
      spawnSync('docker', ['rm', '-f', LOCAL_MINIO.containerName], { stdio: 'ignore' });
    }
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bootstrapObservatoryModule(env) {
  if (parseBooleanFlag(process.env.APPHUB_DEV_SKIP_OBSERVATORY_LOAD)) {
    console.log('[dev-runner-local] Skipping observatory bootstrap (APPHUB_DEV_SKIP_OBSERVATORY_LOAD set).');
    return;
  }

  const coreUrl = (env.APPHUB_CORE_URL ?? 'http://127.0.0.1:4000').trim();
  let host = '127.0.0.1';
  let port = 4000;
  try {
    const parsed = new URL(coreUrl);
    host = parsed.hostname || host;
    port = parsed.port ? Number(parsed.port) : port;
  } catch {
    // ignore parse errors
  }

  try {
    await waitForPort(host, port, 120000, 'Core API');
  } catch (err) {
    console.warn('[dev-runner-local] Core API unavailable; skipping observatory bootstrap.', err?.message ?? err);
    return;
  }

  console.log('[dev-runner-local] Loading observatory module (dev:observatory)...');
  const result = spawnSync('node', ['scripts/dev-load-observatory.mjs'], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env
  });

  if (result.error) {
    console.warn('[dev-runner-local] Observatory bootstrap failed to start:', result.error.message ?? result.error);
    return;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    console.warn(`[dev-runner-local] Observatory bootstrap exited with code ${result.status}.`);
  } else {
    console.log('[dev-runner-local] Observatory module ready.');
  }
}

async function setupLocalClickhouse({ dockerAvailable }) {
  if (parseBooleanFlag(process.env.APPHUB_DEV_CLICKHOUSE_SKIP)) {
    console.log('[dev-runner-local] Skipping local ClickHouse because APPHUB_DEV_CLICKHOUSE_SKIP is set.');
    return null;
  }

  const conflictingPorts = new Set([LOCAL_MINIO.apiPort, LOCAL_MINIO.consolePort]);
  if (conflictingPorts.has(LOCAL_CLICKHOUSE.nativePort)) {
    const fallbackStart = LOCAL_MINIO.consolePort + 1;
    const newPort = await findAvailablePort(fallbackStart, LOCAL_CLICKHOUSE.host);
    console.log(
      `[dev-runner-local] Adjusted ClickHouse native port to ${newPort} to avoid conflict with MinIO ports ${LOCAL_MINIO.apiPort}/${LOCAL_MINIO.consolePort}.`
    );
    LOCAL_CLICKHOUSE.nativePort = newPort;
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

  const imageCheck = spawnSync('docker', ['image', 'inspect', DEFAULT_CLICKHOUSE_IMAGE], { encoding: 'utf8', timeout: 5000 });
  if (imageCheck.status !== 0) {
    throw new Error(
      `[dev-runner-local] ClickHouse image ${DEFAULT_CLICKHOUSE_IMAGE} not found locally. Run "docker pull ${DEFAULT_CLICKHOUSE_IMAGE}" or set APPHUB_DEV_CLICKHOUSE_SKIP=1 to manage ClickHouse yourself.`
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

  const run = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000 });
  if (typeof run.status !== 'number' || run.status !== 0) {
    if (run.error?.code === 'ETIMEDOUT') {
      throw new Error(
        `[dev-runner-local] Timed out starting ClickHouse container. Pre-pull ${DEFAULT_CLICKHOUSE_IMAGE} or set APPHUB_DEV_CLICKHOUSE_SKIP=1 to skip the managed instance.`
      );
    }
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
    command: 'npm run dev --workspace @apphub/frontend -- --host 127.0.0.1 --port 5173 --strictPort'
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
  const dockerAvailable = Boolean(preflightResult?.tooling?.docker?.available);

  await fsPromises.mkdir(LOCAL_DATA_DIR, { recursive: true });
  await fsPromises.mkdir(DEV_LOG_DIR, { recursive: true });

  await setupLocalStorage();

  const localServices = [];

  try {
    const clickhouseService = await setupLocalClickhouse({ dockerAvailable });
    if (clickhouseService) {
      localServices.push(clickhouseService);
    }

    const minioService = await setupLocalMinio({ dockerAvailable });
    const useMinio = Boolean(minioService);
    if (minioService) {
      localServices.push(minioService);
    }

    const pgService = await setupLocalPostgres({ dockerAvailable });
    if (pgService) {
      localServices.push(pgService);
    }

    const defaultDatabaseUrl = buildDatabaseUrl();

    if (skipRedis) {
      console.log('[dev-runner-local] Detected existing Redis instance; skipping bundled Redis.');
    } else {
      const redisService = await setupLocalRedis();
      if (redisService) {
        localServices.push(redisService);
      }
    }

    const baseEnv = { ...process.env };
    const setDefaultEnv = (key, value) => {
      if (typeof baseEnv[key] !== 'string' || baseEnv[key].trim() === '') {
        baseEnv[key] = value;
      }
    };

    if (!baseEnv.NODE_ENV) {
      baseEnv.NODE_ENV = 'development';
    }
    if (!baseEnv.APPHUB_AUTH_DISABLED || baseEnv.APPHUB_AUTH_DISABLED.trim() === '') {
      baseEnv.APPHUB_AUTH_DISABLED = '1';
    }
    if (!baseEnv.APPHUB_SESSION_SECRET || baseEnv.APPHUB_SESSION_SECRET.trim() === '') {
      baseEnv.APPHUB_SESSION_SECRET = 'dev-session-secret';
    }
    if (!baseEnv.APPHUB_CORE_URL || baseEnv.APPHUB_CORE_URL.trim() === '') {
      baseEnv.APPHUB_CORE_URL = 'http://127.0.0.1:4000';
    }
    if (!baseEnv.TZ || baseEnv.TZ.trim() === '') {
      baseEnv.TZ = 'Etc/UTC';
    }
    if (!baseEnv.PGTZ || baseEnv.PGTZ.trim() === '') {
      baseEnv.PGTZ = 'Etc/UTC';
    }
    if (!baseEnv.APPHUB_FRONTEND_PUBLIC_URL || baseEnv.APPHUB_FRONTEND_PUBLIC_URL.trim() === '') {
      baseEnv.APPHUB_FRONTEND_PUBLIC_URL = 'http://localhost:5173';
    }
    if (!baseEnv.APPHUB_FRONTEND_INTERNAL_URL || baseEnv.APPHUB_FRONTEND_INTERNAL_URL.trim() === '') {
      baseEnv.APPHUB_FRONTEND_INTERNAL_URL = 'http://127.0.0.1:5173';
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

    if (useMinio) {
      setDefaultEnv('APPHUB_BUNDLE_STORAGE_BACKEND', 's3');
      setDefaultEnv('APPHUB_BUNDLE_STORAGE_BUCKET', 'apphub-job-bundles');
      setDefaultEnv('APPHUB_BUNDLE_STORAGE_ENDPOINT', minioService.endpoint);
      setDefaultEnv('APPHUB_BUNDLE_STORAGE_REGION', 'us-east-1');
      setDefaultEnv('APPHUB_BUNDLE_STORAGE_FORCE_PATH_STYLE', 'true');
      setDefaultEnv('APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID', minioService.accessKeyId);
      setDefaultEnv('APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY', minioService.secretAccessKey);

      setDefaultEnv('APPHUB_JOB_BUNDLE_STORAGE_BACKEND', 's3');
      setDefaultEnv('APPHUB_JOB_BUNDLE_S3_BUCKET', 'apphub-job-bundles');
      setDefaultEnv('APPHUB_JOB_BUNDLE_S3_ENDPOINT', minioService.endpoint);
      setDefaultEnv('APPHUB_JOB_BUNDLE_S3_REGION', 'us-east-1');
      setDefaultEnv('APPHUB_JOB_BUNDLE_S3_FORCE_PATH_STYLE', 'true');
      setDefaultEnv(
        'APPHUB_JOB_BUNDLE_S3_ACCESS_KEY_ID',
        baseEnv.APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID ?? minioService.accessKeyId
      );
      setDefaultEnv(
        'APPHUB_JOB_BUNDLE_S3_SECRET_ACCESS_KEY',
        baseEnv.APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY ?? minioService.secretAccessKey
      );

      setDefaultEnv('TIMESTORE_STORAGE_DRIVER', 's3');
      setDefaultEnv('TIMESTORE_S3_BUCKET', 'apphub-timestore');
      setDefaultEnv('TIMESTORE_S3_ENDPOINT', minioService.endpoint);
      setDefaultEnv('TIMESTORE_S3_REGION', 'us-east-1');
      setDefaultEnv('TIMESTORE_S3_FORCE_PATH_STYLE', 'true');
      setDefaultEnv(
        'TIMESTORE_S3_ACCESS_KEY_ID',
        baseEnv.APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID ?? minioService.accessKeyId
      );
      setDefaultEnv(
        'TIMESTORE_S3_SECRET_ACCESS_KEY',
        baseEnv.APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY ?? minioService.secretAccessKey
      );
    } else {
      baseEnv.APPHUB_BUNDLE_STORAGE_BACKEND = 'local';
      baseEnv.APPHUB_BUNDLE_STORAGE_PATH = path.join(LOCAL_STORAGE.baseDir, 'apphub-job-bundles');

      baseEnv.APPHUB_JOB_BUNDLE_STORAGE_BACKEND = 'local';
      baseEnv.APPHUB_JOB_BUNDLE_LOCAL_PATH = path.join(LOCAL_STORAGE.baseDir, 'apphub-job-bundles');

      baseEnv.TIMESTORE_STORAGE_DRIVER = 'local';
      baseEnv.TIMESTORE_LOCAL_PATH = path.join(LOCAL_STORAGE.baseDir, 'apphub-timestore');
    }

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
      baseEnv.OBSERVATORY_FILESTORE_BACKEND_KEY = useMinio ? 'observatory-s3' : 'observatory-local';
    }
    if (useMinio) {
      setDefaultEnv('FILESTORE_AUTOPROVISION_BACKEND_KIND', 's3');
      setDefaultEnv('FILESTORE_AUTOPROVISION_S3_BUCKET', 'apphub-filestore');
      setDefaultEnv('FILESTORE_AUTOPROVISION_S3_ENDPOINT', minioService.endpoint);
      setDefaultEnv('FILESTORE_AUTOPROVISION_S3_REGION', 'us-east-1');
      setDefaultEnv('FILESTORE_AUTOPROVISION_S3_FORCE_PATH_STYLE', 'true');
      setDefaultEnv(
        'FILESTORE_AUTOPROVISION_S3_ACCESS_KEY_ID',
        baseEnv.APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID ?? minioService.accessKeyId
      );
      setDefaultEnv(
        'FILESTORE_AUTOPROVISION_S3_SECRET_ACCESS_KEY',
        baseEnv.APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY ?? minioService.secretAccessKey
      );
      setDefaultEnv('OBSERVATORY_FILESTORE_DEFAULT_KEY', baseEnv.OBSERVATORY_FILESTORE_BACKEND_KEY);
      setDefaultEnv('FILESTORE_AUTOPROVISION_MOUNT_KEY', baseEnv.OBSERVATORY_FILESTORE_BACKEND_KEY);
      setDefaultEnv('FILESTORE_AUTOPROVISION_DISPLAY_NAME', 'Observatory (S3)');
      setDefaultEnv('FILESTORE_AUTOPROVISION_DESCRIPTION', 'S3-backed filestore mount for the observatory demo.');
      setDefaultEnv('OBSERVATORY_FILESTORE_S3_BUCKET', 'apphub-filestore');
      setDefaultEnv('OBSERVATORY_FILESTORE_S3_ENDPOINT', minioService.endpoint);
      setDefaultEnv('OBSERVATORY_FILESTORE_S3_REGION', 'us-east-1');
      setDefaultEnv('OBSERVATORY_FILESTORE_S3_FORCE_PATH_STYLE', 'true');
      setDefaultEnv(
        'OBSERVATORY_FILESTORE_S3_ACCESS_KEY_ID',
        baseEnv.APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID ?? minioService.accessKeyId
      );
      setDefaultEnv(
        'OBSERVATORY_FILESTORE_S3_SECRET_ACCESS_KEY',
        baseEnv.APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY ?? minioService.secretAccessKey
      );
    } else {
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
    }

    baseEnv.APPHUB_STREAMING_ENABLED = 'true';
    setDefaultEnv('APPHUB_STREAM_BROKER_URL', 'redpanda:9092');

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
    bootstrapObservatoryModule(baseEnv).catch((err) => {
      console.warn('[dev-runner-local] Observatory bootstrap failed:', err?.message ?? err);
    });
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

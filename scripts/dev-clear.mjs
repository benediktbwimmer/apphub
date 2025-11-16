#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.join(process.cwd()));
const DATA_ROOT = path.join(ROOT, 'data', 'local');
const LOG_ROOT = path.join(ROOT, 'logs', 'dev');

const DEFAULTS = {
  postgres: {
    host: process.env.APPHUB_DEV_POSTGRES_HOST ?? '127.0.0.1',
    port: Number.parseInt(process.env.APPHUB_DEV_POSTGRES_PORT ?? '5432', 10),
    user: process.env.APPHUB_DEV_POSTGRES_USER ?? 'apphub',
    password: process.env.APPHUB_DEV_POSTGRES_PASSWORD ?? 'apphub',
    database: process.env.APPHUB_DEV_POSTGRES_DB ?? 'apphub'
  },
  redisUrl: process.env.APPHUB_DEV_REDIS_URL ?? 'redis://127.0.0.1:6379',
  containers: {
    postgres: process.env.APPHUB_DEV_POSTGRES_CONTAINER ?? 'apphub-dev-postgres',
    minio: process.env.APPHUB_DEV_MINIO_CONTAINER ?? 'apphub-dev-minio',
    clickhouse: process.env.APPHUB_DEV_CLICKHOUSE_CONTAINER ?? 'apphub-local-clickhouse',
    redpanda: process.env.APPHUB_DEV_REDPANDA_CONTAINER ?? 'apphub-dev-redpanda'
  },
  volumes: {
    postgres: process.env.APPHUB_DEV_POSTGRES_VOLUME ?? 'apphub-dev-postgres',
    minio: process.env.APPHUB_DEV_MINIO_VOLUME ?? 'apphub-dev-minio',
    clickhouse: process.env.APPHUB_DEV_CLICKHOUSE_VOLUME ?? 'apphub-local-clickhouse',
    redpanda: process.env.APPHUB_DEV_REDPANDA_VOLUME ?? 'apphub-dev-redpanda'
  }
};

function log(msg) {
  console.log(`[dev-clear] ${msg}`);
}

function runDocker(args, { ignoreError = false } = {}) {
  const res = spawnSync('docker', args, { encoding: 'utf8' });
  if (res.error) {
    if (ignoreError) return '';
    throw res.error;
  }
  if (typeof res.status === 'number' && res.status !== 0) {
    if (ignoreError) return res.stdout ?? '';
    throw new Error(`docker ${args.join(' ')} failed: ${(res.stderr || res.stdout || '').toString().trim()}`);
  }
  return res.stdout ?? '';
}

function dockerResourceExists(type, name) {
  if (!name) return false;
  const args =
    type === 'volume'
      ? ['volume', 'ls', '--format', '{{.Name}}', '--filter', `name=^${name}$`]
      : ['ps', '-aq', '--filter', `name=^/${name}$`];
  const out = runDocker(args, { ignoreError: true });
  return out.trim().length > 0;
}

function stopAndRemoveContainer(name) {
  if (!dockerResourceExists('container', name)) return;
  log(`Stopping container ${name}`);
  runDocker(['stop', name], { ignoreError: true });
  log(`Removing container ${name}`);
  runDocker(['rm', name], { ignoreError: true });
}

function removeVolume(name) {
  if (!dockerResourceExists('volume', name)) return;
  log(`Removing volume ${name}`);
  runDocker(['volume', 'rm', name], { ignoreError: true });
}

async function clearDir(target) {
  try {
    await fs.rm(target, { recursive: true, force: true });
    log(`Removed ${target}`);
  } catch (err) {
    log(`Failed to remove ${target}: ${err?.message ?? err}`);
  }
}

function parseRedisUrl(raw) {
  try {
    const url = new URL(raw);
    const port = url.port ? Number.parseInt(url.port, 10) : 6379;
    return { host: url.hostname || '127.0.0.1', port: Number.isFinite(port) ? port : 6379, password: url.password ?? null };
  } catch (err) {
    throw new Error(`Invalid REDIS_URL: ${raw}. ${err?.message ?? err}`);
  }
}

function buildRedisCommand(args) {
  const chunks = [];
  chunks.push(`*${args.length}\r\n`);
  for (const arg of args) {
    const value = String(arg);
    chunks.push(`$${Buffer.byteLength(value)}\r\n`);
    chunks.push(value);
    chunks.push('\r\n');
  }
  return Buffer.from(chunks.join(''), 'utf8');
}

async function flushRedis() {
  const { host, port, password } = parseRedisUrl(DEFAULTS.redisUrl);
  log(`Flushing Redis at ${host}:${port}`);

  const commands = [];
  if (password) commands.push(['AUTH', password]);
  commands.push(['FLUSHALL'], ['QUIT']);

  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => sendNext());
    let buffer = '';
    let sent = 0;
    let completed = 0;

    function sendNext() {
      if (sent >= commands.length) return;
      socket.write(buildRedisCommand(commands[sent]));
      sent += 1;
    }

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      while (buffer.includes('\r\n')) {
        const idx = buffer.indexOf('\r\n');
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (!line) continue;
        if (line.startsWith('-')) {
          socket.destroy();
          reject(new Error(`Redis error: ${line.slice(1)}`));
          return;
        }
        completed += 1;
        if (completed >= commands.length) {
          socket.end();
          resolve();
          return;
        }
        sendNext();
      }
    });

    socket.on('error', reject);
    socket.setTimeout(3000, () => {
      socket.destroy();
      reject(new Error('Redis flush timed out'));
    });
  }).catch((err) => log(`Redis flush failed: ${err?.message ?? err}`));
}

async function resetPostgres() {
  const cfg = DEFAULTS.postgres;
  log(`Resetting Postgres schema at ${cfg.host}:${cfg.port}/${cfg.database}`);
  try {
    const { Client } = await import('pg');
    const client = new Client(cfg);
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await client.end();
    log('Postgres schema reset.');
  } catch (err) {
    log(`Postgres reset failed (skip if using external DB): ${err?.message ?? err}`);
  }
}

async function main() {
  // Stop managed containers and clear volumes
  stopAndRemoveContainer(DEFAULTS.containers.postgres);
  stopAndRemoveContainer(DEFAULTS.containers.minio);
  stopAndRemoveContainer(DEFAULTS.containers.clickhouse);
  stopAndRemoveContainer(DEFAULTS.containers.redpanda);

  removeVolume(DEFAULTS.volumes.postgres);
  removeVolume(DEFAULTS.volumes.minio);
  removeVolume(DEFAULTS.volumes.clickhouse);
  removeVolume(DEFAULTS.volumes.redpanda);

  await flushRedis();
  await resetPostgres();

  // Local filesystem state
  await clearDir(path.join(DATA_ROOT, 'storage'));
  await clearDir(path.join(DATA_ROOT, 'scratch'));
  await clearDir(path.join(DATA_ROOT, 'minio'));
  await clearDir(path.join(DATA_ROOT, 'clickhouse'));
  await clearDir(path.join(DATA_ROOT, 'redis'));
  await clearDir(path.join(DATA_ROOT, 'observatory'));
  await clearDir(path.join(DATA_ROOT, 'timestore'));
  await clearDir(path.join('/tmp', 'apphub'));
  await clearDir(LOG_ROOT);

  log('Clear complete. Restart npm run local-dev to recreate services.');
}

main().catch((err) => {
  console.error('[dev-clear] Failed:', err?.message ?? err);
  process.exitCode = 1;
});

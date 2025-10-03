#!/usr/bin/env node
import net from 'node:net';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const POSTGRES_CONTAINER = process.env.APPHUB_DEV_POSTGRES_CONTAINER ?? 'apphub-dev-postgres';
const POSTGRES_VOLUME = process.env.APPHUB_DEV_POSTGRES_VOLUME ?? 'apphub-dev-postgres';
const MINIO_CONTAINER = process.env.APPHUB_DEV_MINIO_CONTAINER ?? 'apphub-dev-minio';
const MINIO_VOLUME = process.env.APPHUB_DEV_MINIO_VOLUME ?? 'apphub-dev-minio';

function log(message) {
  console.log(`[dev-maintenance] ${message}`);
}

function runDocker(args, options = {}) {
  const result = spawnSync('docker', args, {
    stdio: options.stdio ?? 'pipe',
    encoding: 'utf8'
  });
  if (result.error) {
    if (options.ignoreError && result.error.code === 'ENOENT') {
      return '';
    }
    throw result.error;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    if (options.ignoreError) {
      return result.stdout ?? '';
    }
    const stderr = result.stderr ? result.stderr.toString() : '';
    const stdout = result.stdout ? result.stdout.toString() : '';
    throw new Error(`docker ${args.join(' ')} failed: ${(stderr || stdout || '').trim()}`);
  }
  return result.stdout ? result.stdout.toString() : '';
}

function dockerResourceExists(type, name) {
  const args = type === 'volume'
    ? ['volume', 'ls', '--format', '{{.Name}}', '--filter', `name=^${name}$`]
    : ['ps', '-aq', '--filter', `name=^/${name}$`];
  try {
    const output = runDocker(args, { stdio: 'pipe', ignoreError: true });
    return output.trim().length > 0;
  } catch (err) {
    throw err;
  }
}

function isContainerRunning(name) {
  try {
    const output = runDocker(['inspect', '-f', '{{.State.Running}}', name], {
      stdio: 'pipe',
      ignoreError: true
    });
    return output.trim() === 'true';
  } catch {
    return false;
  }
}

function stopContainer(name) {
  if (!dockerResourceExists('container', name)) {
    return;
  }
  if (!isContainerRunning(name)) {
    return;
  }
  log(`Stopping container ${name}...`);
  runDocker(['stop', name], { stdio: 'ignore', ignoreError: true });
}

function removeContainer(name) {
  if (!dockerResourceExists('container', name)) {
    return;
  }
  log(`Removing container ${name}...`);
  runDocker(['rm', name], { stdio: 'ignore', ignoreError: true });
}

function removeVolume(name) {
  if (!name || !dockerResourceExists('volume', name)) {
    return;
  }
  log(`Removing volume ${name}...`);
  runDocker(['volume', 'rm', name], { stdio: 'ignore', ignoreError: true });
}

async function clearPostgres() {
  log('Clearing PostgreSQL data volume.');
  stopContainer(POSTGRES_CONTAINER);
  removeContainer(POSTGRES_CONTAINER);
  removeVolume(POSTGRES_VOLUME);
  log('PostgreSQL state cleared. It will be re-initialized on the next dev run.');
}

function parseRedisUrl(input) {
  const fallback = process.env.APPHUB_DEV_REDIS_URL ?? 'redis://127.0.0.1:6379';
  const raw = (input && input.trim().length > 0 ? input : fallback) ?? fallback;
  try {
    const url = new URL(raw);
    const port = url.port ? Number.parseInt(url.port, 10) : 6379;
    return {
      host: url.hostname || '127.0.0.1',
      port: Number.isFinite(port) && port > 0 ? port : 6379,
      password: url.password ? decodeURIComponent(url.password) : null
    };
  } catch (err) {
    throw new Error(`Invalid REDIS_URL provided: ${raw}. ${err?.message ?? err}`);
  }
}

function buildRedisCommand(args) {
  const chunks = [];
  chunks.push(Buffer.from(`*${args.length}\r\n`, 'utf8'));
  for (const arg of args) {
    const value = Buffer.from(String(arg), 'utf8');
    chunks.push(Buffer.from(`$${value.length}\r\n`, 'utf8'));
    chunks.push(value);
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  return Buffer.concat(chunks);
}

async function flushRedis() {
  const redisUrl = process.env.REDIS_URL ?? process.env.FILESTORE_REDIS_URL ?? process.env.METASTORE_REDIS_URL;
  const { host, port, password } = parseRedisUrl(redisUrl);
  log(`Flushing Redis at ${host}:${port}.`);

  const commands = [];
  if (password && password.length > 0) {
    commands.push(['AUTH', password]);
  }
  commands.push(['FLUSHALL']);
  commands.push(['QUIT']);

  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      sendNext();
    });

    let buffer = '';
    let sent = 0;
    let completed = 0;

    function sendNext() {
      if (sent >= commands.length) {
        return;
      }
      const payload = buildRedisCommand(commands[sent]);
      socket.write(payload);
      sent += 1;
    }

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      while (buffer.includes('\r\n')) {
        const idx = buffer.indexOf('\r\n');
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (!line) {
          continue;
        }
        if (line.startsWith('-')) {
          socket.destroy();
          reject(new Error(`Redis error response: ${line.slice(1)}`));
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

    socket.on('error', (err) => {
      reject(err);
    });

    socket.on('close', () => {
      if (completed >= commands.length) {
        resolve();
      }
    });

    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error('Timed out while contacting Redis.'));
    });
  });

  log('Redis data flushed.');
}

async function clearMinio() {
  log('Clearing MinIO object storage volume.');
  stopContainer(MINIO_CONTAINER);
  removeContainer(MINIO_CONTAINER);
  removeVolume(MINIO_VOLUME);
  log('MinIO state cleared. Buckets will be recreated on the next dev run.');
}

async function clearAll() {
  await flushRedis().catch((err) => {
    log(`Redis flush failed: ${err?.message ?? err}`);
  });
  await clearMinio();
  await clearPostgres();
  log('Completed full cleanup.');
}

async function main() {
  const action = process.argv[2];
  switch (action) {
    case 'postgres':
      await clearPostgres();
      break;
    case 'redis':
      await flushRedis();
      break;
    case 'minio':
      await clearMinio();
      break;
    case 'all':
      await clearAll();
      break;
    default:
      console.error('Usage: node scripts/dev-maintenance.mjs <postgres|redis|minio|all>');
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[dev-maintenance] Failed:', err?.message ?? err);
  process.exitCode = 1;
});

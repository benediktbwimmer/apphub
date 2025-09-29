#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');

let pgClient = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Client } = require('pg');
  pgClient = Client;
} catch (err) {
  // pg is optional during preflight; we'll surface a friendly warning later if unavailable.
}

const sleep = promisify(setTimeout);
const REPO_ROOT = path.resolve(__dirname, '..');

let warnedMissingLsof = false;

const PORT_RULES = [
  { port: 6379, label: 'Redis', type: 'redis' },
  { port: 4000, label: 'Catalog API', type: 'repo' },
  { port: 4100, label: 'Metastore API', type: 'repo' },
  { port: 4200, label: 'Filestore API', type: 'repo' },
  { port: 4310, label: 'Observatory file watcher', type: 'repo' },
  { port: 4311, label: 'Observatory dashboard', type: 'repo' },
  { port: 5173, label: 'Frontend dev server', type: 'repo' },
  { port: 5174, label: 'Frontend dev server (alt)', type: 'repo' },
  { port: 5175, label: 'Frontend dev server (alt)', type: 'repo' }
];

function runCommand(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  if (result.error && result.error.code === 'ENOENT') {
    return { ok: false, missing: true };
  }
  if (typeof result.status === 'number' && result.status > 1) {
    return { ok: false, stderr: result.stderr?.trim() };
  }
  return { ok: true, stdout: result.stdout ?? '' };
}

function parseLsof(output) {
  if (!output) {
    return [];
  }
  const processes = new Map();
  let currentPid = null;
  const lines = output.split(/\r?\n/);
  for (const raw of lines) {
    if (!raw) {
      continue;
    }
    const prefix = raw[0];
    const value = raw.slice(1);
    if (prefix === 'p') {
      currentPid = Number.parseInt(value, 10);
      if (Number.isFinite(currentPid)) {
        if (!processes.has(currentPid)) {
          processes.set(currentPid, { pid: currentPid });
        }
      } else {
        currentPid = null;
      }
    } else if (prefix === 'c' && currentPid && processes.has(currentPid)) {
      processes.get(currentPid).command = value;
    }
  }
  return Array.from(processes.values());
}

function getProcessCommandLine(pid) {
  const result = runCommand('ps', ['-p', String(pid), '-o', 'command=']);
  if (!result.ok) {
    return '';
  }
  return result.stdout?.trim() ?? '';
}

function checkCommand(cmd, args = [], { timeoutMs = 2000 } = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      return { ok: false, missing: true };
    }
    if (result.error.code === 'ETIMEDOUT') {
      return { ok: false, timeout: true };
    }
    return { ok: false, stderr: result.error.message ?? 'command failed' };
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    return { ok: false, stderr: stderr || stdout || `exit code ${result.status}` };
  }
  return { ok: true, stdout: result.stdout?.trim() ?? '' };
}

function detectKubectl() {
  const version = checkCommand('kubectl', ['version', '--client', '--output=json']);
  if (!version.ok) {
    const reason = version.missing
      ? 'kubectl not detected on PATH'
      : version.stderr || 'kubectl client unavailable';
    return { available: false, reason };
  }

  const context = checkCommand('kubectl', ['config', 'current-context']);
  if (!context.ok) {
    const reason = context.stderr || 'kubectl current-context is not configured';
    return { available: false, reason };
  }

  return { available: true, context: context.stdout ?? '' };
}

function detectDocker() {
  const version = checkCommand('docker', ['--version']);
  if (!version.ok) {
    const reason = version.missing ? 'docker CLI not detected on PATH' : version.stderr || 'docker unavailable';
    return { available: false, reason };
  }
  return { available: true, version: version.stdout ?? '' };
}

async function terminateProcess(pid, label) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    if (err && err.code === 'ESRCH') {
      return;
    }
    throw err;
  }
  const timeoutMs = 3000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(100);
    try {
      process.kill(pid, 0);
    } catch (err) {
      if (err && err.code === 'ESRCH') {
        return;
      }
      break;
    }
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch (err) {
    if (!err || err.code !== 'ESRCH') {
      console.warn(`[dev-preflight] Failed to terminate ${label} (pid ${pid}): ${err?.message ?? err}`);
    }
  }
}

function shouldKillProcess(rule, commandLine) {
  if (!commandLine || rule.type === 'redis') {
    return false;
  }
  return commandLine.includes(REPO_ROOT);
}

function lookupProcessesForPort(port) {
  const result = runCommand('lsof', ['-nP', '-i', `:${port}`, '-sTCP:LISTEN', '-Fpcfn']);
  if (result.missing) {
    if (!warnedMissingLsof) {
      console.warn('[dev-preflight] Skipping port checks because "lsof" is not available.');
      warnedMissingLsof = true;
    }
    return [];
  }
  if (!result.ok && (!result.stderr || result.stderr.length === 0)) {
    // lsof exits with code 1 when nothing is found; treat as empty list.
    return [];
  }
  if (!result.ok) {
    console.warn(`[dev-preflight] Unable to inspect port ${port}: ${result.stderr}`);
    return [];
  }
  const entries = parseLsof(result.stdout ?? '');
  return entries.map((entry) => {
    const commandLine = getProcessCommandLine(entry.pid);
    return { ...entry, commandLine };
  });
}

async function ensurePortsClean() {
  const blocking = [];
  let skipRedis = false;

  for (const rule of PORT_RULES) {
    let attempts = 0;
    let remaining = lookupProcessesForPort(rule.port);

    while (remaining.length > 0 && attempts < 5) {
      const managed = remaining.filter((proc) => shouldKillProcess(rule, proc.commandLine));
      if (managed.length === 0) {
        if (rule.type === 'redis') {
          skipRedis = true;
        } else {
          blocking.push({ rule, processes: remaining });
        }
        break;
      }

      for (const proc of managed) {
        if (proc.pid === process.pid) {
          continue;
        }
        console.log(`[dev-preflight] Terminating stale ${rule.label} process (pid ${proc.pid}).`);
        await terminateProcess(proc.pid, rule.label);
      }

      attempts += 1;
      await sleep(100);
      remaining = lookupProcessesForPort(rule.port);
    }

    if (remaining.length === 0 && rule.type === 'redis') {
      skipRedis = false;
    }
  }

  return { blocking, skipRedis };
}

async function ensurePostgresReady() {
  if (!pgClient) {
    console.warn('[dev-preflight] Skipping PostgreSQL setup because the "pg" module is unavailable.');
    return;
  }

  const host = process.env.APPHUB_DEV_PGHOST ?? process.env.PGHOST ?? '127.0.0.1';
  const port = Number.parseInt(process.env.APPHUB_DEV_PGPORT ?? process.env.PGPORT ?? '5432', 10);
  const user = process.env.APPHUB_DEV_PGUSER ?? process.env.PGUSER ?? process.env.USER ?? 'postgres';
  const password = process.env.APPHUB_DEV_PGPASSWORD ?? process.env.PGPASSWORD;
  const client = new pgClient({ host, port, user, password, database: 'postgres' });

  try {
    await client.connect();
  } catch (err) {
    console.warn('[dev-preflight] Unable to connect to PostgreSQL at 127.0.0.1:5432. Ensure postgres is running.');
    return;
  }

  try {
    await client.query(
      "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'apphub') THEN CREATE ROLE apphub LOGIN PASSWORD 'apphub'; END IF; END $$;"
    );
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = 'apphub'");
    if (rowCount === 0) {
      await client.query("CREATE DATABASE apphub OWNER apphub");
      console.log('[dev-preflight] Created apphub database with owner apphub.');
    }
  } catch (err) {
    console.warn('[dev-preflight] Failed to ensure PostgreSQL role/database: ' + (err?.message ?? err));
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function runPreflight() {
  const { blocking, skipRedis } = await ensurePortsClean();

  if (blocking.length > 0) {
    const details = blocking
      .map((entry) => {
        const procDetails = entry.processes
          .map((proc) => `    - pid ${proc.pid}: ${proc.commandLine || proc.command || 'unknown'}`)
          .join('\n');
        return `  • ${entry.rule.label} (port ${entry.rule.port}) already in use:\n${procDetails}`;
      })
      .join('\n');
    throw new Error(`Unable to start dev environment because required ports are in use:\n${details}`);
  }

  await ensurePostgresReady();

  if (skipRedis) {
    console.log('[dev-preflight] Detected an existing Redis instance on port 6379. Skipping bundled Redis process.');
  }

  const kubectl = detectKubectl();
  const docker = detectDocker();

  if (!kubectl.available) {
    console.log('[dev-preflight] Kubernetes tooling unavailable: ' + (kubectl.reason ?? 'unknown reason'));
  } else {
    console.log('[dev-preflight] Kubernetes context detected: ' + (kubectl.context || 'unknown'));
  }

  if (!docker.available) {
    console.warn('[dev-preflight] Docker CLI unavailable: ' + (docker.reason ?? 'unknown reason'));
  }

  return { skipRedis, tooling: { kubectl, docker } };
}

module.exports = {
  runPreflight
};

if (require.main === module) {
  runPreflight()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('[dev-preflight] ' + (err?.message ?? err));
      process.exit(1);
    });
}

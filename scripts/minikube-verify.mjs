#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';

const NAMESPACE = process.env.APPHUB_NAMESPACE ?? 'apphub-system';

const flags = parseFlags(process.argv.slice(2));

main().catch((error) => {
  console.error(`\n❌  ${error.message}`);
  if (error.stdout) console.error(error.stdout);
  if (error.stderr) console.error(error.stderr);
  process.exit(error.code ?? 1);
});

async function main() {
  banner('AppHub Minikube Validation');

  await ensureDependency('kubectl');

  if (flags.checkIngress) {
    await ensureDependency('minikube');
  }

  await ensureNamespace();
  await ensurePodsReady();
  await checkRedis();
  await checkPostgres();
  await checkMinio();
  await checkHttp('catalog-api', 'http://apphub-catalog:4000/health');
  await checkHttp('metastore-api', 'http://apphub-metastore:4100/readyz');
  await checkHttp('filestore-api', 'http://apphub-filestore:4300/readyz');
  await checkHttp('timestore-api', 'http://apphub-timestore:4100/ready');

  if (flags.checkIngress) {
    await showIngressSummary();
  }

  console.log('\n✅  All health checks passed.');
}

function parseFlags(args) {
  const options = {
    checkIngress: false
  };

  for (const arg of args) {
    switch (arg) {
      case '--check-ingress':
        options.checkIngress = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log('Usage: npm run minikube:verify [-- --check-ingress]');
  console.log('\nFlags:');
  console.log('  --check-ingress  Include ingress host summary (requires minikube CLI)');
}

async function ensureDependency(bin) {
  await runCapture('which', [bin]).catch(() => {
    throw new Error(`Missing required dependency: ${bin}`);
  });
}

async function ensureNamespace() {
  const result = await runCapture('kubectl', ['get', 'namespace', NAMESPACE]).catch(() => null);
  if (!result) {
    throw new Error(`Namespace ${NAMESPACE} not found. Did you run npm run minikube:up?`);
  }
  info(`Namespace ${NAMESPACE} found.`);
}

async function ensurePodsReady() {
  step('Checking pod readiness');
  const data = await runCapture('kubectl', ['get', 'pods', '-n', NAMESPACE, '-o', 'json']);
  const parsed = JSON.parse(data.stdout || '{}');
  const notReady = [];
  for (const item of parsed.items ?? []) {
    const phase = item.status?.phase;
    if (phase === 'Succeeded') {
      continue;
    }
    const ready = (item.status?.containerStatuses ?? []).every((cs) => cs.ready);
    if (!ready) {
      notReady.push({
        name: item.metadata?.name,
        phase,
        conditions: item.status?.conditions
      });
    }
  }
  if (notReady.length > 0) {
    const summary = notReady.map((entry) => `  - ${entry.name} (phase=${entry.phase ?? 'unknown'})`).join('\n');
    throw new Error(`Not all pods are ready:\n${summary}`);
  }
  info('All pods report Ready.');
}

async function checkRedis() {
  step('Validating Redis connectivity');
  await run('kubectl', ['exec', '-n', NAMESPACE, 'statefulset/apphub-redis', '--', 'redis-cli', 'ping']);
}

async function checkPostgres() {
  step('Validating Postgres connectivity');
  await run('kubectl', ['exec', '-n', NAMESPACE, 'statefulset/apphub-postgres', '--', 'env', 'PGPASSWORD=postgres', 'psql', '-U', 'postgres', '-d', 'apphub', '-Atc', 'select 1']);
}

async function checkMinio() {
  step('Validating MinIO buckets');
  const script = `set -euo pipefail\nmc alias set verify http://apphub-minio:9000 apphub apphub123 >/dev/null\nmc ls verify/apphub-example-bundles >/dev/null\nmc ls verify/apphub-filestore >/dev/null\nmc ls verify/apphub-timestore >/dev/null`;
  await run('kubectl', [
    'run',
    uniqueName('verify-minio'),
    '--namespace',
    NAMESPACE,
    '--attach',
    '--rm',
    '--restart=Never',
    '--image=minio/mc:latest',
    '--command',
    '--',
    'sh',
    '-c',
    script
  ]);
}

async function checkHttp(label, url) {
  step(`Validating ${label} (${url})`);
  await run('kubectl', [
    'run',
    uniqueName(`verify-${label}`),
    '--namespace',
    NAMESPACE,
    '--attach',
    '--rm',
    '--restart=Never',
    '--image=curlimages/curl:8.6.0',
    '--command',
    '--',
    'curl',
    '-fsS',
    '--retry',
    '5',
    '--retry-connrefused',
    '--retry-delay',
    '2',
    url
  ]);
}

async function showIngressSummary() {
  step('Ingress host summary');
  const ipRes = await runCapture('minikube', ['ip']).catch(() => ({ stdout: '<minikube-ip>' }));
  const minikubeIp = ipRes.stdout.trim() || '<minikube-ip>';
  const hosts = ['apphub.local', 'catalog.apphub.local', 'metastore.apphub.local', 'filestore.apphub.local', 'timestore.apphub.local'];
  console.log(`Ingress available via:\n  ${hosts.map((h) => `http://${h}`).join('\n  ')}`);
  console.log(`\n/etc/hosts entry:\n  ${minikubeIp} ${hosts.join(' ')}`);
}

function uniqueName(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function banner(message) {
  console.log(`\n=== ${message} ===\n`);
}

function step(message) {
  console.log(`\n▶️  ${message}`);
}

function info(message) {
  console.log(`   ${message}`);
}

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const spawned = spawn(cmd, args, { stdio: 'inherit', ...options });
    spawned.on('error', reject);
    spawned.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const error = new Error(`Command failed: ${cmd} ${args.join(' ')}`);
        error.code = code ?? 1;
        reject(error);
      }
    });
  });
}

function runCapture(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const spawned = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';
    spawned.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    spawned.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    spawned.on('error', reject);
    spawned.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        const error = new Error(`Command failed: ${cmd} ${args.join(' ')}`);
        error.code = code ?? 1;
        error.stdout = stdout.trim();
        error.stderr = stderr.trim();
        reject(error);
      }
    });
  });
}

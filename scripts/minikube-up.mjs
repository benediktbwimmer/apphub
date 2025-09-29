#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { EOL } from 'node:os';
import process from 'node:process';

const NAMESPACE = 'apphub-system';
const DEFAULT_MEMORY = process.env.APPHUB_MINIKUBE_MEMORY ?? '8192';
const DEFAULT_CPUS = process.env.APPHUB_MINIKUBE_CPUS ?? '4';
const DEFAULT_VITE_API_BASE_URL = process.env.APPHUB_MINIKUBE_API_BASE ?? 'http://catalog.apphub.local';
const IMAGE_PREFIX = process.env.APPHUB_IMAGE_PREFIX ?? 'apphub';
const IMAGE_TAG = process.env.APPHUB_IMAGE_TAG ?? 'dev';
const SERVICES = ['catalog', 'metastore', 'filestore', 'timestore', 'frontend'];

const flags = parseFlags(process.argv.slice(2));

main().catch((error) => {
  console.error(`\n❌  ${error.message}`);
  if (error.stdout) {
    console.error(error.stdout);
  }
  if (error.stderr) {
    console.error(error.stderr);
  }
  process.exit(error.code ?? 1);
});

async function main() {
  banner('AppHub Minikube Bootstrap');

  await ensureDependencies(['minikube', 'kubectl', 'docker']);

  if (!flags.skipStart) {
    await ensureMinikubeRunning();
  } else {
    info('Skipping minikube start per flag.');
  }

  await enableIngressAddon();

  if (!flags.skipBuild) {
    await buildImages();
  } else {
    info('Skipping Docker build per flag.');
  }

  if (!flags.skipLoad) {
    await loadImages();
  } else {
    info('Skipping image load per flag.');
  }

  await applyManifests();
  await waitForResources();
  await summarize();

  if (flags.verify) {
    await run('npm', ['run', 'minikube:verify']);
  } else {
    info('Run npm run minikube:verify to validate service health.');
  }
}

function parseFlags(args) {
  const options = {
    skipBuild: false,
    skipLoad: false,
    skipStart: false,
    verify: false
  };

  for (const arg of args) {
    switch (arg) {
      case '--skip-build':
        options.skipBuild = true;
        break;
      case '--skip-load':
        options.skipLoad = true;
        break;
      case '--skip-start':
        options.skipStart = true;
        break;
      case '--verify':
        options.verify = true;
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
  console.log(`Usage: npm run minikube:up [-- --skip-build --skip-load --skip-start]${EOL}`);
  console.log('Flags:');
  console.log('  --skip-build   Skip rebuilding Docker images (use existing tag)');
  console.log('  --skip-load    Skip loading images into minikube');
  console.log('  --skip-start   Skip minikube start/addon enablement (assume running cluster)');
  console.log('  --verify       Run npm run minikube:verify after deployment');
}

async function ensureDependencies(binaries) {
  step('Checking prerequisites');
  for (const bin of binaries) {
    await runCapture('which', [bin]).catch((error) => {
      throw new Error(`Missing required dependency: ${bin}`);
    });
    info(`  - ${bin}`);
  }
}

async function ensureMinikubeRunning() {
  step('Ensuring minikube is running');
  const status = await runCapture('minikube', ['status', '--output=json']).catch(() => ({ stdout: '' }));
  let shouldStart = true;
  if (status.stdout) {
    try {
      const parsed = JSON.parse(status.stdout);
      shouldStart = !['Running', 'Queued'].includes(parsed?.Host) || !['Running', 'Queued'].includes(parsed?.Kubelet);
    } catch {
      shouldStart = true;
    }
  }

  if (shouldStart) {
    await run('minikube', ['start', `--memory=${DEFAULT_MEMORY}`, `--cpus=${DEFAULT_CPUS}`]);
  } else {
    info('Minikube already running.');
  }
}

async function enableIngressAddon() {
  step('Enabling NGINX ingress addon');
  await run('minikube', ['addons', 'enable', 'ingress']);
}

async function buildImages() {
  step('Building AppHub service images');
  const env = {
    ...process.env,
    VITE_API_BASE_URL: DEFAULT_VITE_API_BASE_URL,
    APPHUB_IMAGE_PREFIX: IMAGE_PREFIX,
    APPHUB_IMAGE_TAG: IMAGE_TAG
  };
  await run('npm', ['run', 'docker:build:services'], { env });
}

async function loadImages() {
  step('Loading images into minikube');
  for (const service of SERVICES) {
    const imageRef = `${IMAGE_PREFIX}/${service}:${IMAGE_TAG}`;
    await loadImage(imageRef);
  }
}

async function loadImage(imageRef) {
  try {
    await run('minikube', ['image', 'load', imageRef, '--overwrite']);
  } catch (error) {
    info(`   retrying without --overwrite for ${imageRef}`);
    await run('minikube', ['image', 'load', imageRef]);
  }
}

async function applyManifests() {
  step('Applying Kubernetes manifests');
  await run('kubectl', ['apply', '-k', 'infra/minikube']);
}

async function waitForResources() {
  step('Waiting for infrastructure statefulsets');
  await waitForRollout('statefulset', ['apphub-postgres', 'apphub-redis']);

  step('Waiting for bootstrap jobs');
  await waitForJobs(['apphub-postgres-bootstrap', 'apphub-minio-bootstrap']);

  step('Waiting for deployments to become available');
  const deployments = await listResources('deployment');
  await waitForRollout('deployment', deployments);
}

async function waitForRollout(kind, names) {
  for (const name of names) {
    if (!name) continue;
    await run('kubectl', ['rollout', 'status', `${kind}/${name}`, '-n', NAMESPACE, '--timeout=600s']);
  }
}

async function waitForJobs(jobNames) {
  for (const job of jobNames) {
    const exists = await resourceExists('job', job);
    if (!exists) continue;
    await run('kubectl', ['wait', '--for=condition=complete', `job/${job}`, '-n', NAMESPACE, '--timeout=600s']);
  }
}

async function listResources(kind) {
  const result = await runCapture('kubectl', ['get', kind, '-n', NAMESPACE, '-o', 'jsonpath={range .items[*]}{.metadata.name}{"\\n"}{end}']).catch(() => ({ stdout: '' }));
  return result.stdout
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function resourceExists(kind, name) {
  const result = await runCapture('kubectl', ['get', kind, name, '-n', NAMESPACE]).catch(() => null);
  return Boolean(result);
}

async function resolveIngressAddress() {
  let address = null;
  let note = '';

  const svcResult = await runCapture('kubectl', [
    'get',
    'svc',
    'ingress-nginx-controller',
    '-n',
    'ingress-nginx',
    '-o',
    'json'
  ]).catch(() => null);

  if (svcResult?.stdout) {
    try {
      const svc = JSON.parse(svcResult.stdout);
      const lbIngress = Array.isArray(svc?.status?.loadBalancer?.ingress)
        ? svc.status.loadBalancer.ingress
        : [];
      const ipEntry = lbIngress.find((entry) => entry?.ip);
      const hostnameEntry = lbIngress.find((entry) => entry?.hostname);
      address = ipEntry?.ip ?? hostnameEntry?.hostname ?? null;
      if (!address && Array.isArray(svc?.spec?.externalIPs) && svc.spec.externalIPs.length > 0) {
        address = svc.spec.externalIPs[0];
      }
    } catch {
      // noop, fall back below
    }
  }

  if (!address) {
    const ipResult = await runCapture('minikube', ['ip']).catch(() => null);
    address = ipResult?.stdout?.trim() || null;
  }

  if (!address) {
    address = '<resolve-ingress-ip>';
  }

  if (address === '127.0.0.1') {
    note = 'Using the Docker driver: map hosts to 127.0.0.1 (the minikube VM IP will time out).';
  }

  return { address, note };
}

async function summarize() {
  step('Final summary');
  const ingressAddress = await resolveIngressAddress();

  const table = [
    { host: 'apphub.local', description: 'Frontend UI' },
    { host: 'catalog.apphub.local', description: 'Catalog API' },
    { host: 'metastore.apphub.local', description: 'Metastore API' },
    { host: 'filestore.apphub.local', description: 'Filestore API' },
    { host: 'timestore.apphub.local', description: 'Timestore API' }
  ];

  console.log(`\n✅  AppHub deployed to namespace ${NAMESPACE}.`);
  console.log('\nIngress hosts (ensure they resolve to the ingress controller address):');
  for (const entry of table) {
    console.log(`  - ${entry.host} (${entry.description})`);
  }
  console.log(`\nSuggested /etc/hosts entry:`);
  console.log(`  ${ingressAddress.address} ${table.map((entry) => entry.host).join(' ')}`);
  if (ingressAddress.note) {
    console.log(`  Note: ${ingressAddress.note}`);
  }

  console.log('\nDefault credentials:');
  console.log('  - Postgres: apphub / apphub');
  console.log('  - MinIO: apphub / apphub123');
  console.log('  - Redis: no auth');

  console.log('\nNext steps:');
  console.log('  1. Update /etc/hosts with the line above (requires sudo).');
  console.log('  2. Open http://apphub.local in your browser.');
  console.log('  3. Use npm run minikube:down to tear everything down later.');
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
    spawned.on('error', (error) => {
      reject(error);
    });
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

function banner(message) {
  console.log(`\n=== ${message} ===\n`);
}

function step(message) {
  console.log(`\n▶️  ${message}`);
}

function info(message) {
  console.log(`   ${message}`);
}

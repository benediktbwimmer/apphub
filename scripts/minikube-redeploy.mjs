#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { EOL } from 'node:os';
import process from 'node:process';

const NAMESPACE = 'apphub-system';
const IMAGE_PREFIX = process.env.APPHUB_IMAGE_PREFIX ?? 'apphub';
const IMAGE_TAG = process.env.APPHUB_IMAGE_TAG ?? 'dev';
const DEFAULT_VITE_API_BASE_URL = process.env.APPHUB_MINIKUBE_API_BASE ?? 'http://catalog.apphub.local';
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
  banner('AppHub Minikube Redeploy');

  await ensureDependencies(['docker', 'minikube', 'kubectl']);

  if (!flags.skipBuild) {
    await buildImages();
  } else {
    info('Skipping Docker image build per flag.');
  }

  if (!flags.skipLoad) {
    await loadImages();
  } else {
    info('Skipping minikube image load per flag.');
  }

  if (!flags.skipApply) {
    await applyManifests();
  } else {
    info('Skipping manifest apply per flag.');
  }

  await restartDeployments();
  await summarize();

  if (flags.verify) {
    await run('npm', ['run', 'minikube:verify']);
  } else {
    info('Run npm run minikube:verify to smoke-test the stack.');
  }
}

function parseFlags(args) {
  const options = {
    skipBuild: false,
    skipLoad: false,
    skipApply: false,
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
      case '--skip-apply':
        options.skipApply = true;
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
  console.log(`Usage: npm run minikube:redeploy [-- --skip-build --skip-load --skip-apply --verify]${EOL}`);
  console.log('Flags:');
  console.log('  --skip-build   Skip rebuilding Docker images (reuse existing tag)');
  console.log('  --skip-load    Skip loading images into minikube');
  console.log('  --skip-apply   Skip kubectl apply (only restart deployments)');
  console.log('  --verify       Run npm run minikube:verify after redeploy');
}

async function ensureDependencies(binaries) {
  step('Checking prerequisites');
  for (const bin of binaries) {
    await runCapture('which', [bin]).catch(() => {
      throw new Error(`Missing required dependency: ${bin}`);
    });
    info(`  - ${bin}`);
  }
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
    try {
      await run('minikube', ['image', 'load', imageRef, '--overwrite']);
    } catch (error) {
      info(`   retrying without --overwrite for ${imageRef}`);
      await run('minikube', ['image', 'load', imageRef]);
    }
  }
}

async function applyManifests() {
  step('Applying Kubernetes manifests');
  await run('kubectl', ['apply', '-k', 'infra/minikube']);
}

async function restartDeployments() {
  step('Restarting AppHub workloads');
  const deployments = await listApphubDeployments();

  if (deployments.length === 0) {
    info('No AppHub deployments found in cluster.');
    return;
  }

  const rolloutTargets = deployments.map((name) => `deployment/${name}`);
  for (const target of rolloutTargets) {
    info(`  - ${target}`);
    await run('kubectl', ['rollout', 'restart', target, '-n', NAMESPACE]);
  }

  for (const target of rolloutTargets) {
    await run('kubectl', ['rollout', 'status', target, '-n', NAMESPACE, '--timeout=600s']);
  }
}

async function listApphubDeployments() {
  const result = await runCapture('kubectl', ['get', 'deployments', '-n', NAMESPACE, '-o', 'json']);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout ?? '{}');
  } catch (error) {
    throw new Error('Failed to parse kubectl deployments JSON output');
  }

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const prefix = `${IMAGE_PREFIX}/`;
  const deployments = [];

  for (const item of items) {
    const name = item?.metadata?.name;
    if (!name) continue;

    const containers = [
      ...(item?.spec?.template?.spec?.containers ?? []),
      ...(item?.spec?.template?.spec?.initContainers ?? [])
    ];

    const usesApphubImage = containers.some((container) => typeof container?.image === 'string' && container.image.startsWith(prefix));

    if (usesApphubImage) {
      deployments.push(name);
    }
  }

  deployments.sort();
  return deployments;
}

async function summarize() {
  step('Current workload status');
  await run('kubectl', ['get', 'pods', '-n', NAMESPACE]);
}

function banner(message) {
  console.log(`\n${message}`);
  console.log('='.repeat(message.length));
}

function step(message) {
  console.log(`\n➡️  ${message}`);
}

function info(message) {
  console.log(message);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(Object.assign(new Error(`${command} exited with code ${code}`), { code }));
      }
    });
  });
}

function runCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const child = spawn(command, args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      ...options
    });

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(Object.assign(new Error(`${command} exited with code ${code}`), { code, stdout, stderr }));
      }
    });
  });
}

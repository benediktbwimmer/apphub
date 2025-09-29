#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { EOL } from 'node:os';
import process from 'node:process';

const NAMESPACE = 'apphub-system';
const IMAGE_PREFIX = process.env.APPHUB_IMAGE_PREFIX ?? 'apphub';
const IMAGE_TAG = process.env.APPHUB_IMAGE_TAG ?? 'dev';
const SERVICES = ['catalog', 'metastore', 'filestore', 'timestore', 'frontend'];

const flags = parseFlags(process.argv.slice(2));

main().catch((error) => {
  console.error(`\n❌  ${error.message}`);
  process.exit(error.code ?? 1);
});

async function main() {
  banner('AppHub Minikube Teardown');

  if (!flags.skipKube) {
    await deleteNamespace();
  } else {
    info('Skipping namespace deletion per flag.');
  }

  if (flags.purgeImages) {
    await removeImages();
  }

  if (flags.stopCluster) {
    await stopMinikube();
  }

  console.log('\n✅  Cleanup complete.');
  console.log('Remember to remove /etc/hosts entries if you no longer need them.');
}

function parseFlags(args) {
  const options = {
    purgeImages: false,
    stopCluster: false,
    skipKube: false
  };

  for (const arg of args) {
    switch (arg) {
      case '--purge-images':
        options.purgeImages = true;
        break;
      case '--stop-cluster':
        options.stopCluster = true;
        break;
      case '--skip-kube':
        options.skipKube = true;
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
  console.log(`Usage: npm run minikube:down [-- --purge-images --stop-cluster --skip-kube]${EOL}`);
  console.log('Flags:');
  console.log('  --purge-images   Remove AppHub images from the minikube cache');
  console.log('  --stop-cluster   Stop the minikube VM after deleting AppHub resources');
  console.log('  --skip-kube      Skip Kubernetes namespace deletion (just run extras)');
}

async function deleteNamespace() {
  step(`Deleting namespace ${NAMESPACE}`);
  await run('kubectl', ['delete', 'namespace', NAMESPACE, '--ignore-not-found', '--wait=true']);
}

async function removeImages() {
  step('Removing images from minikube cache');
  for (const service of SERVICES) {
    const imageRef = `${IMAGE_PREFIX}/${service}:${IMAGE_TAG}`;
    await run('minikube', ['image', 'rm', imageRef]).catch(() => info(`   skipping missing image ${imageRef}`));
  }
}

async function stopMinikube() {
  step('Stopping minikube cluster');
  await run('minikube', ['stop']);
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

function banner(message) {
  console.log(`\n=== ${message} ===\n`);
}

function step(message) {
  console.log(`\n▶️  ${message}`);
}

function info(message) {
  console.log(`   ${message}`);
}

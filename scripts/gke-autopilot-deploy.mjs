#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVICES = ['core', 'metastore', 'filestore', 'timestore', 'frontend', 'website'];
const DEFAULTS = {
  region: process.env.APPHUB_GKE_REGION ?? 'europe-west1',
  repo: process.env.APPHUB_GKE_REPO ?? 'apphub',
  tag: process.env.APPHUB_GKE_IMAGE_TAG ?? 'latest',
  namespace: process.env.APPHUB_GKE_NAMESPACE ?? 'apphub-system'
};

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const project = args.project ?? process.env.APPHUB_GKE_PROJECT;
const bucket = args.bucket ?? process.env.APPHUB_GKE_TIMESTORE_BUCKET;
const clickhouseAccessKey =
  args.clickhouseAccessKey ?? process.env.APPHUB_GKE_CLICKHOUSE_ACCESS_KEY;
const clickhouseSecretKey =
  args.clickhouseSecretKey ?? process.env.APPHUB_GKE_CLICKHOUSE_SECRET_KEY;
const clickhousePassword =
  args.clickhousePassword ?? process.env.APPHUB_GKE_CLICKHOUSE_PASSWORD;
const region = args.region ?? DEFAULTS.region;
const registryHost = args.registryHost ?? `${region}-docker.pkg.dev`;
const repo = args.repo ?? DEFAULTS.repo;
const tag = args.tag ?? DEFAULTS.tag;
const namespace = args.namespace ?? DEFAULTS.namespace;
const frontendApiBaseUrl = args.frontendApi ?? process.env.APPHUB_FRONTEND_API_BASE_URL ?? null;
const skipBuild = args.skipBuild;
const skipPush = args.skipPush;
const skipSecrets = args.skipSecrets;
const skipApply = args.skipApply;
const bundleSigningSecret =
  args.bundleSigningSecret ?? process.env.APPHUB_BUNDLE_STORAGE_SIGNING_SECRET ?? 'local-dev-signing-secret';

const registryPrefix = args.registryPrefix ?? `${registryHost}/${project}/${repo}`;
const repoRoot = runCapture('git', ['rev-parse', '--show-toplevel']).trim();
const settingsPath = join(repoRoot, 'infra', 'gke-autopilot', 'autopilot-settings.env');

try {
  ensureCommand('docker');
  ensureCommand('npm');

  if (!skipPush || !skipBuild) {
    ensureCommand('gcloud', ['--version']);
  }

  if (!skipSecrets || !skipApply) {
    ensureCommand('kubectl', ['version', '--client']);
  }

  if (!project) throw new Error('Missing --project (or APPHUB_GKE_PROJECT)');
  if (!bucket) throw new Error('Missing --bucket (or APPHUB_GKE_TIMESTORE_BUCKET)');

  if (!skipSecrets) {
    if (!clickhouseAccessKey) {
      throw new Error('Missing --clickhouse-access-key (or APPHUB_GKE_CLICKHOUSE_ACCESS_KEY)');
    }
    if (!clickhouseSecretKey) {
      throw new Error('Missing --clickhouse-secret-key (or APPHUB_GKE_CLICKHOUSE_SECRET_KEY)');
    }
    if (!clickhousePassword) {
      throw new Error('Missing --clickhouse-password (or APPHUB_GKE_CLICKHOUSE_PASSWORD)');
    }
  }

  banner('AppHub GKE Autopilot Deployment');
  info(`Project:          ${project}`);
  info(`Region:           ${region}`);
  info(`Artifact Repo:    ${registryPrefix}`);
  info(`Image Tag:        ${tag}`);
  info(`Timestore Bucket: ${bucket}`);
  info(`Namespace:        ${namespace}`);
  if (frontendApiBaseUrl) {
    info(`Frontend API:     ${frontendApiBaseUrl}`);
  }

  step('Updating infra/gke-autopilot/autopilot-settings.env');
  writeEnv(settingsPath, {
    projectId: project,
    timestoreBucket: bucket,
    registryPrefix,
    imageTag: tag
  });

  if (!skipBuild) {
    step('Building service images');
    const env = {
      ...process.env,
      APPHUB_IMAGE_PREFIX: registryPrefix,
      APPHUB_IMAGE_TAG: tag
    };
    if (frontendApiBaseUrl) {
      env.VITE_API_BASE_URL = frontendApiBaseUrl;
    }
    run('npm', ['run', 'docker:build:services'], { cwd: repoRoot, env });
  } else {
    info('Skipping Docker build per flag.');
  }

  if (!skipPush) {
    step('Pushing images to Artifact Registry');
    for (const service of SERVICES) {
      const imageRef = `${registryPrefix}/${service}:${tag}`;
      run('docker', ['push', imageRef], { cwd: repoRoot });
    }
  } else {
    info('Skipping docker push per flag.');
  }

  if (!skipSecrets || !skipApply) {
    step(`Ensuring namespace ${namespace} exists`);
    applyManifestFromFile('infra/minikube/namespace.yaml', args.kubectlContext);
  }

  if (!skipSecrets) {
    step('Applying ClickHouse secrets');
    applySecret(
      namespace,
      'clickhouse-s3',
      {
        CLICKHOUSE_S3_ACCESS_KEY_ID: clickhouseAccessKey,
        CLICKHOUSE_S3_SECRET_ACCESS_KEY: clickhouseSecretKey
      },
      args.kubectlContext
    );
    applySecret(
      namespace,
      'clickhouse-auth',
      { password: clickhousePassword },
      args.kubectlContext
    );
    applySecret(
      namespace,
      'apphub-core-secrets',
      {
        DATABASE_URL: 'postgres://apphub:apphub@apphub-postgres:5432/apphub',
        FILESTORE_DATABASE_URL: 'postgres://apphub:apphub@apphub-postgres:5432/apphub',
        TIMESTORE_DATABASE_URL: 'postgres://apphub:apphub@apphub-postgres:5432/apphub',
        REDIS_URL: 'redis://apphub-redis:6379',
        FILESTORE_REDIS_URL: 'redis://apphub-redis:6379',
        TIMESTORE_MANIFEST_CACHE_REDIS_URL: 'redis://apphub-redis:6379',
        APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID: clickhouseAccessKey,
        APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY: clickhouseSecretKey,
        APPHUB_BUNDLE_STORAGE_SIGNING_SECRET: bundleSigningSecret,
        APPHUB_JOB_BUNDLE_SIGNING_SECRET: bundleSigningSecret,
        FILESTORE_S3_ACCESS_KEY_ID: clickhouseAccessKey,
        FILESTORE_S3_SECRET_ACCESS_KEY: clickhouseSecretKey
      },
      args.kubectlContext
    );
  } else {
    info('Skipping secret management per flag.');
  }

  if (!skipApply) {
    step('Applying manifests');
    const kustomizeArgs = [
      'kustomize',
      'infra/gke-autopilot',
      '--load-restrictor=LoadRestrictionsNone'
    ];
    if (args.kubectlContext) {
      kustomizeArgs.push(`--context=${args.kubectlContext}`);
    }
    const rendered = runCapture('kubectl', kustomizeArgs, { cwd: repoRoot });
    const applyArgs = ['apply', '-f', '-'];
    if (args.kubectlContext) {
      applyArgs.push(`--context=${args.kubectlContext}`);
    }
    runWithInput('kubectl', applyArgs, rendered, { cwd: repoRoot });
  } else {
    info('Skipping kubectl apply per flag.');
  }

  console.log('\n✅ GKE Autopilot deployment workflow completed.');
} catch (error) {
  console.error(`\n❌ ${error.message}`);
  process.exit(error.exitCode ?? error.code ?? 1);
}

function parseArgs(argv) {
  const options = {
    skipBuild: false,
    skipPush: false,
    skipSecrets: false,
    skipApply: false,
    help: false
  };

  const queue = [...argv];
  while (queue.length) {
    const arg = queue.shift();
    switch (arg) {
      case '--project':
        options.project = requireValue(arg, queue.shift());
        break;
      case '--region':
        options.region = requireValue(arg, queue.shift());
        break;
      case '--registry-host':
        options.registryHost = requireValue(arg, queue.shift());
        break;
      case '--registry-prefix':
        options.registryPrefix = requireValue(arg, queue.shift());
        break;
      case '--repo':
        options.repo = requireValue(arg, queue.shift());
        break;
      case '--tag':
        options.tag = requireValue(arg, queue.shift());
        break;
      case '--bucket':
        options.bucket = requireValue(arg, queue.shift());
        break;
      case '--namespace':
        options.namespace = requireValue(arg, queue.shift());
        break;
      case '--bundle-signing-secret':
        options.bundleSigningSecret = requireValue(arg, queue.shift());
        break;
      case '--frontend-api':
        options.frontendApi = requireValue(arg, queue.shift());
        break;
      case '--clickhouse-access-key':
        options.clickhouseAccessKey = requireValue(arg, queue.shift());
        break;
      case '--clickhouse-secret-key':
        options.clickhouseSecretKey = requireValue(arg, queue.shift());
        break;
      case '--clickhouse-password':
        options.clickhousePassword = requireValue(arg, queue.shift());
        break;
      case '--kubectl-context':
        options.kubectlContext = requireValue(arg, queue.shift());
        break;
      case '--skip-build':
        options.skipBuild = true;
        break;
      case '--skip-push':
        options.skipPush = true;
        break;
      case '--skip-secrets':
        options.skipSecrets = true;
        break;
      case '--skip-apply':
        options.skipApply = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function requireValue(flag, value) {
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: npm run deploy:gke-autopilot -- [options]\n`);
  console.log('Required:');
  console.log('  --project <id>                 GCP project ID (or APPHUB_GKE_PROJECT)');
  console.log('  --bucket <name>                GCS bucket for timestore cold storage');
  console.log(
    '  --clickhouse-access-key <id>   HMAC access key for ClickHouse GCS offload (skip with --skip-secrets)'
  );
  console.log(
    '  --clickhouse-secret-key <key>  HMAC secret key (skip with --skip-secrets)'
  );
  console.log(
    '  --clickhouse-password <pass>   ClickHouse user password (skip with --skip-secrets)'
  );
  console.log('\nOptional:');
  console.log('  --region <region>              Artifact Registry region (default europe-west1)');
  console.log(
    '  --registry-host <host>         Override Artifact Registry host (defaults to <region>-docker.pkg.dev)'
  );
  console.log(
    '  --registry-prefix <prefix>     Override full registry prefix (overrides host/project/repo)'
  );
  console.log('  --repo <name>                  Artifact Registry repo name (default apphub)');
  console.log('  --tag <value>                  Image tag to publish (default latest)');
  console.log('  --namespace <ns>               Kubernetes namespace (default apphub-system)');
  console.log('  --bundle-signing-secret <val>  Override APPHUB_BUNDLE_STORAGE_SIGNING_SECRET');
  console.log('  --frontend-api <url>           VITE_API_BASE_URL baked into the frontend image');
  console.log('  --kubectl-context <name>       Pass a specific kubectl context');
  console.log('  --skip-build                   Reuse existing local images');
  console.log('  --skip-push                    Skip docker push (implies images already exist remotely)');
  console.log('  --skip-secrets                 Skip managing ClickHouse secrets');
  console.log('  --skip-apply                   Skip kubectl apply (only update config + images)');
}

function ensureCommand(binary, args = ['--version']) {
  const commandArgs = Array.isArray(args) ? args : [args];
  const result = spawnSync(binary, commandArgs, { stdio: 'ignore' });
  if (result.status !== 0) {
    throw new Error(`Required command "${binary}" not found in PATH`);
  }
}

function run(cmd, cmdArgs, options = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    stdio: 'inherit',
    ...options
  });
  if (result.status !== 0) {
    const error = new Error(`[${cmd}] exited with status ${result.status ?? 'unknown'}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
  return result;
}

function runCapture(cmd, cmdArgs, options = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    stdio: ['inherit', 'pipe', 'inherit'],
    encoding: 'utf8',
    ...options
  });
  if (result.status !== 0) {
    const error = new Error(`[${cmd}] exited with status ${result.status ?? 'unknown'}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
  return result.stdout.trim();
}

function runWithInput(cmd, cmdArgs, input, options = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    stdio: ['pipe', 'inherit', 'inherit'],
    input,
    ...options
  });
  if (result.status !== 0) {
    const error = new Error(`[${cmd}] exited with status ${result.status ?? 'unknown'}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
  return result;
}

function banner(message) {
  console.log(`\n▶ ${message}`);
}

function step(message) {
  console.log(`\n→ ${message}`);
}

function info(message) {
  console.log(`   ${message}`);
}

function writeEnv(filePath, values) {
  const lines = [
    `projectId=${values.projectId}`,
    `timestoreBucket=${values.timestoreBucket}`,
    `registryPrefix=${values.registryPrefix}`,
    `imageTag=${values.imageTag}`
  ];
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function applySecret(namespace, name, data, kubectlContext) {
  const manifest = buildSecretManifest(namespace, name, data);
  const args = ['apply', '-f', '-'];
  if (kubectlContext) {
    args.push(`--context=${kubectlContext}`);
  }
  const result = spawnSync('kubectl', args, {
    stdio: ['pipe', 'inherit', 'inherit'],
    input: manifest
  });
  if (result.status !== 0) {
    const error = new Error(
      `[kubectl] secret ${name} apply failed with status ${result.status ?? 'unknown'}`
    );
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

function buildSecretManifest(namespace, name, stringData) {
  const lines = [
    'apiVersion: v1',
    'kind: Secret',
    'type: Opaque',
    'metadata:',
    `  name: ${name}`,
    `  namespace: ${namespace}`,
    'stringData:'
  ];
  for (const [key, value] of Object.entries(stringData)) {
    lines.push(`  ${key}: ${value}`);
  }
  return `${lines.join('\n')}\n`;
}

function applyManifestFromFile(relativePath, kubectlContext) {
  const args = ['apply', '-f', relativePath];
  if (kubectlContext) {
    args.push(`--context=${kubectlContext}`);
  }
  run('kubectl', args, { cwd: repoRoot });
}

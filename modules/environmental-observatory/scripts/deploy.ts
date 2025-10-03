import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fetch } from 'undici';
import {
  readModuleDescriptor,
  resolveBundleManifests,
  readBundleSlugFromConfig,
  type EventDrivenObservatoryConfig
} from '@apphub/module-registry';
import { materializeObservatoryConfig } from './lib/config';
import { synchronizeObservatoryWorkflowsAndTriggers, type SyncLogger } from './lib/workflows';

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_BUNDLE_TIMEOUT_MS = 5 * 60 * 1000;
const OBSERVATORY_MODULE_ID = 'github.com/apphub/examples/environmental-observatory-event-driven';

async function coreRequest<T>(
  baseUrl: string,
  token: string | null,
  method: 'GET' | 'POST' | 'PATCH',
  requestPath: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(new URL(requestPath, baseUrl), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Core request failed (${response.status} ${response.statusText}): ${text}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

type BundleStatus = {
  state: 'queued' | 'running' | 'completed' | 'failed';
  error: string | null;
  message: string | null;
};

type BundleStatusResponse = {
  data: {
    status: BundleStatus | null;
  };
};

async function waitForBundleCompletion(
  baseUrl: string,
  token: string,
  slug: string,
  options: { pollIntervalMs?: number; timeoutMs?: number } = {}
): Promise<void> {
  const pollInterval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_BUNDLE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await coreRequest<BundleStatusResponse>(
      baseUrl,
      token,
      'GET',
      `/job-imports/example/${slug}`
    );
    const status = response.data.status;
    if (!status) {
      await sleep(pollInterval);
      continue;
    }
    if (status.state === 'completed') {
      return;
    }
    if (status.state === 'failed') {
      throw new Error(
        `Packaging ${slug} failed: ${status.error ?? status.message ?? 'unknown error'}`
      );
    }
    await sleep(pollInterval);
  }

  throw new Error(`Timed out waiting for bundle ${slug} to finish packaging`);
}

async function deployModuleBundles(
  baseUrl: string,
  token: string,
  moduleDistRoot: string
): Promise<void> {
  const descriptorPath = path.resolve(moduleDistRoot, 'config.json');
  const descriptorFile = await readModuleDescriptor(descriptorPath);
  const bundleManifests = resolveBundleManifests(descriptorFile);

  if (bundleManifests.length === 0) {
    console.log('No bundle manifests declared in descriptor; skipping bundle deployment.');
    return;
  }

  const slugs: string[] = [];
  for (const manifest of bundleManifests) {
    const slug = await readBundleSlugFromConfig(manifest.absolutePath);
    if (!slug) {
      console.warn(`Skipping bundle manifest without slug: ${manifest.absolutePath}`);
      continue;
    }
    slugs.push(slug.trim().toLowerCase());
  }

  if (slugs.length === 0) {
    console.log('No bundle slugs discovered; skipping bundle deployment.');
    return;
  }

  console.log(`Deploying ${slugs.length} observatory job bundle(s)...`);
  for (const slug of slugs) {
    console.log(`  • Packaging ${slug}`);
    const payload = {
      slug,
      force: true,
      descriptor: {
        module: descriptorFile.descriptor.module ?? OBSERVATORY_MODULE_ID,
        path: path.dirname(descriptorFile.configPath)
      }
    } as const;

    const response = await coreRequest<{ data: { mode: 'inline' | 'queued' } }>(
      baseUrl,
      token,
      'POST',
      '/job-imports/example',
      payload
    );

    if (response.data.mode === 'queued') {
      await waitForBundleCompletion(baseUrl, token, slug);
    }

    await importExampleJob(baseUrl, token, slug);
  }
}

async function importExampleJob(baseUrl: string, token: string, slug: string): Promise<void> {
  console.log(`  • Publishing ${slug}`);
  await coreRequest(baseUrl, token, 'POST', '/job-imports', {
    source: 'example',
    slug
  });
}

function deriveDataRoot(config: EventDrivenObservatoryConfig): string {
  const segments = config.filestore.inboxPrefix.split('/').filter(Boolean);
  let current = path.resolve(config.paths.inbox);
  for (const _ of segments) {
    current = path.dirname(current);
  }
  return current;
}

async function importServiceManifests(
  baseUrl: string,
  token: string | null,
  moduleDistRoot: string,
  config: EventDrivenObservatoryConfig,
  configPath: string
): Promise<void> {
  const modulePath = path.resolve(moduleDistRoot);
  const payload = {
    module: OBSERVATORY_MODULE_ID,
    path: modulePath,
    configPath: 'config.json',
    variables: {
      OBSERVATORY_CONFIG_PATH: configPath,
      OBSERVATORY_DATA_ROOT: deriveDataRoot(config)
    }
  } as const;

  await coreRequest(baseUrl, token, 'POST', '/service-config/import', payload);
}

export type DeployObservatoryOptions = {
  repoRoot?: string;
  skipGeneratorSchedule?: boolean;
  logger?: SyncLogger;
};

export type DeployObservatoryResult = {
  config: EventDrivenObservatoryConfig;
  configPath: string;
  coreBaseUrl: string;
  coreToken: string;
};

export async function deployEnvironmentalObservatoryModule(
  options: DeployObservatoryOptions = {}
): Promise<DeployObservatoryResult> {
  const moduleRoot = path.resolve(options.repoRoot ?? path.join(__dirname, '..'));
  const moduleDistRoot = path.resolve(moduleRoot, 'dist');
  const { config, outputPath } = await materializeObservatoryConfig({ repoRoot: moduleRoot });
  const coreBaseUrl = (config.core?.baseUrl ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
  const coreToken = config.core?.apiToken ?? '';

  if (!coreToken) {
    throw new Error('Core API token missing. Set core.apiToken in the observatory config.');
  }

  await importServiceManifests(coreBaseUrl, coreToken, moduleDistRoot, config, outputPath);
  await deployModuleBundles(coreBaseUrl, coreToken, moduleDistRoot);
  await synchronizeObservatoryWorkflowsAndTriggers({
    config,
    coreBaseUrl,
    coreToken,
    repoRoot: moduleDistRoot,
    logger: options.logger,
    omitGeneratorSchedule: options.skipGeneratorSchedule
  });

  return {
    config,
    configPath: outputPath,
    coreBaseUrl,
    coreToken
  };
}

async function main(): Promise<void> {
  await deployEnvironmentalObservatoryModule();
  console.log('Observatory module deployment complete.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}

export const deployEnvironmentalObservatoryExample = deployEnvironmentalObservatoryModule;

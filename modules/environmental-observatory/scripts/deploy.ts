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


type ServiceListEntry = {
  slug: string;
  baseUrl?: string | null;
  metadata?: {
    manifest?: {
      healthEndpoint?: string | null;
    } | null;
    runtime?: {
      baseUrl?: string | null;
      previewUrl?: string | null;
    } | null;
  } | null;
};

type ServiceListResponse = {
  data: ServiceListEntry[];
};

function stripTrailingSlash(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  return value.replace(/\/+$/, '');
}

function resolvePublicFrontendBase(): string {
  const explicit = process.env.APPHUB_FRONTEND_PUBLIC_URL?.trim();
  if (explicit && explicit.length > 0) {
    return explicit.replace(/\/+$/, '');
  }
  const port = process.env.APPHUB_FRONTEND_PORT ?? '4173';
  return `http://localhost:${port}`;
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
  return Object.fromEntries(entries) as T;
}

async function ensureObservatoryServices(
  baseUrl: string,
  token: string,
  logger?: SyncLogger
): Promise<void> {
  const response = await coreRequest<ServiceListResponse>(baseUrl, token, 'GET', '/services');
  const services = Array.isArray(response.data) ? response.data : [];

  const internalFrontendBase = 'http://frontend';
  const normalizedInternal = stripTrailingSlash(internalFrontendBase);
  const publicFrontendBase = resolvePublicFrontendBase().replace(/\/+$/, '');

  const adjustments = [
    { slug: 'observatory-dashboard', previewPath: '/observatory/dashboard' },
    { slug: 'observatory-admin', previewPath: '/observatory/admin' }
  ] as const;

  for (const adjustment of adjustments) {
    const service = services.find((entry) => entry.slug === adjustment.slug);
    if (!service) {
      continue;
    }

    const patch: Record<string, unknown> = {};
    const metadataUpdate: Record<string, unknown> = { resourceType: 'service' };
    let metadataChanged = false;

    if (stripTrailingSlash(service.baseUrl ?? '') !== normalizedInternal) {
      patch.baseUrl = internalFrontendBase;
    }

    const existingManifest = service.metadata?.manifest ?? null;
    const currentHealthEndpoint = typeof existingManifest?.healthEndpoint === 'string'
      ? existingManifest.healthEndpoint
      : null;
    if (currentHealthEndpoint !== '/') {
      const manifestUpdate = pruneUndefined({ ...(existingManifest ?? {}), healthEndpoint: '/' });
      metadataUpdate.manifest = manifestUpdate;
      metadataChanged = true;
    }

    const existingRuntime = service.metadata?.runtime ?? null;
    const currentRuntimeBase = typeof existingRuntime?.baseUrl === 'string'
      ? existingRuntime.baseUrl
      : null;
    const currentPreviewUrl = typeof existingRuntime?.previewUrl === 'string'
      ? existingRuntime.previewUrl
      : null;
    const desiredPreviewUrl = `${publicFrontendBase}${adjustment.previewPath}`;
    const needsRuntimeBaseUpdate = stripTrailingSlash(currentRuntimeBase ?? '') !== normalizedInternal;
    const needsPreviewUpdate = currentPreviewUrl !== desiredPreviewUrl;

    if (needsRuntimeBaseUpdate || needsPreviewUpdate) {
      const runtimeUpdate = pruneUndefined({
        ...(existingRuntime ?? {}),
        baseUrl: internalFrontendBase,
        previewUrl: desiredPreviewUrl
      });
      metadataUpdate.runtime = runtimeUpdate;
      metadataChanged = true;
    }

    if (metadataChanged) {
      patch.metadata = metadataUpdate;
    }

    if (Object.keys(patch).length === 0) {
      continue;
    }


    await coreRequest(baseUrl, token, 'PATCH', `/services/${adjustment.slug}`, patch);
    const updatedPreviewUrl = needsRuntimeBaseUpdate || needsPreviewUpdate ? desiredPreviewUrl : currentPreviewUrl;
    logger?.info?.('Updated observatory service registration', {
      service: adjustment.slug,
      baseUrl: patch.baseUrl ?? service.baseUrl,
      previewUrl: updatedPreviewUrl
    });
  }
}

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
  await ensureObservatoryServices(coreBaseUrl, coreToken, options.logger);

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

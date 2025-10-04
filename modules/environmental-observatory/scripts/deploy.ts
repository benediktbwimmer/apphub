import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fetch } from 'undici';
import { access } from 'node:fs/promises';
import {
  ensureS3Bucket,
  readModuleDescriptor,
  resolveBundleManifests,
  readBundleSlugFromConfig,
  type EventDrivenObservatoryConfig,
  type ModuleDescriptorFile,
  type S3BucketOptions
} from '@apphub/module-registry';
import { materializeObservatoryConfig } from './lib/config';
import { synchronizeObservatoryWorkflowsAndTriggers, type SyncLogger } from './lib/workflows';

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_BUNDLE_TIMEOUT_MS = 5 * 60 * 1000;
const OBSERVATORY_MODULE_ID = 'github.com/apphub/examples/environmental-observatory-event-driven';
const OBSERVATORY_DESCRIPTOR_FALLBACK = path.join(
  '..',
  '..',
  'examples',
  'environmental-observatory-event-driven',
  'config.json'
);

async function fileExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function resolveObservatoryDescriptor(
  moduleRoot: string,
  moduleDistRoot: string
): Promise<ModuleDescriptorFile> {
  const primaryPath = path.resolve(moduleDistRoot, 'config.json');
  if (await fileExists(primaryPath)) {
    return readModuleDescriptor(primaryPath);
  }

  const fallbackPath = path.resolve(moduleRoot, OBSERVATORY_DESCRIPTOR_FALLBACK);
  if (await fileExists(fallbackPath)) {
    console.warn(
      '[observatory-bootstrap] dist/config.json not found; falling back to examples descriptor',
      { fallbackPath }
    );
    return readModuleDescriptor(fallbackPath);
  }

  throw new Error(
    `Observatory descriptor missing. Expected ${primaryPath} or ${fallbackPath}. Run module build or ensure examples are present.`
  );
}

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
  descriptor: ModuleDescriptorFile
): Promise<void> {
  const bundleManifests = resolveBundleManifests(descriptor);

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
        module: descriptor.descriptor.module ?? OBSERVATORY_MODULE_ID,
        path: descriptor.directory
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
  descriptor: ModuleDescriptorFile,
  config: EventDrivenObservatoryConfig,
  configPath: string
): Promise<void> {
  const modulePath = path.resolve(descriptor.directory);
  const relativeConfigPath = path.relative(descriptor.directory, descriptor.configPath) || 'config.json';
  const payload = {
    module: OBSERVATORY_MODULE_ID,
    path: modulePath,
    configPath: relativeConfigPath,
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

function parseOptionalBoolean(value: string | undefined): boolean | null {
  if (value === undefined) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return null;
}

function normalizeBucketSpec(input: {
  bucket?: string | null;
  endpoint?: string | null;
  region?: string | null;
  forcePathStyle?: boolean | null;
  accessKeyId?: string | null;
  secretAccessKey?: string | null;
  sessionToken?: string | null;
}): S3BucketOptions | null {
  const bucket = input.bucket?.trim();
  if (!bucket) {
    return null;
  }
  const endpoint = input.endpoint?.trim();
  const region = input.region?.trim();
  const accessKeyId = input.accessKeyId?.trim();
  const secretAccessKey = input.secretAccessKey?.trim();
  const sessionToken = input.sessionToken?.trim();
  return {
    bucket,
    endpoint: endpoint && endpoint.length > 0 ? endpoint : null,
    region: region && region.length > 0 ? region : null,
    forcePathStyle: input.forcePathStyle ?? null,
    accessKeyId: accessKeyId && accessKeyId.length > 0 ? accessKeyId : null,
    secretAccessKey: secretAccessKey && secretAccessKey.length > 0 ? secretAccessKey : null,
    sessionToken: sessionToken && sessionToken.length > 0 ? sessionToken : null
  } satisfies S3BucketOptions;
}

function collectRequiredBuckets(config: EventDrivenObservatoryConfig): S3BucketOptions[] {
  const specs = new Map<string, S3BucketOptions>();
  const env = process.env;

  const addSpec = (spec: S3BucketOptions | null | undefined): void => {
    if (!spec) {
      return;
    }
    const key = `${spec.bucket}::${spec.endpoint ?? ''}`;
    const existing = specs.get(key);
    if (!existing) {
      specs.set(key, spec);
      return;
    }
    specs.set(key, {
      bucket: spec.bucket,
      endpoint: spec.endpoint ?? existing.endpoint ?? null,
      region: spec.region ?? existing.region ?? null,
      forcePathStyle:
        spec.forcePathStyle ?? existing.forcePathStyle ?? null,
      accessKeyId: spec.accessKeyId ?? existing.accessKeyId ?? null,
      secretAccessKey: spec.secretAccessKey ?? existing.secretAccessKey ?? null,
      sessionToken: spec.sessionToken ?? existing.sessionToken ?? null
    });
  };

  addSpec(
    normalizeBucketSpec({
      bucket: config.filestore.bucket,
      endpoint: config.filestore.endpoint,
      region: config.filestore.region,
      forcePathStyle: config.filestore.forcePathStyle ?? null,
      accessKeyId: config.filestore.accessKeyId,
      secretAccessKey: config.filestore.secretAccessKey,
      sessionToken: config.filestore.sessionToken
    })
  );

  addSpec(
    normalizeBucketSpec({
      bucket: env.APPHUB_BUNDLE_STORAGE_BUCKET,
      endpoint: env.APPHUB_BUNDLE_STORAGE_ENDPOINT,
      region: env.APPHUB_BUNDLE_STORAGE_REGION,
      forcePathStyle: parseOptionalBoolean(env.APPHUB_BUNDLE_STORAGE_FORCE_PATH_STYLE),
      accessKeyId: env.APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID ?? config.filestore.accessKeyId ?? null,
      secretAccessKey:
        env.APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY ?? config.filestore.secretAccessKey ?? null,
      sessionToken: env.APPHUB_BUNDLE_STORAGE_SESSION_TOKEN ?? env.AWS_SESSION_TOKEN ?? null
    })
  );

  addSpec(
    normalizeBucketSpec({
      bucket: env.APPHUB_JOB_BUNDLE_S3_BUCKET,
      endpoint: env.APPHUB_JOB_BUNDLE_S3_ENDPOINT,
      region: env.APPHUB_JOB_BUNDLE_S3_REGION,
      forcePathStyle: parseOptionalBoolean(env.APPHUB_JOB_BUNDLE_S3_FORCE_PATH_STYLE),
      accessKeyId: env.APPHUB_JOB_BUNDLE_S3_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID ?? config.filestore.accessKeyId ?? null,
      secretAccessKey:
        env.APPHUB_JOB_BUNDLE_S3_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY ?? config.filestore.secretAccessKey ?? null,
      sessionToken: env.APPHUB_JOB_BUNDLE_S3_SESSION_TOKEN ?? env.AWS_SESSION_TOKEN ?? null
    })
  );

  addSpec(
    normalizeBucketSpec({
      bucket: env.TIMESTORE_S3_BUCKET,
      endpoint: env.TIMESTORE_S3_ENDPOINT,
      region: env.TIMESTORE_S3_REGION,
      forcePathStyle: parseOptionalBoolean(env.TIMESTORE_S3_FORCE_PATH_STYLE),
      accessKeyId: env.TIMESTORE_S3_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID ?? config.filestore.accessKeyId ?? null,
      secretAccessKey:
        env.TIMESTORE_S3_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY ?? config.filestore.secretAccessKey ?? null,
      sessionToken: env.TIMESTORE_S3_SESSION_TOKEN ?? env.AWS_SESSION_TOKEN ?? null
    })
  );

  addSpec(
    normalizeBucketSpec({
      bucket: env.OBSERVATORY_FILESTORE_S3_BUCKET,
      endpoint: env.OBSERVATORY_FILESTORE_S3_ENDPOINT,
      region: env.OBSERVATORY_FILESTORE_S3_REGION,
      forcePathStyle: parseOptionalBoolean(env.OBSERVATORY_FILESTORE_S3_FORCE_PATH_STYLE),
      accessKeyId: env.OBSERVATORY_FILESTORE_S3_ACCESS_KEY_ID ?? config.filestore.accessKeyId ?? null,
      secretAccessKey: env.OBSERVATORY_FILESTORE_S3_SECRET_ACCESS_KEY ?? config.filestore.secretAccessKey ?? null,
      sessionToken: env.OBSERVATORY_FILESTORE_S3_SESSION_TOKEN ?? null
    })
  );

  return Array.from(specs.values());
}

async function ensureRequiredBuckets(config: EventDrivenObservatoryConfig): Promise<void> {
  const buckets = collectRequiredBuckets(config);
  for (const spec of buckets) {
    await ensureS3Bucket(spec);
  }
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
  const descriptor = await resolveObservatoryDescriptor(moduleRoot, moduleDistRoot);
  const { config, outputPath } = await materializeObservatoryConfig({ repoRoot: moduleRoot });
  const coreBaseUrl = (config.core?.baseUrl ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
  const coreToken = config.core?.apiToken ?? '';
  const serviceRegistryToken = (process.env.SERVICE_REGISTRY_TOKEN ?? '').trim() || coreToken;

  if (!coreToken) {
    throw new Error('Core API token missing. Set core.apiToken in the observatory config.');
  }

  await ensureRequiredBuckets(config);
  await importServiceManifests(coreBaseUrl, serviceRegistryToken, descriptor, config, outputPath);
  await deployModuleBundles(coreBaseUrl, coreToken, descriptor);
  await synchronizeObservatoryWorkflowsAndTriggers({
    config,
    coreBaseUrl,
    coreToken,
    repoRoot: descriptor.directory,
    logger: options.logger,
    omitGeneratorSchedule: options.skipGeneratorSchedule
  });
  await ensureObservatoryServices(coreBaseUrl, serviceRegistryToken, options.logger);

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

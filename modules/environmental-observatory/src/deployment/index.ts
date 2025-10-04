import { resolve } from 'node:path';
import type { ModuleManifest, WorkflowDefinition } from '@apphub/module-sdk';
import type { EventDrivenObservatoryConfig } from './configBuilder';
import { applyObservatoryWorkflowDefaults } from './workflowDefaults';
import {
  resolveWorkflowProvisioningPlan,
  type WorkflowProvisioningPlan
} from '@apphub/module-registry';
import type { S3BucketOptions } from '@apphub/module-registry';
import { materializeObservatoryConfig, type FilestoreProvisioning } from './config';
import { buildTriggerDefinitions } from './workflows';

export interface ModuleDeploymentLogger {
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
  debug?(message: string, meta?: Record<string, unknown>): void;
}

export interface ModuleDeploymentContext {
  modulePath: string;
  distPath: string;
  manifest: ModuleManifest;
  env: NodeJS.ProcessEnv;
  logger: ModuleDeploymentLogger;
}

export interface ModuleDeploymentPreparedState<TConfig = unknown> {
  config?: TConfig;
  configPath?: string;
  buckets?: S3BucketOptions[];
  workflow?: WorkflowCustomization<TConfig>;
  filestore?: FilestoreProvisioning;
  postDeploy?: (context: ModulePostDeployContext<TConfig>) => Promise<void> | void;
}

export interface WorkflowCustomization<TConfig> {
  applyDefaults?: (definition: WorkflowDefinition, config: TConfig) => void;
  buildPlan?: (definition: WorkflowDefinition, config: TConfig) => WorkflowProvisioningPlan | null | undefined;
}

export interface ModulePostDeployContext<TConfig> {
  config?: TConfig;
  core: {
    baseUrl: string;
    request: <T>(config: { method: 'GET' | 'POST' | 'PATCH'; path: string; body?: unknown }) => Promise<T>;
  };
  env: NodeJS.ProcessEnv;
  logger: ModuleDeploymentLogger;
}

export interface ModuleDeploymentAdapter<TConfig = unknown> {
  prepare(context: ModuleDeploymentContext): Promise<ModuleDeploymentPreparedState<TConfig>>;
}

export const deploymentAdapter: ModuleDeploymentAdapter<EventDrivenObservatoryConfig> = {
  async prepare(context) {
    const { config, outputPath, filestore } = await materializeObservatoryConfig({
      repoRoot: resolve(context.modulePath),
      env: context.env,
      logger: {
        debug: (message, meta) => context.logger.debug?.(message, meta),
        error: (message, meta) => context.logger.error?.(message ?? 'Failed to materialize observatory config', meta)
      }
    });

    const buckets = collectRequiredBuckets(config, context.env);

    const workflowCustomization: WorkflowCustomization<EventDrivenObservatoryConfig> = {
      applyDefaults(definition, cfg) {
        applyObservatoryWorkflowDefaults(definition as never, cfg);
      },
      buildPlan(definition, cfg) {
        const basePlan = resolveWorkflowProvisioningPlan(definition as never);
        const triggers = buildTriggerDefinitions(cfg).filter((trigger) => trigger.workflowSlug === definition.slug);
        if (triggers.length > 0) {
          basePlan.eventTriggers = triggers.map(({ workflowSlug: _ignored, ...trigger }) => trigger);
        }
        if (definition.slug === 'observatory-minute-data-generator') {
          const skipGenerator = context.env.OBSERVATORY_SKIP_GENERATOR_SCHEDULE === '1';
          if (skipGenerator) {
            basePlan.schedules = basePlan.schedules.filter(
              (schedule) => (schedule.name ?? '').toLowerCase() !== 'observatory synthetic drops'
            );
          }
        }
        return basePlan;
      }
    };

    return {
      config,
      configPath: outputPath,
      buckets,
      filestore,
      workflow: workflowCustomization,
      postDeploy: async ({ core, env, logger }) => {
        await ensureObservatoryServices({ core, env, logger });
      }
    } satisfies ModuleDeploymentPreparedState<EventDrivenObservatoryConfig>;
  }
};

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

function collectRequiredBuckets(
  config: EventDrivenObservatoryConfig,
  env: NodeJS.ProcessEnv
): S3BucketOptions[] {
  const specs = new Map<string, S3BucketOptions>();

  const addSpec = (spec: S3BucketOptions | null | undefined) => {
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
      forcePathStyle: spec.forcePathStyle ?? existing.forcePathStyle ?? null,
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

async function ensureObservatoryServices(options: {
  core: {
    baseUrl: string;
    request: <T>(config: { method: 'GET' | 'POST' | 'PATCH'; path: string; body?: unknown }) => Promise<T>;
  };
  env: NodeJS.ProcessEnv;
  logger: ModuleDeploymentLogger;
}): Promise<void> {
  const services = await options.core.request<{ data: ServiceListEntry[] }>({
    method: 'GET',
    path: '/services'
  });

  const serviceList = Array.isArray(services.data) ? services.data : [];

  const internalFrontendBase = 'http://frontend';
  const normalizedInternal = stripTrailingSlash(internalFrontendBase);
  const publicFrontendBase = resolvePublicFrontendBase(options.env);

  const adjustments = [
    { slug: 'observatory-dashboard', previewPath: '/observatory/dashboard' },
    { slug: 'observatory-admin', previewPath: '/observatory/admin' }
  ] as const;

  for (const adjustment of adjustments) {
    const service = serviceList.find((entry) => entry.slug === adjustment.slug);
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

    await options.core.request({
      method: 'PATCH',
      path: `/services/${adjustment.slug}`,
      body: patch
    });
    options.logger.info?.('Updated observatory service registration', {
      service: adjustment.slug,
      baseUrl: patch.baseUrl ?? service.baseUrl,
      previewUrl: `${publicFrontendBase}${adjustment.previewPath}`
    });
  }
}

function stripTrailingSlash(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  return value.replace(/\/+$/, '');
}

function resolvePublicFrontendBase(env: NodeJS.ProcessEnv): string {
  const explicit = env.APPHUB_FRONTEND_PUBLIC_URL?.trim();
  if (explicit && explicit.length > 0) {
    return explicit.replace(/\/+$/, '');
  }
  const port = env.APPHUB_FRONTEND_PORT ?? '4173';
  return `http://localhost:${port}`;
}

function pruneUndefined<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => pruneUndefined(entry))
      .filter((entry) => entry !== undefined) as unknown as T;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
      if (entry === undefined) {
        continue;
      }
      result[key] = pruneUndefined(entry);
    }
    return result as T;
  }
  return value;
}

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

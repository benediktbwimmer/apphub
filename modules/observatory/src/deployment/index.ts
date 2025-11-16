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

type WorkflowScheduleListEntry = {
  schedule: {
    id: string;
    name: string | null;
    description: string | null;
    cron: string;
    timezone: string | null;
  };
  workflow?: {
    slug?: string;
  };
};

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
        await ensureDashboardSchedule({ core, logger });
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

  const adjustments = [
    { slug: 'observatory-dashboard', previewPath: '/observatory/dashboard' },
    { slug: 'observatory-admin', previewPath: '/observatory/admin' }
  ] as const;

  for (const adjustment of adjustments) {
    const service = serviceList.find((entry) => entry.slug === adjustment.slug);
    if (!service) {
      continue;
    }

    const existingRuntime = service.metadata?.runtime ?? null;
    const currentRuntimeBase =
      typeof existingRuntime?.baseUrl === 'string' ? existingRuntime.baseUrl : null;

    const configRuntimeBase = (() => {
      const config = (service.metadata as { config?: Record<string, unknown> } | null | undefined)?.config;
      const runtime = config && typeof config === 'object' ? (config.runtime as Record<string, unknown> | undefined) : undefined;
      const base = runtime?.baseUrl;
      return typeof base === 'string' && base.trim().length > 0 ? base : null;
    })();

    const defaultPort = (() => {
      const cfg = (service.metadata as { config?: Record<string, unknown> } | null | undefined)?.config;
      const registration = cfg && typeof cfg === 'object' ? (cfg.registration as Record<string, unknown> | undefined) : undefined;
      const portValue = registration?.defaultPort;
      if (typeof portValue === 'number' && Number.isFinite(portValue)) {
        return portValue;
      }
      if (typeof portValue === 'string' && portValue.trim().length > 0) {
        const parsed = Number.parseInt(portValue, 10);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      return null;
    })();
    const runtimeBase =
      configRuntimeBase ??
      currentRuntimeBase ??
      (typeof service.baseUrl === 'string' ? service.baseUrl : null) ??
      (defaultPort ? `http://127.0.0.1:${defaultPort}` : null);

    if (!runtimeBase) {
      continue;
    }

    const normalizedRuntimeBase = stripTrailingSlash(runtimeBase);

    const patch: Record<string, unknown> = {};
    const metadataUpdate: Record<string, unknown> = { resourceType: 'service' };
    let metadataChanged = false;

    if (stripTrailingSlash(service.baseUrl ?? '') !== normalizedRuntimeBase) {
      patch.baseUrl = runtimeBase;
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

    const currentPreviewUrl = typeof existingRuntime?.previewUrl === 'string'
      ? existingRuntime.previewUrl
      : null;
    const desiredPreviewUrl = `${normalizedRuntimeBase}${adjustment.previewPath}`;
    const needsRuntimeBaseUpdate =
      stripTrailingSlash(currentRuntimeBase ?? '') !== normalizedRuntimeBase ||
      stripTrailingSlash(configRuntimeBase ?? '') !== normalizedRuntimeBase;
    const needsPreviewUpdate = currentPreviewUrl !== desiredPreviewUrl;

    if (needsRuntimeBaseUpdate || needsPreviewUpdate) {
      const runtimeUpdate = pruneUndefined({
        ...(existingRuntime ?? {}),
        baseUrl: runtimeBase,
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
      previewUrl: desiredPreviewUrl
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

function resolveInternalFrontendBase(env: NodeJS.ProcessEnv): string | null {
  const explicit =
    env.APPHUB_FRONTEND_INTERNAL_URL?.trim() ??
    env.OBSERVATORY_FRONTEND_INTERNAL_URL?.trim() ??
    null;
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  return null;
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

async function ensureDashboardSchedule(options: {
  core: ModulePostDeployContext<EventDrivenObservatoryConfig>['core'];
  logger: ModuleDeploymentLogger;
}): Promise<void> {
  const slug = 'observatory-dashboard-aggregate';
  const desired = {
    name: 'Periodic dashboard refresh',
    description: 'Fallback aggregation to cover long-running bursts.',
    cron: '*/5 * * * *',
    timezone: 'UTC' as string | null
  };

  try {
    const response = await options.core.request<{ data: WorkflowScheduleListEntry[] }>({
      method: 'GET',
      path: '/workflow-schedules'
    });
    const entries = Array.isArray(response?.data) ? response.data : [];
    const scoped = entries.filter((entry) => entry.workflow?.slug === slug);
    const existing = scoped.find((entry) => entry.schedule?.name === desired.name) ?? null;

    if (!existing) {
      await options.core.request({
        method: 'POST',
        path: `/workflows/${encodeURIComponent(slug)}/schedules`,
        body: desired
      });
      options.logger.info?.('Created workflow schedule', { workflow: slug, schedule: desired.name });
      return;
    }

    const updates: Record<string, unknown> = {};
    const schedule = existing.schedule;
    if ((schedule.name ?? null) !== desired.name) {
      updates.name = desired.name;
    }
    if ((schedule.description ?? null) !== desired.description) {
      updates.description = desired.description;
    }
    if ((schedule.cron ?? '').trim() !== desired.cron) {
      updates.cron = desired.cron;
    }
    if ((schedule.timezone ?? null) !== desired.timezone) {
      updates.timezone = desired.timezone;
    }

    if (Object.keys(updates).length === 0) {
      return;
    }

    await options.core.request({
      method: 'PATCH',
      path: `/workflow-schedules/${schedule.id}`,
      body: updates
    });
    options.logger.info?.('Updated workflow schedule', { workflow: slug, schedule: desired.name });
  } catch (error) {
    options.logger.error?.('Failed to ensure dashboard schedule', {
      workflow: slug,
      error: error instanceof Error ? error.message : String(error)
    });
  }
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

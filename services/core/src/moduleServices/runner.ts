import { createModuleContext, type ModuleLogger, type ModuleTargetDefinition } from '@apphub/module-sdk';
import { ModuleRuntimeLoader } from '../moduleRuntime';
import {
  ensureDatabase,
  closePool,
  listActiveServiceManifests
} from '../db';
import type { ModuleTargetBinding, ServiceManifestStoreRecord, JsonValue } from '../db/types';
import { logStructured, logger } from '../observability/logger';
import type { ModuleServiceDefinition } from './types';
import type { ServiceTargetDefinition, ServiceLifecycle } from '@apphub/module-sdk';

const POLL_INTERVAL_MS = Number(process.env.MODULE_SERVICE_REFRESH_MS ?? '5000');
const shutdownHooks: Array<() => Promise<void> | void> = [];

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof (timer as NodeJS.Timeout).unref === 'function') {
      (timer as NodeJS.Timeout).unref();
    }
  });
}

export function registerModuleServiceShutdownHook(hook: () => Promise<void> | void): void {
  shutdownHooks.push(hook);
}

function ensureString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function ensureNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const record = value as Record<string, unknown>;
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === 'string') {
      output[key] = entry;
    }
  }
  return output;
}

export function parseServiceDefinition(record: ServiceManifestStoreRecord): ModuleServiceDefinition | null {
  const value = record.definition;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    logger.warn('[module:services] Invalid service manifest definition', { id: record.id });
    return null;
  }
  const source = value as Record<string, unknown>;

  const slug = ensureString(source.slug);
  const moduleSource = source.module as Record<string, unknown> | undefined;
  const moduleId =
    ensureString(source.moduleId) ??
    ensureString(moduleSource?.id) ??
    ensureString(record.moduleId);
  let moduleVersion =
    ensureString(source.moduleVersion) ??
    ensureString(moduleSource?.version);
  if (!moduleVersion && typeof record.moduleVersion === 'number') {
    moduleVersion = String(record.moduleVersion);
  }
  if (!slug || !moduleId || !moduleVersion) {
    logger.warn('[module:services] Service definition missing identifiers', {
      id: record.id,
      slug,
      moduleId,
      moduleVersion
    });
    return null;
  }

  const targetSource = source.target as Record<string, unknown> | undefined;
  const targetName = ensureString(targetSource?.name);
  if (!targetName) {
    logger.warn('[module:services] Service definition missing target name', { slug });
    return null;
  }

  const artifactSource = source.artifact as Record<string, unknown> | undefined;
  const artifactPath = ensureString(artifactSource?.path);
  const artifactStorage = ensureString(artifactSource?.storage);
  const artifactChecksum = ensureString(artifactSource?.checksum);
  if (!artifactPath || !artifactStorage) {
    logger.warn('[module:services] Service definition missing artifact data', { slug });
    return null;
  }

  const runtimeSource = source.runtime as Record<string, unknown> | undefined;
  if (!runtimeSource) {
    logger.warn('[module:services] Service definition missing runtime', { slug });
    return null;
  }

  const runtimeHost = ensureString(runtimeSource.host) ?? '127.0.0.1';
  const runtimePort = ensureNumber(runtimeSource.port);
  const runtimeBaseUrl = ensureString(runtimeSource.baseUrl);
  const healthEndpoint = ensureString(runtimeSource.healthEndpoint) ?? '/healthz';
  if (!runtimePort || !runtimeBaseUrl) {
    logger.warn('[module:services] Service runtime missing port or baseUrl', { slug });
    return null;
  }

  const runtimeEnv = toStringRecord(runtimeSource.env);

  const registrationSource = source.registration as Record<string, unknown> | undefined;
  const registration = registrationSource
    ? {
        basePath: ensureString(registrationSource.basePath) ?? undefined,
        tags: Array.isArray(registrationSource.tags)
          ? registrationSource.tags
              .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
              .filter((tag) => !!tag)
          : undefined,
        defaultPort: ensureNumber(registrationSource.defaultPort),
        metadata: (registrationSource.metadata as Record<string, unknown> | null | undefined) ?? undefined,
        ui: (registrationSource.ui as Record<string, unknown> | null | undefined) ?? undefined,
        envTemplate: toStringRecord(registrationSource.envTemplate)
      }
    : undefined;

  return {
    slug,
    displayName: ensureString(source.displayName),
    description: ensureString(source.description),
    kind: ensureString(source.kind) ?? 'module-service',
    moduleId,
    moduleVersion,
    target: {
      name: targetName,
      version: ensureString(targetSource?.version),
      fingerprint: ensureString(targetSource?.fingerprint)
    },
    artifact: {
      path: artifactPath,
      storage: artifactStorage,
      checksum: artifactChecksum ?? ''
    },
    runtime: {
      host: runtimeHost,
      port: runtimePort,
      baseUrl: runtimeBaseUrl,
      healthEndpoint,
      env: runtimeEnv
    },
    registration
  } satisfies ModuleServiceDefinition;
}

function convertMetaValue(value: unknown): JsonValue | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    const converted = value
      .map((entry) => convertMetaValue(entry))
      .filter((entry): entry is JsonValue => entry !== undefined);
    return converted as JsonValue;
  }
  if (value && typeof value === 'object') {
    const record: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      const converted = convertMetaValue(entry);
      if (converted !== undefined) {
        record[key] = converted;
      }
    }
    return record;
  }
  return undefined;
}

function mergeMeta(
  base: Record<string, JsonValue>,
  meta?: Record<string, unknown>
): Record<string, JsonValue> {
  const merged: Record<string, JsonValue> = { ...base };
  if (!meta) {
    return merged;
  }
  for (const [key, value] of Object.entries(meta)) {
    const converted = convertMetaValue(value);
    if (converted !== undefined) {
      merged[key] = converted;
    }
  }
  return merged;
}

function createScopedLogger(baseMeta: Record<string, JsonValue>): ModuleLogger {
  return {
    debug(message, meta) {
      logStructured('info', message, mergeMeta(baseMeta, { ...meta, logLevel: 'debug' }));
    },
    info(message, meta) {
      logStructured('info', message, mergeMeta(baseMeta, meta));
    },
    warn(message, meta) {
      logStructured('warn', message, mergeMeta(baseMeta, meta));
    },
    error(message, meta) {
      const payload = typeof message === 'string' ? message : message.message;
      const extraMeta = typeof message === 'string' ? meta : { ...(meta ?? {}), error: message.stack ?? message.message };
      logStructured('error', payload, mergeMeta(baseMeta, extraMeta));
    }
  } satisfies ModuleLogger;
}

function createServiceModuleLogger(meta: {
  moduleId: string;
  moduleVersion: string;
  serviceSlug: string;
}): ModuleLogger {
  return createScopedLogger({
    moduleId: meta.moduleId,
    moduleVersion: meta.moduleVersion,
    serviceSlug: meta.serviceSlug
  });
}

class ModuleServiceInstance {
  private definition: ModuleServiceDefinition;
  private lifecycle: ServiceLifecycle | null = null;
  private readonly loader: ModuleRuntimeLoader;
  private readonly log: ModuleLogger;

  constructor(definition: ModuleServiceDefinition, loader: ModuleRuntimeLoader) {
    this.definition = definition;
    this.loader = loader;
    this.log = createScopedLogger({
      moduleService: true,
      slug: definition.slug
    });
  }

  updateDefinition(definition: ModuleServiceDefinition) {
    this.definition = definition;
  }

  async start(): Promise<void> {
    const { definition } = this;
    this.log.info('Starting module service', {
      slug: definition.slug,
      moduleId: definition.moduleId,
      target: definition.target.name,
      port: definition.runtime.port
    });

    const binding: ModuleTargetBinding = {
      moduleId: definition.moduleId,
      moduleVersion: definition.moduleVersion,
      targetName: definition.target.name,
      targetVersion: definition.target.version ?? definition.moduleVersion,
      moduleArtifactId: null,
      targetFingerprint: definition.target.fingerprint ?? null
    };

    this.loader.invalidate(definition.moduleId, definition.moduleVersion);
    const loaded = await this.loader.getTarget(binding);

    if (loaded.target.kind !== 'service') {
      throw new Error(
        `Module target ${binding.targetName}@${binding.targetVersion ?? 'latest'} is not a service`
      );
    }

    const serviceTarget = loaded.target as ModuleTargetDefinition<unknown, unknown> & ServiceTargetDefinition<unknown, unknown>;
    const capabilityOverrides = serviceTarget.capabilityOverrides ? [serviceTarget.capabilityOverrides] : undefined;
    const moduleLogger = createServiceModuleLogger({
      moduleId: definition.moduleId,
      moduleVersion: definition.moduleVersion,
      serviceSlug: definition.slug
    });

    const moduleContext = createModuleContext({
      module: loaded.module.definition.metadata,
      settingsDescriptor: loaded.module.definition.settings,
      secretsDescriptor: loaded.module.definition.secrets,
      capabilityConfig: loaded.module.definition.capabilities,
      capabilityOverrides,
      logger: moduleLogger
    });

    const serviceContext = {
      ...moduleContext,
      service: {
        name: serviceTarget.name,
        version: serviceTarget.version ?? definition.target.version ?? loaded.module.definition.metadata.version
      }
    } as Parameters<typeof serviceTarget.handler>[0];

    const envKeys = Object.keys(definition.runtime.env ?? {});
    const previousEnv = new Map<string, string | undefined>();
    for (const key of envKeys) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = definition.runtime.env[key];
    }

    try {
      const lifecycle = await (serviceTarget.handler as (
        context: typeof serviceContext
      ) => Promise<ServiceLifecycle | void> | ServiceLifecycle | void)(serviceContext);
      this.lifecycle = lifecycle ?? null;
      if (this.lifecycle?.start) {
        await this.lifecycle.start();
      }
      this.log.info('Module service listening', {
        slug: definition.slug,
        baseUrl: definition.runtime.baseUrl
      });
    } finally {
      for (const key of envKeys) {
        const previous = previousEnv.get(key);
        if (previous === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous;
        }
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.lifecycle?.stop) {
      this.lifecycle = null;
      return;
    }
    try {
      await this.lifecycle.stop();
      this.log.info('Module service stopped', { slug: this.definition.slug });
    } catch (error) {
      this.log.warn('Failed to stop module service cleanly', {
        slug: this.definition.slug,
        error: error instanceof Error ? error.message : error
      });
    } finally {
      this.lifecycle = null;
    }
  }
}

class ModuleServiceSupervisor {
  private readonly instances = new Map<string, ModuleServiceInstance>();
  private readonly checksums = new Map<string, string>();
  private readonly loader: ModuleRuntimeLoader;

  constructor(loader: ModuleRuntimeLoader) {
    this.loader = loader;
  }

  async sync(): Promise<void> {
    const manifests = await listActiveServiceManifests();
    const seen = new Set<string>();

    for (const manifest of manifests) {
      const definition = parseServiceDefinition(manifest);
      if (!definition) {
        continue;
      }
      seen.add(definition.slug);
      const existing = this.instances.get(definition.slug);
      const checksum = manifest.checksum;

      if (!existing) {
        const instance = new ModuleServiceInstance(definition, this.loader);
        try {
          await instance.start();
          this.instances.set(definition.slug, instance);
          this.checksums.set(definition.slug, checksum);
        } catch (error) {
          logger.error('[module:services] Failed to start module service', {
            slug: definition.slug,
            error: error instanceof Error ? error.message : String(error)
          });
          await instance.stop();
        }
        continue;
      }

      const previousChecksum = this.checksums.get(definition.slug);
      if (previousChecksum === checksum) {
        continue;
      }

      existing.updateDefinition(definition);
      try {
        await existing.stop();
        await existing.start();
        this.checksums.set(definition.slug, checksum);
      } catch (error) {
        logger.error('[module:services] Failed to restart module service', {
          slug: definition.slug,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    for (const [slug, instance] of this.instances.entries()) {
      if (seen.has(slug)) {
        continue;
      }
      await instance.stop();
      this.instances.delete(slug);
      this.checksums.delete(slug);
      logger.info('[module:services] Module service removed', { slug });
    }
  }

  async stopAll(): Promise<void> {
    for (const [slug, instance] of this.instances.entries()) {
      try {
        await instance.stop();
      } catch (error) {
        logger.warn('[module:services] Failed to stop service during shutdown', {
          slug,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    this.instances.clear();
    this.checksums.clear();
  }
}

export async function main(): Promise<void> {
  logger.info('[module:services] Starting module service supervisor');
  await ensureDatabase();
  const loader = new ModuleRuntimeLoader({ cacheTtlMs: 30_000 });
  const supervisor = new ModuleServiceSupervisor(loader);

  let shouldStop = false;

  const handleSignal = async (signal: NodeJS.Signals) => {
    if (shouldStop) {
      return;
    }
    shouldStop = true;
    logger.info('[module:services] Received shutdown signal', { signal });
    await supervisor.stopAll();
    while (shutdownHooks.length > 0) {
      const hook = shutdownHooks.pop();
      if (!hook) {
        continue;
      }
      try {
        await hook();
      } catch (error) {
        logger.warn('[module:services] Shutdown hook failed', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    await closePool();
    process.exit(0);
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  while (!shouldStop) {
    try {
      await supervisor.sync();
    } catch (error) {
      logger.error('[module:services] Failed to synchronize module services', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    if (shouldStop) {
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

if (require.main === module) {
  main()
    .catch(async (error) => {
      logger.error('[module:services] Fatal error', {
        error: error instanceof Error ? error.message : String(error)
      });
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await closePool();
      } catch (error) {
        logger.warn('[module:services] Failed to close database pool', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
}

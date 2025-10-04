import type { ModuleManifest } from '@apphub/module-sdk';
import { coreRequest } from '../core';
import type { ModuleDeploymentLogger } from './types';

interface SyncServicesOptions {
  manifest: ModuleManifest;
  moduleId: string;
  moduleVersion: string;
  coreUrl: string;
  coreToken: string;
  logger: ModuleDeploymentLogger;
  env: NodeJS.ProcessEnv;
}

export async function syncServices(options: SyncServicesOptions): Promise<number> {
  const targets = options.manifest.targets.filter((target) => target.kind === 'service');
  let processed = 0;

  for (const target of targets) {
    const serviceMeta = (target.service ?? {}) as { registration?: Record<string, unknown> };
    const registration = asRecord(serviceMeta.registration);
    if (!registration) {
      continue;
    }
    const slugValue = typeof registration.slug === 'string' ? registration.slug.trim() : '';
    const slug = slugValue.toLowerCase();
    if (!slug) {
      options.logger.warn('Skipping service target without slug', { target: target.name });
      continue;
    }

    const displayName = target.displayName ?? (typeof registration.displayName === 'string' ? registration.displayName : target.name);
    const kind = typeof registration.kind === 'string' && registration.kind.trim().length > 0
      ? registration.kind.trim()
      : 'module-service';

    const declaredDefaultPort = Number.isFinite(registration.defaultPort)
      ? Number(registration.defaultPort)
      : typeof registration.defaultPort === 'string'
        ? Number.parseInt(registration.defaultPort, 10)
        : null;
    if (!declaredDefaultPort || declaredDefaultPort <= 0) {
      options.logger.warn('Skipping service target without a valid defaultPort', { target: target.name });
      continue;
    }

    const basePath = normalizeBasePath(typeof registration.basePath === 'string' ? registration.basePath : undefined);
    const host = '127.0.0.1';
    const baseUrl = buildBaseUrl(host, declaredDefaultPort, basePath);

    const healthEndpoint = normalizePathSegment(
      typeof registration.healthEndpoint === 'string' ? registration.healthEndpoint : undefined
    );

    const envTemplate = asStringMap(registration.env);
    const resolvedEnv = resolveServiceEnv(envTemplate, { port: declaredDefaultPort, host, baseUrl, env: options.env });

    const manifestEnv = toManifestEnvList(envTemplate);
    const tags = Array.isArray(registration.tags)
      ? Array.from(new Set(registration.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).map((tag) => tag.trim())))
      : [];

    const metadataUpdate = pruneUndefined({
      resourceType: 'service' as const,
      manifest: pruneUndefined({
        source: `module:${options.moduleId}`,
        baseUrlSource: 'runtime' as const,
        healthEndpoint,
        env: manifestEnv
      }),
      config: pruneUndefined({
        module: {
          id: options.moduleId,
          version: options.moduleVersion,
          target: {
            name: target.name,
            version: target.version,
            fingerprint: target.fingerprint ?? null
          }
        },
        registration: pruneUndefined({
          kind,
          basePath,
          defaultPort: declaredDefaultPort,
          tags: tags.length > 0 ? tags : undefined,
          metadata: asRecord(registration.metadata),
          ui: asRecord(registration.ui),
          envTemplate
        }),
        runtime: pruneUndefined({
          baseUrl,
          host,
          port: declaredDefaultPort,
          env: resolvedEnv
        })
      })
    });

    await coreRequest({
      baseUrl: options.coreUrl,
      token: options.coreToken,
      method: 'POST',
      path: '/services',
      body: {
        slug,
        displayName,
        kind,
        baseUrl,
        source: 'module',
        metadata: metadataUpdate
      }
    });

    options.logger.info('Registered service', { slug, baseUrl });
    processed += 1;
  }

  return processed;
}

function normalizeBasePath(basePath?: string): string {
  if (!basePath) {
    return '/';
  }
  let normalized = basePath.trim();
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function normalizePathSegment(value: string | undefined): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    return '/';
  }
  if (!normalized.startsWith('/')) {
    return `/${normalized}`;
  }
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asStringMap(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === 'string') {
      result[key] = entry;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function substituteEnvPlaceholders(
  value: string,
  context: { port: number; host: string; baseUrl: string; origin: string; env: NodeJS.ProcessEnv }
): string {
  let output = value;
  const replacements: Record<string, string> = {
    port: String(context.port),
    host: context.host,
    baseurl: context.baseUrl,
    'base-url': context.baseUrl,
    origin: context.origin
  };
  for (const [token, replacement] of Object.entries(replacements)) {
    const pattern = new RegExp(`\{\{\s*${token}\s*\}\}`, 'gi');
    output = output.replace(pattern, replacement);
  }
  output = output.replace(/\$\{([A-Z0-9_:-]+)}/g, (_match, name: string) => context.env[name] ?? '');
  return output;
}

function resolveServiceEnv(
  envTemplate: Record<string, string> | undefined,
  context: { port: number; host: string; baseUrl: string; env: NodeJS.ProcessEnv }
): Record<string, string> {
  const resolved: Record<string, string> = {};
  const origin = (() => {
    try {
      return new URL(context.baseUrl).origin;
    } catch {
      return context.baseUrl;
    }
  })();
  const replacements = { ...context, origin };
  if (envTemplate) {
    for (const [key, value] of Object.entries(envTemplate)) {
      resolved[key] = substituteEnvPlaceholders(value, replacements);
    }
  }
  return resolved;
}

function toManifestEnvList(envTemplate: Record<string, string> | undefined) {
  if (!envTemplate) {
    return undefined;
  }
  const entries = Object.entries(envTemplate).filter(([key]) => key && key.trim().length > 0);
  if (entries.length === 0) {
    return undefined;
  }
  return entries.map(([key, value]) => ({ key, value }));
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

function buildBaseUrl(host: string, port: number, basePath: string): string {
  const normalizedPath = basePath === '/' ? '' : basePath;
  return `http://${host}:${port}${normalizedPath}`;
}

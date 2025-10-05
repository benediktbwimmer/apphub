import { z } from 'zod';
import { integerVar, loadEnvConfig, stringVar } from '@apphub/shared/envConfig';

export type FilestoreRuntimeConfig = {
  baseUrl: string;
  token: string | null;
  userAgent: string;
  fetchTimeoutMs: number | null;
  source: 'env' | 'service';
};

let cachedConfig: FilestoreRuntimeConfig | null = null;

const filestoreEnvSchema = z
  .object({
    CORE_FILESTORE_BASE_URL: stringVar({ allowEmpty: false }),
    FILESTORE_BASE_URL: stringVar({ allowEmpty: false }),
    APPHUB_FILESTORE_BASE_URL: stringVar({ allowEmpty: false }),
    CORE_FILESTORE_TOKEN: stringVar({ allowEmpty: false }),
    FILESTORE_TOKEN: stringVar({ allowEmpty: false }),
    APPHUB_FILESTORE_TOKEN: stringVar({ allowEmpty: false }),
    CORE_FILESTORE_TIMEOUT_MS: integerVar({ min: 0 }),
    FILESTORE_TIMEOUT_MS: integerVar({ min: 0 }),
    CORE_FILESTORE_USER_AGENT: stringVar({ defaultValue: 'core-docker-runner/1.0' })
  })
  .passthrough();

type FilestoreEnv = z.infer<typeof filestoreEnvSchema>;

function loadFilestoreEnv(): FilestoreEnv {
  return loadEnvConfig(filestoreEnvSchema, { context: 'core:filestore-runtime' });
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    url.hash = '';
    url.search = '';
    if (url.pathname && url.pathname.endsWith('/') && url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return null;
  }
}

function selectEnvBaseUrl(env: FilestoreEnv): { baseUrl: string; source: FilestoreRuntimeConfig['source'] } | null {
  const candidates: Array<{ value: string | undefined; source: FilestoreRuntimeConfig['source'] }> = [
    { value: env.CORE_FILESTORE_BASE_URL, source: 'env' },
    { value: env.FILESTORE_BASE_URL, source: 'env' },
    { value: env.APPHUB_FILESTORE_BASE_URL, source: 'env' }
  ];

  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate.value ?? null);
    if (normalized) {
      return { baseUrl: normalized, source: candidate.source };
    }
  }

  return null;
}

function resolveToken(env: FilestoreEnv): string | null {
  const candidates = [env.CORE_FILESTORE_TOKEN, env.FILESTORE_TOKEN, env.APPHUB_FILESTORE_TOKEN];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}

function resolveTimeoutMs(env: FilestoreEnv): number | null {
  const candidates = [env.CORE_FILESTORE_TIMEOUT_MS, env.FILESTORE_TIMEOUT_MS];
  for (const candidate of candidates) {
    if (candidate === undefined) {
      continue;
    }
    if (candidate <= 0) {
      return null;
    }
    return candidate;
  }
  return null;
}

function resolveUserAgent(env: FilestoreEnv): string {
  return env.CORE_FILESTORE_USER_AGENT ?? 'core-docker-runner/1.0';
}

async function resolveRuntimeFromRegistry(env: FilestoreEnv): Promise<FilestoreRuntimeConfig> {
  const { requireResolvedService } = await import('../clients/serviceClient');
  const resolved = await requireResolvedService('filestore', { requireHealthy: false }).catch(() => null);
  if (!resolved) {
    throw new Error(
      'Filestore base URL is not configured. Set CORE_FILESTORE_BASE_URL or register a filestore service.'
    );
  }

  const serviceBaseUrl = normalizeBaseUrl(resolved.record.baseUrl);
  if (!serviceBaseUrl) {
    throw new Error(
      'Filestore service registration is missing a valid base URL. Provide CORE_FILESTORE_BASE_URL or update the service record.'
    );
  }

  return {
    baseUrl: serviceBaseUrl,
    token: resolveToken(env),
    userAgent: resolveUserAgent(env),
    fetchTimeoutMs: resolveTimeoutMs(env),
    source: 'service'
  } satisfies FilestoreRuntimeConfig;
}

export async function getFilestoreRuntimeConfig(): Promise<FilestoreRuntimeConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const env = loadFilestoreEnv();

  const envBaseUrl = selectEnvBaseUrl(env);
  if (envBaseUrl) {
    cachedConfig = {
      baseUrl: envBaseUrl.baseUrl,
      token: resolveToken(env),
      userAgent: resolveUserAgent(env),
      fetchTimeoutMs: resolveTimeoutMs(env),
      source: envBaseUrl.source
    } satisfies FilestoreRuntimeConfig;
    return cachedConfig;
  }

  cachedConfig = await resolveRuntimeFromRegistry(env);
  return cachedConfig;
}

export function clearFilestoreRuntimeConfigCache(): void {
  cachedConfig = null;
}

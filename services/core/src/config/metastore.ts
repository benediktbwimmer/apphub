import { z } from 'zod';
import { integerVar, loadEnvConfig, stringVar } from '@apphub/shared/envConfig';

export type MetastoreRuntimeConfig = {
  baseUrl: string;
  token: string | null;
  userAgent: string;
  fetchTimeoutMs: number | null;
  source: 'env' | 'service';
};

let cachedConfig: MetastoreRuntimeConfig | null = null;

const metastoreEnvSchema = z
  .object({
    CORE_METASTORE_BASE_URL: stringVar({ allowEmpty: false }),
    METASTORE_BASE_URL: stringVar({ allowEmpty: false }),
    APPHUB_METASTORE_BASE_URL: stringVar({ allowEmpty: false }),
    CORE_METASTORE_TOKEN: stringVar({ allowEmpty: false }),
    METASTORE_TOKEN: stringVar({ allowEmpty: false }),
    APPHUB_METASTORE_TOKEN: stringVar({ allowEmpty: false }),
    CORE_METASTORE_TIMEOUT_MS: integerVar({ min: 0 }),
    METASTORE_TIMEOUT_MS: integerVar({ min: 0 }),
    CORE_METASTORE_USER_AGENT: stringVar({ defaultValue: 'core-observatory/1.0' })
  })
  .passthrough();

type MetastoreEnv = z.infer<typeof metastoreEnvSchema>;

function loadMetastoreEnv(): MetastoreEnv {
  return loadEnvConfig(metastoreEnvSchema, { context: 'core:metastore-runtime' });
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

function selectEnvBaseUrl(env: MetastoreEnv): { baseUrl: string; source: MetastoreRuntimeConfig['source'] } | null {
  const candidates: Array<{ value: string | undefined; source: MetastoreRuntimeConfig['source'] }> = [
    { value: env.CORE_METASTORE_BASE_URL, source: 'env' },
    { value: env.METASTORE_BASE_URL, source: 'env' },
    { value: env.APPHUB_METASTORE_BASE_URL, source: 'env' }
  ];

  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate.value ?? null);
    if (normalized) {
      return { baseUrl: normalized, source: candidate.source };
    }
  }

  return null;
}

function resolveToken(env: MetastoreEnv): string | null {
  const candidates = [env.CORE_METASTORE_TOKEN, env.METASTORE_TOKEN, env.APPHUB_METASTORE_TOKEN];

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

function resolveTimeoutMs(env: MetastoreEnv): number | null {
  const candidates = [env.CORE_METASTORE_TIMEOUT_MS, env.METASTORE_TIMEOUT_MS];
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

function resolveUserAgent(env: MetastoreEnv): string {
  return env.CORE_METASTORE_USER_AGENT ?? 'core-observatory/1.0';
}

async function resolveRuntimeFromRegistry(env: MetastoreEnv): Promise<MetastoreRuntimeConfig> {
  const { requireResolvedService } = await import('../clients/serviceClient');
  const resolved = await requireResolvedService('metastore', { requireHealthy: false }).catch(() => null);
  if (!resolved) {
    throw new Error(
      'Metastore base URL is not configured. Set CORE_METASTORE_BASE_URL or register a metastore service.'
    );
  }

  const serviceBaseUrl = normalizeBaseUrl(resolved.record.baseUrl);
  if (!serviceBaseUrl) {
    throw new Error(
      'Metastore service registration is missing a valid base URL. Provide CORE_METASTORE_BASE_URL or update the service record.'
    );
  }

  return {
    baseUrl: serviceBaseUrl,
    token: resolveToken(env),
    userAgent: resolveUserAgent(env),
    fetchTimeoutMs: resolveTimeoutMs(env),
    source: 'service'
  } satisfies MetastoreRuntimeConfig;
}

export async function getMetastoreRuntimeConfig(): Promise<MetastoreRuntimeConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const env = loadMetastoreEnv();

  const envBaseUrl = selectEnvBaseUrl(env);
  if (envBaseUrl) {
    cachedConfig = {
      baseUrl: envBaseUrl.baseUrl,
      token: resolveToken(env),
      userAgent: resolveUserAgent(env),
      fetchTimeoutMs: resolveTimeoutMs(env),
      source: envBaseUrl.source
    } satisfies MetastoreRuntimeConfig;
    return cachedConfig;
  }

  cachedConfig = await resolveRuntimeFromRegistry(env);
  return cachedConfig;
}

export function clearMetastoreRuntimeConfigCache(): void {
  cachedConfig = null;
}

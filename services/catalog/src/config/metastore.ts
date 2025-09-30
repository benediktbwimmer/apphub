import { requireResolvedService } from '../clients/serviceClient';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export type MetastoreRuntimeConfig = {
  baseUrl: string;
  token: string | null;
  userAgent: string;
  fetchTimeoutMs: number | null;
  source: 'env' | 'service';
};

let cachedConfig: MetastoreRuntimeConfig | null = null;

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

function selectEnvBaseUrl(): { baseUrl: string; source: MetastoreRuntimeConfig['source'] } | null {
  const candidates: Array<{ value: string | undefined; source: MetastoreRuntimeConfig['source'] }> = [
    { value: process.env.CATALOG_METASTORE_BASE_URL, source: 'env' },
    { value: process.env.METASTORE_BASE_URL, source: 'env' },
    { value: process.env.APPHUB_METASTORE_BASE_URL, source: 'env' }
  ];

  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate.value ?? null);
    if (normalized) {
      return { baseUrl: normalized, source: candidate.source };
    }
  }

  return null;
}

function resolveToken(): string | null {
  const candidates = [
    process.env.CATALOG_METASTORE_TOKEN,
    process.env.METASTORE_TOKEN,
    process.env.APPHUB_METASTORE_TOKEN
  ];

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

function resolveTimeoutMs(): number | null {
  const raw = process.env.CATALOG_METASTORE_TIMEOUT_MS ?? process.env.METASTORE_TIMEOUT_MS;
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function resolveUserAgent(): string {
  return process.env.CATALOG_METASTORE_USER_AGENT ?? 'catalog-observatory/1.0';
}

export async function getMetastoreRuntimeConfig(): Promise<MetastoreRuntimeConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const envBaseUrl = selectEnvBaseUrl();
  if (envBaseUrl) {
    cachedConfig = {
      baseUrl: envBaseUrl.baseUrl,
      token: resolveToken(),
      userAgent: resolveUserAgent(),
      fetchTimeoutMs: resolveTimeoutMs(),
      source: envBaseUrl.source
    } satisfies MetastoreRuntimeConfig;
    return cachedConfig;
  }

  const resolved = await requireResolvedService('metastore', { requireHealthy: false }).catch(() => null);
  if (!resolved) {
    throw new Error(
      'Metastore base URL is not configured. Set CATALOG_METASTORE_BASE_URL or register a metastore service.'
    );
  }

  const serviceBaseUrl = normalizeBaseUrl(resolved.record.baseUrl);
  if (!serviceBaseUrl) {
    throw new Error(
      'Metastore service registration is missing a valid base URL. Provide CATALOG_METASTORE_BASE_URL or update the service record.'
    );
  }

  cachedConfig = {
    baseUrl: serviceBaseUrl,
    token: resolveToken(),
    userAgent: resolveUserAgent(),
    fetchTimeoutMs: resolveTimeoutMs(),
    source: 'service'
  } satisfies MetastoreRuntimeConfig;

  return cachedConfig;
}

export function clearMetastoreRuntimeConfigCache(): void {
  cachedConfig = null;
}

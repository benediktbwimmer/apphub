import { requireResolvedService } from '../clients/serviceClient';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export type FilestoreRuntimeConfig = {
  baseUrl: string;
  token: string | null;
  userAgent: string;
  fetchTimeoutMs: number | null;
  source: 'env' | 'service';
};

let cachedConfig: FilestoreRuntimeConfig | null = null;

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
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

function selectEnvBaseUrl(): { baseUrl: string; source: FilestoreRuntimeConfig['source'] } | null {
  const candidates: Array<{ value: string | undefined; source: FilestoreRuntimeConfig['source'] }> = [
    { value: process.env.CATALOG_FILESTORE_BASE_URL, source: 'env' },
    { value: process.env.FILESTORE_BASE_URL, source: 'env' },
    { value: process.env.APPHUB_FILESTORE_BASE_URL, source: 'env' }
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
    process.env.CATALOG_FILESTORE_TOKEN,
    process.env.FILESTORE_TOKEN,
    process.env.APPHUB_FILESTORE_TOKEN
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
  const raw = process.env.CATALOG_FILESTORE_TIMEOUT_MS ?? process.env.FILESTORE_TIMEOUT_MS;
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export async function getFilestoreRuntimeConfig(): Promise<FilestoreRuntimeConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const envBaseUrl = selectEnvBaseUrl();
  if (envBaseUrl) {
    cachedConfig = {
      baseUrl: envBaseUrl.baseUrl,
      token: resolveToken(),
      userAgent: process.env.CATALOG_FILESTORE_USER_AGENT ?? 'catalog-docker-runner/1.0',
      fetchTimeoutMs: resolveTimeoutMs(),
      source: envBaseUrl.source
    } satisfies FilestoreRuntimeConfig;
    return cachedConfig;
  }

  const resolved = await requireResolvedService('filestore', { requireHealthy: false }).catch(() => null);
  if (!resolved) {
    throw new Error(
      'Filestore base URL is not configured. Set CATALOG_FILESTORE_BASE_URL or register a filestore service.'
    );
  }

  const serviceBaseUrl = normalizeBaseUrl(resolved.record.baseUrl);
  if (!serviceBaseUrl) {
    throw new Error(
      'Filestore service registration is missing a valid base URL. Provide CATALOG_FILESTORE_BASE_URL or update the service record.'
    );
  }

  cachedConfig = {
    baseUrl: serviceBaseUrl,
    token: resolveToken(),
    userAgent: process.env.CATALOG_FILESTORE_USER_AGENT ?? 'catalog-docker-runner/1.0',
    fetchTimeoutMs: resolveTimeoutMs(),
    source: 'service'
  } satisfies FilestoreRuntimeConfig;

  return cachedConfig;
}

export function clearFilestoreRuntimeConfigCache(): void {
  cachedConfig = null;
}

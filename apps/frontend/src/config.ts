const DEFAULT_API_BASE_URL = 'http://localhost:4000';

function normalizeBaseUrl(value: string | undefined, fallback: string): string {
  if (!value || typeof value !== 'string') {
    return fallback;
  }
  return value.replace(/\/$/, '') || fallback;
}

export const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL, DEFAULT_API_BASE_URL);

function isLocalHost(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function resolveLocalServiceFallback(port: number, pathSuffix: string): string {
  if (isLocalHost()) {
    const protocol = typeof window !== 'undefined' && window.location?.protocol
      ? window.location.protocol
      : 'http:';
    const hostname = typeof window !== 'undefined' && window.location?.hostname
      ? window.location.hostname
      : 'localhost';
    return `${protocol}//${hostname}:${port}`;
  }
  return `${API_BASE_URL}${pathSuffix}`;
}

const DEFAULT_TIMESTORE_BASE = resolveLocalServiceFallback(4200, '/timestore');
export const TIMESTORE_BASE_URL = normalizeBaseUrl(
  import.meta.env.VITE_TIMESTORE_BASE_URL,
  DEFAULT_TIMESTORE_BASE
);

const DEFAULT_METASTORE_BASE = resolveLocalServiceFallback(4100, '/metastore');
export const METASTORE_BASE_URL = normalizeBaseUrl(
  import.meta.env.VITE_METASTORE_BASE_URL,
  DEFAULT_METASTORE_BASE
);

const DEFAULT_API_BASE_URL = 'http://localhost:4000';
const DEFAULT_STREAMING_CONSOLE_URL = 'http://localhost:28000';

function normalizeBaseUrl(value: string | undefined, fallback: string): string {
  if (!value || typeof value !== 'string') {
    return fallback;
  }
  return value.replace(/\/$/, '') || fallback;
}

export const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL, DEFAULT_API_BASE_URL);

export const TIMESTORE_BASE_URL = normalizeBaseUrl(
  import.meta.env.VITE_TIMESTORE_BASE_URL,
  `${API_BASE_URL}/timestore`
);

export const METASTORE_BASE_URL = normalizeBaseUrl(
  import.meta.env.VITE_METASTORE_BASE_URL,
  `${API_BASE_URL}/metastore`
);

export const FILESTORE_BASE_URL = normalizeBaseUrl(
  import.meta.env.VITE_FILESTORE_BASE_URL,
  `${API_BASE_URL}/filestore`
);

export const STREAMING_CONSOLE_URL = normalizeBaseUrl(
  import.meta.env.VITE_STREAMING_CONSOLE_URL,
  DEFAULT_STREAMING_CONSOLE_URL
);

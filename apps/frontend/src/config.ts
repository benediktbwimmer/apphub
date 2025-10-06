const DEFAULT_API_BASE_URL = 'http://localhost:4000';
const DEFAULT_STREAMING_CONSOLE_URL = 'http://localhost:28000';
const DEFAULT_MINIO_CONSOLE_URL = 'http://localhost:9401';

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

export const MINIO_CONSOLE_URL = normalizeBaseUrl(
  import.meta.env.VITE_MINIO_CONSOLE_URL,
  DEFAULT_MINIO_CONSOLE_URL
);

export type ExternalConsoleLink = {
  id: string;
  label: string;
  description?: string;
  url: string;
};

function parseExternalConsoleEnv(): ExternalConsoleLink[] {
  const raw = import.meta.env.VITE_EXTERNAL_CONSOLES;
  if (!raw || typeof raw !== 'string') {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const result: ExternalConsoleLink[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const id = typeof (entry as { id?: unknown }).id === 'string' ? (entry as { id: string }).id.trim() : '';
      const label = typeof (entry as { label?: unknown }).label === 'string' ? (entry as { label: string }).label.trim() : '';
      const rawUrl = typeof (entry as { url?: unknown }).url === 'string' ? (entry as { url: string }).url.trim() : '';
      if (!id || !label || !rawUrl) {
        continue;
      }
      const normalizedUrl = normalizeBaseUrl(rawUrl, rawUrl);
      const descriptionValue =
        typeof (entry as { description?: unknown }).description === 'string'
          ? (entry as { description: string }).description.trim()
          : '';
      const description = descriptionValue.length > 0 ? descriptionValue : undefined;
      result.push({ id, label, url: normalizedUrl, description });
    }
    return result;
  } catch {
    return [];
  }
}

function uniqueById(items: ExternalConsoleLink[]): ExternalConsoleLink[] {
  const seen = new Set<string>();
  const result: ExternalConsoleLink[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

const derivedExternalConsoles = (() => {
  const consoles: ExternalConsoleLink[] = parseExternalConsoleEnv();

  if (STREAMING_CONSOLE_URL && !consoles.some((entry) => entry.id === 'redpanda-console')) {
    consoles.push({
      id: 'redpanda-console',
      label: 'Redpanda Console',
      description: 'Inspect Kafka topics, partitions, and consumer lag.',
      url: STREAMING_CONSOLE_URL
    });
  }

  if (MINIO_CONSOLE_URL && !consoles.some((entry) => entry.id === 'minio-console')) {
    consoles.push({
      id: 'minio-console',
      label: 'MinIO Console',
      description: 'Browse object storage buckets and artifacts.',
      url: MINIO_CONSOLE_URL
    });
  }

  return uniqueById(consoles);
})();

export const EXTERNAL_CONSOLES: readonly ExternalConsoleLink[] = derivedExternalConsoles;

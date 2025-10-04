import type { SecretConfig, SecretConfigCollection, SecretRecord } from '../types';

export function loadConfigFromString(raw: string | null | undefined): SecretConfigCollection | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as SecretConfigCollection;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseSecretConfig(key: string, config: SecretConfig): SecretRecord | null {
  if (typeof config === 'string') {
    const value = config.trim();
    if (!value) {
      return null;
    }
    return {
      key,
      value,
      backend: 'unknown'
    } satisfies SecretRecord;
  }
  if (!config || typeof config !== 'object') {
    return null;
  }
  const value = typeof config.value === 'string' ? config.value : '';
  if (!value) {
    return null;
  }
  const version = typeof config.version === 'string' ? config.version : null;
  const metadata = config.metadata ?? null;
  return {
    key,
    value,
    version,
    metadata: metadata ?? null,
    backend: 'unknown'
  } satisfies SecretRecord;
}

export function normalizeSecretCollection(
  sourceName: string,
  collection: SecretConfigCollection | null | undefined
): SecretRecord[] {
  if (!collection) {
    return [];
  }
  const entries: SecretRecord[] = [];
  for (const [key, config] of Object.entries(collection)) {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      continue;
    }
    const entry = parseSecretConfig(trimmedKey, config);
    if (entry) {
      entries.push({ ...entry, backend: sourceName });
    }
  }
  return entries;
}

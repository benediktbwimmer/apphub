import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { JsonValue } from './db/types';

type SecretStoreEntry = {
  key: string;
  value: string;
  version?: string | null;
  metadata?: JsonValue | null;
};

type SecretStoreMap = Map<string, SecretStoreEntry>;

type SecretConfig =
  | string
  | {
      value: string;
      version?: string | null;
      metadata?: JsonValue | null;
    };

type SecretConfigCollection = Record<string, SecretConfig>;

let cache: SecretStoreMap | null = null;

function parseSecretConfig(key: string, config: SecretConfig): SecretStoreEntry | null {
  if (typeof config === 'string') {
    const value = config.trim();
    if (!value) {
      return null;
    }
    return { key, value } satisfies SecretStoreEntry;
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
    metadata
  } satisfies SecretStoreEntry;
}

function mergeStoreEntries(target: SecretStoreMap, source: SecretConfigCollection | null | undefined): void {
  if (!source) {
    return;
  }
  for (const [key, config] of Object.entries(source)) {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      continue;
    }
    const entry = parseSecretConfig(trimmedKey, config);
    if (entry) {
      target.set(trimmedKey, entry);
    }
  }
}

function loadFromJsonString(raw: string): SecretConfigCollection | null {
  if (!raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as SecretConfigCollection;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function loadFromFile(): SecretConfigCollection | null {
  const filePath = process.env.APPHUB_SECRET_STORE_PATH;
  if (!filePath) {
    return null;
  }
  const absolute = path.resolve(filePath);
  if (!existsSync(absolute)) {
    return null;
  }
  try {
    const contents = readFileSync(absolute, 'utf8');
    return loadFromJsonString(contents);
  } catch {
    return null;
  }
}

function buildStore(): SecretStoreMap {
  const store: SecretStoreMap = new Map();
  const inline = loadFromJsonString(process.env.APPHUB_SECRET_STORE ?? '');
  mergeStoreEntries(store, inline ?? undefined);
  mergeStoreEntries(store, loadFromFile() ?? undefined);
  return store;
}

function getStore(): SecretStoreMap {
  if (!cache) {
    cache = buildStore();
  }
  return cache;
}

export function getSecretFromStore(key: string): SecretStoreEntry | null {
  const trimmed = key.trim();
  if (!trimmed) {
    return null;
  }
  const store = getStore();
  return store.get(trimmed) ?? null;
}

export function refreshSecretStore(): void {
  cache = buildStore();
}

export type { SecretStoreEntry };

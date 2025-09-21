import type { LaunchEnvVar, TagKV } from '../types';

export const MAX_LAUNCH_ENV_ROWS = 32;

const ENV_TAG_KEYS = new Set(['env', 'launch:env', 'launch-env', 'launch_env', 'env-var', 'envvar']);

export function normalizeEnvEntries(entries?: LaunchEnvVar[] | null): LaunchEnvVar[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }
  const normalized: LaunchEnvVar[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry.key !== 'string') {
      continue;
    }
    const key = entry.key.trim();
    if (!key) {
      continue;
    }
    const value = typeof entry.value === 'string' ? entry.value : '';
    normalized.push({ key, value });
  }
  return normalized;
}

export function parseEnvTagValue(rawValue: string): LaunchEnvVar | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }
  for (const separator of ['=', ':']) {
    const separatorIndex = trimmed.indexOf(separator);
    if (separatorIndex > 0) {
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (!key) {
        return null;
      }
      return { key, value };
    }
  }
  return { key: trimmed, value: '' };
}

export function extractEnvFromTags(tags: TagKV[] = []): LaunchEnvVar[] {
  const envVars: LaunchEnvVar[] = [];
  for (const tag of tags) {
    if (!tag || typeof tag.key !== 'string' || typeof tag.value !== 'string') {
      continue;
    }
    const normalizedKey = tag.key.trim().toLowerCase();
    if (!ENV_TAG_KEYS.has(normalizedKey)) {
      continue;
    }
    const parsed = parseEnvTagValue(tag.value);
    if (parsed) {
      envVars.push(parsed);
    }
  }
  return envVars;
}

export function mergeEnvSources(primary: LaunchEnvVar[] = [], available: LaunchEnvVar[] = []): LaunchEnvVar[] {
  const normalizedPrimary = normalizeEnvEntries(primary);
  const normalizedAvailable = normalizeEnvEntries(available);
  const seen = new Set<string>();
  const merged: LaunchEnvVar[] = [];

  for (const entry of normalizedPrimary) {
    if (seen.has(entry.key)) {
      continue;
    }
    seen.add(entry.key);
    merged.push(entry);
    if (merged.length >= MAX_LAUNCH_ENV_ROWS) {
      return merged;
    }
  }

  for (const entry of normalizedAvailable) {
    if (seen.has(entry.key)) {
      continue;
    }
    seen.add(entry.key);
    merged.push(entry);
    if (merged.length >= MAX_LAUNCH_ENV_ROWS) {
      break;
    }
  }

  return merged;
}

export type EnvHints = {
  tags: TagKV[];
  availableEnv?: LaunchEnvVar[] | null;
  availableLaunchEnv?: LaunchEnvVar[] | null;
  launchEnvTemplates?: LaunchEnvVar[] | null;
};

export function collectAvailableEnvVars(hints: EnvHints): LaunchEnvVar[] {
  const storedHints = [
    ...normalizeEnvEntries(hints.availableEnv),
    ...normalizeEnvEntries(hints.availableLaunchEnv),
    ...normalizeEnvEntries(hints.launchEnvTemplates)
  ];
  const tagEnv = extractEnvFromTags(hints.tags);
  return mergeEnvSources(storedHints, tagEnv);
}

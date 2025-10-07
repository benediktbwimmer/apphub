import type { StagingSchemaField } from '../sql/stagingSchema';

interface StagingSchemaCacheEntry {
  fields: StagingSchemaField[];
  updatedAt: number;
  stale: boolean;
  schemaVersion: number | null;
}

export interface CachedStagingSchema {
  fields: StagingSchemaField[];
  updatedAt: number;
  stale: boolean;
  schemaVersion: number | null;
}

const schemaCache = new Map<string, StagingSchemaCacheEntry>();

function canonicalKey(datasetSlug: string): string | null {
  if (typeof datasetSlug !== 'string') {
    return null;
  }
  const trimmed = datasetSlug.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cloneFields(fields: StagingSchemaField[]): StagingSchemaField[] {
  return fields.map((field) => ({
    name: field.name,
    type: field.type,
    nullable: field.nullable,
    description: field.description ?? null
  }));
}

export function getStagingSchemaCacheEntry(datasetSlug: string): CachedStagingSchema | null {
  const key = canonicalKey(datasetSlug);
  if (!key) {
    return null;
  }
  const entry = schemaCache.get(key);
  if (!entry) {
    return null;
  }
  return {
    fields: cloneFields(entry.fields),
    updatedAt: entry.updatedAt,
    stale: entry.stale,
    schemaVersion: entry.schemaVersion
  };
}

interface CacheMetadata {
  schemaVersion?: number | null;
  updatedAt?: number;
  stale?: boolean;
}

export function setStagingSchemaCache(
  datasetSlug: string,
  fields: StagingSchemaField[],
  metadata: CacheMetadata = {}
): void {
  const key = canonicalKey(datasetSlug);
  if (!key) {
    return;
  }
  schemaCache.set(key, {
    fields: cloneFields(fields),
    updatedAt: metadata.updatedAt ?? Date.now(),
    stale: metadata.stale ?? false,
    schemaVersion: typeof metadata.schemaVersion === 'number'
      ? metadata.schemaVersion
      : metadata.schemaVersion ?? null
  });
}

export function markStagingSchemaCacheStale(datasetSlug: string): void {
  const key = canonicalKey(datasetSlug);
  if (!key) {
    return;
  }
  const existing = schemaCache.get(key);
  if (existing) {
    schemaCache.set(key, {
      fields: existing.fields,
      updatedAt: Date.now(),
      stale: true,
      schemaVersion: existing.schemaVersion
    });
  }
}

export function clearStagingSchemaCache(datasetSlug: string): void {
  const key = canonicalKey(datasetSlug);
  if (!key) {
    return;
  }
  schemaCache.delete(key);
}

export function resetStagingSchemaCache(): void {
  schemaCache.clear();
}

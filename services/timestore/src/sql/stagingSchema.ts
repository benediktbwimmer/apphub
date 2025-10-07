import { getStagingSchemaCacheEntry, setStagingSchemaCache } from '../cache/stagingSchemaCache';
import type { DatasetRecord } from '../db/metadata';
import {
  getStagingSchemaRegistry,
  upsertStagingSchemaRegistry,
  type StagingSchemaRegistryRecord
} from '../db/stagingSchemaRegistry';
import type { ServiceConfig } from '../config/serviceConfig';
import { getStagingWriteManager } from '../ingestion/stagingManager';
import {
  recordStagingSchemaCacheFallback,
  recordStagingSchemaRegistryLoad,
  recordStagingSchemaRegistryUpdate
} from '../observability/metrics';
import type { PendingStagingBatch } from '../storage/spoolManager';

export interface StagingSchemaField {
  name: string;
  type: string;
  nullable?: boolean;
  description?: string | null;
}

export async function readStagingSchemaFields(
  dataset: DatasetRecord,
  config: ServiceConfig,
  warnings?: string[]
): Promise<StagingSchemaField[]> {
  const cacheEntry = getStagingSchemaCacheEntry(dataset.slug);
  if (cacheEntry && cacheEntry.fields.length > 0 && cacheEntry.stale === false) {
    return cacheEntry.fields;
  }

  const registryEntry = await loadRegistryEntry(dataset, warnings);
  if (registryEntry && registryEntry.fields.length > 0) {
    setStagingSchemaCache(dataset.slug, registryEntry.fields, {
      schemaVersion: registryEntry.schemaVersion,
      updatedAt: registryEntry.updatedAt?.getTime()
    });
    return registryEntry.fields;
  }

  const pendingFields = await collectFieldsFromPendingBatches(dataset, config);
  if (pendingFields.length > 0) {
    recordStagingSchemaCacheFallback({
      datasetSlug: dataset.slug,
      reason: registryEntry ? 'empty' : 'missing'
    });
    try {
      const persisted = await upsertStagingSchemaRegistry({
        datasetId: dataset.id,
        fields: pendingFields,
        sourceBatchId: null
      });
      recordStagingSchemaRegistryUpdate({
        datasetSlug: dataset.slug,
        status: persisted.status
      });
      setStagingSchemaCache(dataset.slug, persisted.record.fields, {
        schemaVersion: persisted.record.schemaVersion,
        updatedAt: persisted.record.updatedAt.getTime()
      });
      return persisted.record.fields;
    } catch (error) {
      if (warnings) {
        warnings.push(
          `Failed to persist staging schema for dataset ${dataset.slug}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      recordStagingSchemaRegistryUpdate({
        datasetSlug: dataset.slug,
        status: 'failed'
      });
      setStagingSchemaCache(dataset.slug, pendingFields);
      return pendingFields;
    }
  }

  if (registryEntry) {
    setStagingSchemaCache(dataset.slug, registryEntry.fields, {
      schemaVersion: registryEntry.schemaVersion,
      updatedAt: registryEntry.updatedAt?.getTime()
    });
  }

  if (warnings) {
    warnings.push(`No staging schema available for dataset ${dataset.slug}.`);
  }
  return [];
}

async function loadRegistryEntry(
  dataset: DatasetRecord,
  warnings?: string[]
): Promise<StagingSchemaRegistryRecord | null> {
  try {
    const entry = await getStagingSchemaRegistry(dataset.id);
    if (!entry) {
      recordStagingSchemaRegistryLoad({ datasetSlug: dataset.slug, result: 'miss' });
      return null;
    }
    recordStagingSchemaRegistryLoad({ datasetSlug: dataset.slug, result: 'hit' });
    return entry;
  } catch (error) {
    recordStagingSchemaRegistryLoad({ datasetSlug: dataset.slug, result: 'error' });
    if (warnings) {
      warnings.push(
        `Failed to load staging schema registry entry for dataset ${dataset.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    return null;
  }
}

async function collectFieldsFromPendingBatches(
  dataset: DatasetRecord,
  config: ServiceConfig
): Promise<StagingSchemaField[]> {
  try {
    const manager = getStagingWriteManager(config);
    const batches: PendingStagingBatch[] = await manager.getSpoolManager().listPendingBatches(dataset.slug);
    const fieldMap = new Map<string, StagingSchemaField>();

    for (const batch of batches) {
      for (const field of batch.schema) {
        if (!field.name) {
          continue;
        }
        const name = field.name.trim();
        if (!name || fieldMap.has(name)) {
          continue;
        }
        fieldMap.set(name, {
          name,
          type: field.type,
          nullable: true,
          description: null
        });
      }
    }

    return Array.from(fieldMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    return [];
  }
}

export function sanitizeDatasetSlug(datasetSlug: string): string {
  const trimmed = datasetSlug.trim();
  if (trimmed.length === 0) {
    throw new Error('datasetSlug must not be empty');
  }
  const normalized = trimmed.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return normalized.length > 0 ? normalized : 'dataset';
}

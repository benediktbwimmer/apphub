import { randomUUID } from 'node:crypto';
import {
  createDataset,
  getDatasetBySlug,
  getStorageTargetByName,
  upsertStorageTarget,
  updateDataset,
  updateDatasetDefaultStorageTarget,
  type StorageTargetRecord
} from '../db/metadata';
import type { ServiceConfig } from '../config/serviceConfig';
import { ensureClickHouseTable } from '../clickhouse/writer';

const DEFAULT_STORAGE_TARGET_NAME = 'timestore-clickhouse';
const DEFAULT_STORAGE_TARGET_ID = `st-${DEFAULT_STORAGE_TARGET_NAME}`;

export async function ensureDefaultStorageTarget(): Promise<StorageTargetRecord> {
  const existing = await getStorageTargetByName(DEFAULT_STORAGE_TARGET_NAME);
  if (existing) {
    return existing;
  }

  return upsertStorageTarget({
    id: DEFAULT_STORAGE_TARGET_ID,
    name: DEFAULT_STORAGE_TARGET_NAME,
    kind: 'clickhouse',
    description: 'ClickHouse-backed timestore storage target',
    config: {}
  });
}

async function ensureClickHouseTableWithRetry(params: {
  config: ServiceConfig;
  datasetSlug: string;
  tableName: string;
  schema: { name: string; type: string }[];
}): Promise<void> {
  const maxAttempts = 5;
  const delayMs = 2000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await ensureClickHouseTable(params);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[timestore] Failed to ensure ClickHouse table ${params.tableName} for ${params.datasetSlug} after ${maxAttempts} attempts: ${
      lastError instanceof Error ? lastError.message : lastError
    }`
  );
}

export async function ensureStreamingDatasets(
  config: ServiceConfig,
  storageTarget: StorageTargetRecord
): Promise<void> {
  if (!config.features.streaming.enabled) {
    return;
  }

  const seen = new Set<string>();
  for (const batcher of config.streaming.batchers) {
    const slug = batcher.datasetSlug.trim();
    if (!slug || seen.has(slug)) {
      continue;
    }
    seen.add(slug);

    const ensureTable = async () => {
      const schema = batcher.schema.fields;
      if (schema.length === 0) {
        return;
      }
      await ensureClickHouseTableWithRetry({
        config,
        datasetSlug: slug,
        tableName: batcher.tableName ?? slug,
        schema
      });
    };

    const existing = await getDatasetBySlug(slug);
    if (!existing) {
      await ensureTable();
      await createDataset({
        id: `ds-${randomUUID()}`,
        slug,
        name: batcher.datasetName ?? slug,
        description: 'Streaming dataset (auto-provisioned)',
        defaultStorageTargetId: storageTarget.id,
        metadata: {
          createdBy: 'timestore-streaming-bootstrap',
          tableName: batcher.tableName ?? slug,
          timestampColumn: batcher.timeField ?? 'timestamp'
        }
      });
      continue;
    }

    if (!existing.defaultStorageTargetId) {
      await updateDatasetDefaultStorageTarget(existing.id, storageTarget.id);
    }
    const metadata = (existing.metadata as Record<string, unknown>) ?? {};
    let shouldUpdateMetadata = false;
    if (typeof metadata.tableName !== 'string' || metadata.tableName.trim() === '') {
      metadata.tableName = batcher.tableName ?? slug;
      shouldUpdateMetadata = true;
    }
    if (typeof metadata.timestampColumn !== 'string' || metadata.timestampColumn.trim() === '') {
      metadata.timestampColumn = batcher.timeField ?? 'timestamp';
      shouldUpdateMetadata = true;
    }
    if (shouldUpdateMetadata) {
      await updateDataset({
        id: existing.id,
        metadata
      });
    }
    await ensureTable();
  }
}

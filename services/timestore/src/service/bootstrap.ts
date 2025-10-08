import {
  getStorageTargetByName,
  upsertStorageTarget,
  type StorageTargetRecord
} from '../db/metadata';

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

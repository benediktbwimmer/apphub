import { randomUUID } from 'node:crypto';
import {
  getStorageTargetByName,
  upsertStorageTarget,
  type StorageTargetRecord
} from '../db/metadata';
import { loadServiceConfig, type ServiceConfig } from '../config/serviceConfig';

const DEFAULT_STORAGE_TARGET_PREFIX = 'timestore-default';

export async function ensureDefaultStorageTarget(): Promise<StorageTargetRecord> {
  const config = loadServiceConfig();
  const name = getDefaultStorageTargetName(config.storage.driver);
  const existing = await getStorageTargetByName(name);
  if (existing) {
    return existing;
  }

  if (config.storage.driver === 'local') {
    return upsertStorageTarget({
      id: `st-${randomUUID()}`,
      name,
      kind: 'local',
      description: 'Default local timestore storage target',
      config: {
        root: config.storage.root
      }
    });
  }

  if (!config.storage.s3) {
    throw new Error('S3 storage selected but configuration missing');
  }

  return upsertStorageTarget({
    id: `st-${randomUUID()}`,
    name,
    kind: 's3',
    description: 'Default S3 timestore storage target',
    config: {
      bucket: config.storage.s3.bucket,
      endpoint: config.storage.s3.endpoint,
      region: config.storage.s3.region
    }
  });
}

export function getDefaultStorageTargetName(driver: ServiceConfig['storage']['driver']): string {
  return `${DEFAULT_STORAGE_TARGET_PREFIX}-${driver}`;
}

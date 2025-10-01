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

  if (config.storage.driver === 's3') {
    if (!config.storage.s3) {
      throw new Error('S3 storage selected but configuration missing');
    }

    const s3Config: Record<string, unknown> = {
      bucket: config.storage.s3.bucket,
      endpoint: config.storage.s3.endpoint,
      region: config.storage.s3.region
    };
    if (config.storage.s3.accessKeyId) {
      s3Config.accessKeyId = config.storage.s3.accessKeyId;
    }
    if (config.storage.s3.secretAccessKey) {
      s3Config.secretAccessKey = config.storage.s3.secretAccessKey;
    }
    if (config.storage.s3.sessionToken) {
      s3Config.sessionToken = config.storage.s3.sessionToken;
    }
    if (config.storage.s3.forcePathStyle !== undefined) {
      s3Config.forcePathStyle = config.storage.s3.forcePathStyle;
    }

    return upsertStorageTarget({
      id: `st-${randomUUID()}`,
      name,
      kind: 's3',
      description: 'Default S3 timestore storage target',
      config: s3Config
    });
  }

  if (config.storage.driver === 'gcs') {
    if (!config.storage.gcs) {
      throw new Error('GCS storage selected but configuration missing');
    }
    const gcsConfig: Record<string, unknown> = {
      bucket: config.storage.gcs.bucket
    };
    if (config.storage.gcs.projectId) {
      gcsConfig.projectId = config.storage.gcs.projectId;
    }
    if (config.storage.gcs.keyFilename) {
      gcsConfig.keyFilename = config.storage.gcs.keyFilename;
    }
    if (config.storage.gcs.clientEmail) {
      gcsConfig.clientEmail = config.storage.gcs.clientEmail;
    }
    if (config.storage.gcs.privateKey) {
      gcsConfig.privateKey = config.storage.gcs.privateKey;
    }
    if (config.storage.gcs.hmacKeyId) {
      gcsConfig.hmacKeyId = config.storage.gcs.hmacKeyId;
    }
    if (config.storage.gcs.hmacSecret) {
      gcsConfig.hmacSecret = config.storage.gcs.hmacSecret;
    }

    return upsertStorageTarget({
      id: `st-${randomUUID()}`,
      name,
      kind: 'gcs',
      description: 'Default GCS timestore storage target',
      config: gcsConfig
    });
  }

  if (config.storage.driver === 'azure_blob') {
    if (!config.storage.azure) {
      throw new Error('Azure Blob storage selected but configuration missing');
    }

    const azureConfig: Record<string, unknown> = {
      container: config.storage.azure.container
    };
    if (config.storage.azure.connectionString) {
      azureConfig.connectionString = config.storage.azure.connectionString;
    }
    if (config.storage.azure.accountName) {
      azureConfig.accountName = config.storage.azure.accountName;
    }
    if (config.storage.azure.accountKey) {
      azureConfig.accountKey = config.storage.azure.accountKey;
    }
    if (config.storage.azure.sasToken) {
      azureConfig.sasToken = config.storage.azure.sasToken;
    }
    if (config.storage.azure.endpoint) {
      azureConfig.endpoint = config.storage.azure.endpoint;
    }

    return upsertStorageTarget({
      id: `st-${randomUUID()}`,
      name,
      kind: 'azure_blob',
      description: 'Default Azure Blob timestore storage target',
      config: azureConfig
    });
  }

  throw new Error(`Unsupported storage driver: ${config.storage.driver}`);
}

export function getDefaultStorageTargetName(driver: ServiceConfig['storage']['driver']): string {
  return `${DEFAULT_STORAGE_TARGET_PREFIX}-${driver}`;
}

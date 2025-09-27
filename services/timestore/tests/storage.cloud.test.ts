import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { StorageTargetRecord } from '../src/db/metadata';
import type { PartitionWriteRequest } from '../src/storage';
import {
  GcsStorageDriver,
  AzureBlobStorageDriver,
  resolveGcsDriverOptions,
  resolveAzureDriverOptions,
  resolvePartitionLocation,
  createGcsBucketClient,
  createAzureContainerClient,
  type ResolvedGcsOptions,
  type ResolvedAzureOptions
} from '../src/storage';
import { configureGcsSupport, configureAzureSupport } from '../src/query/executor';
import type { ServiceConfig } from '../src/config/serviceConfig';

function createWriteRequest(): PartitionWriteRequest {
  return {
    datasetSlug: 'sensor-readings',
    partitionId: 'partition-123',
    partitionKey: { region: 'us-east-1' },
    tableName: 'records',
    schema: [
      { name: 'id', type: 'integer' },
      { name: 'value', type: 'double' }
    ],
    rows: [
      { id: 1, value: 42.5 },
      { id: 2, value: 37.1 }
    ]
  } satisfies PartitionWriteRequest;
}

test('GcsStorageDriver writes duckdb file to bucket', async () => {
  const writes: Array<{ key: string; size: number; options: unknown }> = [];
  const bucketFactory = () => ({
    file(key: string) {
      return {
        async save(buffer: Buffer, options: unknown) {
          writes.push({ key, size: buffer.length, options });
        }
      };
    }
  });

  const driver = new GcsStorageDriver({ bucket: 'telemetry' }, bucketFactory as unknown as typeof createGcsBucketClient);
  const result = await driver.writePartition(createWriteRequest());

  assert.equal(writes.length, 1);
  assert.equal(result.relativePath, writes[0]?.key);
  assert.equal(result.rowCount, 2);
  const expectedKey = 'sensor-readings/region=us-east-1/partition-123.duckdb';
  assert.equal(result.relativePath, expectedKey);
  assert.equal(writes[0]?.options && (writes[0]?.options as { resumable?: boolean }).resumable, false);
});

test('AzureBlobStorageDriver uploads duckdb file to container', async () => {
  const uploads: Array<{ key: string; size: number; options: unknown }> = [];
  const containerFactory = () => ({
    getBlockBlobClient(key: string) {
      return {
        async uploadData(buffer: Buffer, options: unknown) {
          uploads.push({ key, size: buffer.length, options });
        }
      };
    }
  });

  const resolved: ResolvedAzureOptions = {
    container: 'exports',
    connectionString: 'DefaultEndpointsProtocol=https;AccountName=sample;AccountKey=test',
    accountName: 'sample'
  };

  const driver = new AzureBlobStorageDriver(resolved, containerFactory as unknown as typeof createAzureContainerClient);
  const request = createWriteRequest();
  const result = await driver.writePartition(request);
  assert.equal(uploads.length, 1);
  assert.equal(result.relativePath, uploads[0]?.key);
  assert.equal(result.fileSizeBytes, uploads[0]?.size);
});

test('resolvePartitionLocation returns cloud URIs', () => {
  const serviceConfig = createServiceConfig();
  const gcsTarget: StorageTargetRecord = {
    id: 'gcs-1',
    name: 'gcs',
    kind: 'gcs',
    description: null,
    config: {
      bucket: 'telemetry-gcs'
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const azureTarget: StorageTargetRecord = {
    id: 'azure-1',
    name: 'azure',
    kind: 'azure_blob',
    description: null,
    config: {
      container: 'snapshots',
      connectionString: 'DefaultEndpointsProtocol=https;AccountName=sample;AccountKey=test'
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const partition = {
    id: 'p1',
    datasetId: 'd1',
    manifestId: 'm1',
    partitionKey: {},
    storageTargetId: gcsTarget.id,
    fileFormat: 'duckdb' as const,
    filePath: 'dataset/key=value/file.duckdb',
    fileSizeBytes: 100,
    rowCount: 2,
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    checksum: null,
    metadata: {},
    createdAt: new Date().toISOString()
  };

  const gcsUri = resolvePartitionLocation(partition, gcsTarget, serviceConfig);
  assert.equal(gcsUri, 'gs://telemetry-gcs/dataset/key=value/file.duckdb');

  const azureUri = resolvePartitionLocation(partition, azureTarget, serviceConfig);
  assert.equal(azureUri, 'azure://sample.blob.core.windows.net/snapshots/dataset/key=value/file.duckdb');
});

test('configureGcsSupport installs httpfs and creates scoped secret', async () => {
  const { config, target, options } = createGcsConfig();
  const executed: string[] = [];
  const connection = {
    run(sql: string, callback: (err: Error | null) => void) {
      executed.push(sql);
      callback(null);
    }
  };

  await configureGcsSupport(connection, [{ target, options }]);

  assert.ok(executed.some((sql) => sql === 'INSTALL httpfs'));
  assert.ok(executed.some((sql) => sql === 'LOAD httpfs'));
  assert.ok(executed.some((sql) => sql.startsWith('DROP SECRET IF EXISTS')));
  const createSecret = executed.find((sql) => sql.trim().startsWith('CREATE SECRET'));
  assert.ok(createSecret);
  assert.match(createSecret ?? '', /TYPE gcs/i);
  assert.match(createSecret ?? '', /SCOPE 'gs:\/\/telemetry\/';?$/m);
});

test('configureAzureSupport installs extension and registers connection string secret', async () => {
  const { config, target, options } = createAzureConfig();
  const executed: string[] = [];
  const connection = {
    run(sql: string, callback: (err: Error | null) => void) {
      executed.push(sql);
      callback(null);
    }
  };

  await configureAzureSupport(connection, [{ target, options }]);

  assert.ok(executed.includes('INSTALL azure'));
  assert.ok(executed.includes('LOAD azure'));
  const createSecret = executed.find((sql) => sql.trim().startsWith('CREATE SECRET'));
  assert.ok(createSecret);
  assert.match(createSecret ?? '', /CONNECTION_STRING/);
  assert.match(createSecret ?? '', /SCOPE 'azure:\/\/sample\.blob\.core\.windows\.net\/snapshots\//);
});

function createServiceConfig(): ServiceConfig {
  return {
    host: '127.0.0.1',
    port: 4100,
    logLevel: 'info',
    database: {
      url: 'postgres://example',
      schema: 'public',
      maxConnections: 5,
      idleTimeoutMs: 1000,
      connectionTimeoutMs: 1000
    },
    storage: {
      driver: 'local',
      root: '/tmp/timestore',
      s3: undefined,
      gcs: {
        bucket: 'telemetry-gcs',
        projectId: 'sample'
      },
      azure: {
        container: 'snapshots',
        connectionString: 'DefaultEndpointsProtocol=https;AccountName=sample;AccountKey=test'
      }
    },
    query: {
      cache: {
        enabled: false,
        directory: path.join(tmpdir(), 'cache'),
        maxBytes: 1024
      }
    },
    sql: {
      maxQueryLength: 10_000,
      statementTimeoutMs: 30_000
    },
    lifecycle: {
      enabled: true,
      queueName: 'q',
      intervalSeconds: 60,
      jitterSeconds: 5,
      jobConcurrency: 1,
      compaction: {
        smallPartitionBytes: 10,
        targetPartitionBytes: 20,
        maxPartitionsPerGroup: 5
      },
      retention: {
        defaultRules: {},
        deleteGraceMinutes: 5
      },
      exports: {
        enabled: false,
        outputFormat: 'parquet',
        outputPrefix: 'exports',
        minIntervalHours: 24
      }
    },
    observability: {
      metrics: {
        enabled: false,
        collectDefaultMetrics: false,
        prefix: 'timestore_',
        scope: null
      },
      tracing: {
        enabled: false,
        serviceName: 'timestore'
      }
    },
    filestore: {
      enabled: false,
      redisUrl: 'inline',
      channel: 'apphub:filestore',
      datasetSlug: 'filestore_activity',
      datasetName: 'Filestore Activity',
      tableName: 'filestore_activity',
      retryDelayMs: 3000,
      inline: true
    }
  } satisfies ServiceConfig;
}

function createGcsConfig(): {
  config: ServiceConfig;
  target: StorageTargetRecord;
  options: ResolvedGcsOptions;
} {
  const config = createServiceConfig();
  const target: StorageTargetRecord = {
    id: 'gcs-target',
    name: 'telemetry-gcs',
    kind: 'gcs',
    description: null,
    config: {
      bucket: 'telemetry',
      hmacKeyId: 'HMACKEY',
      hmacSecret: 'super-secret'
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const options = resolveGcsDriverOptions(config, target);
  return { config, target, options };
}

function createAzureConfig(): {
  config: ServiceConfig;
  target: StorageTargetRecord;
  options: ResolvedAzureOptions;
} {
  const config = createServiceConfig();
  const target: StorageTargetRecord = {
    id: 'azure-target',
    name: 'telemetry-azure',
    kind: 'azure_blob',
    description: null,
    config: {
      container: 'snapshots',
      connectionString: 'DefaultEndpointsProtocol=https;AccountName=sample;AccountKey=test'
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const options = resolveAzureDriverOptions(config, target);
  return { config, target, options };
}

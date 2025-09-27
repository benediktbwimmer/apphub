import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadDuckDb, isCloseable } from '@apphub/shared';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { LifecycleAuditLogInput, PartitionWithTarget, StorageTargetRecord } from '../db/metadata';
import { getManifestById, updateManifestSummaryAndMetadata } from '../db/metadata';
import {
  resolvePartitionLocation,
  resolveGcsDriverOptions,
  resolveAzureDriverOptions,
  createGcsBucketClient,
  createAzureContainerClient
} from '../storage';
import type { LifecycleJobContext, LifecycleOperationExecutionResult } from './types';
import { mergeMetadataLifecycle, mergeSummaryLifecycle } from './manifest';
import { publishTimestoreEvent } from '../events/publisher';

export async function performParquetExport(
  context: LifecycleJobContext,
  partitions: PartitionWithTarget[]
): Promise<LifecycleOperationExecutionResult> {
  const { lifecycle } = context.config;
  if (!lifecycle.exports.enabled) {
    return {
      operation: 'parquetExport',
      status: 'skipped',
      message: 'parquet exports disabled via configuration'
    };
  }

  if (partitions.length === 0) {
    return {
      operation: 'parquetExport',
      status: 'skipped',
      message: 'no partitions available to export'
    };
  }

  const lastExportAt = getLastExportTimestamp(context.manifest.metadata);
  if (lastExportAt) {
    const elapsedMs = Date.now() - lastExportAt.getTime();
    const minIntervalMs = lifecycle.exports.minIntervalHours * 60 * 60 * 1000;
    if (elapsedMs < minIntervalMs) {
      return {
        operation: 'parquetExport',
        status: 'skipped',
        message: 'last export newer than configured interval'
      };
    }
  }

  const storageTarget = chooseExportTarget(partitions);
  const exportTimestamp = new Date();
  const relativePath = buildExportPath(context.dataset.slug, lifecycle.exports.outputPrefix, exportTimestamp);
  const exportResult = await materializeParquetSnapshot(
    context,
    partitions,
    storageTarget,
    relativePath
  );

  const summaryPayload = {
    appliedAt: exportTimestamp.toISOString(),
    fileFormat: 'parquet',
    filePath: relativePath,
    storageTargetId: storageTarget.id,
    rowCount: exportResult.rowCount,
    fileSizeBytes: exportResult.fileSizeBytes
  } as Record<string, unknown>;

  const exportsHistory = readExportsHistory(context.manifest.metadata);
  const nextHistory = [...exportsHistory, {
    id: exportResult.assetId,
    filePath: relativePath,
    storageTargetId: storageTarget.id,
    fileSizeBytes: exportResult.fileSizeBytes,
    rowCount: exportResult.rowCount,
    exportedAt: exportTimestamp.toISOString()
  }];
  const metadataPayload = {
    lastCompletedAt: exportTimestamp.toISOString(),
    history: nextHistory.slice(-10),
    outputFormat: 'parquet'
  } as Record<string, unknown>;

  const updatedSummary = mergeSummaryLifecycle(context.manifest, 'exports', summaryPayload);
  const updatedMetadata = mergeMetadataLifecycle(context.manifest, 'exports', metadataPayload);
  await updateManifestSummaryAndMetadata(context.manifest.id, updatedSummary, updatedMetadata);
  const manifestWithPartitions = await getManifestById(context.manifest.id);

  const auditEvents: LifecycleAuditLogInput[] = [
    {
      id: `la-${randomUUID()}`,
      datasetId: context.dataset.id,
      manifestId: context.manifest.id,
      eventType: 'export.parquet.created',
      payload: {
        datasetId: context.dataset.id,
        filePath: relativePath,
        storageTargetId: storageTarget.id,
        rowCount: exportResult.rowCount,
        fileSizeBytes: exportResult.fileSizeBytes
      }
    }
  ];

  try {
    await publishTimestoreEvent(
      'timestore.dataset.export.completed',
      {
        datasetId: context.dataset.id,
        datasetSlug: context.dataset.slug,
        manifestId: context.manifest.id,
        exportId: exportResult.assetId,
        storageTargetId: storageTarget.id,
        filePath: relativePath,
        rowCount: exportResult.rowCount,
        fileSizeBytes: exportResult.fileSizeBytes,
        exportedAt: exportTimestamp.toISOString()
      },
      'timestore.lifecycle'
    );
  } catch (err) {
    console.error('[timestore] failed to publish dataset.export completed event', err);
  }

  return {
    operation: 'parquetExport',
    status: 'completed',
    manifest: manifestWithPartitions ?? context.manifest,
    auditEvents,
    totals: {
      partitions: partitions.length,
      bytes: exportResult.fileSizeBytes
    }
  };
}

interface ExportResult {
  assetId: string;
  fileSizeBytes: number;
  rowCount: number;
}

async function materializeParquetSnapshot(
  context: LifecycleJobContext,
  partitions: PartitionWithTarget[],
  target: StorageTargetRecord,
  relativePath: string
): Promise<ExportResult> {
  const duckdb = loadDuckDb();
  const db = new duckdb.Database(':memory:');
  const connection = db.connect();
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'timestore-export-'));
  const tempFile = path.join(tempDir, 'snapshot.parquet');

  try {
    await attachPartitions(connection, partitions, context.config);
    await createDatasetView(connection, partitions);
    await run(connection, `COPY (SELECT * FROM dataset_view) TO '${tempFile.replace(/'/g, "''")}' (FORMAT 'parquet')`);
    const countRows = await firstRow(connection, 'SELECT COUNT(*) AS count FROM dataset_view');
    const rowCount = Number(countRows?.count ?? 0);

    const { fileSizeBytes } = await persistExportAsset(tempFile, relativePath, target, context.config);

    return {
      assetId: `asset-${randomUUID()}`,
      fileSizeBytes,
      rowCount
    };
  } finally {
    await closeConnection(connection);
    if (isCloseable(db)) {
      db.close();
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function attachPartitions(
  connection: any,
  partitions: PartitionWithTarget[],
  config: LifecycleJobContext['config']
): Promise<void> {
  let index = 0;
  for (const partition of partitions) {
    const alias = `p${index++}`;
    const location = resolvePartitionLocation(partition, partition.storageTarget, config);
    await run(connection, `ATTACH '${location.replace(/'/g, "''")}' AS ${alias}`);
  }
}

async function createDatasetView(
  connection: any,
  partitions: PartitionWithTarget[]
): Promise<void> {
  const selects: string[] = [];
  let index = 0;
  for (const partition of partitions) {
    const alias = `p${index++}`;
    const tableName = quoteIdentifier(extractTableName(partition));
    selects.push(`SELECT * FROM ${alias}.${tableName}`);
  }
  const unionSql = selects.join('\nUNION ALL\n');
  await run(connection, `CREATE OR REPLACE TEMP VIEW dataset_view AS ${unionSql}`);
}

async function persistExportAsset(
  tempFile: string,
  relativePath: string,
  target: StorageTargetRecord,
  config: LifecycleJobContext['config']
): Promise<{ fileSizeBytes: number }> {
  const stats = await fs.stat(tempFile);
  if (target.kind === 'local') {
    const root = typeof target.config.root === 'string' ? target.config.root : config.storage.root;
    const destination = path.join(root, convertPosixToPlatform(relativePath));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(tempFile, destination);
    return { fileSizeBytes: stats.size };
  }

  if (target.kind === 's3') {
    const bucket = typeof target.config.bucket === 'string' ? target.config.bucket : config.storage.s3?.bucket;
    if (!bucket) {
      throw new Error('S3 storage target missing bucket configuration');
    }
    const client = new S3Client({
      region: typeof target.config.region === 'string' ? target.config.region : config.storage.s3?.region ?? 'us-east-1',
      endpoint: typeof target.config.endpoint === 'string' ? target.config.endpoint : config.storage.s3?.endpoint,
      forcePathStyle: Boolean(target.config.endpoint ?? config.storage.s3?.endpoint)
    });
    const fileBuffer = await fs.readFile(tempFile);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: relativePath,
        Body: fileBuffer,
        ContentType: 'application/octet-stream'
      })
    );
    return { fileSizeBytes: fileBuffer.length };
  }

  if (target.kind === 'gcs') {
    const options = resolveGcsDriverOptions(config, target);
    const bucket = createGcsBucketClient(options);
    const fileBuffer = await fs.readFile(tempFile);
    await bucket.file(relativePath).save(fileBuffer, {
      resumable: false,
      contentType: 'application/octet-stream'
    });
    return { fileSizeBytes: fileBuffer.length };
  }

  if (target.kind === 'azure_blob') {
    const options = resolveAzureDriverOptions(config, target);
    if (!options.connectionString) {
      throw new Error('Azure Blob storage target requires a connection string for exports');
    }
    const containerClient = createAzureContainerClient(options);
    const fileBuffer = await fs.readFile(tempFile);
    const blobClient = containerClient.getBlockBlobClient(relativePath);
    await blobClient.uploadData(fileBuffer, {
      blobHTTPHeaders: {
        blobContentType: 'application/octet-stream'
      }
    });
    return { fileSizeBytes: fileBuffer.length };
  }

  throw new Error(`Unsupported storage target for export: ${target.kind}`);
}

function chooseExportTarget(partitions: PartitionWithTarget[]): StorageTargetRecord {
  const target = partitions[0]?.storageTarget;
  if (!target) {
    throw new Error('Unable to determine storage target for export');
  }
  return target;
}

function buildExportPath(datasetSlug: string, prefix: string, timestamp: Date): string {
  const slug = datasetSlug.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '_');
  const iso = timestamp.toISOString().replace(/[:.]/g, '-');
  const posixPath = path.posix;
  return posixPath.join(prefix, slug, `snapshot-${iso}.parquet`);
}

function readExportsHistory(metadata: Record<string, unknown> | null | undefined): Array<Record<string, unknown>> {
  const lifecycle = metadata && typeof metadata === 'object' && metadata !== null
    ? (metadata as Record<string, unknown>).lifecycle
    : null;
  if (!lifecycle || typeof lifecycle !== 'object') {
    return [];
  }
  const exportsSection = (lifecycle as Record<string, unknown>).exports;
  if (!exportsSection || typeof exportsSection !== 'object') {
    return [];
  }
  const history = (exportsSection as Record<string, unknown>).history;
  return Array.isArray(history) ? [...history] : [];
}

function getLastExportTimestamp(metadata: Record<string, unknown> | null | undefined): Date | null {
  const lifecycle = metadata && typeof metadata === 'object' && metadata !== null
    ? (metadata as Record<string, unknown>).lifecycle
    : null;
  if (!lifecycle || typeof lifecycle !== 'object') {
    return null;
  }
  const exportsSection = (lifecycle as Record<string, unknown>).exports;
  if (!exportsSection || typeof exportsSection !== 'object') {
    return null;
  }
  const lastCompletedAt = (exportsSection as Record<string, unknown>).lastCompletedAt;
  if (typeof lastCompletedAt === 'string') {
    const parsed = new Date(lastCompletedAt);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function extractTableName(partition: PartitionWithTarget): string {
  const metadata = partition.metadata ?? {};
  const tableName = typeof metadata.tableName === 'string' ? metadata.tableName : 'records';
  return tableName;
}

function convertPosixToPlatform(input: string): string {
  return input.split('/').join(path.sep);
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function run(connection: any, sql: string, ...params: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.run(sql, ...params, (err: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

async function firstRow(connection: any, sql: string): Promise<Record<string, unknown> | null> {
  const rows = await all(connection, sql);
  return rows[0] ?? null;
}

function all(connection: any, sql: string, ...params: unknown[]): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    connection.all(sql, ...params, (err: Error | null, rows?: Record<string, unknown>[]) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows ?? []);
    });
  });
}

function closeConnection(connection: any): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.close((err: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

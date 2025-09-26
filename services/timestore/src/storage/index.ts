import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { loadDuckDb, isCloseable } from '@apphub/shared';
import { ServiceConfig } from '../config/serviceConfig';
import type { DatasetPartitionRecord, StorageTargetRecord } from '../db/metadata';

export type FieldType = 'timestamp' | 'string' | 'double' | 'integer' | 'boolean';

export interface FieldDefinition {
  name: string;
  type: FieldType;
}

export interface PartitionWriteRequest {
  datasetSlug: string;
  partitionId: string;
  partitionKey: Record<string, string>;
  tableName: string;
  schema: FieldDefinition[];
  rows: Record<string, unknown>[];
}

export interface PartitionWriteResult {
  relativePath: string;
  fileSizeBytes: number;
  rowCount: number;
  checksum: string;
}

export interface StorageDriver {
  writePartition(request: PartitionWriteRequest): Promise<PartitionWriteResult>;
}

export function createStorageDriver(
  config: ServiceConfig,
  target: StorageTargetRecord
): StorageDriver {
  if (target.kind === 'local') {
    const root = typeof target.config.root === 'string' ? target.config.root : config.storage.root;
    return new LocalStorageDriver(root);
  }

  if (target.kind === 's3') {
    const bucket = typeof target.config.bucket === 'string'
      ? target.config.bucket
      : config.storage.s3?.bucket;
    if (!bucket) {
      throw new Error('S3 storage target missing bucket configuration');
    }
    return new S3StorageDriver({
      bucket,
      endpoint: typeof target.config.endpoint === 'string' ? target.config.endpoint : config.storage.s3?.endpoint,
      region: typeof target.config.region === 'string' ? target.config.region : config.storage.s3?.region
    });
  }

  throw new Error(`Unsupported storage target kind: ${target.kind}`);
}

class LocalStorageDriver implements StorageDriver {
  constructor(private readonly root: string) {}

  async writePartition(request: PartitionWriteRequest): Promise<PartitionWriteResult> {
    const relativePath = buildPartitionRelativePath(request.datasetSlug, request.partitionKey, request.partitionId);
    const absolutePath = path.join(this.root, convertPosixToPlatform(relativePath));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await writeDuckDbFile(absolutePath, request.tableName, request.schema, request.rows);
    const stats = await fs.stat(absolutePath);
    const checksum = await computeFileChecksum(absolutePath);
    return {
      relativePath,
      fileSizeBytes: stats.size,
      rowCount: request.rows.length,
      checksum
    };
  }
}

interface S3DriverOptions {
  bucket: string;
  endpoint?: string;
  region?: string;
}

class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client;

  constructor(private readonly options: S3DriverOptions) {
    this.client = new S3Client({
      region: options.region ?? 'us-east-1',
      endpoint: options.endpoint,
      forcePathStyle: Boolean(options.endpoint)
    });
  }

  async writePartition(request: PartitionWriteRequest): Promise<PartitionWriteResult> {
    const relativePath = buildPartitionRelativePath(request.datasetSlug, request.partitionKey, request.partitionId);
    const tempDir = await mkdtemp(path.join(tmpdir(), 'timestore-s3-'));
    const tempFile = path.join(tempDir, `${request.partitionId}.duckdb`);
    try {
      await writeDuckDbFile(tempFile, request.tableName, request.schema, request.rows);
      const fileBuffer = await fs.readFile(tempFile);
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: relativePath,
          Body: fileBuffer
        })
      );
      const checksum = createHash('sha1').update(fileBuffer).digest('hex');
      return {
        relativePath,
        fileSizeBytes: fileBuffer.length,
        rowCount: request.rows.length,
        checksum
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

function convertPosixToPlatform(input: string): string {
  return input.split('/').join(path.sep);
}

function buildPartitionRelativePath(
  datasetSlug: string,
  partitionKey: Record<string, string>,
  partitionId: string
): string {
  const safeDataset = sanitizeSegment(datasetSlug);
  const segments = Object.entries(partitionKey)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${sanitizeSegment(key)}=${sanitizeSegment(value)}`);
  const fileName = `${partitionId}.duckdb`;
  const posixPath = path.posix;
  return posixPath.join(safeDataset, ...segments, fileName);
}

function sanitizeSegment(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s/\\]+/g, '_')
    .replace(/[^a-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'segment';
}

export function resolvePartitionLocation(
  partition: DatasetPartitionRecord,
  target: StorageTargetRecord,
  config: ServiceConfig
): string {
  if (target.kind === 'local') {
    const root = typeof target.config.root === 'string' ? target.config.root : config.storage.root;
    return path.join(root, convertPosixToPlatform(partition.filePath));
  }

  if (target.kind === 's3') {
    const bucket = typeof target.config.bucket === 'string' ? target.config.bucket : config.storage.s3?.bucket;
    if (!bucket) {
      throw new Error('S3 storage target missing bucket configuration');
    }
    return `s3://${bucket}/${partition.filePath}`;
  }

  throw new Error(`Unsupported storage target kind: ${target.kind}`);
}

async function writeDuckDbFile(
  filePath: string,
  tableName: string,
  schema: FieldDefinition[],
  rows: Record<string, unknown>[]
): Promise<void> {
  await fs.rm(filePath, { force: true });
  const duckdb = loadDuckDb();
  const db = new duckdb.Database(filePath);
  const connection = db.connect();

  try {
    const safeTableName = quoteIdentifier(tableName || 'records');
    const columnDefinitions = schema
      .map((field) => `${quoteIdentifier(field.name)} ${mapDuckDbType(field.type)}`)
      .join(', ');
    await run(connection, `CREATE TABLE IF NOT EXISTS ${safeTableName} (${columnDefinitions})`);

    if (rows.length === 0) {
      return;
    }

    const columnNames = schema.map((field) => field.name);
    const placeholders = columnNames.map(() => '?').join(', ');
    const insertSql = `INSERT INTO ${safeTableName} (${columnNames.map(quoteIdentifier).join(', ')}) VALUES (${placeholders})`;

    for (const row of rows) {
      const values = columnNames.map((column, index) =>
        coerceValue(row[column], schema[index]?.type ?? 'string')
      );
      await run(connection, insertSql, ...values);
    }
  } finally {
    await closeConnection(connection);
    if (isCloseable(db)) {
      db.close();
    }
  }
}

function quoteIdentifier(identifier: string): string {
  const safe = identifier.replace(/"/g, '""');
  return `"${safe}"`;
}

function mapDuckDbType(type: FieldType): string {
  switch (type) {
    case 'timestamp':
      return 'TIMESTAMP';
    case 'double':
      return 'DOUBLE';
    case 'integer':
      return 'BIGINT';
    case 'boolean':
      return 'BOOLEAN';
    case 'string':
    default:
      return 'VARCHAR';
  }
}

function coerceValue(value: unknown, type: FieldType): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  switch (type) {
    case 'timestamp':
      if (value instanceof Date) {
        return value.toISOString();
      }
      return new Date(String(value)).toISOString();
    case 'double':
      return Number(value);
    case 'integer':
      return Number.parseInt(String(value), 10);
    case 'boolean':
      return typeof value === 'boolean' ? value : String(value).toLowerCase() === 'true';
    case 'string':
    default:
      return String(value);
  }
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

async function computeFileChecksum(filePath: string): Promise<string> {
  const hash = createHash('sha1');
  const data = await fs.readFile(filePath);
  hash.update(data);
  return hash.digest('hex');
}

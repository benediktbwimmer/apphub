import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Storage, type StorageOptions, type Bucket } from '@google-cloud/storage';
import { BlobServiceClient, StorageSharedKeyCredential, type ContainerClient } from '@azure/storage-blob';
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
    const accessKeyId = typeof target.config.accessKeyId === 'string'
      ? target.config.accessKeyId
      : config.storage.s3?.accessKeyId;
    const secretAccessKey = typeof target.config.secretAccessKey === 'string'
      ? target.config.secretAccessKey
      : config.storage.s3?.secretAccessKey;
    const sessionToken = typeof target.config.sessionToken === 'string'
      ? target.config.sessionToken
      : config.storage.s3?.sessionToken;
    const forcePathStyle = typeof target.config.forcePathStyle === 'boolean'
      ? target.config.forcePathStyle
      : config.storage.s3?.forcePathStyle;
    return new S3StorageDriver({
      bucket,
      endpoint: typeof target.config.endpoint === 'string' ? target.config.endpoint : config.storage.s3?.endpoint,
      region: typeof target.config.region === 'string' ? target.config.region : config.storage.s3?.region,
      accessKeyId,
      secretAccessKey,
      sessionToken,
      forcePathStyle
    });
  }

  if (target.kind === 'gcs') {
    const options = resolveGcsDriverOptions(config, target);
    return new GcsStorageDriver(options);
  }

  if (target.kind === 'azure_blob') {
    const options = resolveAzureDriverOptions(config, target);
    return new AzureBlobStorageDriver(options);
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
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  forcePathStyle?: boolean;
}

class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client;

  constructor(private readonly options: S3DriverOptions) {
    this.client = new S3Client({
      region: options.region ?? 'us-east-1',
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
      credentials:
        options.accessKeyId && options.secretAccessKey
          ? {
              accessKeyId: options.accessKeyId,
              secretAccessKey: options.secretAccessKey,
              sessionToken: options.sessionToken
            }
          : undefined
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

interface GcsDriverOptions {
  bucket: string;
  projectId?: string;
  keyFilename?: string;
  clientEmail?: string;
  privateKey?: string;
}

export class GcsStorageDriver implements StorageDriver {
  private readonly bucket: Bucket;

  constructor(
    private readonly options: GcsDriverOptions,
    bucketFactory: (options: GcsDriverOptions) => Bucket = createGcsBucketClient
  ) {
    this.bucket = bucketFactory(options);
  }

  async writePartition(request: PartitionWriteRequest): Promise<PartitionWriteResult> {
    const relativePath = buildPartitionRelativePath(request.datasetSlug, request.partitionKey, request.partitionId);
    const tempDir = await mkdtemp(path.join(tmpdir(), 'timestore-gcs-'));
    const tempFile = path.join(tempDir, `${request.partitionId}.duckdb`);
    try {
      await writeDuckDbFile(tempFile, request.tableName, request.schema, request.rows);
      const fileBuffer = await fs.readFile(tempFile);
      const object = this.bucket.file(relativePath);
      await object.save(fileBuffer, {
        resumable: false,
        contentType: 'application/octet-stream'
      });
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

interface AzureBlobDriverOptions {
  container: string;
  connectionString?: string;
  accountName?: string;
  accountKey?: string;
  sasToken?: string;
  endpoint?: string;
}

export class AzureBlobStorageDriver implements StorageDriver {
  private readonly containerClient: ContainerClient;

  constructor(
    private readonly options: ResolvedAzureOptions,
    containerFactory: (options: ResolvedAzureOptions) => ContainerClient = createAzureContainerClient
  ) {
    this.containerClient = containerFactory(this.options);
  }

  async writePartition(request: PartitionWriteRequest): Promise<PartitionWriteResult> {
    const relativePath = buildPartitionRelativePath(request.datasetSlug, request.partitionKey, request.partitionId);
    const tempDir = await mkdtemp(path.join(tmpdir(), 'timestore-azure-'));
    const tempFile = path.join(tempDir, `${request.partitionId}.duckdb`);
    try {
      await writeDuckDbFile(tempFile, request.tableName, request.schema, request.rows);
      const fileBuffer = await fs.readFile(tempFile);
      const blobClient = this.containerClient.getBlockBlobClient(relativePath);
      await blobClient.uploadData(fileBuffer, {
        blobHTTPHeaders: {
          blobContentType: 'application/octet-stream'
        }
      });
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

  if (target.kind === 'gcs') {
    const options = resolveGcsDriverOptions(config, target);
    return `gs://${options.bucket}/${partition.filePath}`;
  }

  if (target.kind === 'azure_blob') {
    const options = resolveAzureDriverOptions(config, target);
    const host = resolveAzureBlobHost(options);
    return `azure://${host}/${options.container}/${partition.filePath}`;
  }

  throw new Error(`Unsupported storage target kind: ${target.kind}`);
}

export async function deletePartitionFile(
  partition: DatasetPartitionRecord,
  target: StorageTargetRecord,
  config: ServiceConfig
): Promise<void> {
  if (target.kind === 'local') {
    const location = resolvePartitionLocation(partition, target, config);
    await fs.rm(location, { force: true });
    return;
  }

  if (target.kind === 'gcs') {
    const options = resolveGcsDriverOptions(config, target);
    const bucket = createGcsBucketClient(options);
    await bucket.file(partition.filePath).delete({ ignoreNotFound: true });
    return;
  }

  if (target.kind === 's3') {
    const bucket = typeof target.config.bucket === 'string' ? target.config.bucket : config.storage.s3?.bucket;
    if (!bucket) {
      throw new Error('S3 storage target missing bucket configuration');
    }

    const region = typeof target.config.region === 'string' ? target.config.region : config.storage.s3?.region ?? 'us-east-1';
    const endpoint = typeof target.config.endpoint === 'string' ? target.config.endpoint : config.storage.s3?.endpoint;
    const accessKeyId = typeof target.config.accessKeyId === 'string'
      ? target.config.accessKeyId
      : config.storage.s3?.accessKeyId;
    const secretAccessKey = typeof target.config.secretAccessKey === 'string'
      ? target.config.secretAccessKey
      : config.storage.s3?.secretAccessKey;
    const sessionToken = typeof target.config.sessionToken === 'string'
      ? target.config.sessionToken
      : config.storage.s3?.sessionToken;
    const forcePathStyle = typeof target.config.forcePathStyle === 'boolean'
      ? target.config.forcePathStyle
      : config.storage.s3?.forcePathStyle ?? Boolean(endpoint);

    const client = new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials:
        accessKeyId && secretAccessKey
          ? {
              accessKeyId,
              secretAccessKey,
              sessionToken
            }
          : undefined
    });

    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: partition.filePath
      })
    );
    return;
  }

  if (target.kind === 'azure_blob') {
    const options = resolveAzureDriverOptions(config, target);
    const containerClient = createAzureContainerClient(options);
    const blobClient = containerClient.getBlockBlobClient(partition.filePath);
    await blobClient.deleteIfExists();
    return;
  }

  throw new Error(`Unsupported storage target kind for deletion: ${target.kind}`);
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

export interface ResolvedGcsOptions extends GcsDriverOptions {
  hmacKeyId?: string;
  hmacSecret?: string;
}

interface AzureConnectionStringProperties {
  [key: string]: string;
}

export interface ResolvedAzureOptions extends AzureBlobDriverOptions {
  accountName?: string;
  connectionStringProperties?: AzureConnectionStringProperties;
}

export function resolveGcsDriverOptions(config: ServiceConfig, target: StorageTargetRecord): ResolvedGcsOptions {
  const targetConfig = target.config ?? {};
  const fallback = config.storage.gcs;
  const bucket = typeof targetConfig.bucket === 'string' ? targetConfig.bucket : fallback?.bucket;
  if (!bucket) {
    throw new Error('GCS storage target missing bucket configuration');
  }

  return {
    bucket,
    projectId: typeof targetConfig.projectId === 'string' ? targetConfig.projectId : fallback?.projectId,
    keyFilename: typeof targetConfig.keyFilename === 'string' ? targetConfig.keyFilename : fallback?.keyFilename,
    clientEmail: typeof targetConfig.clientEmail === 'string' ? targetConfig.clientEmail : fallback?.clientEmail,
    privateKey: typeof targetConfig.privateKey === 'string' ? targetConfig.privateKey : fallback?.privateKey,
    hmacKeyId: typeof targetConfig.hmacKeyId === 'string' ? targetConfig.hmacKeyId : fallback?.hmacKeyId,
    hmacSecret: typeof targetConfig.hmacSecret === 'string' ? targetConfig.hmacSecret : fallback?.hmacSecret
  } satisfies ResolvedGcsOptions;
}

export function resolveAzureDriverOptions(config: ServiceConfig, target: StorageTargetRecord): ResolvedAzureOptions {
  const targetConfig = target.config ?? {};
  const fallback = config.storage.azure;
  const container = typeof targetConfig.container === 'string' ? targetConfig.container : fallback?.container;
  if (!container) {
    throw new Error('Azure Blob storage target missing container configuration');
  }

  const connectionString = typeof targetConfig.connectionString === 'string'
    ? targetConfig.connectionString
    : fallback?.connectionString;

  const resolved: ResolvedAzureOptions = {
    container,
    connectionString,
    accountName: typeof targetConfig.accountName === 'string' ? targetConfig.accountName : fallback?.accountName,
    accountKey: typeof targetConfig.accountKey === 'string' ? targetConfig.accountKey : fallback?.accountKey,
    sasToken: typeof targetConfig.sasToken === 'string' ? targetConfig.sasToken : fallback?.sasToken,
    endpoint: typeof targetConfig.endpoint === 'string' ? targetConfig.endpoint : fallback?.endpoint
  } satisfies ResolvedAzureOptions;

  if (connectionString) {
    const properties = parseAzureConnectionString(connectionString);
    resolved.connectionStringProperties = properties;
    if (!resolved.accountName && properties.accountname) {
      resolved.accountName = properties.accountname;
    }
    if (!resolved.endpoint && properties.blobendpoint) {
      resolved.endpoint = properties.blobendpoint;
    }
    if (!resolved.sasToken && properties.sharedaccesssignature) {
      resolved.sasToken = properties.sharedaccesssignature;
    }
  }

  return resolved;
}

export function createGcsBucketClient(options: GcsDriverOptions): Bucket {
  const storageOptions: StorageOptions = {};
  if (options.projectId) {
    storageOptions.projectId = options.projectId;
  }
  if (options.keyFilename) {
    storageOptions.keyFilename = options.keyFilename;
  }
  if (options.clientEmail && options.privateKey) {
    storageOptions.credentials = {
      client_email: options.clientEmail,
      private_key: normalizePrivateKey(options.privateKey)
    };
  }
  return new Storage(storageOptions).bucket(options.bucket);
}

export function createAzureContainerClient(options: ResolvedAzureOptions): ContainerClient {
  if (options.connectionString) {
    const client = BlobServiceClient.fromConnectionString(options.connectionString);
    return client.getContainerClient(options.container);
  }

  const endpoint = buildAzureEndpoint(options);

  if (options.accountName && options.accountKey) {
    const credential = new StorageSharedKeyCredential(options.accountName, options.accountKey);
    const client = new BlobServiceClient(endpoint, credential);
    return client.getContainerClient(options.container);
  }

  if (options.accountName && options.sasToken) {
    const sas = options.sasToken.startsWith('?') ? options.sasToken : `?${options.sasToken}`;
    const client = new BlobServiceClient(`${endpoint}${sas}`);
    return client.getContainerClient(options.container);
  }

  throw new Error('Azure Blob storage target missing authentication configuration');
}

function normalizePrivateKey(input: string): string {
  return input.includes('\\n') ? input.replace(/\\n/g, '\n') : input;
}

function parseAzureConnectionString(connectionString: string): AzureConnectionStringProperties {
  const result: AzureConnectionStringProperties = {};
  for (const segment of connectionString.split(';')) {
    if (!segment) {
      continue;
    }
    const [rawKey, ...rest] = segment.split('=');
    if (!rawKey || rest.length === 0) {
      continue;
    }
    const key = rawKey.trim().toLowerCase();
    const value = rest.join('=').trim();
    if (key) {
      result[key] = value;
    }
  }
  return result;
}

function buildAzureEndpoint(options: ResolvedAzureOptions): string {
  const explicit = options.endpoint?.trim();
  if (explicit) {
    return removeTrailingSlash(explicit);
  }
  if (options.connectionStringProperties?.blobendpoint) {
    return removeTrailingSlash(options.connectionStringProperties.blobendpoint);
  }
  if (options.accountName) {
    return `https://${options.accountName}.blob.core.windows.net`;
  }
  throw new Error('Azure Blob storage target missing endpoint configuration');
}

function removeTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function resolveAzureBlobHost(options: ResolvedAzureOptions): string {
  if (options.endpoint) {
    try {
      const url = new URL(options.endpoint);
      return url.host;
    } catch {
      return removeTrailingSlash(options.endpoint).replace(/^https?:\/\//i, '');
    }
  }
  if (options.connectionStringProperties?.blobendpoint) {
    try {
      const url = new URL(options.connectionStringProperties.blobendpoint);
      return url.host;
    } catch {
      return removeTrailingSlash(options.connectionStringProperties.blobendpoint).replace(/^https?:\/\//i, '');
    }
  }
  if (options.accountName) {
    return `${options.accountName}.blob.core.windows.net`;
  }
  throw new Error('Azure Blob storage target missing account information for location resolution');
}

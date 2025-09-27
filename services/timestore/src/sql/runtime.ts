import { randomUUID, createHash } from 'node:crypto';
import { loadDuckDb, isCloseable } from '@apphub/shared';
import { loadServiceConfig, type ServiceConfig } from '../config/serviceConfig';
import {
  listDatasets,
  getLatestPublishedManifest,
  getSchemaVersionById,
  getStorageTargetById,
  type DatasetRecord,
  type DatasetManifestWithPartitions,
  type DatasetPartitionRecord,
  type StorageTargetRecord
} from '../db/metadata';
import {
  resolvePartitionLocation,
  resolveGcsDriverOptions,
  resolveAzureDriverOptions,
  type ResolvedGcsOptions,
  type ResolvedAzureOptions
} from '../storage';
import { configureS3Support, configureGcsSupport, configureAzureSupport } from '../query/executor';
import {
  recordRuntimeCacheEvent,
  observeRuntimeCacheRebuild,
  type RuntimeCacheEvent
} from '../observability/metrics';

type DuckDbConnection = any;

const DEFAULT_SQL_RUNTIME_CACHE_TTL_MS = 30_000;
const CONTEXT_SIGNATURE_SYMBOL: unique symbol = Symbol('apphub.timestore.sqlContextSignature');
const CONTEXT_VERSION_SYMBOL: unique symbol = Symbol('apphub.timestore.sqlContextVersion');

type VersionedSqlContext = SqlContext & {
  [CONTEXT_SIGNATURE_SYMBOL]?: string;
  [CONTEXT_VERSION_SYMBOL]?: number;
};

interface ContextCacheEntry {
  context: VersionedSqlContext;
  expiresAt: number;
  builtAt: number;
  version: number;
  signature: string;
}

interface ConnectionCacheEntry {
  signature: string;
  db: any;
  warnings: string[];
  expiresAt: number;
  activeConnections: number;
  disposed: boolean;
  closePromise: Promise<void> | null;
}

let contextCacheEntry: ContextCacheEntry | null = null;
let contextBuildPromise: Promise<VersionedSqlContext> | null = null;
let contextVersionCounter = 0;
let cacheGeneration = 0;
const connectionCache = new Map<string, ConnectionCacheEntry>();
const connectionBuildPromises = new Map<string, Promise<void>>();

function getRuntimeCacheTtlMs(): number {
  const config = loadServiceConfig();
  const value = config.sql.runtimeCacheTtlMs;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(value, 0);
  }
  return DEFAULT_SQL_RUNTIME_CACHE_TTL_MS;
}

function computeContextSignature(context: SqlContext): string {
  const hash = createHash('sha1');
  const datasets = [...context.datasets].sort((a, b) =>
    a.dataset.id.localeCompare(b.dataset.id)
  );
  for (const entry of datasets) {
    hash.update(String(entry.dataset.id));
    hash.update('|');
    hash.update(String(entry.dataset.slug));
    hash.update('|');
    hash.update(String(entry.dataset.updatedAt ?? ''));
    hash.update('|');
    hash.update(String(entry.manifest?.id ?? 'none'));
    hash.update('|');
    hash.update(String(entry.manifest?.version ?? 'none'));
    hash.update('|');
    hash.update(String(entry.manifest?.updatedAt ?? ''));
    hash.update('|');
    const partitionIds = entry.partitions.map((partition) => partition.id).sort();
    for (const partitionId of partitionIds) {
      hash.update(String(partitionId));
      hash.update(',');
    }
    hash.update(';');
  }
  hash.update(`count:${context.datasets.length}`);
  return hash.digest('hex');
}

function annotateContext(
  context: SqlContext,
  signature: string,
  version: number
): VersionedSqlContext {
  const target = context as VersionedSqlContext;
  Object.defineProperty(target, CONTEXT_SIGNATURE_SYMBOL, {
    value: signature,
    enumerable: false,
    configurable: true
  });
  Object.defineProperty(target, CONTEXT_VERSION_SYMBOL, {
    value: version,
    enumerable: false,
    configurable: true
  });
  return target;
}

function getContextSignature(context: SqlContext): string {
  const target = context as VersionedSqlContext;
  if (target[CONTEXT_SIGNATURE_SYMBOL]) {
    return target[CONTEXT_SIGNATURE_SYMBOL] as string;
  }
  const signature = computeContextSignature(context);
  Object.defineProperty(target, CONTEXT_SIGNATURE_SYMBOL, {
    value: signature,
    enumerable: false,
    configurable: true
  });
  if (typeof target[CONTEXT_VERSION_SYMBOL] !== 'number') {
    Object.defineProperty(target, CONTEXT_VERSION_SYMBOL, {
      value: 0,
      enumerable: false,
      configurable: true
    });
  }
  return signature;
}

function pruneExpiredConnectionEntries(now: number): void {
  for (const [signature, entry] of connectionCache.entries()) {
    if (entry.expiresAt <= now) {
      connectionCache.delete(signature);
      markConnectionEntryForDisposal(entry, 'expired');
    }
  }
}

function flushConnectionCache(event: RuntimeCacheEvent): void {
  for (const [signature, entry] of connectionCache.entries()) {
    connectionCache.delete(signature);
    markConnectionEntryForDisposal(entry, event);
  }
}

function markConnectionEntryForDisposal(entry: ConnectionCacheEntry, event: RuntimeCacheEvent): void {
  if (!entry.disposed) {
    entry.disposed = true;
  }
  recordRuntimeCacheEvent('connection', event);
  if (entry.activeConnections === 0) {
    disposeConnectionDatabase(entry);
  }
}

function disposeConnectionDatabase(entry: ConnectionCacheEntry): void {
  if (entry.closePromise) {
    return;
  }
  entry.closePromise = Promise.resolve().then(() => {
    if (isCloseable(entry.db)) {
      ignoreCloseError(() => entry.db.close());
    }
  });
}

async function releaseCachedConnection(
  entry: ConnectionCacheEntry,
  connection: DuckDbConnection
): Promise<void> {
  try {
    await closeConnection(connection);
  } finally {
    entry.activeConnections = Math.max(entry.activeConnections - 1, 0);
    if (entry.disposed && entry.activeConnections === 0) {
      disposeConnectionDatabase(entry);
    }
  }
}

function leaseCachedConnection(entry: ConnectionCacheEntry): SqlRuntimeConnection {
  const connection = entry.db.connect();
  entry.activeConnections += 1;
  return {
    connection,
    warnings: [...entry.warnings],
    cleanup: async () => {
      await releaseCachedConnection(entry, connection);
    }
  } satisfies SqlRuntimeConnection;
}

export interface SqlSchemaColumnInfo {
  name: string;
  type: string;
  nullable?: boolean;
  description?: string | null;
}

export interface SqlSchemaTableInfo {
  name: string;
  description: string | null;
  partitionKeys?: string[];
  columns: SqlSchemaColumnInfo[];
}

export interface SqlDatasetPartitionContext {
  id: string;
  storageTarget: StorageTargetRecord;
  location: string;
  tableName: string;
  partitionKey: Record<string, unknown>;
  rowCount: number | null;
  startTime: string;
  endTime: string;
  fileSizeBytes: number | null;
}

export interface SqlDatasetContext {
  dataset: DatasetRecord;
  manifest: DatasetManifestWithPartitions | null;
  columns: SqlSchemaColumnInfo[];
  partitionKeys: string[];
  partitions: SqlDatasetPartitionContext[];
  viewName: string;
  aliasWarnings: string[];
}

export interface SqlContext {
  config: ServiceConfig;
  datasets: SqlDatasetContext[];
  warnings: string[];
}

export interface SqlRuntimeConnection {
  connection: DuckDbConnection;
  cleanup: () => Promise<void>;
  warnings: string[];
}

async function buildSqlContext(): Promise<SqlContext> {
  const config = loadServiceConfig();
  const warnings: string[] = [];
  const datasets: SqlDatasetContext[] = [];

  const datasetRecords = await loadAllDatasets();
  const storageTargetCache = new Map<string, StorageTargetRecord | null>();

  for (const dataset of datasetRecords) {
    if (dataset.writeFormat !== 'duckdb') {
      warnings.push(`Dataset ${dataset.slug} is not backed by DuckDB partitions; skipping.`);
      continue;
    }

    const manifest = await getLatestPublishedManifest(dataset.id);
    const columns = await loadSchemaColumns(dataset, manifest, warnings);
    const partitions = manifest
      ? await mapPartitions(manifest.partitions, config, storageTargetCache, warnings)
      : [];
    const partitionKeys = derivePartitionKeys(partitions);
    const { viewName, aliasWarning } = createViewName(dataset.slug);
    const aliasWarnings = aliasWarning ? [aliasWarning] : [];
    if (aliasWarning) {
      warnings.push(aliasWarning);
    }

    datasets.push({
      dataset,
      manifest,
      columns,
      partitionKeys,
      partitions,
      viewName,
      aliasWarnings
    });
  }

  return {
    config,
    datasets,
    warnings
  } satisfies SqlContext;
}

export async function loadSqlContext(): Promise<SqlContext> {
  const ttlMs = getRuntimeCacheTtlMs();
  if (ttlMs <= 0) {
    const context = (await buildSqlContext()) as VersionedSqlContext;
    const signature = computeContextSignature(context);
    const version = ++contextVersionCounter;
    return annotateContext(context, signature, version);
  }

  const now = Date.now();
  pruneExpiredConnectionEntries(now);

  if (contextCacheEntry && contextCacheEntry.expiresAt > now) {
    contextCacheEntry.expiresAt = now + ttlMs;
    recordRuntimeCacheEvent('context', 'hit');
    return contextCacheEntry.context;
  }

  if (contextCacheEntry) {
    recordRuntimeCacheEvent('context', 'expired');
    flushConnectionCache('expired');
    contextCacheEntry = null;
  }

  if (!contextBuildPromise) {
    contextBuildPromise = buildAndCacheContext(ttlMs).catch((error) => {
      contextBuildPromise = null;
      contextCacheEntry = null;
      throw error;
    });
  }

  return contextBuildPromise;
}

async function buildAndCacheContext(ttlMs: number): Promise<VersionedSqlContext> {
  const start = process.hrtime.bigint();
  const generation = cacheGeneration;
  try {
    const context = (await buildSqlContext()) as VersionedSqlContext;
    const signature = computeContextSignature(context);
    const version = ++contextVersionCounter;
    annotateContext(context, signature, version);
    const builtAt = Date.now();
    recordRuntimeCacheEvent('context', 'miss');
    observeRuntimeCacheRebuild('context', Number(process.hrtime.bigint() - start) / 1_000_000_000);
    if (generation === cacheGeneration) {
      contextCacheEntry = {
        context,
        expiresAt: builtAt + ttlMs,
        builtAt,
        version,
        signature
      } satisfies ContextCacheEntry;
    }
    return context;
  } finally {
    contextBuildPromise = null;
  }
}

export async function createDuckDbConnection(context: SqlContext): Promise<SqlRuntimeConnection> {
  const ttlMs = getRuntimeCacheTtlMs();
  if (ttlMs <= 0) {
    return createDuckDbConnectionUncached(context);
  }

  const signature = getContextSignature(context);
  while (true) {
    const now = Date.now();
    pruneExpiredConnectionEntries(now);

    const cachedEntry = connectionCache.get(signature);
    if (cachedEntry && !cachedEntry.disposed && cachedEntry.expiresAt > now) {
      cachedEntry.expiresAt = now + ttlMs;
      recordRuntimeCacheEvent('connection', 'hit');
      return leaseCachedConnection(cachedEntry);
    }

    if (cachedEntry) {
      connectionCache.delete(signature);
      markConnectionEntryForDisposal(cachedEntry, 'expired');
    }

    let pending = connectionBuildPromises.get(signature);
    let initiatedBuild = false;

    if (!pending) {
      initiatedBuild = true;
      pending = buildConnectionEntry(context, signature, ttlMs)
        .catch((error) => {
          connectionCache.delete(signature);
          throw error;
        })
        .finally(() => {
          connectionBuildPromises.delete(signature);
        });
      connectionBuildPromises.set(signature, pending);
    }

    await pending;

    const entry = connectionCache.get(signature);
    if (!entry || entry.disposed) {
      continue;
    }

    entry.expiresAt = Date.now() + ttlMs;
    if (!initiatedBuild) {
      recordRuntimeCacheEvent('connection', 'hit');
    }

    return leaseCachedConnection(entry);
  }
}

async function buildConnectionEntry(
  context: SqlContext,
  signature: string,
  ttlMs: number
): Promise<void> {
  const start = process.hrtime.bigint();
  const generation = cacheGeneration;
  const { db, warnings } = await initializeDuckDbDatabase(context);
  recordRuntimeCacheEvent('connection', 'miss');
  observeRuntimeCacheRebuild('connection', Number(process.hrtime.bigint() - start) / 1_000_000_000);
  if (generation !== cacheGeneration) {
    if (isCloseable(db)) {
      ignoreCloseError(() => db.close());
    }
    return;
  }
  const entry: ConnectionCacheEntry = {
    signature,
    db,
    warnings,
    expiresAt: Date.now() + ttlMs,
    activeConnections: 0,
    disposed: false,
    closePromise: null
  };
  connectionCache.set(signature, entry);
}

async function createDuckDbConnectionUncached(
  context: SqlContext
): Promise<SqlRuntimeConnection> {
  const { db, warnings } = await initializeDuckDbDatabase(context);
  let connection: DuckDbConnection | null = null;
  try {
    connection = db.connect();
  } catch (error) {
    if (isCloseable(db)) {
      ignoreCloseError(() => db.close());
    }
    throw error;
  }

  return {
    connection,
    warnings: [...warnings],
    cleanup: async () => {
      await closeConnection(connection!).catch(() => {
        // ignore cleanup failures
      });
      if (isCloseable(db)) {
        ignoreCloseError(() => db.close());
      }
    }
  } satisfies SqlRuntimeConnection;
}

async function initializeDuckDbDatabase(context: SqlContext): Promise<{ db: any; warnings: string[] }> {
  const duckdb = loadDuckDb();
  const db = new duckdb.Database(':memory:');
  const connection = db.connect();
  const warnings = [...context.warnings];

  try {
    await prepareConnectionForRemotePartitions(connection, context);

    await run(connection, 'CREATE SCHEMA IF NOT EXISTS timestore');
    await run(connection, 'CREATE SCHEMA IF NOT EXISTS timestore_runtime');

    await createRuntimeTables(connection);
    await populateRuntimeTables(connection, context.datasets);

    for (const dataset of context.datasets) {
      const datasetWarnings = await attachDataset(connection, dataset);
      warnings.push(...datasetWarnings);
    }

    await closeConnection(connection);
    return { db, warnings };
  } catch (error) {
    await closeConnection(connection).catch(() => {
      // ignore cleanup failures during bootstrapping
    });
    if (isCloseable(db)) {
      ignoreCloseError(() => db.close());
    }
    throw error;
  }
}

async function prepareConnectionForRemotePartitions(
  connection: any,
  context: SqlContext
): Promise<void> {
  let hasS3 = false;
  const gcsTargets = new Map<string, { target: StorageTargetRecord; options: ResolvedGcsOptions }>();
  const azureTargets = new Map<string, { target: StorageTargetRecord; options: ResolvedAzureOptions }>();

  for (const dataset of context.datasets) {
    for (const partition of dataset.partitions) {
      const target = partition.storageTarget;
      switch (target.kind) {
        case 's3':
          hasS3 = true;
          break;
        case 'gcs':
          if (!gcsTargets.has(target.id)) {
            gcsTargets.set(target.id, {
              target,
              options: resolveGcsDriverOptions(context.config, target)
            });
          }
          break;
        case 'azure_blob':
          if (!azureTargets.has(target.id)) {
            azureTargets.set(target.id, {
              target,
              options: resolveAzureDriverOptions(context.config, target)
            });
          }
          break;
        default:
          break;
      }
    }
  }

  if (hasS3) {
    await configureS3Support(connection, context.config);
  }
  if (gcsTargets.size > 0) {
    await configureGcsSupport(connection, Array.from(gcsTargets.values()));
  }
  if (azureTargets.size > 0) {
    await configureAzureSupport(connection, Array.from(azureTargets.values()));
  }
}

export function invalidateSqlRuntimeCache(): void {
  cacheGeneration += 1;
  contextCacheEntry = null;
  contextBuildPromise = null;
  recordRuntimeCacheEvent('context', 'invalidated');
  flushConnectionCache('invalidated');
}

export function resetSqlRuntimeCache(): void {
  cacheGeneration += 1;
  contextCacheEntry = null;
  contextBuildPromise = null;
  contextVersionCounter = 0;
  flushConnectionCache('invalidated');
  connectionBuildPromises.clear();
}

async function loadAllDatasets(): Promise<DatasetRecord[]> {
  const result: DatasetRecord[] = [];
  let cursor: { updatedAt: string; id: string } | null = null;

  do {
    const { datasets, nextCursor } = await listDatasets({
      limit: 100,
      cursor,
      status: 'all'
    });
    result.push(...datasets);
    cursor = nextCursor;
  } while (cursor);

  return result;
}

async function loadSchemaColumns(
  dataset: DatasetRecord,
  manifest: DatasetManifestWithPartitions | null,
  warnings: string[]
): Promise<SqlSchemaColumnInfo[]> {
  if (!manifest || !manifest.schemaVersionId) {
    warnings.push(`Dataset ${dataset.slug} has no published schema; autocomplete disabled.`);
    return [];
  }

  const schemaVersion = await getSchemaVersionById(manifest.schemaVersionId);
  if (!schemaVersion || typeof schemaVersion.schema !== 'object') {
    warnings.push(`Schema version ${manifest.schemaVersionId} for dataset ${dataset.slug} is unavailable.`);
    return [];
  }

  const payload = schemaVersion.schema as { fields?: Array<Record<string, unknown>> };
  if (!Array.isArray(payload.fields)) {
    warnings.push(`Schema for dataset ${dataset.slug} is malformed; fields missing.`);
    return [];
  }

  const columns: SqlSchemaColumnInfo[] = [];
  for (const field of payload.fields) {
    const name = typeof field?.name === 'string' ? field.name : null;
    const type = typeof field?.type === 'string' ? normalizeFieldType(field.type) : 'VARCHAR';
    if (!name) {
      continue;
    }
    columns.push({
      name,
      type,
      nullable: typeof field?.nullable === 'boolean' ? field.nullable : undefined,
      description: typeof field?.description === 'string' ? field.description : null
    });
  }
  return columns;
}

async function mapPartitions(
  partitions: DatasetPartitionRecord[],
  config: ServiceConfig,
  cache: Map<string, StorageTargetRecord | null>,
  warnings: string[]
): Promise<SqlDatasetPartitionContext[]> {
  const results: SqlDatasetPartitionContext[] = [];

  for (const partition of partitions) {
    if (partition.fileFormat !== 'duckdb') {
      warnings.push(`Skipping non-DuckDB partition ${partition.id}.`);
      continue;
    }
    const storageTarget = await loadStorageTarget(partition.storageTargetId, cache, warnings);
    if (!storageTarget) {
      continue;
    }
    const tableName = extractTableName(partition.metadata);
    let location: string;
    try {
      location = resolvePartitionLocation(partition, storageTarget, config);
    } catch (error) {
      warnings.push(
        `Failed to resolve location for partition ${partition.id}: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }

    results.push({
      id: partition.id,
      storageTarget,
      location,
      tableName,
      partitionKey: partition.partitionKey,
      rowCount: partition.rowCount ?? null,
      startTime: partition.startTime,
      endTime: partition.endTime,
      fileSizeBytes: partition.fileSizeBytes ?? null
    });
  }

  return results;
}

function derivePartitionKeys(partitions: SqlDatasetPartitionContext[]): string[] {
  const keys = new Set<string>();
  for (const partition of partitions) {
    for (const key of Object.keys(partition.partitionKey ?? {})) {
      keys.add(key);
    }
  }
  return Array.from(keys).sort();
}

async function loadStorageTarget(
  id: string,
  cache: Map<string, StorageTargetRecord | null>,
  warnings: string[]
): Promise<StorageTargetRecord | null> {
  if (cache.has(id)) {
    return cache.get(id) ?? null;
  }
  const record = await getStorageTargetById(id);
  if (!record) {
    warnings.push(`Storage target ${id} not found; skipping affected partitions.`);
    cache.set(id, null);
    return null;
  }
  cache.set(id, record);
  return record;
}

async function attachDataset(connection: DuckDbConnection, dataset: SqlDatasetContext): Promise<string[]> {
  const warnings: string[] = [];
  if (dataset.partitions.length === 0) {
    await createEmptyView(connection, dataset);
    return warnings;
  }

  const selects: string[] = [];
  let index = 0;
  for (const partition of dataset.partitions) {
    const alias = buildPartitionAlias(dataset.dataset.slug, index);
    try {
      await run(
        connection,
        `ATTACH '${escapeSqlLiteral(partition.location)}' AS ${alias}`
      );
      selects.push(`SELECT * FROM ${alias}.${quoteIdentifier(partition.tableName)}`);
    } catch (error) {
      warnings.push(
        `Failed to attach partition ${partition.id} for dataset ${dataset.dataset.slug}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    index += 1;
  }

  if (selects.length === 0) {
    await createEmptyView(connection, dataset);
    return warnings;
  }

  const unionSql = selects.join('\nUNION ALL\n');
  await run(connection, `CREATE OR REPLACE VIEW ${quoteQualifiedName(dataset.viewName)} AS ${unionSql}`);
  return warnings;
}

async function createEmptyView(connection: DuckDbConnection, dataset: SqlDatasetContext): Promise<void> {
  if (dataset.columns.length === 0) {
    await run(connection, `CREATE OR REPLACE VIEW ${quoteQualifiedName(dataset.viewName)} AS SELECT 1 WHERE 1=0`);
    return;
  }

  const projections = dataset.columns
    .map((column) => `CAST(NULL AS ${column.type}) AS ${quoteIdentifier(column.name)}`)
    .join(', ');
  const query = `SELECT ${projections} WHERE 1=0`;
  await run(connection, `CREATE OR REPLACE VIEW ${quoteQualifiedName(dataset.viewName)} AS ${query}`);
}

async function createRuntimeTables(connection: DuckDbConnection): Promise<void> {
  await run(
    connection,
    `CREATE TABLE timestore_runtime.datasets (
       dataset_id VARCHAR,
       dataset_slug VARCHAR,
       dataset_name VARCHAR,
       status VARCHAR,
       write_format VARCHAR,
       partition_count BIGINT,
       total_rows BIGINT,
       total_bytes BIGINT,
       updated_at TIMESTAMP,
       manifest_version BIGINT
     )`
  );

  await run(
    connection,
    `CREATE TABLE timestore_runtime.partitions (
       dataset_slug VARCHAR,
       partition_id VARCHAR,
       storage_target VARCHAR,
       storage_kind VARCHAR,
       location VARCHAR,
       table_name VARCHAR,
       row_count BIGINT,
       file_size_bytes BIGINT,
       start_time TIMESTAMP,
       end_time TIMESTAMP
     )`
  );

  await run(
    connection,
    `CREATE TABLE timestore_runtime.columns (
       dataset_slug VARCHAR,
       column_name VARCHAR,
       data_type VARCHAR,
       nullable BOOLEAN,
       description VARCHAR
     )`
  );
}

async function populateRuntimeTables(connection: DuckDbConnection, datasets: SqlDatasetContext[]): Promise<void> {
  for (const dataset of datasets) {
    const manifest = dataset.manifest;
    await run(
      connection,
      `INSERT INTO timestore_runtime.datasets (
         dataset_id,
         dataset_slug,
         dataset_name,
         status,
         write_format,
         partition_count,
         total_rows,
         total_bytes,
         updated_at,
         manifest_version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      dataset.dataset.id,
      dataset.dataset.slug,
      dataset.dataset.name,
      dataset.dataset.status,
      dataset.dataset.writeFormat,
      manifest?.partitionCount ?? 0,
      manifest?.totalRows ?? 0,
      manifest?.totalBytes ?? 0,
      manifest?.updatedAt ?? dataset.dataset.updatedAt,
      manifest?.version ?? null
    );

    for (const column of dataset.columns) {
      await run(
        connection,
        `INSERT INTO timestore_runtime.columns (
           dataset_slug,
           column_name,
           data_type,
           nullable,
           description
         ) VALUES (?, ?, ?, ?, ?)` ,
        dataset.dataset.slug,
        column.name,
        column.type,
        column.nullable ?? null,
        column.description ?? null
      );
    }

    for (const partition of dataset.partitions) {
      await run(
        connection,
        `INSERT INTO timestore_runtime.partitions (
           dataset_slug,
           partition_id,
           storage_target,
           storage_kind,
           location,
           table_name,
           row_count,
           file_size_bytes,
           start_time,
           end_time
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        dataset.dataset.slug,
        partition.id,
        partition.storageTarget.name,
        partition.storageTarget.kind,
        partition.location,
        partition.tableName,
        partition.rowCount ?? null,
        partition.fileSizeBytes ?? null,
        partition.startTime,
        partition.endTime
      );
    }
  }
}

function createViewName(datasetSlug: string): { viewName: string; aliasWarning: string | null } {
  const sanitized = sanitizeIdentifierSegment(datasetSlug);
  const viewName = `timestore.${sanitized}`;
  const aliasWarning = sanitized !== datasetSlug
    ? `Dataset ${datasetSlug} exposed as view ${viewName} to comply with identifier rules.`
    : null;
  return { viewName, aliasWarning };
}

function buildPartitionAlias(datasetSlug: string, index: number): string {
  const safeSlug = datasetSlug.replace(/[^a-zA-Z0-9]+/g, '_');
  return `ds_${safeSlug}_${index}_${randomUUID().slice(0, 6)}`;
}

function sanitizeIdentifierSegment(segment: string): string {
  const trimmed = segment.trim();
  const replaced = trimmed.replace(/[^A-Za-z0-9_]/g, '_');
  const collapsed = replaced.replace(/_+/g, '_');
  const stripped = collapsed.replace(/^_+|_+$/g, '');
  const fallback = stripped.length > 0 ? stripped : 'dataset';
  if (/^[0-9]/.test(fallback)) {
    return `d_${fallback}`;
  }
  return fallback;
}

function extractTableName(metadata: Record<string, unknown>): string {
  if (metadata && typeof metadata === 'object') {
    const value = (metadata as Record<string, unknown>).tableName;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return 'records';
}

function normalizeFieldType(input: string): string {
  const value = input.trim().toLowerCase();
  switch (value) {
    case 'timestamp':
      return 'TIMESTAMP';
    case 'double':
    case 'float':
    case 'real':
      return 'DOUBLE';
    case 'integer':
    case 'int':
    case 'bigint':
      return 'BIGINT';
    case 'boolean':
    case 'bool':
      return 'BOOLEAN';
    case 'string':
    case 'varchar':
    case 'text':
    default:
      return 'VARCHAR';
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteQualifiedName(name: string): string {
  const segments = name.split('.');
  return segments.map(quoteIdentifier).join('.');
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function run(connection: DuckDbConnection, sql: string, ...params: unknown[]): Promise<void> {
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

export function all(connection: DuckDbConnection, sql: string, ...params: unknown[]): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    connection.all(sql, ...params, (err: Error | null, rows?: Array<Record<string, unknown>>) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows ?? []);
      }
    });
  });
}

async function closeConnection(connection: DuckDbConnection): Promise<void> {
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

function ignoreCloseError(fn: () => void): void {
  try {
    fn();
  } catch {
    // ignore errors during best-effort close
  }
}

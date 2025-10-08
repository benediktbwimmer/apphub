import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadDuckDb, isCloseable } from '@apphub/shared';
import { clearStagingSchemaCache, markStagingSchemaCacheStale } from '../cache/stagingSchemaCache';
import { setStagingSummaryMetrics } from '../observability/metrics';
import { TIMESTORE_DEBUG_ENABLED } from './index';
import type { FieldDefinition, FieldType } from './index';

export interface DuckDbSpoolManagerOptions {
  directory: string;
  maxDatasetBytes: number;
  maxTotalBytes: number;
}

export interface AppendRowsRequest {
  datasetSlug: string;
  tableName: string;
  schema: FieldDefinition[];
  rows?: Record<string, unknown>[];
}

export interface DatasetSpoolStats {
  datasetSlug: string;
  totalRows: number;
  tables: Array<{
    tableName: string;
    rowCount: number;
  }>;
  databaseSizeBytes: number;
  walSizeBytes: number;
}

export interface StagePartitionRequest {
  datasetSlug: string;
  tableName: string;
  schema: FieldDefinition[];
  rows?: Record<string, unknown>[];
  partitionKey: Record<string, string>;
  partitionAttributes?: Record<string, string> | null;
  timeRange: {
    start: string;
    end: string;
  };
  ingestionSignature: string;
  receivedAt: string;
  idempotencyKey?: string | null;
  schemaDefaults?: Record<string, unknown> | null;
  backfillRequested?: boolean;
}

export interface StagePartitionResult {
  datasetSlug: string;
  tableName: string;
  ingestionSignature: string;
  batchId: string;
  rowCount: number;
  alreadyStaged: boolean;
}

export interface DatasetStagingSummary {
  datasetSlug: string;
  pendingBatchCount: number;
  pendingRowCount: number;
  oldestStagedAt?: string | null;
  databaseSizeBytes: number;
  walSizeBytes: number;
  onDiskBytes: number;
}

export interface PreparedFlushBatch {
  batchId: string;
  ingestionSignature: string;
  tableName: string;
  schema: FieldDefinition[];
  partitionKey: Record<string, string>;
  partitionAttributes: Record<string, string> | null;
  timeRange: {
    start: string;
    end: string;
  };
  rowCount: number;
  receivedAt: string;
  stagedAt: string;
  idempotencyKey: string | null;
  schemaDefaults: Record<string, unknown> | null;
  backfillRequested: boolean;
  rows: Record<string, unknown>[];
  parquetFilePath: string;
}

export interface PreparedFlushResult {
  datasetSlug: string;
  flushToken: string;
  batches: PreparedFlushBatch[];
  preparedAt: string;
}

export interface PendingStagingBatch {
  batchId: string;
  tableName: string;
  rowCount: number;
  timeRange: {
    start: string;
    end: string;
  };
  stagedAt: string;
  schema: FieldDefinition[];
}

interface DatasetSpoolContext {
  datasetSlug: string;
  safeSlug: string;
  directory: string;
  databasePath: string;
  catalogName: string;
  db: any;
  connection: any;
  initialized: boolean;
  metadataReady: boolean;
  corruptionRecoveryAttempts: number;
}

const SPOOL_SCHEMA = 'staging';
const METADATA_TABLE = '__ingestion_batches';
const INTERNAL_BATCH_ID_COLUMN = '__batch_id';
const INTERNAL_STAGED_AT_COLUMN = '__staged_at';
const SKIP_FLUSH_RESET = (process.env.TIMESTORE_SKIP_FLUSH_RESET ?? '').toLowerCase();
const SKIP_FLUSH_RESET_ENABLED = ['1', 'true', 'yes', 'on'].includes(SKIP_FLUSH_RESET);
const CORRUPTION_ERROR_PATTERNS = [
  'Serialization Error: Failed to deserialize',
  'field id mismatch',
  'failure while replaying wal',
  'corrupt wal file',
  'connection was never established or has been closed'
];

export class DuckDbSpoolManager {
  private readonly rootReady: Promise<void>;
  private readonly datasetContexts = new Map<string, DatasetSpoolContext>();
  private readonly datasetLocks = new Map<string, Promise<void>>();

  constructor(private readonly options: DuckDbSpoolManagerOptions) {
    this.rootReady = fs.mkdir(options.directory, { recursive: true }).then(() => undefined);
  }

  async ensureDatasetSchema(datasetSlug: string): Promise<void> {
    await this.runWithDatasetLock(datasetSlug, 'write', async (context) => {
      if (!context.initialized) {
        await run(
          context.connection,
          `CREATE SCHEMA IF NOT EXISTS ${qualifySchemaName(context.catalogName, SPOOL_SCHEMA)}`
        );
        await this.ensureMetadataTable(context);
        context.initialized = true;
      }
    });
  }

  async appendRows(request: AppendRowsRequest): Promise<number> {
    const rows = request.rows ?? [];
    if (rows.length === 0) {
      await this.ensureDatasetSchema(request.datasetSlug);
      return 0;
    }

    return this.runWithDatasetLock(request.datasetSlug, 'write', async (context) => {
      if (!context.initialized) {
        await run(
          context.connection,
          `CREATE SCHEMA IF NOT EXISTS ${qualifySchemaName(context.catalogName, SPOOL_SCHEMA)}`
        );
        await this.ensureMetadataTable(context);
        context.initialized = true;
      }

      const normalizedTableName = sanitizeTableName(request.tableName);
      await this.ensureTable(context, normalizedTableName, request.schema);

      await run(context.connection, 'BEGIN TRANSACTION');
      try {
        await this.insertRows(context, normalizedTableName, request.schema, rows);
        await run(context.connection, 'COMMIT');
      } catch (error) {
        await run(context.connection, 'ROLLBACK').catch(() => undefined);
        throw error;
      }

      await this.evaluateSizeThresholds(request.datasetSlug).catch(() => undefined);
      markStagingSchemaCacheStale(request.datasetSlug);

      return rows.length;
    });
  }

  async getDatasetStats(datasetSlug: string): Promise<DatasetSpoolStats> {
    return this.runWithDatasetLock(datasetSlug, 'write', async (context) => {
      if (!context.initialized) {
        await run(
          context.connection,
          `CREATE SCHEMA IF NOT EXISTS ${qualifySchemaName(context.catalogName, SPOOL_SCHEMA)}`
        );
        await this.ensureMetadataTable(context);
        context.initialized = true;
      }

      const tableNames = await this.listTables(context);
      const tables: DatasetSpoolStats['tables'] = [];
      for (const tableName of tableNames) {
        const qualified = qualifyTableName(context.catalogName, SPOOL_SCHEMA, tableName);
        const row = await firstRow(
          context.connection,
          `SELECT COUNT(*)::BIGINT AS count FROM ${qualified}`
        );
        const rowCount = Number(row?.count ?? 0);
        tables.push({ tableName, rowCount });
      }

      const databaseSize = await this.readDatabaseSize(context.connection);
      const totalRows = tables.reduce((sum, entry) => sum + entry.rowCount, 0);

      return {
        datasetSlug,
        totalRows,
        tables,
        databaseSizeBytes: databaseSize.databaseSizeBytes,
        walSizeBytes: databaseSize.walSizeBytes
      } satisfies DatasetSpoolStats;
    });
  }

  async stagePartition(request: StagePartitionRequest): Promise<StagePartitionResult> {
    return this.runWithDatasetLock(request.datasetSlug, 'write', async (context) => {
      if (!context.initialized) {
        await run(
          context.connection,
          `CREATE SCHEMA IF NOT EXISTS ${qualifySchemaName(context.catalogName, SPOOL_SCHEMA)}`
        );
        await this.ensureMetadataTable(context);
        context.initialized = true;
      }

      await run(context.connection, 'BEGIN TRANSACTION');
      try {
        const metadataTable = qualifyTableName(context.catalogName, SPOOL_SCHEMA, METADATA_TABLE);
        const existing = await firstRow(
          context.connection,
          `SELECT batch_id, row_count FROM ${metadataTable} WHERE ingestion_signature = ?`,
          request.ingestionSignature
        );
        if (existing) {
          await run(context.connection, 'ROLLBACK').catch(() => undefined);
          return {
            datasetSlug: request.datasetSlug,
            tableName: request.tableName,
            ingestionSignature: request.ingestionSignature,
            batchId: String(existing.batch_id ?? ''),
            rowCount: Number(existing.row_count ?? 0),
            alreadyStaged: true
          } satisfies StagePartitionResult;
        }

        const batchId = randomUUID();
        const stagedAt = new Date(request.receivedAt);
        const augmentedSchema = augmentSchema(request.schema);
        await this.ensureTable(context, request.tableName, augmentedSchema);

        if (request.rows && request.rows.length > 0) {
          const rowsWithMetadata = request.rows.map((row) => ({
            ...row,
            [INTERNAL_BATCH_ID_COLUMN]: batchId,
            [INTERNAL_STAGED_AT_COLUMN]: stagedAt
          }));
          await this.insertRows(context, request.tableName, augmentedSchema, rowsWithMetadata);
        }

        const metadataSql = `INSERT INTO ${metadataTable} (
            ingestion_signature,
            batch_id,
            table_name,
            schema_json,
            partition_key_json,
            partition_attributes_json,
            time_range_start,
            time_range_end,
            row_count,
            received_at,
            staged_at,
            idempotency_key,
            schema_defaults_json,
            schema_backfill_requested
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        await run(
          context.connection,
          metadataSql,
          request.ingestionSignature,
          batchId,
          request.tableName,
          JSON.stringify(request.schema),
          JSON.stringify(request.partitionKey),
          request.partitionAttributes ? JSON.stringify(request.partitionAttributes) : null,
          new Date(request.timeRange.start),
          new Date(request.timeRange.end),
          request.rows ? request.rows.length : 0,
          stagedAt,
          stagedAt,
          request.idempotencyKey ?? null,
          request.schemaDefaults ? JSON.stringify(request.schemaDefaults) : null,
          request.backfillRequested === true
        );

        await run(context.connection, 'COMMIT');

        await this.evaluateSizeThresholds(request.datasetSlug).catch(() => undefined);
        await this.refreshDatasetSummary(context);
        markStagingSchemaCacheStale(request.datasetSlug);

        return {
          datasetSlug: request.datasetSlug,
          tableName: request.tableName,
          ingestionSignature: request.ingestionSignature,
          batchId,
          rowCount: request.rows ? request.rows.length : 0,
          alreadyStaged: false
        } satisfies StagePartitionResult;
      } catch (error) {
        await run(context.connection, 'ROLLBACK').catch(() => undefined);
        throw error;
      }
    });
  }

  async dropDatasetSchema(datasetSlug: string): Promise<void> {
    await this.runWithDatasetLock(datasetSlug, 'write', async () => {
      this.datasetContexts.delete(datasetSlug);

      const safeSlug = sanitizeDatasetSlug(datasetSlug);
      const datasetDir = path.join(this.options.directory, safeSlug);
      await fs.rm(datasetDir, { recursive: true, force: true });
      setStagingSummaryMetrics({
        datasetSlug,
        pendingBatchCount: 0,
        pendingRowCount: 0,
        oldestStagedAt: null,
        databaseSizeBytes: 0,
        walSizeBytes: 0,
        onDiskBytes: 0
      });
      clearStagingSchemaCache(datasetSlug);
    });
  }

  async markDatasetCorrupted(datasetSlug: string, reason: unknown): Promise<void> {
    await this.runWithDatasetLock(datasetSlug, 'write', async (context) => {
      await this.recoverCorruptedDataset(context, reason);
      markStagingSchemaCacheStale(datasetSlug);
    });
  }

  async close(): Promise<void> {
    this.datasetContexts.clear();
  }

  async acquireDatasetReadLock(datasetSlug: string): Promise<() => void> {
    const releaseDatasetLock = await this.acquireDatasetLock(datasetSlug);
    let lockHandle: fs.FileHandle | null = null;
    let lockPath: string | null = null;
    try {
      const context = await this.getDatasetContext(datasetSlug);
      const lock = await this.acquireFilesystemLock(context);
      lockHandle = lock.handle;
      lockPath = lock.lockPath;
    } catch (error) {
      releaseDatasetLock();
      throw error;
    }

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      void this.releaseFilesystemLock(lockHandle, lockPath);
      releaseDatasetLock();
    };
  }

  async withReadConnection<T>(
    datasetSlug: string,
    fn: (connection: any, catalogName: string) => Promise<T>
  ): Promise<T> {
    return this.runWithDatasetLock(datasetSlug, 'write', async (context) => {
      await this.ensureMetadataTable(context);
      return fn(context.connection, context.catalogName);
    });
  }

  private async getDatasetContext(datasetSlug: string): Promise<DatasetSpoolContext> {
    const existing = this.datasetContexts.get(datasetSlug);
    if (existing) {
      this.logFlushDebug('dataset context cache hit', {
        datasetSlug,
        databasePath: existing.databasePath
      });
      return existing;
    }

    await this.rootReady;
    const safeSlug = sanitizeDatasetSlug(datasetSlug);
    const datasetDir = path.join(this.options.directory, safeSlug);
    await fs.mkdir(datasetDir, { recursive: true });
    const databasePath = path.join(datasetDir, 'staging.duckdb');
    const parsedPath = path.parse(databasePath);
    const catalogName = parsedPath.name;

    this.logFlushDebug('initializing dataset context', {
      datasetSlug,
      databasePath,
      datasetDir
    });

    const context: DatasetSpoolContext = {
      datasetSlug,
      safeSlug,
      directory: datasetDir,
      databasePath,
      catalogName,
      db: null,
      connection: null,
      initialized: false,
      metadataReady: false,
      corruptionRecoveryAttempts: 0
    };

    this.datasetContexts.set(datasetSlug, context);
    return context;
  }

  private async ensureTable(
    context: DatasetSpoolContext,
    tableName: string,
    schema: FieldDefinition[]
  ): Promise<void> {
    if (schema.length === 0) {
      throw new Error('Cannot create staging table without at least one column');
    }

    const qualified = qualifyTableName(context.catalogName, SPOOL_SCHEMA, tableName);
    const escapedTableForPragma = qualified.replace(/'/g, "''");
    let metadata: any[] = [];
    try {
      metadata = await all(
        context.connection,
        `PRAGMA table_info('${escapedTableForPragma}')`
      );
    } catch (error) {
      if (!isMissingTableError(error)) {
        throw error;
      }
      metadata = [];
    }

    if (metadata.length === 0) {
      const columnsSql = schema
        .map((field) => `${quoteIdentifier(field.name)} ${mapDuckDbType(field.type)}`)
        .join(', ');
      await run(context.connection, `CREATE TABLE ${qualified} (${columnsSql})`);
      return;
    }

    const existingColumns = new Map<string, string>();
    for (const column of metadata as Array<{ name: string; type: string }>) {
      existingColumns.set(column.name, column.type?.toUpperCase() ?? '');
    }

    for (const field of schema) {
      const expectedType = mapDuckDbType(field.type);
      const existingType = existingColumns.get(field.name);
      if (!existingType) {
        await run(
          context.connection,
          `ALTER TABLE ${qualified} ADD COLUMN ${quoteIdentifier(field.name)} ${expectedType}`
        );
        continue;
      }

      if (existingType !== expectedType) {
        throw new Error(
          `Field '${field.name}' type mismatch in staging table '${tableName}'. Expected ${expectedType} but found ${existingType}.`
        );
      }
    }
  }

  private async insertRows(
    context: DatasetSpoolContext,
    tableName: string,
    schema: FieldDefinition[],
    rows: Record<string, unknown>[]
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const qualified = qualifyTableName(context.catalogName, SPOOL_SCHEMA, tableName);
    const columnNames = schema.map((field) => field.name);
    const placeholders = columnNames.map(() => '?').join(', ');
    const insertSql = `INSERT INTO ${qualified} (${columnNames.map(quoteIdentifier).join(', ')}) VALUES (${placeholders})`;

    for (const row of rows) {
      const values = columnNames.map((column, index) =>
        coerceValue(row[column], schema[index]?.type ?? 'string')
      );
      await run(context.connection, insertSql, ...values);
    }
  }

  private async ensureMetadataTable(
    context: DatasetSpoolContext,
    retriesRemaining = 2
  ): Promise<void> {
    if (context.metadataReady) {
      return;
    }

    this.logFlushDebug('ensuring metadata table', {
      datasetSlug: context.datasetSlug,
      databasePath: context.databasePath
    });

    await run(
      context.connection,
      `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(context.catalogName)}.${quoteIdentifier(SPOOL_SCHEMA)}`
    );

    try {
      await run(
        context.connection,
        `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(context.catalogName)}.${quoteIdentifier(SPOOL_SCHEMA)}`
      );

      const metadataTable = qualifyTableName(context.catalogName, SPOOL_SCHEMA, METADATA_TABLE);
      await run(
        context.connection,
        `CREATE TABLE IF NOT EXISTS ${metadataTable} (
          ingestion_signature VARCHAR PRIMARY KEY,
          batch_id VARCHAR NOT NULL,
          table_name VARCHAR NOT NULL,
          schema_json VARCHAR NOT NULL,
          partition_key_json VARCHAR NOT NULL,
          partition_attributes_json VARCHAR,
          time_range_start TIMESTAMP NOT NULL,
          time_range_end TIMESTAMP NOT NULL,
          row_count BIGINT NOT NULL,
          received_at TIMESTAMP NOT NULL,
          staged_at TIMESTAMP NOT NULL,
          idempotency_key VARCHAR,
          schema_defaults_json VARCHAR,
          schema_backfill_requested BOOLEAN,
          flush_token VARCHAR,
          flush_started_at TIMESTAMP
        )`
      );

      this.logFlushDebug('metadata table ensured', {
        datasetSlug: context.datasetSlug,
        databasePath: context.databasePath
      });

      await this.ensureMetadataColumns(context);
      this.logFlushDebug('metadata columns ensured', {
        datasetSlug: context.datasetSlug,
        databasePath: context.databasePath
      });

      if (SKIP_FLUSH_RESET_ENABLED) {
        this.logFlushDebug('skipping incomplete flush reset (flag enabled)', {
          datasetSlug: context.datasetSlug,
          databasePath: context.databasePath
        });
      } else {
        await this.resetIncompleteFlushes(context);
        this.logFlushDebug('incomplete flushes reset', {
          datasetSlug: context.datasetSlug,
          databasePath: context.databasePath
        });
      }
      context.metadataReady = true;

      this.logFlushDebug('metadata table ready', {
        datasetSlug: context.datasetSlug,
        databasePath: context.databasePath
      });
    } catch (error) {
      this.logFlushDebug('ensureMetadataTable encountered error', {
        datasetSlug: context.datasetSlug,
        databasePath: context.databasePath,
        error: extractDuckDbMessage(error)
      });
      if (isDuckDbCorruptionError(error) && retriesRemaining > 0) {
        await this.recoverCorruptedDataset(context, error);
        await this.ensureMetadataTable(context, retriesRemaining - 1);
        return;
      }
      throw error;
    }
  }

  private async ensureMetadataColumns(context: DatasetSpoolContext): Promise<void> {
    const metadataTable = qualifyTableName(context.catalogName, SPOOL_SCHEMA, METADATA_TABLE);
    const escaped = metadataTable.replace(/"/g, '""');
    this.logFlushDebug('fetching metadata column info', {
      datasetSlug: context.datasetSlug,
      databasePath: context.databasePath
    });
    const existingColumns = await all(
      context.connection,
      `PRAGMA table_info('${escaped}')`
    );
    this.logFlushDebug('metadata column info fetched', {
      datasetSlug: context.datasetSlug,
      databasePath: context.databasePath,
      columnCount: existingColumns.length
    });
    const columnNames = new Set(existingColumns.map((column) => String(column.name ?? '')));

    if (!columnNames.has('flush_token')) {
      await run(context.connection, `ALTER TABLE ${metadataTable} ADD COLUMN flush_token VARCHAR`);
    }
    if (!columnNames.has('flush_started_at')) {
      await run(
        context.connection,
        `ALTER TABLE ${metadataTable} ADD COLUMN flush_started_at TIMESTAMP`
      );
    }
    if (!columnNames.has('idempotency_key')) {
      await run(context.connection, `ALTER TABLE ${metadataTable} ADD COLUMN idempotency_key VARCHAR`);
    }
    if (!columnNames.has('schema_defaults_json')) {
      await run(
        context.connection,
        `ALTER TABLE ${metadataTable} ADD COLUMN schema_defaults_json VARCHAR`
      );
    }
    if (!columnNames.has('schema_backfill_requested')) {
      await run(
        context.connection,
        `ALTER TABLE ${metadataTable} ADD COLUMN schema_backfill_requested BOOLEAN`
      );
    }
  }

  private async resetIncompleteFlushes(context: DatasetSpoolContext): Promise<void> {
    const metadataTable = qualifyTableName(context.catalogName, SPOOL_SCHEMA, METADATA_TABLE);
    this.logFlushDebug('resetting incomplete flushes', {
      datasetSlug: context.datasetSlug,
      databasePath: context.databasePath
    });
    const pendingResetRow = await firstRow(
      context.connection,
      `SELECT COUNT(*)::BIGINT AS pending FROM ${metadataTable} WHERE flush_token IS NOT NULL`
    );
    const pendingReset = Number(pendingResetRow?.pending ?? 0n);
    if (pendingReset === 0) {
      this.logFlushDebug('no incomplete flush rows found', {
        datasetSlug: context.datasetSlug,
        databasePath: context.databasePath
      });
      return;
    }

    await run(
      context.connection,
      `UPDATE ${metadataTable} SET flush_token = NULL, flush_started_at = NULL WHERE flush_token IS NOT NULL`
    );
    this.logFlushDebug('incomplete flush rows cleared', {
      datasetSlug: context.datasetSlug,
      databasePath: context.databasePath,
      rowsCleared: pendingReset
    });
  }

  private async recoverCorruptedDataset(context: DatasetSpoolContext, reason: unknown): Promise<void> {
    this.logFlushDebug('detected potential duckdb corruption', {
      datasetSlug: context.datasetSlug,
      databasePath: context.databasePath,
      reason: reason instanceof Error ? reason.message : String(reason),
      attempts: context.corruptionRecoveryAttempts
    });

    if (context.corruptionRecoveryAttempts >= 3) {
      this.logFlushDebug('corruption recovery attempts exhausted', {
        datasetSlug: context.datasetSlug,
        databasePath: context.databasePath
      });
      throw reason instanceof Error ? reason : new Error(String(reason));
    }

    context.corruptionRecoveryAttempts += 1;

    await closeConnection(context.connection).catch(() => undefined);
    if (isCloseable(context.db)) {
      try {
        context.db.close();
      } catch (error) {
        this.logFlushDebug('error closing corrupted duckdb database', {
          datasetSlug: context.datasetSlug,
          error: error instanceof Error ? error.message : error
        });
      }
    }
    context.connection = null;
    context.db = null;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${context.databasePath}.corrupt-${timestamp}`;

    await fs.mkdir(context.directory, { recursive: true });

    await fs.rename(context.databasePath, backupPath).catch((error: NodeJS.ErrnoException) => {
      if (error && error.code !== 'ENOENT') {
        throw error;
      }
    });
    await fs.rm(`${context.databasePath}.wal`, { force: true }).catch(() => undefined);

    const duckdb = loadDuckDb();
    const db = new duckdb.Database(context.databasePath);
    const connection = db.connect();

    context.db = db;
    context.connection = connection;
    context.initialized = false;
    context.metadataReady = false;
    context.corruptionRecoveryAttempts = 0;

    this.logFlushDebug('reinitialized staging database after corruption', {
      datasetSlug: context.datasetSlug,
      databasePath: context.databasePath,
      backupPath
    });
  }

  private async listTables(context: DatasetSpoolContext): Promise<string[]> {
    const rows = await all(
      context.connection,
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_catalog = ?
          AND table_schema = ?
          AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
      context.catalogName,
      SPOOL_SCHEMA
    );
    return rows
      .map((row) => String(row.table_name))
      .filter((name) => name !== METADATA_TABLE);
  }

  private async readDatabaseSize(connection: any): Promise<{
    databaseSizeBytes: number;
    walSizeBytes: number;
  }> {
    const row = await firstRow(connection, 'SELECT * FROM pragma_database_size()');
    const databaseSizeBytes = parseSizeString(typeof row?.database_size === 'string' ? row.database_size : null);
    const walSizeBytes = parseSizeString(typeof row?.wal_size === 'string' ? row.wal_size : null);
    return { databaseSizeBytes, walSizeBytes };
  }

  private async evaluateSizeThresholds(datasetSlug: string): Promise<void> {
    const datasetSize = await this.computeDatasetBytes(datasetSlug);
    if (this.options.maxDatasetBytes > 0 && datasetSize > this.options.maxDatasetBytes) {
      console.warn(
        `[timestore] staging dataset '${datasetSlug}' exceeded maxDatasetBytes (${datasetSize} > ${this.options.maxDatasetBytes})`
      );
    }

    if (this.options.maxTotalBytes > 0) {
      const totalSize = await this.computeTotalBytes();
      if (totalSize > this.options.maxTotalBytes) {
        console.warn(
          `[timestore] total staging footprint exceeded maxTotalBytes (${totalSize} > ${this.options.maxTotalBytes})`
        );
      }
    }
  }

  private async computeDatasetBytes(datasetSlug: string): Promise<number> {
    const safeSlug = sanitizeDatasetSlug(datasetSlug);
    const datasetDir = path.join(this.options.directory, safeSlug);
    const files = ['staging.duckdb', 'staging.duckdb.wal'];
    let total = 0;
    for (const file of files) {
      const filePath = path.join(datasetDir, file);
      try {
        const stats = await fs.stat(filePath);
        total += stats.size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }
    return total;
  }

  private async computeTotalBytes(): Promise<number> {
    const entries = await fs.readdir(this.options.directory, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const datasetSlug = entry.name;
      total += await this.computeDatasetBytes(datasetSlug);
    }
    return total;
  }

  async getDatasetSummary(datasetSlug: string): Promise<DatasetStagingSummary> {
    return this.runWithDatasetLock(datasetSlug, 'write', async (context) =>
      this.buildDatasetSummary(context)
    );
  }

  private async buildDatasetSummary(context: DatasetSpoolContext): Promise<DatasetStagingSummary> {
    await this.ensureMetadataTable(context);
    const metadataTable = qualifyTableName(context.catalogName, SPOOL_SCHEMA, METADATA_TABLE);
    const summaryRow = await firstRow(
      context.connection,
      `SELECT
          COUNT(*)::BIGINT AS batch_count,
          COALESCE(SUM(row_count), 0)::BIGINT AS row_count,
          MIN(staged_at) AS oldest_staged_at
        FROM ${metadataTable}
       WHERE flush_token IS NULL`
    );

    const pendingBatchCount = Number(summaryRow?.batch_count ?? 0n);
    const pendingRowCount = Number(summaryRow?.row_count ?? 0n);
    const oldestStagedAt = summaryRow?.oldest_staged_at
      ? new Date(summaryRow.oldest_staged_at).toISOString()
      : null;

    const { databaseSizeBytes, walSizeBytes } = await this.readDatabaseSize(context.connection);
    const onDiskBytes = await this.computeDatasetBytes(context.datasetSlug);

    const summary: DatasetStagingSummary = {
      datasetSlug: context.datasetSlug,
      pendingBatchCount,
      pendingRowCount,
      oldestStagedAt,
      databaseSizeBytes,
      walSizeBytes,
      onDiskBytes
    };

    setStagingSummaryMetrics(summary);
    return summary;
  }

  private async refreshDatasetSummary(context: DatasetSpoolContext): Promise<void> {
    try {
      await this.buildDatasetSummary(context);
    } catch (error) {
      console.warn('[timestore] failed to refresh staging summary metrics', error);
    }
  }

  async prepareFlush(datasetSlug: string): Promise<PreparedFlushResult | null> {
    return this.runWithDatasetLock(datasetSlug, 'write', async (context) => {
      await this.ensureMetadataTable(context);
      const metadataTable = qualifyTableName(context.catalogName, SPOOL_SCHEMA, METADATA_TABLE);

      this.logFlushDebug('prepareFlush invoked', {
        datasetSlug: context.datasetSlug,
        databasePath: context.databasePath
      });

      const pendingBatches = await all(
        context.connection,
        `SELECT
            ingestion_signature,
            batch_id,
            table_name,
            schema_json,
            partition_key_json,
            partition_attributes_json,
            time_range_start,
            time_range_end,
            row_count,
            received_at,
            staged_at,
            idempotency_key,
            schema_defaults_json,
            schema_backfill_requested
          FROM ${metadataTable}
         WHERE flush_token IS NULL
         ORDER BY staged_at ASC`
      );

      this.logFlushDebug('metadata query completed', {
        datasetSlug: context.datasetSlug,
        pendingBatchCount: pendingBatches.length
      });

      if (pendingBatches.length === 0) {
        return null;
      }

      const flushToken = randomUUID();
      const now = new Date();

      this.logFlushDebug('pending batches selected', {
        datasetSlug: context.datasetSlug,
        flushToken,
        batchCount: pendingBatches.length,
        batches: pendingBatches.map((batch) => ({
          batchId: String(batch.batch_id ?? ''),
          tableName: String(batch.table_name ?? ''),
          rowCount: Number(batch.row_count ?? 0),
          stagedAt: batch.staged_at ? new Date(batch.staged_at).toISOString() : null
        }))
      });

      await run(context.connection, 'BEGIN TRANSACTION');
      try {
        this.logFlushDebug('assigning flush token to batches', {
          datasetSlug: context.datasetSlug,
          flushToken,
          batchCount: pendingBatches.length
        });
        for (const batch of pendingBatches) {
          await run(
            context.connection,
            `UPDATE ${metadataTable}
                SET flush_token = ?, flush_started_at = ?
              WHERE batch_id = ? AND flush_token IS NULL`,
            flushToken,
            now,
            batch.batch_id
          );
        }
        await run(context.connection, 'COMMIT');
      } catch (error) {
        await run(context.connection, 'ROLLBACK').catch(() => undefined);
        throw error;
      }

      await this.refreshDatasetSummary(context);

      const flushDir = await this.ensureFlushDirectory(context, flushToken);
      const batches: PreparedFlushBatch[] = [];

      try {
        for (const batch of pendingBatches) {
          const schema = parseJson<FieldDefinition[]>(batch.schema_json, []);
          const partitionKey = parseJson<Record<string, string>>(batch.partition_key_json, {});
          const partitionAttributes = batch.partition_attributes_json
            ? parseJson<Record<string, string> | null>(batch.partition_attributes_json, null)
            : null;
          const schemaDefaults = batch.schema_defaults_json
            ? parseJson<Record<string, unknown> | null>(batch.schema_defaults_json, null)
            : null;
          const backfillRequested = Boolean(batch.schema_backfill_requested);

          const tableName = String(batch.table_name ?? '');
          const parquetFilePath = path.join(
            flushDir,
            `${sanitizeTableName(tableName)}-${String(batch.batch_id ?? '')}.parquet`
          );
          await fs.rm(parquetFilePath, { force: true });
          this.logFlushDebug('exporting staging batch to parquet', {
            datasetSlug: context.datasetSlug,
            flushToken,
            batchId: String(batch.batch_id ?? ''),
            tableName,
            schemaColumns: schema.map((field) => `${field.name}:${field.type}`),
            destinationPath: parquetFilePath
          });
          await this.exportBatchToParquet(context, tableName, schema, String(batch.batch_id ?? ''), parquetFilePath);

          if (TIMESTORE_DEBUG_ENABLED) {
            try {
              const stats = await fs.stat(parquetFilePath);
              this.logFlushDebug('parquet export complete', {
                datasetSlug: context.datasetSlug,
                flushToken,
                batchId: String(batch.batch_id ?? ''),
                tableName,
                fileSizeBytes: stats.size,
                destinationPath: parquetFilePath
              });
            } catch (error) {
              this.logFlushDebug('parquet export missing or unreadable', {
                datasetSlug: context.datasetSlug,
                flushToken,
                batchId: String(batch.batch_id ?? ''),
                tableName,
                destinationPath: parquetFilePath,
                error: error instanceof Error ? error.message : error
              });
            }
          }
          const rows = await this.readBatchRows(context, tableName, schema, String(batch.batch_id ?? ''));

          batches.push({
            batchId: String(batch.batch_id ?? ''),
            ingestionSignature: String(batch.ingestion_signature ?? ''),
            tableName,
            schema,
            partitionKey,
            partitionAttributes,
            timeRange: {
              start: new Date(batch.time_range_start).toISOString(),
              end: new Date(batch.time_range_end).toISOString()
            },
            rowCount: Number(batch.row_count ?? 0),
            receivedAt: new Date(batch.received_at).toISOString(),
            stagedAt: new Date(batch.staged_at).toISOString(),
            idempotencyKey: batch.idempotency_key ? String(batch.idempotency_key) : null,
            schemaDefaults,
            backfillRequested,
            rows,
            parquetFilePath
          });
        }
      } catch (error) {
        await this.abortFlushInternal(context, flushToken).catch(() => undefined);
        throw error;
      }

      return {
        datasetSlug,
        flushToken,
        batches,
        preparedAt: now.toISOString()
      } satisfies PreparedFlushResult;
    });
  }

  async finalizeFlush(datasetSlug: string, flushToken: string): Promise<void> {
    await this.runWithDatasetLock(datasetSlug, 'write', async (context) => {
      await this.ensureMetadataTable(context);
      const metadataTable = qualifyTableName(context.catalogName, SPOOL_SCHEMA, METADATA_TABLE);

      const batches = await all(
        context.connection,
        `SELECT batch_id, table_name
           FROM ${metadataTable}
          WHERE flush_token = ?`,
        flushToken
      );

      if (batches.length > 0) {
        await run(context.connection, 'BEGIN TRANSACTION');
        try {
          for (const batch of batches) {
            const tableName = String(batch.table_name ?? '');
            const batchId = String(batch.batch_id ?? '');
            const qualifiedTable = qualifyTableName(context.catalogName, SPOOL_SCHEMA, tableName);
            await run(
              context.connection,
              `DELETE FROM ${qualifiedTable} WHERE ${quoteIdentifier(INTERNAL_BATCH_ID_COLUMN)} = ?`,
              batchId
            );
            await run(
              context.connection,
              `DELETE FROM ${metadataTable} WHERE batch_id = ?`,
              batchId
            );
          }
          await run(context.connection, 'COMMIT');
        } catch (error) {
          await run(context.connection, 'ROLLBACK').catch(() => undefined);
          throw error;
        }
      }

      await this.cleanupFlushDirectory(context, flushToken);
      await this.refreshDatasetSummary(context);
      markStagingSchemaCacheStale(datasetSlug);
    });
  }

  async abortFlush(datasetSlug: string, flushToken: string): Promise<{ batches: number; rows: number }> {
    return this.runWithDatasetLock(datasetSlug, 'write', async (context) => {
      await this.ensureMetadataTable(context);
      return this.abortFlushInternal(context, flushToken);
    });
  }

  async listPendingBatches(datasetSlug: string): Promise<PendingStagingBatch[]> {
    return this.runWithDatasetLock(datasetSlug, 'write', async (context) => {
      await this.ensureMetadataTable(context);
      const metadataTable = qualifyTableName(context.catalogName, SPOOL_SCHEMA, METADATA_TABLE);
      const rows = await all(
        context.connection,
        `SELECT
            batch_id,
            table_name,
            row_count,
            time_range_start,
            time_range_end,
            staged_at,
            schema_json
          FROM ${metadataTable}
         WHERE flush_token IS NULL
         ORDER BY staged_at ASC`
      );

      return rows.map((row) => {
        const tableName = typeof row.table_name === 'string' ? row.table_name : 'records';
        const schemaEntries = parseJson<Array<{ name?: unknown; type?: unknown }>>(row.schema_json, []);
        const schema: FieldDefinition[] = [];
        for (const entry of schemaEntries) {
          if (!entry || typeof entry.name !== 'string') {
            continue;
          }
          const rawType = typeof entry.type === 'string' ? entry.type : 'string';
          schema.push({
            name: entry.name,
            type: mapStagingTypeToFieldType(rawType)
          });
        }

        return {
          batchId: String(row.batch_id ?? ''),
          tableName,
          rowCount: Number(row.row_count ?? 0),
          timeRange: {
            start: new Date(row.time_range_start ?? row.staged_at ?? Date.now()).toISOString(),
            end: new Date(row.time_range_end ?? row.staged_at ?? Date.now()).toISOString()
          },
          stagedAt: new Date(row.staged_at ?? Date.now()).toISOString(),
          schema
        } satisfies PendingStagingBatch;
      });
    });
  }

  private async abortFlushInternal(
    context: DatasetSpoolContext,
    flushToken: string
  ): Promise<{ batches: number; rows: number }> {
    const metadataTable = qualifyTableName(context.catalogName, SPOOL_SCHEMA, METADATA_TABLE);
    const stats = await firstRow(
      context.connection,
      `SELECT
          COUNT(*)::BIGINT AS batch_count,
          COALESCE(SUM(row_count), 0)::BIGINT AS row_count
        FROM ${metadataTable}
       WHERE flush_token = ?`,
      flushToken
    );
    const batches = Number(stats?.batch_count ?? 0n);
    const rows = Number(stats?.row_count ?? 0n);
    await run(
      context.connection,
      `UPDATE ${metadataTable} SET flush_token = NULL, flush_started_at = NULL WHERE flush_token = ?`,
      flushToken
    );
    await this.cleanupFlushDirectory(context, flushToken);
    await this.refreshDatasetSummary(context);
    return { batches, rows };
  }

  private getFlushDirectory(context: DatasetSpoolContext, flushToken: string): string {
    return path.join(context.directory, 'flush', flushToken);
  }

  private async ensureFlushDirectory(
    context: DatasetSpoolContext,
    flushToken: string
  ): Promise<string> {
    const flushDir = this.getFlushDirectory(context, flushToken);
    await fs.mkdir(flushDir, { recursive: true });
    return flushDir;
  }

  private async cleanupFlushDirectory(
    context: DatasetSpoolContext,
    flushToken: string
  ): Promise<void> {
    const flushDir = this.getFlushDirectory(context, flushToken);
    await fs.rm(flushDir, { recursive: true, force: true });
  }

  private async readBatchRows(
    context: DatasetSpoolContext,
    tableName: string,
    schema: FieldDefinition[],
    batchId: string
  ): Promise<Record<string, unknown>[]> {
    if (schema.length === 0) {
      return [];
    }
    const qualifiedTable = qualifyTableName(context.catalogName, SPOOL_SCHEMA, tableName);
    const columnList = schema.map((field) => quoteIdentifier(field.name)).join(', ');
    const rows = await all(
      context.connection,
      `SELECT ${columnList}
         FROM ${qualifiedTable}
        WHERE ${quoteIdentifier(INTERNAL_BATCH_ID_COLUMN)} = ?
        ORDER BY ${quoteIdentifier(INTERNAL_STAGED_AT_COLUMN)}`,
      batchId
    );
    const mappedRows = rows.map((row) => {
      const output: Record<string, unknown> = {};
      for (const field of schema) {
        output[field.name] = (row as Record<string, unknown>)[field.name];
      }
      return output;
    });
    this.logFlushDebug('read staging batch rows', {
      datasetSlug: context.datasetSlug,
      tableName,
      batchId,
      rowCount: mappedRows.length,
      columnCount: schema.length
    });
    return mappedRows;
  }

  private logFlushDebug(message: string, details: Record<string, unknown>): void {
    if (!TIMESTORE_DEBUG_ENABLED) {
      return;
    }
    console.info('[timestore:flush]', message, details);
  }

  private async exportBatchToParquet(
    context: DatasetSpoolContext,
    tableName: string,
    schema: FieldDefinition[],
    batchId: string,
    destinationPath: string
  ): Promise<void> {
    if (schema.length === 0) {
      throw new Error(`Cannot export staging batch '${batchId}' for table '${tableName}' without schema columns`);
    }
    const qualifiedTable = qualifyTableName(context.catalogName, SPOOL_SCHEMA, tableName);
    const columnList = schema.map((field) => quoteIdentifier(field.name)).join(', ');
    const escapedPath = destinationPath.replace(/'/g, "''");
    this.logFlushDebug('issuing COPY statement for staging batch', {
      datasetSlug: context.datasetSlug,
      tableName,
      batchId,
      destinationPath,
      qualifiedTable,
      columnList
    });
    await run(
      context.connection,
      `COPY (
        SELECT ${columnList}
          FROM ${qualifiedTable}
         WHERE ${quoteIdentifier(INTERNAL_BATCH_ID_COLUMN)} = ?
      ) TO '${escapedPath}' (FORMAT PARQUET)`,
      batchId
    );
    this.logFlushDebug('COPY statement completed', {
      datasetSlug: context.datasetSlug,
      tableName,
      batchId,
      destinationPath
    });
  }

  private async acquireFilesystemLock(
    context: DatasetSpoolContext
  ): Promise<{ handle: fs.FileHandle; lockPath: string }> {
    const lockPath = path.join(context.directory, 'staging.lock');
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const handle = await fs.open(lockPath, 'wx');
        return { handle, lockPath };
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') {
          throw error;
        }
        await delay(10 * Math.max(1, attempt + 1));
      }
    }

    await fs.rm(lockPath, { force: true }).catch(() => undefined);
    const handle = await fs.open(lockPath, 'wx');
    return { handle, lockPath };
  }

  private async releaseFilesystemLock(handle: fs.FileHandle | null, lockPath: string | null): Promise<void> {
    if (!handle || !lockPath) {
      return;
    }
    await handle.close().catch(() => undefined);
    await fs.rm(lockPath, { force: true }).catch(() => undefined);
  }

  private async runWithDatasetLock<T>(
    datasetSlug: string,
    mode: 'write' | 'read',
    fn: (context: DatasetSpoolContext) => Promise<T>
  ): Promise<T> {
    const releaseDatasetLock = await this.acquireDatasetLock(datasetSlug);
    let lockHandle: fs.FileHandle | null = null;
    let lockPath: string | null = null;
    try {
      const context = await this.getDatasetContext(datasetSlug);
      const lock = await this.acquireFilesystemLock(context);
      lockHandle = lock.handle;
      lockPath = lock.lockPath;
      const duckdb = loadDuckDb();
      const options = mode === 'read' ? { access_mode: 'READ_ONLY' } : undefined;
      context.db = new duckdb.Database(context.databasePath, options);
      context.connection = context.db.connect();
      try {
        return await fn(context);
      } finally {
        const activeConnection = context.connection;
        if (activeConnection) {
          await closeConnection(activeConnection).catch(() => undefined);
        }
        const activeDb = context.db;
        if (isCloseable(activeDb)) {
          try {
            activeDb.close();
          } catch (error) {
            this.logFlushDebug('error closing duckdb database', {
              datasetSlug: context.datasetSlug,
              databasePath: context.databasePath,
              error: error instanceof Error ? error.message : error
            });
          }
        }
        context.connection = null;
        context.db = null;
      }
    } finally {
      await this.releaseFilesystemLock(lockHandle, lockPath);
      releaseDatasetLock();
    }
  }

  private async acquireDatasetLock(datasetSlug: string): Promise<() => void> {
    const existing = this.datasetLocks.get(datasetSlug) ?? Promise.resolve();
    let release!: () => void;
    const current = existing.then(
      () => new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    this.datasetLocks.set(datasetSlug, current);

    await existing;

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      release();
      if (this.datasetLocks.get(datasetSlug) === current) {
        this.datasetLocks.delete(datasetSlug);
      }
    };
  }
}

function sanitizeDatasetSlug(datasetSlug: string): string {
  const trimmed = datasetSlug.trim();
  if (trimmed.length === 0) {
    throw new Error('datasetSlug must not be empty');
  }
  const normalized = trimmed.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return normalized.length > 0 ? normalized : 'dataset';
}

function sanitizeTableName(tableName: string): string {
  const trimmed = tableName.trim();
  if (!trimmed) {
    throw new Error('tableName must not be empty');
  }
  return trimmed.replace(/[^a-zA-Z0-9_]/g, '_');
}

function quoteIdentifier(identifier: string): string {
  const safe = identifier.replace(/"/g, '""');
  return `"${safe}"`;
}

function qualifySchemaName(catalog: string, schema: string): string {
  return `${quoteIdentifier(catalog)}.${quoteIdentifier(schema)}`;
}

function qualifyTableName(catalog: string, schema: string, table: string): string {
  return `${qualifySchemaName(catalog, schema)}.${quoteIdentifier(table)}`;
}

function augmentSchema(schema: FieldDefinition[]): FieldDefinition[] {
  const names = new Set(schema.map((field) => field.name));
  const augmented: FieldDefinition[] = [...schema];
  if (!names.has(INTERNAL_BATCH_ID_COLUMN)) {
    augmented.push({ name: INTERNAL_BATCH_ID_COLUMN, type: 'string' });
  }
  if (!names.has(INTERNAL_STAGED_AT_COLUMN)) {
    augmented.push({ name: INTERNAL_STAGED_AT_COLUMN, type: 'timestamp' });
  }
  return augmented;
}

function mapStagingTypeToFieldType(input: string): FieldDefinition['type'] {
  const normalized = input.trim().toLowerCase();
  if (normalized.includes('time')) {
    return 'timestamp';
  }
  if (normalized === 'boolean' || normalized === 'bool') {
    return 'boolean';
  }
  if (
    normalized === 'double' ||
    normalized === 'float' ||
    normalized === 'real' ||
    normalized === 'numeric' ||
    normalized === 'decimal'
  ) {
    return 'double';
  }
  if (
    normalized === 'integer' ||
    normalized === 'int' ||
    normalized === 'bigint' ||
    normalized === 'smallint' ||
    normalized === 'tinyint'
  ) {
    return 'integer';
  }
  return 'string';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn('[timestore] failed to parse staging metadata json', error);
    return fallback;
  }
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

function all(connection: any, sql: string, ...params: unknown[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    connection.all(sql, ...params, (err: Error | null, rows?: any[]) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows ?? []);
      }
    });
  });
}

function firstRow(connection: any, sql: string, ...params: unknown[]): Promise<any | null> {
  return new Promise((resolve, reject) => {
    connection.all(sql, ...params, (err: Error | null, rows?: any[]) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows && rows.length > 0 ? rows[0] : null);
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

const SIZE_MULTIPLIERS: Record<string, number> = {
  byte: 1,
  bytes: 1,
  kib: 1024,
  mib: 1024 * 1024,
  gib: 1024 * 1024 * 1024,
  tib: 1024 * 1024 * 1024 * 1024,
  pib: 1024 * 1024 * 1024 * 1024 * 1024
};

function parseSizeString(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const trimmed = value.trim();
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*(bytes?|KiB|MiB|GiB|TiB|PiB)$/i.exec(trimmed);
  if (!match) {
    return 0;
  }
  const amount = Number.parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = SIZE_MULTIPLIERS[unit] ?? 1;
  return Math.round(amount * multiplier);
}

function isMissingTableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /does not exist/i.test(error.message ?? '');
}

function extractDuckDbMessage(error: unknown): string {
  if (!error) {
    return '';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'object' && error && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return String(error);
}

export function isDuckDbCorruptionError(error: unknown): boolean {
  const message = extractDuckDbMessage(error).toLowerCase();
  if (!message) {
    return false;
  }
  return CORRUPTION_ERROR_PATTERNS.some((pattern) => message.includes(pattern.toLowerCase()));
}

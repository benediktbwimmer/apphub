import { loadDuckDb, isCloseable } from '@apphub/shared';
import { access } from 'node:fs/promises';
import path from 'node:path';
import type { DatasetRecord } from '../db/metadata';
import { getStagingSchemaRegistry } from '../db/stagingSchemaRegistry';
import type { StagingSchemaField } from '../sql/stagingSchema';
import { sanitizeDatasetSlug } from '../sql/stagingSchema';
import type { ServiceConfig } from '../config/serviceConfig';
import { loadServiceConfig } from '../config/serviceConfig';
import { queryStreamingHotBuffer } from '../streaming/hotBuffer';
import type { HotBufferQueryResult } from '../streaming/hotBuffer';
import { buildQueryPlan } from './planner';
import { executeDuckDbPlan, type QueryExecutionResult } from './executor';
import type { QueryPlan } from './planner';

interface RowSourceQueryOptions {
  dataset: DatasetRecord;
  timestampColumn: string;
  rangeStart: Date;
  rangeEnd: Date;
  limit?: number;
  columns?: string[];
  config?: ServiceConfig;
}

export type RowSourceKind = 'hot_buffer' | 'staging' | 'published';

export interface RowSourceResult {
  source: RowSourceKind;
  rows: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
}

export interface RowSource {
  readonly kind: RowSourceKind;
  fetchRows(options: RowSourceQueryOptions): Promise<RowSourceResult>;
}

export class HotBufferRowSource implements RowSource {
  readonly kind = 'hot_buffer' as const;

  async fetchRows(options: RowSourceQueryOptions): Promise<RowSourceResult> {
    const queryResult = queryStreamingHotBuffer(options.dataset.slug, {
      rangeStart: options.rangeStart,
      rangeEnd: options.rangeEnd,
      limit: options.limit,
      timestampColumn: options.timestampColumn
    });
    const rows = this.projectColumns(queryResult, options);
    return {
      source: this.kind,
      rows,
      metadata: {
        bufferState: queryResult.bufferState,
        watermark: queryResult.watermark,
        latestTimestamp: queryResult.latestTimestamp
      }
    };
  }

  private projectColumns(
    result: HotBufferQueryResult,
    options: RowSourceQueryOptions
  ): Record<string, unknown>[] {
    if (!options.columns || options.columns.length === 0) {
      return result.rows;
    }
    const columns = new Set(
      options.columns.concat(options.timestampColumn)
    );
    return result.rows.map((row) => {
      const projected: Record<string, unknown> = {};
      for (const column of columns) {
        if (Object.prototype.hasOwnProperty.call(row, column)) {
          projected[column] = row[column];
        }
      }
      return projected;
    });
  }
}

export class StagingRowSource implements RowSource {
  readonly kind = 'staging' as const;

  async fetchRows(options: RowSourceQueryOptions): Promise<RowSourceResult> {
    const config = options.config ?? loadServiceConfig();
    const stagingDir = config.staging?.directory;
    if (!stagingDir) {
      return { source: this.kind, rows: [] };
    }
    const safeSlug = sanitizeDatasetSlug(options.dataset.slug);
    const databasePath = path.join(stagingDir, safeSlug, 'staging.duckdb');
    try {
      await access(databasePath);
    } catch {
      return { source: this.kind, rows: [] };
    }

    const schemaFields = await this.loadSchemaFields(options.dataset.id);
    if (schemaFields.length === 0) {
      return { source: this.kind, rows: [] };
    }
    const columns = this.resolveProjectedColumns(options, schemaFields);
    const duckdb = loadDuckDb();
    const db = new duckdb.Database(databasePath, { access_mode: 'READ_ONLY' });
    const connection = db.connect();
    const catalogIdentifier = quoteIdentifier(path.parse(databasePath).name);
    const stagingSchema = `${catalogIdentifier}.${quoteIdentifier('staging')}`;
    const metadataTable = `${stagingSchema}.${quoteIdentifier('__ingestion_batches')}`;

    try {
      const tables = await this.fetchPendingTables(connection, metadataTable);
      if (tables.length === 0) {
        return { source: this.kind, rows: [] };
      }

      const rows: Record<string, unknown>[] = [];
      const rangeStartIso = options.rangeStart.toISOString();
      const rangeEndIso = options.rangeEnd.toISOString();
      let remaining = options.limit ?? Number.POSITIVE_INFINITY;

      for (const tableName of tables) {
        if (remaining <= 0) {
          break;
        }
        try {
          const tableRows = await this.fetchTableRows(
            connection,
            tableName,
            columns,
            options.timestampColumn,
            rangeStartIso,
            rangeEndIso,
            remaining,
            stagingSchema,
            metadataTable
          );
          rows.push(...tableRows);
          remaining -= tableRows.length;
        } catch {
          // Ignore binder errors caused by missing columns; staging schema may lag.
        }
      }

      return {
        source: this.kind,
        rows
      };
    } finally {
      await closeConnection(connection);
      if (isCloseable(db)) {
        db.close();
      }
    }
  }

  private async loadSchemaFields(datasetId: string): Promise<StagingSchemaField[]> {
    const registry = await getStagingSchemaRegistry(datasetId);
    return registry?.fields ?? [];
  }

  private resolveProjectedColumns(
    options: RowSourceQueryOptions,
    schemaFields: StagingSchemaField[]
  ): string[] {
    if (!options.columns || options.columns.length === 0) {
      return schemaFields.map((field) => field.name);
    }
    const allowed = new Set(schemaFields.map((field) => field.name));
    const requested = new Set(options.columns);
    requested.add(options.timestampColumn);
    const projection: string[] = [];
    for (const column of requested) {
      if (allowed.has(column)) {
        projection.push(column);
      }
    }
    return projection.length > 0 ? projection : schemaFields.map((field) => field.name);
  }

  private async fetchPendingTables(connection: any, metadataTable: string): Promise<string[]> {
    const result = await all(
      connection,
      `SELECT DISTINCT table_name
         FROM ${metadataTable}
        WHERE flush_token IS NULL
          AND table_name IS NOT NULL`
    );
    return result
      .map((row: Record<string, unknown>) => typeof row.table_name === 'string' ? row.table_name : null)
      .filter((value): value is string => Boolean(value));
  }

  private async fetchTableRows(
    connection: any,
    tableName: string,
    columns: string[],
    timestampColumn: string,
    startIso: string,
    endIso: string,
    limit: number,
    stagingSchema: string,
    metadataTable: string
  ): Promise<Record<string, unknown>[]> {
    const quotedColumns = columns.map(quoteIdentifier).join(', ');
    const qualifiedTable = `${stagingSchema}.${quoteIdentifier(tableName)}`;
    const quotedTimestamp = quoteIdentifier(timestampColumn);
    const sql = `
      SELECT ${quotedColumns}
        FROM ${qualifiedTable} AS t
        JOIN ${metadataTable} AS b
          ON t.${quoteIdentifier('__batch_id')} = b.batch_id
       WHERE b.flush_token IS NULL
         AND b.table_name = ?
         AND t.${quotedTimestamp} >= ?
         AND t.${quotedTimestamp} <= ?
       ORDER BY t.${quotedTimestamp}
       LIMIT ?`;
    return all(connection, sql, tableName, startIso, endIso, limit);
  }
}

export class PublishedRowSource implements RowSource {
  readonly kind = 'published' as const;

  async fetchRows(options: RowSourceQueryOptions): Promise<RowSourceResult> {
    const config = options.config ?? loadServiceConfig();
    const plan = await this.buildPlan(options, config);
    const result = await executeDuckDbPlan(plan);
    const rows = this.projectColumns(result, options);
    return {
      source: this.kind,
      rows,
      metadata: {
        partitions: plan.partitions.length
      }
    };
  }

  private async buildPlan(
    options: RowSourceQueryOptions,
    config: ServiceConfig
  ): Promise<QueryPlan> {
    const request = {
      timeRange: {
        start: options.rangeStart.toISOString(),
        end: options.rangeEnd.toISOString()
      },
      timestampColumn: options.timestampColumn,
      limit: options.limit,
      columns: options.columns
    };
    // buildQueryPlan expects within manifest load path; providing dataset skips DB fetch.
    const plan = await buildQueryPlan(options.dataset.slug, request, options.dataset);
    // ensure we don't accidentally include streaming overlay; executeDuckDbPlan handles raw partitions.
    return plan;
  }

  private projectColumns(
    result: QueryExecutionResult,
    options: RowSourceQueryOptions
  ): Record<string, unknown>[] {
    if (!options.columns || options.columns.length === 0) {
      return result.rows;
    }
    const columns = new Set(
      options.columns.concat(options.timestampColumn)
    );
    return result.rows.map((row) => {
      const projected: Record<string, unknown> = {};
      for (const column of columns) {
        if (Object.prototype.hasOwnProperty.call(row, column)) {
          projected[column] = row[column];
        }
      }
      return projected;
    });
  }
}

async function all(connection: any, sql: string, ...params: unknown[]): Promise<Array<Record<string, unknown>>> {
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

async function closeConnection(connection: any): Promise<void> {
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

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

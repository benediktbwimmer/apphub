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
import type { QueryExecutionResult } from './executor';
import type { QueryPlan } from './planner';
import { getStagingWriteManager } from '../ingestion/stagingManager';

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
    return this.fetchRowsWithRetry(options, 2);
  }

  private async fetchRowsWithRetry(
    options: RowSourceQueryOptions,
    attempts: number
  ): Promise<RowSourceResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.fetchRowsOnce(options);
      } catch (error) {
        lastError = error;
        if (!this.isTransientConnectionError(error) || attempt === attempts - 1) {
          throw error;
        }
        // brief delay to let writers finish closing handles before retrying
        await delay(25 * (attempt + 1));
      }
    }
    throw lastError;
  }

  private isTransientConnectionError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const message = error.message?.toLowerCase() ?? '';
    return message.includes('connection was already closed');
  }

  private async fetchRowsOnce(options: RowSourceQueryOptions): Promise<RowSourceResult> {
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
    const stagingManager = getStagingWriteManager(config);
    const spoolManager = stagingManager.getSpoolManager();

    const rows = await spoolManager.withReadConnection(options.dataset.slug, async (connection, catalogName) => {
      const catalogIdentifier = quoteIdentifier(catalogName);
      const stagingSchema = `${catalogIdentifier}.${quoteIdentifier('staging')}`;
      const metadataTable = `${stagingSchema}.${quoteIdentifier('__ingestion_batches')}`;

      const batches = await queryAll(connection, `
        SELECT batch_id, table_name, schema_json
          FROM ${metadataTable}
         WHERE flush_token IS NULL
         ORDER BY staged_at ASC
      `);

      if (batches.length === 0) {
        return [] as Record<string, unknown>[];
      }

      const rangeStartIso = options.rangeStart.toISOString();
      const rangeEndIso = options.rangeEnd.toISOString();
      const limit = typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
        ? Math.floor(options.limit)
        : undefined;
      let remaining = limit ?? Number.POSITIVE_INFINITY;
      const collected: Record<string, unknown>[] = [];
      const projection = new Set(columns.concat(options.timestampColumn));

      for (const batch of batches) {
        if (limit && remaining <= 0) {
          break;
        }
        const tableName = typeof batch.table_name === 'string' ? batch.table_name : null;
        if (!tableName) {
          continue;
        }
        const qualifiedTable = `${stagingSchema}.${quoteIdentifier(tableName)}`;
        const placeholderLimit = limit ? ' LIMIT ?' : '';
        const sql = `
          SELECT ${Array.from(projection).map(quoteIdentifier).join(', ')}
            FROM ${qualifiedTable}
            JOIN ${metadataTable}
              ON ${qualifiedTable}.${quoteIdentifier('__batch_id')} = ${metadataTable}.${quoteIdentifier('batch_id')}
           WHERE ${metadataTable}.${quoteIdentifier('flush_token')} IS NULL
             AND ${metadataTable}.${quoteIdentifier('table_name')} = ?
             AND ${qualifiedTable}.${quoteIdentifier(options.timestampColumn)} >= ?
             AND ${qualifiedTable}.${quoteIdentifier(options.timestampColumn)} <= ?
           ORDER BY ${qualifiedTable}.${quoteIdentifier(options.timestampColumn)}${placeholderLimit}`;
        const params: unknown[] = [tableName, rangeStartIso, rangeEndIso];
        if (limit) {
          params.push(Math.max(1, remaining));
        }
        try {
          const batchRows = await queryAll(connection, sql, ...params);
          for (const row of batchRows) {
            const projected: Record<string, unknown> = {};
            for (const column of projection) {
              if (Object.prototype.hasOwnProperty.call(row, column)) {
                projected[column] = row[column];
              }
            }
            collected.push(projected);
            if (limit) {
              remaining -= 1;
              if (remaining <= 0) {
                break;
              }
            }
          }
        } catch {
          // ignore binder errors from mismatched schema columns
        }
      }

      collected.sort((a, b) => {
        const left = toTimestampMs(a[options.timestampColumn]);
        const right = toTimestampMs(b[options.timestampColumn]);
        if (left === null || right === null) {
          return 0;
        }
        return left - right;
      });

      return limit ? collected.slice(0, limit) : collected;
    });

    return {
      source: this.kind,
      rows
    };
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

}

export class PublishedRowSource implements RowSource {
  readonly kind = 'published' as const;

  async fetchRows(options: RowSourceQueryOptions): Promise<RowSourceResult> {
    const config = options.config ?? loadServiceConfig();
    const plan = await this.buildPlan(options, config);
    const { executeDuckDbPlan } = await loadExecutorModule();
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

function queryAll(connection: any, sql: string, ...params: unknown[]): Promise<Array<Record<string, unknown>>> {
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

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toTimestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

let executorModulePromise: Promise<typeof import('./executor')> | null = null;

async function loadExecutorModule(): Promise<typeof import('./executor')> {
  if (!executorModulePromise) {
    executorModulePromise = import('./executor');
  }
  return executorModulePromise;
}

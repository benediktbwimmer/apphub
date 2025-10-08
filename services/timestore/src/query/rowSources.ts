import { queryStreamingHotBuffer } from '../streaming/hotBuffer';
import type { HotBufferQueryResult } from '../streaming/hotBuffer';
import type { DatasetRecord } from '../db/metadata';
import type { ServiceConfig } from '../config/serviceConfig';

interface RowSourceQueryOptions {
  dataset: DatasetRecord;
  timestampColumn: string;
  rangeStart: Date;
  rangeEnd: Date;
  limit?: number;
  columns?: string[];
  config?: ServiceConfig;
}

export type RowSourceKind = 'hot_buffer';

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

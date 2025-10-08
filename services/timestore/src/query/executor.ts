import { loadServiceConfig, type ServiceConfig } from '../config/serviceConfig';
import { getClickHouseClient } from '../clickhouse/client';
import {
  deriveTableName as deriveClickHouseTableName,
  quoteIdentifier as quoteClickHouseIdent,
  escapeStringLiteral as escapeClickHouseString,
  toDateTime64Literal
} from '../clickhouse/util';
import { getStreamingHotBufferStatus } from '../streaming/hotBuffer';
import { HotBufferRowSource, type RowSourceResult } from './rowSources';
import { recordUnifiedRowSourceRows, recordUnifiedRowSourceWarning } from '../observability/metrics';
import type { QueryPlan } from './planner';
import type {
  ColumnPredicate,
  BooleanColumnPredicate,
  NumberPartitionKeyPredicate,
  StringPartitionKeyPredicate,
  TimestampPartitionKeyPredicate
} from '../types/partitionFilters';

interface QueryResultRow {
  [key: string]: unknown;
}

export interface QueryExecutionResult {
  rows: QueryResultRow[];
  columns: string[];
  mode: 'raw' | 'downsampled';
  warnings: string[];
  streaming?: QueryStreamingMetadata;
  sources?: QueryRowSourceBreakdown;
}

export interface QueryStreamingMetadata {
  enabled: boolean;
  bufferState: 'disabled' | 'ready' | 'unavailable';
  rows: number;
  watermark: string | null;
  latestTimestamp: string | null;
  fresh: boolean;
}

export interface QueryRowSourceBreakdown {
  published: {
    rows: number;
    partitions: number;
  };
  hotBuffer: {
    rows: number;
  };
}

interface HotBufferMetadata {
  bufferState: 'disabled' | 'ready' | 'unavailable';
  watermark: string | null;
  latestTimestamp: string | null;
}

export async function executeQueryPlan(plan: QueryPlan): Promise<QueryExecutionResult> {
  const config = loadServiceConfig();
  if (plan.execution.backend.kind !== 'clickhouse') {
    throw new Error(`Unsupported query execution backend: ${plan.execution.backend.kind}`);
  }

  const baseResult = await executeClickHousePlan(plan, config);

  if (plan.mode !== 'raw') {
    return {
      ...baseResult,
      warnings: dedupeWarnings(baseResult.warnings ?? [])
    };
  }

  return mergeHotBufferRows(plan, baseResult, config);
}

async function executeClickHousePlan(
  plan: QueryPlan,
  config: ServiceConfig
): Promise<QueryExecutionResult> {
  const client = getClickHouseClient(config.clickhouse);
  const warnings: string[] = [];

  const queryColumns = resolveClickHouseQueryColumns(plan);
  const selectClause = queryColumns.map((column) => quoteClickHouseIdent(column)).join(', ');
  const timestampIdentifier = quoteClickHouseIdent(plan.timestampColumn);

  const conditions: string[] = [
    `${quoteClickHouseIdent('__dataset_slug')} = '${escapeClickHouseString(plan.datasetSlug)}'`,
    `${timestampIdentifier} >= ${toDateTime64Literal(plan.rangeStart.toISOString())}`,
    `${timestampIdentifier} <= ${toDateTime64Literal(plan.rangeEnd.toISOString())}`
  ];

  if (plan.columnFilters && Object.keys(plan.columnFilters).length > 0) {
    const filterClause = buildClickHouseColumnFilterClause(plan.columnFilters);
    if (filterClause) {
      conditions.push(filterClause);
    }
  }

  const whereClause = conditions.join(' AND ');
  const tables = resolveClickHouseTables(plan);
  const rows: Record<string, unknown>[] = [];

  for (const tableName of tables) {
    const tableIdentifier = `${quoteClickHouseIdent(config.clickhouse.database)}.${quoteClickHouseIdent(
      deriveClickHouseTableName(plan.datasetSlug, tableName)
    )}`;
    const query = `SELECT ${selectClause}
      FROM ${tableIdentifier}
      WHERE ${whereClause}
      ORDER BY ${timestampIdentifier} ASC`;
    try {
      const result = await client.query({
        query,
        format: 'JSONEachRow'
      });
      const tableRows = await result.json<Record<string, unknown>>();
      if (tableRows.length > 0) {
        rows.push(...tableRows);
      }
    } catch (error) {
      console.warn('[timestore] clickhouse query failed', {
        datasetSlug: plan.datasetSlug,
        tableName,
        error: error instanceof Error ? error.message : error
      });
      warnings.push(`Failed to read ClickHouse table '${tableName}'.`);
    }
  }

  const normalizedRows = normalizeRows(rows).map((row) => {
    const projected: Record<string, unknown> = {};
    for (const column of queryColumns) {
      if (Object.prototype.hasOwnProperty.call(row, column)) {
        projected[column] = row[column];
      }
    }
    return projected;
  });

  const finalizedRows = finalizeRows(plan, normalizedRows);
  const columns = deriveColumns(plan);

  return {
    rows: finalizedRows,
    columns,
    mode: 'raw',
    warnings: dedupeWarnings(warnings)
  };
}

async function mergeHotBufferRows(
  plan: QueryPlan,
  baseResult: QueryExecutionResult,
  config: ServiceConfig
): Promise<QueryExecutionResult> {
  const warnings = [...(baseResult.warnings ?? [])];
  const publishedRows = baseResult.rows.length;
  const publishedRowSet = new Set(baseResult.rows);
  if (publishedRows > 0) {
    recordUnifiedRowSourceRows(plan.datasetSlug, 'published', 'query', publishedRows);
  }

  const rowSourceOptions = {
    dataset: plan.dataset,
    timestampColumn: plan.timestampColumn,
    rangeStart: plan.rangeStart,
    rangeEnd: plan.rangeEnd,
    limit: plan.limit,
    columns: plan.columns,
    config
  };

  const combinedRows: Record<string, unknown>[] = [...baseResult.rows];
  let streamingRows: Record<string, unknown>[] = [];

  const streamingEnabled = config.features.streaming.enabled && config.streaming.hotBuffer.enabled;
  const status = getStreamingHotBufferStatus();
  const streamingMetadata: QueryStreamingMetadata = {
    enabled: streamingEnabled,
    bufferState: streamingEnabled ? status.state : 'disabled',
    rows: 0,
    watermark: null,
    latestTimestamp: null,
    fresh: streamingEnabled ? status.state === 'ready' : true
  };

  if (!streamingEnabled || status.state === 'disabled') {
    const finalRows = finalizeRows(plan, combinedRows);
    const finalColumns = mergeColumns(baseResult.columns, finalRows);
    const sources = summarizeRowSources(finalRows, publishedRowSet, streamingRows, plan.partitions.length);
    return {
      ...baseResult,
      rows: finalRows,
      columns: finalColumns,
      warnings: dedupeWarnings(warnings),
      streaming: streamingMetadata,
      sources
    };
  }

  let hotBufferResult: RowSourceResult | null = null;
  let hotBufferError: unknown = null;
  try {
    const hotBufferSource = new HotBufferRowSource();
    hotBufferResult = await hotBufferSource.fetchRows(rowSourceOptions);
  } catch (error) {
    hotBufferError = error;
    console.warn('[timestore] failed to read streaming hot buffer', {
      datasetSlug: plan.dataset.slug,
      error: error instanceof Error ? error.message : error
    });
  }

  const hotBufferMetadata = normalizeHotBufferMetadata(hotBufferResult?.metadata);
  const bufferState = hotBufferMetadata.bufferState;

  if (bufferState === 'unavailable' || hotBufferError) {
    if (config.streaming.hotBuffer.fallbackMode === 'error') {
      throw new Error('Streaming hot buffer is unavailable and fallback mode is set to error.');
    }
    warnings.push('Streaming hot buffer unavailable; served ClickHouse partitions only.');
    const warningReason = hotBufferError
      ? hotBufferError instanceof Error
        ? hotBufferError.message
        : String(hotBufferError)
      : bufferState;
    recordUnifiedRowSourceWarning(plan.datasetSlug, 'hot_buffer', 'query', warningReason);
    const finalRows = finalizeRows(plan, combinedRows);
    const finalColumns = mergeColumns(baseResult.columns, finalRows);
    const sources = summarizeRowSources(finalRows, publishedRowSet, streamingRows, plan.partitions.length);
    return {
      ...baseResult,
      rows: finalRows,
      columns: finalColumns,
      warnings: dedupeWarnings(warnings),
      streaming: {
        ...streamingMetadata,
        bufferState: 'unavailable',
        fresh: false
      },
      sources
    };
  }

  streamingRows = hotBufferResult?.rows ?? [];
  if (streamingRows.length > 0) {
    combinedRows.push(...streamingRows);
    recordUnifiedRowSourceRows(plan.datasetSlug, 'hot_buffer', 'query', streamingRows.length);
  }

  const finalRows = finalizeRows(plan, combinedRows);
  const finalColumns = mergeColumns(baseResult.columns, finalRows);
  const sources = summarizeRowSources(finalRows, publishedRowSet, streamingRows, plan.partitions.length);

  return {
    ...baseResult,
    rows: finalRows,
    columns: finalColumns,
    warnings: dedupeWarnings(warnings),
    streaming: {
      enabled: true,
      bufferState,
      rows: sources.hotBuffer.rows,
      watermark: hotBufferMetadata.watermark,
      latestTimestamp: hotBufferMetadata.latestTimestamp,
      fresh: determineFreshness(hotBufferMetadata.latestTimestamp, plan.rangeEnd)
    },
    sources
  };
}

function finalizeRows(
  plan: QueryPlan,
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  if (rows.length === 0) {
    return [];
  }
  const sorted = [...rows];
  sorted.sort((a, b) => compareRowsByTimestamp(a, b, plan.timestampColumn));
  const deduped: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const row of sorted) {
    const key = buildRowDedupKey(row);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  if (plan.limit && plan.limit > 0 && deduped.length > plan.limit) {
    return deduped.slice(0, plan.limit);
  }
  return deduped;
}

function buildRowDedupKey(row: Record<string, unknown>): string {
  const entries = Object.entries(row).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

function determineFreshness(latestTimestamp: string | null, rangeEnd: Date): boolean {
  if (!latestTimestamp) {
    return false;
  }
  const parsed = Date.parse(latestTimestamp);
  if (Number.isNaN(parsed)) {
    return false;
  }
  return parsed >= rangeEnd.getTime();
}

function compareRowsByTimestamp(
  left: QueryResultRow,
  right: QueryResultRow,
  column: string
): number {
  const leftValue = toTimestampMs(left[column]);
  const rightValue = toTimestampMs(right[column]);
  if (leftValue === null && rightValue === null) {
    return 0;
  }
  if (leftValue === null) {
    return 1;
  }
  if (rightValue === null) {
    return -1;
  }
  return leftValue - rightValue;
}

function toTimestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
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

function mergeColumns(baseColumns: string[], rows: QueryResultRow[]): string[] {
  const seen = new Set(baseColumns);
  const merged = [...baseColumns];
  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (!seen.has(column)) {
        seen.add(column);
        merged.push(column);
      }
    }
  }
  return merged;
}

function normalizeHotBufferMetadata(metadata: Record<string, unknown> | undefined): HotBufferMetadata {
  const state = metadata?.bufferState;
  const bufferState: HotBufferMetadata['bufferState'] =
    state === 'ready' || state === 'disabled' ? state : 'unavailable';
  const watermarkValue = metadata?.watermark;
  const latestTimestampValue = metadata?.latestTimestamp;
  return {
    bufferState,
    watermark: typeof watermarkValue === 'string' ? watermarkValue : null,
    latestTimestamp: typeof latestTimestampValue === 'string' ? latestTimestampValue : null
  };
}

function summarizeRowSources(
  finalRows: Record<string, unknown>[],
  publishedRowSet: Set<Record<string, unknown>>,
  streamingRows: Record<string, unknown>[],
  partitions: number
): QueryRowSourceBreakdown {
  const streamingRowSet = new Set(streamingRows);
  let publishedIncluded = 0;
  let streamingIncluded = 0;

  for (const row of finalRows) {
    if (streamingRowSet.has(row)) {
      streamingIncluded += 1;
      continue;
    }
    if (publishedRowSet.has(row)) {
      publishedIncluded += 1;
    }
  }

  return {
    published: {
      rows: publishedIncluded,
      partitions
    },
    hotBuffer: {
      rows: streamingIncluded
    }
  };
}

function normalizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key] = normalizeValue(value);
    }
    return normalized;
  });
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const timestampLike = extractTimestampValue(value);
  if (timestampLike !== null) {
    return timestampLike;
  }
  if (typeof value === 'bigint') {
    if (value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER) {
      return Number(value);
    }
    return value.toString();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    return value;
  }
  if (typeof value === 'undefined') {
    return null;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return value.toString('base64');
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const normalized: Record<string, unknown> = {};
    for (const [key, nested] of entries) {
      normalized[key] = normalizeValue(nested);
    }
    return normalized;
  }
  if (Number.isNaN(value)) {
    return null;
  }
  return value;
}

function extractTimestampValue(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  if ('toISOString' in value && typeof (value as { toISOString?: () => string }).toISOString === 'function') {
    try {
      const iso = (value as { toISOString: () => string }).toISOString();
      if (typeof iso === 'string' && !Number.isNaN(Date.parse(iso))) {
        return iso;
      }
    } catch {
      return null;
    }
  }
  if ('toJSON' in value && typeof (value as { toJSON?: () => unknown }).toJSON === 'function') {
    try {
      const json = (value as { toJSON: () => unknown }).toJSON();
      if (typeof json === 'string' && !Number.isNaN(Date.parse(json))) {
        return json;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function dedupeWarnings(warnings: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const warning of warnings) {
    const normalized = warning.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function deriveColumns(plan: QueryPlan): string[] {
  if (plan.columns && plan.columns.length > 0) {
    return [...plan.columns];
  }
  if (plan.schemaFields.length > 0) {
    return plan.schemaFields.map((field) => field.name);
  }
  return [plan.timestampColumn];
}

function resolveClickHouseQueryColumns(plan: QueryPlan): string[] {
  const baseColumns = plan.columns && plan.columns.length > 0
    ? [...plan.columns]
    : plan.schemaFields.map((field) => field.name);
  if (!baseColumns.includes(plan.timestampColumn)) {
    baseColumns.unshift(plan.timestampColumn);
  }
  const unique: string[] = [];
  for (const column of baseColumns) {
    if (!unique.includes(column)) {
      unique.push(column);
    }
  }
  if (unique.length === 0) {
    unique.push(plan.timestampColumn);
  }
  return unique;
}

function resolveClickHouseTables(plan: QueryPlan): string[] {
  const tables = new Set<string>();
  for (const partition of plan.partitions) {
    const tableName = partition.tableName?.trim();
    if (tableName) {
      tables.add(tableName);
    }
  }
  if (tables.size === 0) {
    const metadata = plan.dataset.metadata as { tableName?: unknown } | null;
    const tableName = metadata && typeof metadata.tableName === 'string' ? metadata.tableName.trim() : null;
    if (tableName) {
      tables.add(tableName);
    }
  }
  if (tables.size === 0) {
    tables.add('records');
  }
  return Array.from(tables);
}

function buildClickHouseColumnFilterClause(columnFilters: Record<string, ColumnPredicate>): string {
  const expressions: string[] = [];
  for (const [column, predicate] of Object.entries(columnFilters)) {
    const expression = clickHousePredicateToSql(column, predicate);
    if (expression) {
      expressions.push(expression);
    }
  }
  return expressions.join(' AND ');
}

function clickHousePredicateToSql(column: string, predicate: ColumnPredicate): string | null {
  const identifier = quoteClickHouseIdent(column);
  switch (predicate.type) {
    case 'string':
      return buildClickHouseStringPredicate(identifier, predicate);
    case 'number':
      return buildClickHouseNumberPredicate(identifier, predicate);
    case 'timestamp':
      return buildClickHouseTimestampPredicate(identifier, predicate);
    case 'boolean':
      return buildClickHouseBooleanPredicate(identifier, predicate);
    default:
      return null;
  }
}

function buildClickHouseStringPredicate(
  identifier: string,
  predicate: StringPartitionKeyPredicate
): string | null {
  const clauses: string[] = [];
  if (typeof predicate.eq === 'string') {
    clauses.push(`${identifier} = ${toClickHouseLiteral('string', predicate.eq)}`);
  }
  if (Array.isArray(predicate.in) && predicate.in.length > 0) {
    const values = predicate.in.map((value) => toClickHouseLiteral('string', value));
    clauses.push(`${identifier} IN (${values.join(', ')})`);
  }
  if (typeof predicate.gt === 'string') {
    clauses.push(`${identifier} > ${toClickHouseLiteral('string', predicate.gt)}`);
  }
  if (typeof predicate.gte === 'string') {
    clauses.push(`${identifier} >= ${toClickHouseLiteral('string', predicate.gte)}`);
  }
  if (typeof predicate.lt === 'string') {
    clauses.push(`${identifier} < ${toClickHouseLiteral('string', predicate.lt)}`);
  }
  if (typeof predicate.lte === 'string') {
    clauses.push(`${identifier} <= ${toClickHouseLiteral('string', predicate.lte)}`);
  }
  return clauses.length > 0 ? clauses.join(' AND ') : null;
}

function buildClickHouseNumberPredicate(
  identifier: string,
  predicate: NumberPartitionKeyPredicate
): string | null {
  const clauses: string[] = [];
  if (predicate.eq !== undefined) {
    clauses.push(`${identifier} = ${toClickHouseLiteral('number', predicate.eq)}`);
  }
  if (Array.isArray(predicate.in) && predicate.in.length > 0) {
    const values = predicate.in.map((value) => toClickHouseLiteral('number', value));
    clauses.push(`${identifier} IN (${values.join(', ')})`);
  }
  if (predicate.gt !== undefined) {
    clauses.push(`${identifier} > ${toClickHouseLiteral('number', predicate.gt)}`);
  }
  if (predicate.gte !== undefined) {
    clauses.push(`${identifier} >= ${toClickHouseLiteral('number', predicate.gte)}`);
  }
  if (predicate.lt !== undefined) {
    clauses.push(`${identifier} < ${toClickHouseLiteral('number', predicate.lt)}`);
  }
  if (predicate.lte !== undefined) {
    clauses.push(`${identifier} <= ${toClickHouseLiteral('number', predicate.lte)}`);
  }
  return clauses.length > 0 ? clauses.join(' AND ') : null;
}

function buildClickHouseTimestampPredicate(
  identifier: string,
  predicate: TimestampPartitionKeyPredicate
): string | null {
  const clauses: string[] = [];
  if (typeof predicate.eq === 'string') {
    clauses.push(`${identifier} = ${toClickHouseLiteral('timestamp', predicate.eq)}`);
  }
  if (Array.isArray(predicate.in) && predicate.in.length > 0) {
    const values = predicate.in.map((value) => toClickHouseLiteral('timestamp', value));
    clauses.push(`${identifier} IN (${values.join(', ')})`);
  }
  if (typeof predicate.gt === 'string') {
    clauses.push(`${identifier} > ${toClickHouseLiteral('timestamp', predicate.gt)}`);
  }
  if (typeof predicate.gte === 'string') {
    clauses.push(`${identifier} >= ${toClickHouseLiteral('timestamp', predicate.gte)}`);
  }
  if (typeof predicate.lt === 'string') {
    clauses.push(`${identifier} < ${toClickHouseLiteral('timestamp', predicate.lt)}`);
  }
  if (typeof predicate.lte === 'string') {
    clauses.push(`${identifier} <= ${toClickHouseLiteral('timestamp', predicate.lte)}`);
  }
  return clauses.length > 0 ? clauses.join(' AND ') : null;
}

function buildClickHouseBooleanPredicate(
  identifier: string,
  predicate: BooleanColumnPredicate
): string | null {
  const clauses: string[] = [];
  if (predicate.eq !== undefined) {
    clauses.push(`${identifier} = ${toClickHouseLiteral('boolean', predicate.eq)}`);
  }
  if (Array.isArray(predicate.in) && predicate.in.length > 0) {
    const values = predicate.in.map((value) => toClickHouseLiteral('boolean', value));
    clauses.push(`${identifier} IN (${values.join(', ')})`);
  }
  return clauses.length > 0 ? clauses.join(' AND ') : null;
}

type ClickHouseLiteralType = 'string' | 'number' | 'timestamp' | 'boolean';

function toClickHouseLiteral(type: ClickHouseLiteralType, value: unknown): string {
  switch (type) {
    case 'string':
      return `'${escapeClickHouseString(String(value))}'`;
    case 'number':
      return String(value);
    case 'timestamp': {
      const parsed = Date.parse(String(value));
      const normalized = Number.isNaN(parsed) ? String(value) : new Date(parsed).toISOString();
      return `parseDateTimeBestEffort('${escapeClickHouseString(normalized)}')`;
    }
    case 'boolean':
      return value ? '1' : '0';
    default:
      return `'${escapeClickHouseString(String(value))}'`;
  }
}

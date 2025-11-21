import { loadServiceConfig, type ServiceConfig } from '../config/serviceConfig';
import { getClickHouseClient } from '../clickhouse/client';
import {
  deriveTableName as deriveClickHouseTableName,
  quoteIdentifier as quoteClickHouseIdent,
  escapeStringLiteral as escapeClickHouseString,
  toDateTime64Literal
} from '../clickhouse/util';
import {
  getMockTableRows,
  isClickHouseMockEnabled
} from '../clickhouse/mockStore';
import { getStreamingHotBufferStatus } from '../streaming/hotBuffer';
import { HotBufferRowSource, type RowSourceResult } from './rowSources';
import { recordUnifiedRowSourceRows, recordUnifiedRowSourceWarning } from '../observability/metrics';
import type { QueryPlan, DownsampleAggregationPlan, DownsamplePlan } from './planner';
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
    return baseResult;
  }

  return mergeHotBufferRows(plan, baseResult, config);
}

async function executeClickHousePlan(
  plan: QueryPlan,
  config: ServiceConfig
): Promise<QueryExecutionResult> {
  if (isClickHouseMockEnabled(config.clickhouse)) {
    return plan.mode === 'downsampled'
      ? executeMockClickHouseDownsamplePlan(plan)
      : executeMockClickHouseRawPlan(plan);
  }
  const result = plan.mode === 'downsampled'
    ? await executeClickHouseDownsamplePlan(plan, config)
    : await executeClickHouseRawPlan(plan, config);
  return {
    ...result,
    warnings: dedupeWarnings(result.warnings ?? [])
  };
}

async function executeClickHouseRawPlan(
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
      for (const row of tableRows) {
        rows.push(row);
      }
    } catch (error) {
      console.warn('[timestore] clickhouse query failed', {
        datasetSlug: plan.datasetSlug,
        tableName,
        error: error instanceof Error ? error.message : error,
        errorName: error instanceof Error ? error.name : undefined,
        stack: error instanceof Error ? error.stack : undefined
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

async function executeClickHouseDownsamplePlan(
  plan: QueryPlan,
  config: ServiceConfig
): Promise<QueryExecutionResult> {
  const downsample = plan.downsample;
  if (!downsample) {
    throw new Error('Downsample plan missing for downsampled query.');
  }
  const client = getClickHouseClient(config.clickhouse);
  const warnings: string[] = [];
  const timestampIdentifier = quoteClickHouseIdent(plan.timestampColumn);
  const dimensionColumns = resolveDownsampleDimensionColumns(plan);
  const bucketExpression = buildDownsampleBucketExpression(plan);

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
  const sourceColumns = buildDownsampleSourceColumns(plan, dimensionColumns);
  const sourceSelectClause = sourceColumns.map((column) => quoteClickHouseIdent(column)).join(', ');

  const sourceQueries = tables.map((tableName) => {
    const tableIdentifier = `${quoteClickHouseIdent(config.clickhouse.database)}.${quoteClickHouseIdent(
      deriveClickHouseTableName(plan.datasetSlug, tableName)
    )}`;
    return `SELECT ${sourceSelectClause}
      FROM ${tableIdentifier}
      WHERE ${whereClause}`;
  });

  const unionSource = sourceQueries
    .map((query) => `(${query})`)
    .join('\n      UNION ALL\n      ');

  const aggregationSelects = downsample.aggregations.map(
    (aggregation) => `${aggregation.expression} AS ${quoteClickHouseIdent(aggregation.alias)}`
  );

  const selectClauseParts = [
    `${bucketExpression} AS ${timestampIdentifier}`,
    ...dimensionColumns.map((column) => quoteClickHouseIdent(column)),
    ...aggregationSelects
  ];

  const selectClause = selectClauseParts.join(', ');
  const groupByParts = [
    timestampIdentifier,
    ...dimensionColumns.map((column) => quoteClickHouseIdent(column))
  ];
  const groupByClause = groupByParts.join(', ');

  const orderByClause = [
    `${timestampIdentifier} ASC`,
    ...dimensionColumns.map((column) => `${quoteClickHouseIdent(column)} ASC`)
  ].join(', ');

  let query = `SELECT ${selectClause}
    FROM (
      ${unionSource}
    ) AS source
    GROUP BY ${groupByClause}
    ORDER BY ${orderByClause}`;

  if (plan.limit && plan.limit > 0) {
    query += `\n    LIMIT ${plan.limit}`;
  }

  let rows: Record<string, unknown>[] = [];
  try {
    const result = await client.query({
      query,
      format: 'JSONEachRow'
    });
    rows = await result.json<Record<string, unknown>>();
  } catch (error) {
    console.warn('[timestore] clickhouse downsample query failed', {
      datasetSlug: plan.datasetSlug,
      tables,
      error: error instanceof Error ? error.message : error
    });
    throw error;
  }

  const normalizedRows = finalizeRows(plan, normalizeRows(rows));
  const columns = deriveColumns(plan);

  return {
    rows: normalizedRows,
    columns,
    mode: 'downsampled',
    warnings
  };
}

function executeMockClickHouseRawPlan(plan: QueryPlan): QueryExecutionResult {
  const queryColumns = resolveClickHouseQueryColumns(plan);
  const rows = collectMockTableRows(plan);

  const normalizedRows = rows
    .sort((left, right) => compareRowsByTimestamp(left, right, plan.timestampColumn))
    .map((row) => {
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
    warnings: []
  };
}

function executeMockClickHouseDownsamplePlan(plan: QueryPlan): QueryExecutionResult {
  const downsample = plan.downsample;
  if (!downsample) {
    throw new Error('Downsample plan missing for downsampled query.');
  }
  const rows = collectMockTableRows(plan);
  const dimensionColumns = resolveDownsampleDimensionColumns(plan);
  const bucketStates = aggregateMockRows(plan, rows, dimensionColumns);
  const finalizedRows = finalizeMockDownsampleRows(plan, bucketStates, dimensionColumns);
  const columns = deriveColumns(plan);

  return {
    rows: finalizedRows,
    columns,
    mode: 'downsampled',
    warnings: []
  };
}

function collectMockTableRows(plan: QueryPlan): Record<string, unknown>[] {
  const tables = resolveClickHouseTables(plan);
  const rows: Record<string, unknown>[] = [];

  for (const tableName of tables) {
    const tableRows = getMockTableRows({
      datasetSlug: plan.datasetSlug,
      tableName
    });
    if (tableRows.length === 0) {
      continue;
    }
    for (const row of tableRows) {
      if (!isTimestampWithinRange(row, plan.timestampColumn, plan.rangeStart, plan.rangeEnd)) {
        continue;
      }
      if (!matchesColumnFilters(row, plan.columnFilters ?? {})) {
        continue;
      }
      rows.push(row);
    }
  }

  return rows;
}

interface DownsampleBucketState {
  bucketMs: number;
  dimensions: Record<string, unknown>;
  aggregations: Record<string, AggregationAccumulator>;
}

interface AggregationAccumulator {
  fn: DownsampleAggregationPlan['fn'];
  column?: string;
  percentile?: number;
  numericSum?: number;
  numericCount?: number;
  min?: number;
  max?: number;
  values?: number[];
  distinct?: Set<string>;
  totalCount?: number;
  nonNullCount?: number;
}

function aggregateMockRows(
  plan: QueryPlan,
  rows: Record<string, unknown>[],
  dimensionColumns: string[]
): DownsampleBucketState[] {
  const downsample = plan.downsample;
  if (!downsample) {
    return [];
  }
  const buckets = new Map<string, DownsampleBucketState>();

  for (const row of rows) {
    const timestamp = toTimestampMs(row[plan.timestampColumn]);
    if (timestamp === null) {
      continue;
    }
    const bucketMs = floorTimestampToInterval(timestamp, downsample.intervalSize, downsample.intervalUnit);
    const dimensionKeyValues = dimensionColumns.map((column) => serializeDistinctValue(row[column]));
    const bucketKey = JSON.stringify([bucketMs, ...dimensionKeyValues]);

    let state = buckets.get(bucketKey);
    if (!state) {
      const dimensions: Record<string, unknown> = {};
      for (const column of dimensionColumns) {
        dimensions[column] = Object.prototype.hasOwnProperty.call(row, column) ? row[column] : null;
      }
      state = {
        bucketMs,
        dimensions,
        aggregations: initializeAggregationAccumulators(downsample.aggregations)
      };
      buckets.set(bucketKey, state);
    }

    updateAggregationAccumulators(state.aggregations, downsample.aggregations, row);
  }

  return Array.from(buckets.values());
}

function initializeAggregationAccumulators(
  aggregations: DownsampleAggregationPlan[]
): Record<string, AggregationAccumulator> {
  const result: Record<string, AggregationAccumulator> = {};
  for (const aggregation of aggregations) {
    result[aggregation.alias] = {
      fn: aggregation.fn,
      column: aggregation.column ?? undefined,
      percentile: aggregation.percentile,
      distinct: aggregation.fn === 'count_distinct' ? new Set<string>() : undefined,
      values: aggregation.fn === 'median' || aggregation.fn === 'percentile' ? [] : undefined,
      numericSum: 0,
      numericCount: 0,
      totalCount: 0,
      nonNullCount: 0
    };
  }
  return result;
}

function updateAggregationAccumulators(
  accumulators: Record<string, AggregationAccumulator>,
  aggregations: DownsampleAggregationPlan[],
  row: Record<string, unknown>
): void {
  for (const aggregation of aggregations) {
    const accumulator = accumulators[aggregation.alias];
    if (!accumulator) {
      continue;
    }
    const value = aggregation.column ? row[aggregation.column] : undefined;
    switch (aggregation.fn) {
      case 'avg':
      case 'sum': {
        const numeric = coerceNumber(value);
        if (numeric !== null) {
          accumulator.numericSum = (accumulator.numericSum ?? 0) + numeric;
          accumulator.numericCount = (accumulator.numericCount ?? 0) + 1;
        }
        break;
      }
      case 'min': {
        const numeric = coerceNumber(value);
        if (numeric !== null) {
          accumulator.min = accumulator.min === undefined ? numeric : Math.min(accumulator.min, numeric);
        }
        break;
      }
      case 'max': {
        const numeric = coerceNumber(value);
        if (numeric !== null) {
          accumulator.max = accumulator.max === undefined ? numeric : Math.max(accumulator.max, numeric);
        }
        break;
      }
      case 'median':
      case 'percentile': {
        const numeric = coerceNumber(value);
        if (numeric !== null) {
          accumulator.values = accumulator.values ?? [];
          accumulator.values.push(numeric);
        }
        break;
      }
      case 'count': {
        accumulator.totalCount = (accumulator.totalCount ?? 0) + 1;
        if (aggregation.column) {
          if (value !== null && value !== undefined) {
            accumulator.nonNullCount = (accumulator.nonNullCount ?? 0) + 1;
          }
        }
        break;
      }
      case 'count_distinct': {
        if (value !== null && value !== undefined) {
          const distinctValue = serializeDistinctValue(value);
          accumulator.distinct?.add(distinctValue);
        }
        break;
      }
      default:
        break;
    }
  }
}

function finalizeMockDownsampleRows(
  plan: QueryPlan,
  bucketStates: DownsampleBucketState[],
  dimensionColumns: string[]
): Record<string, unknown>[] {
  const downsample = plan.downsample;
  if (!downsample) {
    return [];
  }
  const rows: Record<string, unknown>[] = [];

  for (const state of bucketStates) {
    const row: Record<string, unknown> = {};
    row[plan.timestampColumn] = formatClickHouseTimestamp(state.bucketMs);
    for (const column of dimensionColumns) {
      row[column] = state.dimensions[column] ?? null;
    }
    for (const aggregation of downsample.aggregations) {
      const accumulator = state.aggregations[aggregation.alias];
      row[aggregation.alias] = computeAggregationValue(accumulator, aggregation);
    }
    rows.push(row);
  }

  rows.sort((left, right) => compareRowsByTimestamp(left, right, plan.timestampColumn));
  if (plan.limit && plan.limit > 0 && rows.length > plan.limit) {
    return rows.slice(0, plan.limit);
  }
  return rows;
}

function computeAggregationValue(
  accumulator: AggregationAccumulator | undefined,
  aggregation: DownsampleAggregationPlan
): unknown {
  if (!accumulator) {
    return null;
  }
  switch (aggregation.fn) {
    case 'avg': {
      const sum = accumulator.numericSum ?? 0;
      const count = accumulator.numericCount ?? 0;
      if (count === 0) {
        return null;
      }
      return sum / count;
    }
    case 'sum':
      return accumulator.numericSum ?? 0;
    case 'min':
      return accumulator.min ?? null;
    case 'max':
      return accumulator.max ?? null;
    case 'median': {
      const values = accumulator.values ?? [];
      if (values.length === 0) {
        return null;
      }
      values.sort((a, b) => a - b);
      const mid = Math.floor(values.length / 2);
      if (values.length % 2 === 0) {
        return (values[mid - 1] + values[mid]) / 2;
      }
      return values[mid];
    }
    case 'percentile': {
      const values = accumulator.values ?? [];
      if (values.length === 0) {
        return null;
      }
      values.sort((a, b) => a - b);
      const p = typeof aggregation.percentile === 'number' ? aggregation.percentile : 0;
      const index = Math.min(values.length - 1, Math.max(0, Math.floor(p * (values.length - 1))));
      return values[index];
    }
    case 'count':
      return aggregation.column ? accumulator.nonNullCount ?? 0 : accumulator.totalCount ?? 0;
    case 'count_distinct':
      return accumulator.distinct ? accumulator.distinct.size : 0;
    default:
      return null;
  }
}

function serializeDistinctValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (value === null || value === undefined) {
    return 'null';
  }
  return JSON.stringify(value);
}

function floorTimestampToInterval(
  timestampMs: number,
  size: number,
  unit: DownsamplePlan['intervalUnit']
): number {
  const SECOND_MS = 1_000;
  const MINUTE_MS = 60 * SECOND_MS;
  const HOUR_MS = 60 * MINUTE_MS;
  const DAY_MS = 24 * HOUR_MS;

  switch (unit) {
    case 'second': {
      const interval = size * SECOND_MS;
      return Math.floor(timestampMs / interval) * interval;
    }
    case 'minute': {
      const interval = size * MINUTE_MS;
      return Math.floor(timestampMs / interval) * interval;
    }
    case 'hour': {
      const interval = size * HOUR_MS;
      return Math.floor(timestampMs / interval) * interval;
    }
    case 'day': {
      const interval = size * DAY_MS;
      return Math.floor(timestampMs / interval) * interval;
    }
    case 'week': {
      const interval = size * 7 * DAY_MS;
      const base = Date.UTC(1970, 0, 5); // Monday, aligns with ClickHouse
      const offset = timestampMs - base;
      const bucketIndex = Math.floor(offset / interval);
      return base + bucketIndex * interval;
    }
    case 'month': {
      const date = new Date(timestampMs);
      const totalMonths = date.getUTCFullYear() * 12 + date.getUTCMonth();
      const bucketMonths = Math.floor(totalMonths / size) * size;
      const year = Math.floor(bucketMonths / 12);
      const month = bucketMonths % 12;
      return Date.UTC(year, month, 1, 0, 0, 0, 0);
    }
    default:
      return timestampMs;
  }
}

function formatClickHouseTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs);
  const pad = (value: number, length: number) => value.toString().padStart(length, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)} ${pad(
    date.getUTCHours(),
    2
  )}:${pad(date.getUTCMinutes(), 2)}:${pad(date.getUTCSeconds(), 2)}.${pad(date.getUTCMilliseconds(), 3)}`;
}

function isTimestampWithinRange(
  row: Record<string, unknown>,
  column: string,
  start: Date,
  end: Date
): boolean {
  const value = toTimestampMs(row[column]);
  if (value === null) {
    return false;
  }
  const startMs = start.getTime();
  const endMs = end.getTime();
  return value >= startMs && value <= endMs;
}

function matchesColumnFilters(
  row: Record<string, unknown>,
  filters: Record<string, ColumnPredicate>
): boolean {
  const entries = Object.entries(filters);
  if (entries.length === 0) {
    return true;
  }
  for (const [column, predicate] of entries) {
    if (!matchesColumnPredicate(row[column], predicate)) {
      return false;
    }
  }
  return true;
}

function matchesColumnPredicate(
  value: unknown,
  predicate: ColumnPredicate
): boolean {
  switch (predicate.type) {
    case 'string':
      return matchesStringPredicate(value, predicate);
    case 'number':
      return matchesNumberPredicate(value, predicate);
    case 'timestamp':
      return matchesTimestampPredicate(value, predicate);
    case 'boolean':
      return matchesBooleanPredicate(value, predicate);
    default:
      return false;
  }
}

function matchesStringPredicate(
  value: unknown,
  predicate: StringPartitionKeyPredicate
): boolean {
  const text = coerceString(value);
  if (text === null) {
    return false;
  }
  if (predicate.eq !== undefined && text !== predicate.eq) {
    return false;
  }
  if (predicate.in && !predicate.in.includes(text)) {
    return false;
  }
  if (predicate.gt !== undefined && text <= predicate.gt) {
    return false;
  }
  if (predicate.gte !== undefined && text < predicate.gte) {
    return false;
  }
  if (predicate.lt !== undefined && text >= predicate.lt) {
    return false;
  }
  if (predicate.lte !== undefined && text > predicate.lte) {
    return false;
  }
  return true;
}

function matchesNumberPredicate(
  value: unknown,
  predicate: NumberPartitionKeyPredicate
): boolean {
  const numeric = coerceNumber(value);
  if (numeric === null) {
    return false;
  }
  if (predicate.eq !== undefined && numeric !== predicate.eq) {
    return false;
  }
  if (predicate.in && !predicate.in.includes(numeric)) {
    return false;
  }
  if (predicate.gt !== undefined && numeric <= predicate.gt) {
    return false;
  }
  if (predicate.gte !== undefined && numeric < predicate.gte) {
    return false;
  }
  if (predicate.lt !== undefined && numeric >= predicate.lt) {
    return false;
  }
  if (predicate.lte !== undefined && numeric > predicate.lte) {
    return false;
  }
  return true;
}

function matchesTimestampPredicate(
  value: unknown,
  predicate: TimestampPartitionKeyPredicate
): boolean {
  const millis = toTimestampMs(value);
  if (millis === null) {
    return false;
  }

  const compare = (input: string | undefined, comparator: (left: number, right: number) => boolean) => {
    if (!input) {
      return true;
    }
    const parsed = Date.parse(input);
    if (Number.isNaN(parsed)) {
      return false;
    }
    return comparator(millis, parsed);
  };

  if (predicate.eq !== undefined && !compare(predicate.eq, (left, right) => left === right)) {
    return false;
  }
  if (predicate.in && !predicate.in.some((candidate) => compare(candidate, (left, right) => left === right))) {
    return false;
  }
  if (!compare(predicate.gt, (left, right) => left > right)) {
    return false;
  }
  if (!compare(predicate.gte, (left, right) => left >= right)) {
    return false;
  }
  if (!compare(predicate.lt, (left, right) => left < right)) {
    return false;
  }
  if (!compare(predicate.lte, (left, right) => left <= right)) {
    return false;
  }
  return true;
}

function matchesBooleanPredicate(
  value: unknown,
  predicate: BooleanColumnPredicate
): boolean {
  const bool = coerceBoolean(value);
  if (bool === null) {
    return false;
  }
  if (predicate.eq !== undefined && bool !== predicate.eq) {
    return false;
  }
  if (predicate.in && !predicate.in.includes(bool)) {
    return false;
  }
  return true;
}

function coerceString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value.toString();
  }
  return null;
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coerceBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return null;
    }
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n'].includes(normalized)) {
      return false;
    }
  }
  return null;
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
    const trimmed = value.trim();
    const clickHousePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
    const candidate = clickHousePattern.test(trimmed) ? `${trimmed.replace(' ', 'T')}Z` : trimmed;
    const parsed = Date.parse(candidate);
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

function resolveDownsampleDimensionColumns(plan: QueryPlan): string[] {
  if (!plan.columns || plan.columns.length === 0) {
    return [];
  }
  const unique: string[] = [];
  for (const column of plan.columns) {
    if (column === plan.timestampColumn) {
      continue;
    }
    if (!unique.includes(column)) {
      unique.push(column);
    }
  }
  return unique;
}

function buildDownsampleSourceColumns(plan: QueryPlan, dimensionColumns: string[]): string[] {
  const columns = new Set<string>();
  columns.add(plan.timestampColumn);
  for (const column of dimensionColumns) {
    columns.add(column);
  }
  for (const aggregation of plan.downsample?.aggregations ?? []) {
    if (aggregation.column) {
      columns.add(aggregation.column);
    }
  }
  return Array.from(columns);
}

function buildDownsampleBucketExpression(plan: QueryPlan): string {
  const downsample = plan.downsample;
  if (!downsample) {
    throw new Error('Downsample plan missing for downsampled query.');
  }
  const timestampIdentifier = quoteClickHouseIdent(plan.timestampColumn);
  return `toStartOfInterval(${timestampIdentifier}, INTERVAL ${downsample.intervalLiteral})`;
}

function deriveColumns(plan: QueryPlan): string[] {
  if (plan.mode === 'downsampled' && plan.downsample) {
    const columns: string[] = [];
    const pushUnique = (value: string) => {
      if (!columns.includes(value)) {
        columns.push(value);
      }
    };
    pushUnique(plan.timestampColumn);
    for (const column of resolveDownsampleDimensionColumns(plan)) {
      pushUnique(column);
    }
    for (const aggregation of plan.downsample.aggregations) {
      pushUnique(aggregation.alias);
    }
    return columns;
  }
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

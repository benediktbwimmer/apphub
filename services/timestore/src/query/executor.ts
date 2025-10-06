import { loadDuckDb, isCloseable } from '@apphub/shared';
import { randomUUID } from 'node:crypto';
import { mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import {
  loadServiceConfig,
  type QueryExecutionBackendConfig,
  type ServiceConfig
} from '../config/serviceConfig';
import type { QueryPlan, QueryPlanPartition } from './planner';
import type { StorageTargetRecord } from '../db/metadata';
import {
  resolveGcsDriverOptions,
  resolveAzureDriverOptions,
  resolveAzureBlobHost,
  type ResolvedGcsOptions,
  type ResolvedAzureOptions
} from '../storage';
import type { FieldDefinition, FieldType } from '../storage';
import type {
  ColumnPredicate,
  BooleanColumnPredicate,
  NumberPartitionKeyPredicate,
  StringPartitionKeyPredicate,
  TimestampPartitionKeyPredicate
} from '../types/partitionFilters';
import { assessPartitionAccessError } from './partitionDiagnostics';
import { queryStreamingHotBuffer, getStreamingHotBufferStatus } from '../streaming/hotBuffer';

interface QueryResultRow {
  [key: string]: unknown;
}

const DEFAULT_MAX_EXPRESSION_DEPTH = 10_000;
const STAGING_SCHEMA = 'staging';
const STAGING_METADATA_TABLE = '__ingestion_batches';
const STAGING_BATCH_ID_COLUMN = '__batch_id';

export async function applyDefaultDuckDbSettings(
  connection: any,
  config: ServiceConfig
): Promise<void> {
  const configuredDepth = config.sql?.maxExpressionDepth ?? DEFAULT_MAX_EXPRESSION_DEPTH;
  const normalizedDepth = Number.isFinite(configuredDepth) && configuredDepth > 0
    ? Math.floor(configuredDepth)
    : DEFAULT_MAX_EXPRESSION_DEPTH;

  if (normalizedDepth <= 0) {
    return;
  }

  await run(connection, `SET max_expression_depth=${normalizedDepth}`);
}

interface S3RuntimeOptions {
  bucket?: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  forcePathStyle?: boolean;
}

export interface QueryExecutionResult {
  rows: QueryResultRow[];
  columns: string[];
  mode: 'raw' | 'downsampled';
  warnings: string[];
  streaming?: QueryStreamingMetadata;
}

export interface QueryStreamingMetadata {
  enabled: boolean;
  bufferState: 'disabled' | 'ready' | 'unavailable';
  rows: number;
  watermark: string | null;
  latestTimestamp: string | null;
  fresh: boolean;
}

export async function executeQueryPlan(plan: QueryPlan): Promise<QueryExecutionResult> {
  const { backend } = plan.execution;
  let baseResult: QueryExecutionResult;
  switch (backend.kind) {
    case 'duckdb_local':
      baseResult = await executeDuckDbPlan(plan);
      break;
    case 'duckdb_cluster':
      baseResult = await executeClusteredDuckDbPlan(plan, backend);
      break;
    default:
      throw new Error(`Unsupported query execution backend: ${backend.kind}`);
  }
  return applyStreamingOverlay(plan, baseResult);
}

async function executeClusteredDuckDbPlan(
  plan: QueryPlan,
  backend: QueryExecutionBackendConfig
): Promise<QueryExecutionResult> {
  const fanout = Math.max(backend.maxPartitionFanout ?? 32, 1);
  if (plan.partitions.length <= fanout || plan.mode === 'downsampled') {
    return executeDuckDbPlan(plan);
  }

  const partitionGroups = chunkPartitions(plan.partitions, fanout);
  const results: QueryExecutionResult[] = new Array(partitionGroups.length);
  const concurrency = Math.max(backend.maxWorkerConcurrency ?? 2, 1);

  let cursor = 0;
  async function processNext(): Promise<void> {
    const groupIndex = cursor++;
    if (groupIndex >= partitionGroups.length) {
      return;
    }
    const group = partitionGroups[groupIndex]!;
    const partialPlan: QueryPlan = {
      ...plan,
      partitions: group
    };
    results[groupIndex] = await executeDuckDbPlan(partialPlan);
    await processNext();
  }

  const workers = Array.from({ length: Math.min(concurrency, partitionGroups.length) }, () => processNext());
  await Promise.all(workers);

  return mergeClusterResults(results, plan);
}

function chunkPartitions(partitions: QueryPlanPartition[], size: number): QueryPlanPartition[][] {
  const groups: QueryPlanPartition[][] = [];
  for (let index = 0; index < partitions.length; index += size) {
    groups.push(partitions.slice(index, index + size));
  }
  return groups;
}

function mergeClusterResults(results: QueryExecutionResult[], plan: QueryPlan): QueryExecutionResult {
  if (results.length === 0) {
    return {
      rows: [],
      columns: deriveColumns(plan, plan.mode),
      mode: plan.mode,
      warnings: []
    };
  }

  if (plan.mode === 'downsampled') {
    return {
      ...results[0],
      warnings: dedupeWarnings(results.flatMap((result) => result.warnings ?? []))
    };
  }

  const timestampColumn = plan.timestampColumn;
  const aggregatedRows = results.flatMap((result) => result.rows);
  aggregatedRows.sort((a, b) => {
    const left = a[timestampColumn];
    const right = b[timestampColumn];
    if (typeof left === 'string' && typeof right === 'string') {
      return left.localeCompare(right);
    }
    return 0;
  });

  const limitedRows = plan.limit ? aggregatedRows.slice(0, plan.limit) : aggregatedRows;
  const columns = results[0]?.columns ?? deriveColumns(plan, 'raw');
  return {
    rows: limitedRows,
    columns,
    mode: 'raw',
    warnings: dedupeWarnings(results.flatMap((result) => result.warnings ?? []))
  } satisfies QueryExecutionResult;
}

function applyStreamingOverlay(plan: QueryPlan, baseResult: QueryExecutionResult): QueryExecutionResult {
  const config = loadServiceConfig();
  const streamingEnabled = config.features.streaming.enabled && config.streaming.hotBuffer.enabled;
  const status = getStreamingHotBufferStatus();
  const warnings = [...baseResult.warnings];

  const streamingMetadata: QueryStreamingMetadata = {
    enabled: streamingEnabled,
    bufferState: streamingEnabled ? status.state : 'disabled',
    rows: 0,
    watermark: null,
    latestTimestamp: null,
    fresh: streamingEnabled ? status.state === 'ready' : true
  } satisfies QueryStreamingMetadata;

  if (!streamingEnabled || status.state === 'disabled' || plan.mode !== 'raw') {
    return {
      ...baseResult,
      warnings: dedupeWarnings(warnings),
      streaming: streamingMetadata
    } satisfies QueryExecutionResult;
  }

  const hotBufferResult = queryStreamingHotBuffer(plan.datasetSlug, {
    rangeStart: plan.rangeStart,
    rangeEnd: plan.rangeEnd,
    limit: plan.limit,
    timestampColumn: plan.timestampColumn
  });

  if (hotBufferResult.bufferState === 'unavailable') {
    if (config.streaming.hotBuffer.fallbackMode === 'error') {
      throw new Error('Streaming hot buffer is unavailable and fallback mode is set to error.');
    }
    warnings.push('Streaming hot buffer unavailable; served Parquet partitions only.');
    return {
      ...baseResult,
      warnings: dedupeWarnings(warnings),
      streaming: {
        ...streamingMetadata,
        bufferState: 'unavailable',
        fresh: false
      }
    } satisfies QueryExecutionResult;
  }

  const streamingRows = hotBufferResult.rows ?? [];
  if (streamingRows.length === 0) {
    return {
      ...baseResult,
      warnings: dedupeWarnings(warnings),
      streaming: {
        ...streamingMetadata,
        bufferState: hotBufferResult.bufferState,
        watermark: hotBufferResult.watermark,
        latestTimestamp: hotBufferResult.latestTimestamp,
        fresh: determineFreshness(hotBufferResult.latestTimestamp, plan.rangeEnd)
      }
    } satisfies QueryExecutionResult;
  }

  const baseRows = [...baseResult.rows];
  const combinedRows = [...baseRows, ...streamingRows];
  const streamingRowSet = new Set(streamingRows);
  combinedRows.sort((a, b) => compareRowsByTimestamp(a, b, plan.timestampColumn));

  let limitedRows = combinedRows;
  if (plan.limit && plan.limit > 0 && combinedRows.length > plan.limit) {
    limitedRows = combinedRows.slice(0, plan.limit);
  }

  const streamingIncluded = limitedRows.reduce(
    (count, row) => (streamingRowSet.has(row) ? count + 1 : count),
    0
  );
  const unifiedColumns = mergeColumns(baseResult.columns, limitedRows);

  return {
    ...baseResult,
    rows: limitedRows,
    columns: unifiedColumns,
    warnings: dedupeWarnings(warnings),
    streaming: {
      enabled: true,
      bufferState: hotBufferResult.bufferState,
      rows: streamingIncluded,
      watermark: hotBufferResult.watermark,
      latestTimestamp: hotBufferResult.latestTimestamp,
      fresh: determineFreshness(hotBufferResult.latestTimestamp, plan.rangeEnd)
    }
  } satisfies QueryExecutionResult;
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

async function executeDuckDbPlan(plan: QueryPlan): Promise<QueryExecutionResult> {
  const duckdb = loadDuckDb();
  const db = new duckdb.Database(':memory:');
  const connection = db.connect();
  const config = loadServiceConfig();
  const warnings: string[] = [];

  try {
    await applyDefaultDuckDbSettings(connection, config);
    await prepareConnectionForPlan(connection, plan, config);
    const canonicalFields = resolveCanonicalFields(plan);
    const viewWarnings = await createDatasetView(connection, plan, canonicalFields);
    warnings.push(...viewWarnings);
    let baseViewSource = 'dataset_view';
    const stagingIntegration = await integratePendingStaging(connection, plan, canonicalFields, config);
    if (stagingIntegration) {
      if (stagingIntegration.replacedEmptyView) {
        const warningToRemove = `No readable partitions found for dataset ${plan.datasetSlug}; returning empty result.`;
        const index = warnings.indexOf(warningToRemove);
        if (index >= 0) {
          warnings.splice(index, 1);
        }
      }
      warnings.push(...stagingIntegration.warnings);
      baseViewSource = stagingIntegration.baseViewName;
    }

    const baseViewName = await applyColumnFilters(connection, plan, baseViewSource);

    const { preparatoryQueries, selectSql, mode } = buildFinalQuery(plan, baseViewName);
    for (const query of preparatoryQueries) {
      await run(connection, query);
    }

    const rows = normalizeRows(await all(connection, selectSql));
    const columns = rows.length > 0 ? Object.keys(rows[0] ?? {}) : deriveColumns(plan, mode);

    return {
      rows,
      columns,
      mode,
      warnings: dedupeWarnings(warnings)
    };
  } finally {
    await closeConnection(connection);
    if (isCloseable(db)) {
      db.close();
    }
  }
}

async function prepareConnectionForPlan(
  connection: any,
  plan: QueryPlan,
  config: ServiceConfig
): Promise<void> {
  let hasS3 = false;
  const s3Targets = new Map<string, StorageTargetRecord>();
  const gcsTargets = new Map<string, { target: StorageTargetRecord; options: ResolvedGcsOptions }>();
  const azureTargets = new Map<string, { target: StorageTargetRecord; options: ResolvedAzureOptions }>();

  for (const partition of plan.partitions) {
    const target = partition.storageTarget;
    switch (target.kind) {
      case 's3':
        hasS3 = true;
        if (!s3Targets.has(target.id)) {
          s3Targets.set(target.id, target);
        }
        break;
      case 'gcs':
        if (!gcsTargets.has(target.id)) {
          gcsTargets.set(target.id, {
            target,
            options: resolveGcsDriverOptions(config, target)
          });
        }
        break;
      case 'azure_blob':
        if (!azureTargets.has(target.id)) {
          azureTargets.set(target.id, {
            target,
            options: resolveAzureDriverOptions(config, target)
          });
        }
        break;
      default:
        break;
    }
  }

  if (hasS3) {
    await configureS3Support(connection, config, Array.from(s3Targets.values()));
  }
  if (gcsTargets.size > 0) {
    await configureGcsSupport(connection, Array.from(gcsTargets.values()));
  }
  if (azureTargets.size > 0) {
    await configureAzureSupport(connection, Array.from(azureTargets.values()));
  }
}

async function createDatasetView(
  connection: any,
  plan: QueryPlan,
  canonicalFields: FieldDefinition[]
): Promise<string[]> {
  const warnings: string[] = [];
  const selects: string[] = [];

  for (const partition of plan.partitions) {
    try {
      const availableColumns = await fetchPartitionColumns(connection, partition);
      const escapedPath = partition.location.replace(/'/g, "''");
      try {
        await all(connection, `SELECT 1 FROM read_parquet('${escapedPath}') LIMIT 1`);
      } catch (error) {
        const assessment = assessPartitionAccessError(
          {
            datasetSlug: plan.datasetSlug,
            partitionId: partition.id,
            storageTarget: partition.storageTarget,
            location: partition.location,
            startTime: partition.startTime,
            endTime: partition.endTime
          },
          error
        );
        if (assessment.recoverable) {
          if (assessment.warning) {
            warnings.push(assessment.warning);
          }
          continue;
        }
        throw assessment.error;
      }
      selects.push(buildPartitionSelect(partition, plan, canonicalFields, availableColumns));
    } catch (error) {
      const assessment = assessPartitionAccessError(
        {
          datasetSlug: plan.datasetSlug,
          partitionId: partition.id,
          storageTarget: partition.storageTarget,
          location: partition.location,
          startTime: partition.startTime,
          endTime: partition.endTime
        },
        error
      );
      if (assessment.recoverable) {
        if (assessment.warning) {
          warnings.push(assessment.warning);
        }
        continue;
      }
      throw assessment.error;
    }
  }

  if (selects.length === 0) {
    await createEmptyDatasetView(connection, plan, canonicalFields);
    warnings.push(`No readable partitions found for dataset ${plan.datasetSlug}; returning empty result.`);
    return warnings;
  }

  const unionSql = selects.join('\nUNION ALL\n');
  await run(connection, `CREATE TEMP VIEW dataset_view AS ${unionSql}`);
  return warnings;
}

async function createEmptyDatasetView(
  connection: any,
  plan: QueryPlan,
  canonicalFields: FieldDefinition[]
): Promise<void> {
  const fallbackField: FieldDefinition = { name: plan.timestampColumn, type: 'timestamp' };
  const effectiveFields = canonicalFields.length > 0 ? canonicalFields : [fallbackField];
  const projections = effectiveFields
    .map((field) => `CAST(NULL AS ${mapFieldTypeToDuckDb(field.type)}) AS ${quoteIdentifier(field.name)}`)
    .join(', ');
  await run(connection, `CREATE TEMP VIEW dataset_view AS SELECT ${projections} WHERE 1=0`);
}

async function fetchPartitionColumns(
  connection: any,
  partition: QueryPlanPartition
): Promise<Set<string>> {
  const escapedPath = partition.location.replace(/'/g, "''");
  const rows = await all(
    connection,
    `DESCRIBE SELECT * FROM read_parquet('${escapedPath}')`
  );
  return extractColumnNames(rows as QueryResultRow[]);
}

function resolveCanonicalFields(plan: QueryPlan): FieldDefinition[] {
  if (plan.schemaFields.length > 0) {
    return plan.schemaFields;
  }
  return [];
}

function buildPartitionSelect(
  partition: QueryPlanPartition,
  plan: QueryPlan,
  canonicalFields: FieldDefinition[],
  availableColumns: Set<string>
): string {
  const escapedPath = partition.location.replace(/'/g, "''");
  const source = `read_parquet('${escapedPath}')`;
  const timestampColumn = quoteIdentifier(plan.timestampColumn);
  const startLiteral = plan.rangeStart.toISOString().replace(/'/g, "''");
  const endLiteral = plan.rangeEnd.toISOString().replace(/'/g, "''");

  const projections = buildCanonicalProjections(canonicalFields, availableColumns);

  const whereClause = `${timestampColumn} BETWEEN TIMESTAMP '${startLiteral}' AND TIMESTAMP '${endLiteral}'`;

  return `SELECT ${projections} FROM ${source} WHERE ${whereClause}`;
}

function mapFieldTypeToDuckDb(type: FieldType): string {
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

async function applyColumnFilters(connection: any, plan: QueryPlan, baseView: string): Promise<string> {
  if (!plan.columnFilters || Object.keys(plan.columnFilters).length === 0) {
    return baseView;
  }
  const clause = buildColumnFilterClause(plan.columnFilters);
  if (!clause) {
    return baseView;
  }
  await run(
    connection,
    `CREATE TEMP VIEW dataset_filtered AS
       SELECT *
         FROM ${baseView}
        WHERE ${clause}`
  );
  return 'dataset_filtered';
}

function buildColumnFilterClause(columnFilters: Record<string, ColumnPredicate>): string {
  const expressions: string[] = [];
  for (const [column, predicate] of Object.entries(columnFilters)) {
    const expression = columnPredicateToSql(column, predicate);
    if (expression) {
      expressions.push(expression);
    }
  }
  return expressions.length > 0 ? expressions.join(' AND ') : '1 = 1';
}

function columnPredicateToSql(column: string, predicate: ColumnPredicate): string | null {
  const identifier = quoteIdentifier(column);
  switch (predicate.type) {
    case 'string':
      return buildStringPredicateSql(identifier, predicate);
    case 'number':
      return buildNumberPredicateSql(identifier, predicate);
    case 'timestamp':
      return buildTimestampPredicateSql(identifier, predicate);
    case 'boolean':
      return buildBooleanPredicateSql(identifier, predicate);
    default:
      return null;
  }
}

function buildStringPredicateSql(identifier: string, predicate: StringPartitionKeyPredicate): string | null {
  const clauses: string[] = [];
  if (typeof predicate.eq === 'string') {
    clauses.push(`${identifier} = ${toSqlLiteral('string', predicate.eq)}`);
  }
  if (Array.isArray(predicate.in) && predicate.in.length > 0) {
    const values = predicate.in.map((value) => toSqlLiteral('string', value));
    clauses.push(`${identifier} IN (${values.join(', ')})`);
  }
  if (typeof predicate.gt === 'string') {
    clauses.push(`${identifier} > ${toSqlLiteral('string', predicate.gt)}`);
  }
  if (typeof predicate.gte === 'string') {
    clauses.push(`${identifier} >= ${toSqlLiteral('string', predicate.gte)}`);
  }
  if (typeof predicate.lt === 'string') {
    clauses.push(`${identifier} < ${toSqlLiteral('string', predicate.lt)}`);
  }
  if (typeof predicate.lte === 'string') {
    clauses.push(`${identifier} <= ${toSqlLiteral('string', predicate.lte)}`);
  }
  return clauses.length > 0 ? clauses.join(' AND ') : null;
}

function buildNumberPredicateSql(identifier: string, predicate: NumberPartitionKeyPredicate): string | null {
  const clauses: string[] = [];
  if (predicate.eq !== undefined) {
    clauses.push(`${identifier} = ${toSqlLiteral('number', predicate.eq)}`);
  }
  if (Array.isArray(predicate.in) && predicate.in.length > 0) {
    const values = predicate.in.map((value) => toSqlLiteral('number', value));
    clauses.push(`${identifier} IN (${values.join(', ')})`);
  }
  if (predicate.gt !== undefined) {
    clauses.push(`${identifier} > ${toSqlLiteral('number', predicate.gt)}`);
  }
  if (predicate.gte !== undefined) {
    clauses.push(`${identifier} >= ${toSqlLiteral('number', predicate.gte)}`);
  }
  if (predicate.lt !== undefined) {
    clauses.push(`${identifier} < ${toSqlLiteral('number', predicate.lt)}`);
  }
  if (predicate.lte !== undefined) {
    clauses.push(`${identifier} <= ${toSqlLiteral('number', predicate.lte)}`);
  }
  return clauses.length > 0 ? clauses.join(' AND ') : null;
}

function buildTimestampPredicateSql(identifier: string, predicate: TimestampPartitionKeyPredicate): string | null {
  const clauses: string[] = [];
  if (typeof predicate.eq === 'string') {
    clauses.push(`${identifier} = ${toSqlLiteral('timestamp', predicate.eq)}`);
  }
  if (Array.isArray(predicate.in) && predicate.in.length > 0) {
    const values = predicate.in.map((value) => toSqlLiteral('timestamp', value));
    clauses.push(`${identifier} IN (${values.join(', ')})`);
  }
  if (typeof predicate.gt === 'string') {
    clauses.push(`${identifier} > ${toSqlLiteral('timestamp', predicate.gt)}`);
  }
  if (typeof predicate.gte === 'string') {
    clauses.push(`${identifier} >= ${toSqlLiteral('timestamp', predicate.gte)}`);
  }
  if (typeof predicate.lt === 'string') {
    clauses.push(`${identifier} < ${toSqlLiteral('timestamp', predicate.lt)}`);
  }
  if (typeof predicate.lte === 'string') {
    clauses.push(`${identifier} <= ${toSqlLiteral('timestamp', predicate.lte)}`);
  }
  return clauses.length > 0 ? clauses.join(' AND ') : null;
}

function buildBooleanPredicateSql(identifier: string, predicate: BooleanColumnPredicate): string | null {
  const clauses: string[] = [];
  if (predicate.eq !== undefined) {
    clauses.push(`${identifier} = ${toSqlLiteral('boolean', predicate.eq)}`);
  }
  if (Array.isArray(predicate.in) && predicate.in.length > 0) {
    const values = predicate.in.map((value) => toSqlLiteral('boolean', value));
    clauses.push(`${identifier} IN (${values.join(', ')})`);
  }
  return clauses.length > 0 ? clauses.join(' AND ') : null;
}

function toSqlLiteral(type: ColumnPredicate['type'], value: unknown): string {
  switch (type) {
    case 'string':
      return `'${escapeSqlString(String(value))}'`;
    case 'number':
      return String(value);
    case 'timestamp': {
      const parsed = Date.parse(String(value));
      const normalized = Number.isNaN(parsed) ? String(value) : new Date(parsed).toISOString();
      return `TIMESTAMP '${escapeSqlString(normalized)}'`;
    }
    case 'boolean':
      return value ? 'TRUE' : 'FALSE';
    default:
      return `'${escapeSqlString(String(value))}'`;
  }
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function buildFinalQuery(
  plan: QueryPlan,
  baseView: string
): {
  preparatoryQueries: string[];
  selectSql: string;
  mode: 'raw' | 'downsampled';
} {
  if (plan.downsample) {
    const timestampColumn = quoteIdentifier(plan.timestampColumn);
    const windowExpression = buildWindowExpression(plan.downsample.intervalLiteral, timestampColumn);
    const aggregations = plan.downsample.aggregations
      .map((aggregation) => `${aggregation.expression} AS ${quoteIdentifier(aggregation.alias)}`)
      .join(', ');

    const limitClause = plan.limit ? ` LIMIT ${plan.limit}` : '';

    return {
      mode: 'downsampled',
      preparatoryQueries: [
        `CREATE TEMP VIEW dataset_windowed AS
           SELECT *, ${windowExpression} AS window_start
             FROM ${baseView}`
      ],
      selectSql: `SELECT window_start AS ${timestampColumn}${aggregations ? `, ${aggregations}` : ''}
                  FROM dataset_windowed
                  GROUP BY window_start
                  ORDER BY window_start${limitClause}`
    };
  }

  const selectColumns = buildSelectList(plan);
  const timestampColumn = quoteIdentifier(plan.timestampColumn);
  const limitClause = plan.limit ? ` LIMIT ${plan.limit}` : '';

  return {
    mode: 'raw',
    preparatoryQueries: [],
    selectSql: `SELECT ${selectColumns}
                FROM ${baseView}
                ORDER BY ${timestampColumn} ASC${limitClause}`
  };
}

function buildWindowExpression(intervalLiteral: string, timestampColumn: string): string {
  const lower = intervalLiteral.toLowerCase();
  if (lower.startsWith('1 ')) {
    const unit = lower.split(' ')[1] ?? 'minute';
    return `DATE_TRUNC('${unit}', ${timestampColumn})`;
  }
  return `DATE_BIN(INTERVAL '${intervalLiteral}', ${timestampColumn}, TIMESTAMP '1970-01-01 00:00:00')`;
}

function deriveColumns(plan: QueryPlan, mode: 'raw' | 'downsampled'): string[] {
  if (mode === 'downsampled' && plan.downsample) {
    const timestampColumn = plan.timestampColumn;
    const aggregations = plan.downsample.aggregations.map((aggregation) => aggregation.alias);
    return [timestampColumn, ...aggregations];
  }
  if (plan.columns && plan.columns.length > 0) {
    return [...plan.columns];
  }
  if (plan.schemaFields.length > 0) {
    return plan.schemaFields.map((field) => field.name);
  }
  return [plan.timestampColumn];
}

function buildSelectList(plan: QueryPlan): string {
  if (plan.columns && plan.columns.length > 0) {
    return plan.columns.map(quoteIdentifier).join(', ');
  }
  if (plan.schemaFields.length > 0) {
    return plan.schemaFields.map((field) => quoteIdentifier(field.name)).join(', ');
  }
  return '*';
}

async function integratePendingStaging(
  connection: any,
  plan: QueryPlan,
  canonicalFields: FieldDefinition[],
  config: ServiceConfig
): Promise<{ baseViewName: string; warnings: string[]; replacedEmptyView: boolean } | null> {
  const stagingDirectory = config.staging?.directory;
  if (!stagingDirectory) {
    return null;
  }

  await run(connection, 'DROP VIEW IF EXISTS dataset_with_staging').catch(() => undefined);
  await run(connection, 'DROP VIEW IF EXISTS staging_dataset_view').catch(() => undefined);
  await run(connection, 'DROP TABLE IF EXISTS staging_dataset_rows').catch(() => undefined);

  const databasePath = path.join(stagingDirectory, sanitizeDatasetSlug(plan.datasetSlug), 'staging.duckdb');
  try {
    await access(databasePath);
  } catch {
    return null;
  }

  const alias = `staging_${randomUUID().replace(/-/g, '_')}`;
  const escapedPath = databasePath.replace(/'/g, "''");
  let stagingTableCreated = false;
  let pendingRowCount = 0;

  try {
    await run(connection, `ATTACH '${escapedPath}' AS ${quoteIdentifier(alias)} (READ_ONLY)`);
  } catch (error) {
    console.warn(`[timestore] failed to attach staging database for dataset ${plan.datasetSlug}`, error);
    return null;
  }

  const metadataTableRef = `${quoteIdentifier(alias)}.${quoteIdentifier(STAGING_SCHEMA)}.${quoteIdentifier(STAGING_METADATA_TABLE)}`;
  try {
    const pendingTables = await all(
      connection,
      `SELECT DISTINCT table_name FROM ${metadataTableRef} WHERE flush_token IS NULL`
    );

    if (pendingTables.length === 0) {
      return null;
    }

    const stagingSelects: string[] = [];
    for (let index = 0; index < pendingTables.length; index += 1) {
      const tableNameValue = pendingTables[index]?.table_name;
      if (typeof tableNameValue !== 'string' || tableNameValue.trim().length === 0) {
        continue;
      }
      const tableName = tableNameValue.trim();
      const tableRef = `${quoteIdentifier(alias)}.${quoteIdentifier(STAGING_SCHEMA)}.${quoteIdentifier(tableName)}`;

      const overlapRows = await all(
        connection,
        `SELECT 1
           FROM ${metadataTableRef}
          WHERE flush_token IS NULL
            AND table_name = ?
            AND time_range_start <= ?
            AND time_range_end >= ?
          LIMIT 1`,
        tableName,
        plan.rangeEnd,
        plan.rangeStart
      );

      if (overlapRows.length === 0) {
        continue;
      }

      const availableColumns = await fetchTableColumns(connection, tableRef);
      const tableAlias = `stg${index}`;
      const selectSql = buildStagingSelect({
        tableRef,
        tableAlias,
        metadataTableRef,
        tableName,
        plan,
        canonicalFields,
        availableColumns
      });
      stagingSelects.push(selectSql);
    }

    if (stagingSelects.length === 0) {
      return null;
    }

    const unionSql = stagingSelects.join('\nUNION ALL\n');
    await run(connection, 'DROP TABLE IF EXISTS staging_dataset_rows');
    await run(connection, `CREATE TEMP TABLE staging_dataset_rows AS ${unionSql}`);
    stagingTableCreated = true;

    const rowCountRows = await all(
      connection,
      `SELECT COALESCE(SUM(row_count), 0)::BIGINT AS row_count
         FROM ${metadataTableRef}
        WHERE flush_token IS NULL
          AND time_range_start <= ?
          AND time_range_end >= ?`,
      plan.rangeEnd,
      plan.rangeStart
    );
    pendingRowCount = Number(rowCountRows[0]?.row_count ?? 0n);
  } finally {
    await run(connection, `DETACH ${quoteIdentifier(alias)}`).catch(() => undefined);
  }

  if (!stagingTableCreated) {
    await run(connection, 'DROP TABLE IF EXISTS staging_dataset_rows').catch(() => undefined);
    return null;
  }

  let baseViewName = 'dataset_with_staging';
  const replacedEmptyView = plan.partitions.length === 0;

  if (replacedEmptyView) {
    await run(connection, 'DROP VIEW IF EXISTS dataset_view');
    await run(connection, 'CREATE TEMP VIEW dataset_view AS SELECT * FROM staging_dataset_rows');
    baseViewName = 'dataset_view';
  } else {
    await run(
      connection,
      'CREATE TEMP VIEW dataset_with_staging AS SELECT * FROM dataset_view UNION ALL SELECT * FROM staging_dataset_rows'
    );
  }

  const warnings: string[] = pendingRowCount > 0
    ? [`Included ${pendingRowCount} staged row(s) pending flush for dataset ${plan.datasetSlug}.`]
    : [];

  return {
    baseViewName,
    warnings,
    replacedEmptyView
  };
}

interface BuildStagingSelectInput {
  tableRef: string;
  tableAlias: string;
  metadataTableRef: string;
  tableName: string;
  plan: QueryPlan;
  canonicalFields: FieldDefinition[];
  availableColumns: Set<string>;
}

function buildStagingSelect(input: BuildStagingSelectInput): string {
  const { tableRef, tableAlias, metadataTableRef, tableName, plan, canonicalFields, availableColumns } = input;
  const projections = buildCanonicalProjections(canonicalFields, availableColumns, tableAlias);
  const startLiteral = escapeSqlLiteral(plan.rangeStart.toISOString());
  const endLiteral = escapeSqlLiteral(plan.rangeEnd.toISOString());
  const timestampColumn = `${tableAlias}.${quoteIdentifier(plan.timestampColumn)}`;
  const escapedTableName = escapeSqlLiteral(tableName);

  const whereParts = [
    'b.flush_token IS NULL',
    `b.table_name = '${escapedTableName}'`,
    `b.time_range_start <= TIMESTAMP '${endLiteral}'`,
    `b.time_range_end >= TIMESTAMP '${startLiteral}'`,
    `${timestampColumn} BETWEEN TIMESTAMP '${startLiteral}' AND TIMESTAMP '${endLiteral}'`
  ];

  return `SELECT ${projections}
          FROM ${tableRef} AS ${tableAlias}
          JOIN ${metadataTableRef} AS b
            ON ${tableAlias}.${quoteIdentifier(STAGING_BATCH_ID_COLUMN)} = b.batch_id
         WHERE ${whereParts.join(' AND ')}`;
}

async function fetchTableColumns(connection: any, tableRef: string): Promise<Set<string>> {
  try {
    const rows = await all(connection, `DESCRIBE SELECT * FROM ${tableRef}`);
    return extractColumnNames(rows as QueryResultRow[]);
  } catch {
    return new Set<string>();
  }
}

function buildCanonicalProjections(
  canonicalFields: FieldDefinition[],
  availableColumns: Set<string>,
  tableAlias?: string
): string {
  if (canonicalFields.length === 0) {
    return tableAlias ? `${tableAlias}.*` : '*';
  }
  return canonicalFields
    .map((field) => {
      const identifier = quoteIdentifier(field.name);
      if (availableColumns.has(field.name)) {
        return tableAlias ? `${tableAlias}.${identifier}` : identifier;
      }
      const duckType = mapFieldTypeToDuckDb(field.type);
      return `NULL::${duckType} AS ${identifier}`;
    })
    .join(', ');
}

function extractColumnNames(rows: QueryResultRow[]): Set<string> {
  return new Set(
    rows
      .map((row) => {
        const value =
          typeof row.column_name === 'string'
            ? row.column_name
            : typeof row.column === 'string'
              ? row.column
              : typeof row.name === 'string'
                ? row.name
                : null;
        return value as string | null;
      })
      .filter((value): value is string => Boolean(value))
  );
}

function sanitizeDatasetSlug(datasetSlug: string): string {
  const trimmed = datasetSlug.trim();
  if (trimmed.length === 0) {
    throw new Error('datasetSlug must not be empty');
  }
  const normalized = trimmed.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return normalized.length > 0 ? normalized : 'dataset';
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

function all(connection: any, sql: string, ...params: unknown[]): Promise<QueryResultRow[]> {
  return new Promise((resolve, reject) => {
    connection.all(sql, ...params, (err: Error | null, rows?: QueryResultRow[]) => {
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

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function normalizeRows(rows: QueryResultRow[]): QueryResultRow[] {
  return rows.map((row) => {
    const normalized: QueryResultRow = {};
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
    return (value as Buffer).toString('base64');
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
  if ('toISOString' in value && typeof (value as { toISOString?: unknown }).toISOString === 'function') {
    try {
      const iso = (value as { toISOString: () => unknown }).toISOString();
      if (typeof iso === 'string' && !Number.isNaN(Date.parse(iso))) {
        return iso;
      }
    } catch {
      return null;
    }
  }
  if ('toJSON' in value && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
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
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export async function configureS3Support(
  connection: any,
  config: ServiceConfig,
  targets: StorageTargetRecord[] = []
): Promise<void> {
  const options = resolveS3RuntimeOptions(config, targets);
  if (!options.bucket) {
    throw new Error('Remote partitions require S3 configuration but none was provided');
  }

  await ensureHttpfsLoaded(connection);

  if (options.region) {
    await run(connection, `SET s3_region='${escapeSqlLiteral(options.region)}'`);
  }

  const { host, scheme } = resolveS3Endpoint(options.endpoint);

  await run(connection, `SET s3_endpoint='${escapeSqlLiteral(host)}'`);
  if (scheme === 'https') {
    await run(connection, 'SET s3_use_ssl=true');
  } else {
    await run(connection, 'SET s3_use_ssl=false');
  }

  const forcePath = options.forcePathStyle ?? (host.includes(':') || host.includes('127.0.0.1'));
  if (forcePath) {
    await run(connection, `SET s3_url_style='path'`);
  }
  if (options.accessKeyId && options.secretAccessKey) {
    await run(connection, `SET s3_access_key_id='${escapeSqlLiteral(options.accessKeyId)}'`);
    await run(connection, `SET s3_secret_access_key='${escapeSqlLiteral(options.secretAccessKey)}'`);
  }
  if (options.sessionToken) {
    await run(connection, `SET s3_session_token='${escapeSqlLiteral(options.sessionToken)}'`);
  }

  const cacheConfig = config.query.cache;
  if (cacheConfig.enabled) {
    await mkdir(cacheConfig.directory, { recursive: true });
    try {
      await run(connection, `SET s3_cache_directory='${escapeSqlLiteral(cacheConfig.directory)}'`);
      await run(connection, `SET s3_cache_size='${String(cacheConfig.maxBytes)}'`);
    } catch (error) {
      if (isUnrecognizedConfigParameterError(error, 's3_cache_directory')) {
        cacheConfig.enabled = false;
        console.warn(
          '[timestore] DuckDB does not recognize s3_cache_directory; skipping query cache setup',
          error
        );
      } else {
        throw error;
      }
    }
  }
}

function resolveS3RuntimeOptions(
  config: ServiceConfig,
  targets: StorageTargetRecord[]
): S3RuntimeOptions {
  const base = config.storage.s3;

  let bucket = base?.bucket;
  let endpoint = base?.endpoint;
  let region = base?.region;
  let accessKeyId = base?.accessKeyId;
  let secretAccessKey = base?.secretAccessKey;
  let sessionToken = base?.sessionToken;
  let forcePathStyle = base?.forcePathStyle;

  for (const target of targets) {
    if (target.kind !== 's3') {
      continue;
    }
    const targetConfig = target.config as Record<string, unknown>;

    if (!bucket) {
      const candidate = pickString(targetConfig, 'bucket');
      if (candidate) {
        bucket = candidate;
      }
    }
    if (!endpoint) {
      const candidate = pickString(targetConfig, 'endpoint');
      if (candidate) {
        endpoint = candidate;
      }
    }
    if (!region) {
      const candidate = pickString(targetConfig, 'region');
      if (candidate) {
        region = candidate;
      }
    }
    if (!accessKeyId) {
      const candidate = pickString(targetConfig, 'accessKeyId');
      if (candidate) {
        accessKeyId = candidate;
      }
    }
    if (!secretAccessKey) {
      const candidate = pickString(targetConfig, 'secretAccessKey');
      if (candidate) {
        secretAccessKey = candidate;
      }
    }
    if (!sessionToken) {
      const candidate = pickString(targetConfig, 'sessionToken');
      if (candidate) {
        sessionToken = candidate;
      }
    }
    if (forcePathStyle === undefined) {
      const candidate = pickBoolean(targetConfig, 'forcePathStyle');
      if (candidate !== undefined) {
        forcePathStyle = candidate;
      }
    }
  }

  return {
    bucket,
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    forcePathStyle
  } satisfies S3RuntimeOptions;
}

function pickString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return undefined;
}

function pickBoolean(source: Record<string, unknown>, key: string): boolean | undefined {
  const value = source[key];
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function resolveS3Endpoint(rawEndpoint: string | undefined): { host: string; scheme: 'http' | 'https' } {
  const fallback = 'http://127.0.0.1:9000'; // TODO(apphub-2367): remove hard-coded MinIO fallback when runtime cache propagation is fixed.
  const endpoint = rawEndpoint && rawEndpoint.trim().length > 0 ? rawEndpoint.trim() : fallback;

  try {
    const parsed = new URL(endpoint.includes('://') ? endpoint : `${fallback.substring(0, fallback.indexOf('://'))}://${endpoint}`);
    const scheme = parsed.protocol === 'https:' ? 'https' : 'http';
    const host = parsed.host || parsed.hostname;
    return { host, scheme };
  } catch {
    const sanitized = endpoint.replace(/\/+$/u, '');
    return { host: sanitized, scheme: endpoint.startsWith('https://') ? 'https' : 'http' };
  }
}

async function ensureHttpfsLoaded(connection: any): Promise<void> {
  await run(connection, 'INSTALL httpfs');
  await run(connection, 'LOAD httpfs');
}

function isUnrecognizedConfigParameterError(error: unknown, parameter: string): boolean {
  if (!error) {
    return false;
  }
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes(`unrecognized configuration parameter "${parameter.toLowerCase()}"`) ||
    normalized.includes(`unrecognized configuration parameter '${parameter.toLowerCase()}'`)
  );
}

export async function configureGcsSupport(
  connection: any,
  targets: Array<{ target: StorageTargetRecord; options: ResolvedGcsOptions }>
): Promise<void> {
  if (targets.length === 0) {
    return;
  }

  await ensureHttpfsLoaded(connection);

  for (const { target, options } of targets) {
    if (!options.hmacKeyId || !options.hmacSecret) {
      throw new Error(`GCS storage target ${target.name} missing hmac credentials for DuckDB access`);
    }

    const secretName = buildSecretName('gcs', target.id);
    await run(connection, `DROP SECRET IF EXISTS ${quoteIdentifier(secretName)}`);
    const scope = `gs://${options.bucket}/`;
    const createSecretSql = `CREATE SECRET ${quoteIdentifier(secretName)} (
      TYPE gcs,
      KEY_ID '${escapeSqlLiteral(options.hmacKeyId)}',
      SECRET '${escapeSqlLiteral(options.hmacSecret)}',
      SCOPE '${escapeSqlLiteral(scope)}'
    )`;
    await run(connection, createSecretSql);
  }
}

export async function configureAzureSupport(
  connection: any,
  targets: Array<{ target: StorageTargetRecord; options: ResolvedAzureOptions }>
): Promise<void> {
  if (targets.length === 0) {
    return;
  }

  await run(connection, 'INSTALL azure');
  await run(connection, 'LOAD azure');

  for (const { target, options } of targets) {
    const secretName = buildSecretName('azure', target.id);
    await run(connection, `DROP SECRET IF EXISTS ${quoteIdentifier(secretName)}`);

    const host = resolveAzureBlobHost(options);
    const scopePath = `azure://${host}/${options.container}/`;

    if (options.connectionString) {
      const createSecretSql = `CREATE SECRET ${quoteIdentifier(secretName)} (
        TYPE azure,
        CONNECTION_STRING '${escapeSqlLiteral(options.connectionString)}',
        SCOPE '${escapeSqlLiteral(scopePath)}'
      )`;
      await run(connection, createSecretSql);
      continue;
    }

    throw new Error(`Azure storage target ${target.name} requires a connection string for DuckDB access`);
  }
}

function buildSecretName(prefix: string, targetId: string): string {
  const normalized = targetId.replace(/[^a-zA-Z0-9]+/g, '_');
  return `timestore_${prefix}_${normalized}`;
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

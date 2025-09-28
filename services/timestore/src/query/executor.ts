import { loadDuckDb, isCloseable } from '@apphub/shared';
import { mkdir } from 'node:fs/promises';
import { loadServiceConfig, type ServiceConfig } from '../config/serviceConfig';
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

interface QueryResultRow {
  [key: string]: unknown;
}

export interface QueryExecutionResult {
  rows: QueryResultRow[];
  columns: string[];
  mode: 'raw' | 'downsampled';
}

export async function executeQueryPlan(plan: QueryPlan): Promise<QueryExecutionResult> {
  const duckdb = loadDuckDb();
  const db = new duckdb.Database(':memory:');
  const connection = db.connect();
  const config = loadServiceConfig();

  try {
    if (plan.partitions.length === 0) {
      const columns = deriveColumns(plan, plan.mode);
      return {
        rows: [],
        columns,
        mode: plan.mode
      };
    }

    await prepareConnectionForPlan(connection, plan, config);
    const partitionColumns = await attachPartitions(connection, plan);
    await createDatasetView(connection, plan, partitionColumns);
    const baseViewName = await applyColumnFilters(connection, plan);

    const { preparatoryQueries, selectSql, mode } = buildFinalQuery(plan, baseViewName);
    for (const query of preparatoryQueries) {
      await run(connection, query);
    }

    const rows = normalizeRows(await all(connection, selectSql));
    const columns = rows.length > 0 ? Object.keys(rows[0] ?? {}) : deriveColumns(plan, mode);

    return {
      rows,
      columns,
      mode
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
  const gcsTargets = new Map<string, { target: StorageTargetRecord; options: ResolvedGcsOptions }>();
  const azureTargets = new Map<string, { target: StorageTargetRecord; options: ResolvedAzureOptions }>();

  for (const partition of plan.partitions) {
    const target = partition.storageTarget;
    switch (target.kind) {
      case 's3':
        hasS3 = true;
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
    await configureS3Support(connection, config);
  }
  if (gcsTargets.size > 0) {
    await configureGcsSupport(connection, Array.from(gcsTargets.values()));
  }
  if (azureTargets.size > 0) {
    await configureAzureSupport(connection, Array.from(azureTargets.values()));
  }
}

async function attachPartitions(
  connection: any,
  plan: QueryPlan
): Promise<Map<string, Set<string>>> {
  const columnMap = new Map<string, Set<string>>();

  for (const partition of plan.partitions) {
    const escapedLocation = partition.location.replace(/'/g, "''");
    await run(connection, `ATTACH '${escapedLocation}' AS ${partition.alias}`);
    const tableName = quoteIdentifier(partition.tableName);
    const availableColumns = await introspectPartitionColumns(connection, partition);
    columnMap.set(partition.alias, availableColumns);
    const timestampColumn = quoteIdentifier(plan.timestampColumn);
    const startLiteral = plan.rangeStart.toISOString().replace(/'/g, "''");
    const endLiteral = plan.rangeEnd.toISOString().replace(/'/g, "''");
    const filterSql = `CREATE TEMP VIEW ${partition.alias}_filtered AS
         SELECT *
         FROM ${partition.alias}.${tableName}
         WHERE ${timestampColumn} BETWEEN TIMESTAMP '${startLiteral}' AND TIMESTAMP '${endLiteral}'`;
    await run(connection, filterSql);
  }
  return columnMap;
}

async function createDatasetView(
  connection: any,
  plan: QueryPlan,
  partitionColumns: Map<string, Set<string>>
): Promise<void> {
  const canonicalFields = resolveCanonicalSchema(plan, partitionColumns);
  const selects = plan.partitions.map((partition) =>
    buildPartitionSelect(partition, canonicalFields, partitionColumns.get(partition.alias))
  );
  const unionSql = selects.join('\nUNION ALL\n');
  await run(connection, `CREATE TEMP VIEW dataset_view AS ${unionSql}`);
}

async function introspectPartitionColumns(
  connection: any,
  partition: QueryPlanPartition
): Promise<Set<string>> {
  const alias = partition.alias.replace(/'/g, "''");
  const table = partition.tableName.replace(/"/g, '""').replace(/'/g, "''");
  const qualified = `${alias}."${table}"`;
  const rows = await all(connection, `PRAGMA table_info('${qualified}')`);
  const columns = new Set<string>();
  for (const row of rows ?? []) {
    const columnName =
      typeof row?.column_name === 'string'
        ? (row.column_name as string)
        : typeof row?.name === 'string'
          ? (row.name as string)
          : null;
    if (columnName) {
      columns.add(columnName);
    }
  }
  return columns;
}

function resolveCanonicalSchema(
  plan: QueryPlan,
  partitionColumns: Map<string, Set<string>>
): FieldDefinition[] {
  if (plan.schemaFields.length > 0) {
    return plan.schemaFields;
  }
  return inferFieldsFromPartitionColumns(partitionColumns);
}

function buildPartitionSelect(
  partition: QueryPlanPartition,
  canonicalFields: FieldDefinition[],
  availableColumns: Set<string> | undefined
): string {
  if (canonicalFields.length === 0) {
    return `SELECT * FROM ${partition.alias}_filtered`;
  }

  const available = availableColumns ?? new Set<string>();
  const expressions = canonicalFields.map((field) => {
    const identifier = quoteIdentifier(field.name);
    if (available.has(field.name)) {
      return identifier;
    }
    const duckType = mapFieldTypeToDuckDb(field.type);
    return `NULL::${duckType} AS ${identifier}`;
  });

  const selectList = expressions.join(', ');
  return `SELECT ${selectList}
        FROM ${partition.alias}_filtered`;
}

function inferFieldsFromPartitionColumns(
  partitionColumns: Map<string, Set<string>>
): FieldDefinition[] {
  const seen = new Set<string>();
  const inferred: FieldDefinition[] = [];
  for (const columns of partitionColumns.values()) {
    for (const column of columns) {
      if (!seen.has(column)) {
        seen.add(column);
        inferred.push({
          name: column,
          type: 'string'
        });
      }
    }
  }
  return inferred;
}

async function applyColumnFilters(connection: any, plan: QueryPlan): Promise<string> {
  if (!plan.columnFilters || Object.keys(plan.columnFilters).length === 0) {
    return 'dataset_view';
  }
  const clause = buildColumnFilterClause(plan.columnFilters);
  if (!clause) {
    return 'dataset_view';
  }
  await run(
    connection,
    `CREATE TEMP VIEW dataset_filtered AS
       SELECT *
         FROM dataset_view
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

  const selectColumns = plan.columns && plan.columns.length > 0
    ? plan.columns.map(quoteIdentifier).join(', ')
    : '*';
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
  return [plan.timestampColumn];
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

function normalizeRows(rows: QueryResultRow[]): QueryResultRow[] {
  return rows.map((row) => {
    const normalized: QueryResultRow = {};
    for (const [key, value] of Object.entries(row)) {
      if (value instanceof Date) {
        normalized[key] = value.toISOString();
      } else {
        normalized[key] = value;
      }
    }
    return normalized;
  });
}

export async function configureS3Support(connection: any, config: ServiceConfig): Promise<void> {
  const s3 = config.storage.s3;
  if (!s3 || !s3.bucket) {
    throw new Error('Remote partitions require S3 configuration but none was provided');
  }

  await ensureHttpfsLoaded(connection);

  if (s3.region) {
    await run(connection, `SET s3_region='${escapeSqlLiteral(s3.region)}'`);
  }
  if (s3.endpoint) {
    await run(connection, `SET s3_endpoint='${escapeSqlLiteral(s3.endpoint)}'`);
    const isSecure = /^https:/i.test(s3.endpoint);
    const isInsecure = /^http:/i.test(s3.endpoint);
    if (isSecure) {
      await run(connection, 'SET s3_use_ssl=true');
    } else if (isInsecure) {
      await run(connection, 'SET s3_use_ssl=false');
    }
  }
  if (s3.forcePathStyle) {
    await run(connection, `SET s3_url_style='path'`);
  }
  if (s3.accessKeyId && s3.secretAccessKey) {
    await run(connection, `SET s3_access_key_id='${escapeSqlLiteral(s3.accessKeyId)}'`);
    await run(connection, `SET s3_secret_access_key='${escapeSqlLiteral(s3.secretAccessKey)}'`);
  }
  if (s3.sessionToken) {
    await run(connection, `SET s3_session_token='${escapeSqlLiteral(s3.sessionToken)}'`);
  }

  const cacheConfig = config.query.cache;
  if (cacheConfig.enabled) {
    await mkdir(cacheConfig.directory, { recursive: true });
    await run(connection, `SET s3_cache_directory='${escapeSqlLiteral(cacheConfig.directory)}'`);
    await run(connection, `SET s3_cache_size='${String(cacheConfig.maxBytes)}'`);
  }
}

async function ensureHttpfsLoaded(connection: any): Promise<void> {
  await run(connection, 'INSTALL httpfs');
  await run(connection, 'LOAD httpfs');
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

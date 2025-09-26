import { loadDuckDb, isCloseable } from '@apphub/shared';
import { mkdir } from 'node:fs/promises';
import { loadServiceConfig, type ServiceConfig } from '../config/serviceConfig';
import type { QueryPlan } from './planner';

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
    await attachPartitions(connection, plan);
    await createDatasetView(connection, plan);

    const { preparatoryQueries, selectSql, mode } = buildFinalQuery(plan);
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
  if (!plan.partitions.some(isS3Partition)) {
    return;
  }

  await configureS3Support(connection, config);
}

async function attachPartitions(connection: any, plan: QueryPlan): Promise<void> {
  for (const partition of plan.partitions) {
    const escapedLocation = partition.location.replace(/'/g, "''");
    await run(connection, `ATTACH '${escapedLocation}' AS ${partition.alias}`);
    const tableName = quoteIdentifier(partition.tableName);
    const timestampColumn = quoteIdentifier(plan.timestampColumn);
    const startLiteral = plan.rangeStart.toISOString().replace(/'/g, "''");
    const endLiteral = plan.rangeEnd.toISOString().replace(/'/g, "''");
    const filterSql = `CREATE TEMP VIEW ${partition.alias}_filtered AS
         SELECT *
         FROM ${partition.alias}.${tableName}
         WHERE ${timestampColumn} BETWEEN TIMESTAMP '${startLiteral}' AND TIMESTAMP '${endLiteral}'`;
    await run(connection, filterSql);
  }
}

async function createDatasetView(connection: any, plan: QueryPlan): Promise<void> {
  const selects = plan.partitions.map((partition) => `SELECT * FROM ${partition.alias}_filtered`);
  const unionSql = selects.join('\nUNION ALL\n');
  await run(connection, `CREATE TEMP VIEW dataset_view AS ${unionSql}`);
}

function buildFinalQuery(plan: QueryPlan): {
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
           FROM dataset_view`
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
                FROM dataset_view
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

function isS3Partition(partition: QueryPlan['partitions'][number]): boolean {
  return partition.location.startsWith('s3://');
}

export async function configureS3Support(connection: any, config: ServiceConfig): Promise<void> {
  const s3 = config.storage.s3;
  if (!s3 || !s3.bucket) {
    throw new Error('Remote partitions require S3 configuration but none was provided');
  }

  await run(connection, 'INSTALL httpfs');
  await run(connection, 'LOAD httpfs');

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

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

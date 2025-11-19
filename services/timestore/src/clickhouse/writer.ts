import type { FieldDefinition } from '../ingestion/types';
import type { ServiceConfig } from '../config/serviceConfig';
import { getClickHouseClient } from './client';
import { deriveTableName, quoteIdentifier } from './util';
import {
  isClickHouseMockEnabled,
  recordMockInsert
} from './mockStore';

interface InsertBatchParams {
  config: ServiceConfig;
  datasetSlug: string;
  tableName: string;
  schema: FieldDefinition[];
  rows: Record<string, unknown>[];
  partitionKey: Record<string, unknown>;
  partitionAttributes: Record<string, unknown> | null;
  timeRange: { start: string; end: string };
  ingestionSignature: string;
  receivedAt: string;
}

const METADATA_COLUMNS: Array<{ name: string; type: string }> = [
  { name: '__dataset_slug', type: 'String' },
  { name: '__table_name', type: 'String' },
  { name: '__partition_key', type: 'String' },
  { name: '__partition_attributes', type: 'Nullable(String)' },
  { name: '__partition_start', type: "DateTime64(3, 'UTC')" },
  { name: '__partition_end', type: "DateTime64(3, 'UTC')" },
  { name: '__ingestion_signature', type: 'String' },
  { name: '__received_at', type: "DateTime64(3, 'UTC')" }
];

function mapFieldTypeToClickHouse(field: FieldDefinition): string {
  switch (field.type) {
    case 'timestamp':
      return "DateTime64(3, 'UTC')";
    case 'double':
      return 'Float64';
    case 'integer':
      return 'Int64';
    case 'boolean':
      return 'UInt8';
    case 'string':
    default:
      return 'String';
  }
}

function formatClickHouseDateTime(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const date =
    value instanceof Date
      ? value
      : typeof value === 'number'
        ? new Date(value)
        : new Date(String(value));

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const iso = date.toISOString();
  return iso.replace('T', ' ').replace('Z', '');
}

function convertValue(type: FieldDefinition['type'], value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  switch (type) {
    case 'timestamp': {
      return formatClickHouseDateTime(value);
    }
    case 'double': {
      const numeric = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }
    case 'integer': {
      const numeric = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
      return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
    }
    case 'boolean': {
      if (typeof value === 'boolean') {
        return value ? 1 : 0;
      }
      if (typeof value === 'number') {
        return value ? 1 : 0;
      }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'y'].includes(normalized)) {
          return 1;
        }
        if (['false', '0', 'no', 'n'].includes(normalized)) {
          return 0;
        }
      }
      return null;
    }
    case 'string':
    default:
      return String(value);
  }
}

function serializeObject(value: Record<string, unknown> | null): string | null {
  if (!value) {
    return null;
  }
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(Object.fromEntries(entries));
}

async function ensureDatabaseAndTable(
  config: ServiceConfig,
  datasetSlug: string,
  tableName: string,
  schema: FieldDefinition[]
): Promise<void> {
  if (isClickHouseMockEnabled(config.clickhouse)) {
    return;
  }
  const client = getClickHouseClient(config.clickhouse);
  const databaseIdent = quoteIdentifier(config.clickhouse.database);
  await client.command({
    query: `CREATE DATABASE IF NOT EXISTS ${databaseIdent}`
  });

  const tableIdent = quoteIdentifier(deriveTableName(datasetSlug, tableName));
  const createColumns = [
    ...METADATA_COLUMNS.map((column) => `${quoteIdentifier(column.name)} ${column.type}`),
    ...schema.map((field) => `${quoteIdentifier(field.name)} Nullable(${mapFieldTypeToClickHouse(field)})`)
  ];
  const createQuery = `
    CREATE TABLE IF NOT EXISTS ${databaseIdent}.${tableIdent} (
      ${createColumns.join(',\n      ')}
    )
    ENGINE = MergeTree
    PARTITION BY ${quoteIdentifier('__dataset_slug')}
    ORDER BY (${quoteIdentifier('__dataset_slug')}, ${quoteIdentifier('__partition_key')}, ${quoteIdentifier('__ingestion_signature')})
    SETTINGS storage_policy = 'timestore_demo', index_granularity = 8192
  `;

  await client.command({ query: createQuery });

  const describeResult = await client.query({
    query: `DESCRIBE TABLE ${databaseIdent}.${tableIdent}`,
    format: 'JSONEachRow'
  });
  const describedColumns = await describeResult.json<{ name: string }>();
  const existingColumns = new Set(describedColumns.map((column: { name: string }) => column.name));

  const alterStatements: string[] = [];
  for (const field of schema) {
    if (!existingColumns.has(field.name)) {
      alterStatements.push(
        `ALTER TABLE ${databaseIdent}.${tableIdent} ADD COLUMN IF NOT EXISTS ${quoteIdentifier(field.name)} Nullable(${mapFieldTypeToClickHouse(field)})`
      );
    }
  }
  for (const column of METADATA_COLUMNS) {
    if (!existingColumns.has(column.name)) {
      alterStatements.push(
        `ALTER TABLE ${databaseIdent}.${tableIdent} ADD COLUMN IF NOT EXISTS ${quoteIdentifier(column.name)} ${column.type}`
      );
    }
  }

  for (const statement of alterStatements) {
    await client.command({ query: statement });
  }

  await client.command({ query: `ALTER TABLE ${databaseIdent}.${tableIdent} REMOVE TTL` }).catch(() => undefined);
  await client
    .command({ query: `ALTER TABLE ${databaseIdent}.${tableIdent} MODIFY SETTING storage_policy = 'timestore_demo', index_granularity = 8192` })
    .catch(() => undefined);
}

export async function ensureClickHouseTable(
  params: {
    config: ServiceConfig;
    datasetSlug: string;
    tableName: string;
    schema: FieldDefinition[];
  }
): Promise<void> {
  const { config, datasetSlug, tableName, schema } = params;
  await ensureDatabaseAndTable(config, datasetSlug, tableName, schema);
}

export async function writeBatchToClickHouse(params: InsertBatchParams): Promise<void> {
  const { config, datasetSlug, tableName, schema, rows, partitionKey, partitionAttributes, timeRange, ingestionSignature, receivedAt } = params;
  if (rows.length === 0 || schema.length === 0) {
    return;
  }

  await ensureDatabaseAndTable(config, datasetSlug, tableName, schema);
  const serializedPartitionKey = serializeObject(partitionKey) ?? '{}';
  const serializedPartitionAttributes = serializeObject(partitionAttributes);

  const preparedRows = rows.map((row) => {
    const projected: Record<string, unknown> = {};
    for (const field of schema) {
      projected[field.name] = convertValue(field.type, (row as Record<string, unknown>)[field.name]);
    }
    projected['__dataset_slug'] = datasetSlug;
    projected['__table_name'] = tableName;
    projected['__partition_key'] = serializedPartitionKey;
    projected['__partition_attributes'] = serializedPartitionAttributes;
    const partitionStart = formatClickHouseDateTime(timeRange.start);
    const partitionEnd = formatClickHouseDateTime(timeRange.end);
    if (!partitionStart || !partitionEnd) {
      throw new Error('Invalid partition time range; expected RFC 3339 timestamps');
    }
    projected['__partition_start'] = partitionStart;
    projected['__partition_end'] = partitionEnd;
    projected['__ingestion_signature'] = ingestionSignature;
    const receivedAtFormatted = formatClickHouseDateTime(receivedAt);
    if (!receivedAtFormatted) {
      throw new Error('Invalid receivedAt timestamp; expected RFC 3339 timestamp');
    }
    projected['__received_at'] = receivedAtFormatted;
    return projected;
  });

  if (isClickHouseMockEnabled(config.clickhouse)) {
    recordMockInsert({ datasetSlug, tableName }, preparedRows);
    return;
  }

  const client = getClickHouseClient(config.clickhouse);
  await client.insert({
    table: deriveTableName(datasetSlug, tableName),
    values: preparedRows,
    format: 'JSONEachRow'
  });
}

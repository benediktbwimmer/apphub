import { TIMESTORE_BASE_URL } from '../config';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import type {
  DatasetRecord,
  DatasetListResponse,
  ManifestResponse,
  LifecycleStatusResponse,
  RetentionPolicy,
  RetentionResponse,
  LifecycleRunResponse,
  QueryResponse,
  SqlSchemaResponse,
  SqlQueryResult,
  SqlSchemaTable
} from './types';
import {
  datasetListResponseSchema,
  datasetRecordSchema,
  manifestResponseSchema,
  lifecycleStatusResponseSchema,
  retentionResponseSchema,
  lifecycleRunCompletedSchema,
  lifecycleRunQueuedSchema,
  queryResponseSchema,
  sqlSchemaResponseSchema,
  sqlQueryResultSchema
} from './types';

function createTimestoreUrl(path: string): URL {
  const normalizedPath = path.replace(/^\/+/, '');
  const base = TIMESTORE_BASE_URL.endsWith('/') ? TIMESTORE_BASE_URL : `${TIMESTORE_BASE_URL}/`;
  return new URL(normalizedPath, base);
}

export type DatasetListParams = {
  cursor?: string | null;
  limit?: number;
  search?: string | null;
  status?: 'active' | 'inactive' | 'all';
};

export type SqlQueryRequest = {
  statement: string;
  maxRows?: number;
  defaultSchema?: string;
};

async function parseJson<T>(response: Response, schema: { parse: (input: unknown) => T }): Promise<T> {
  const payload = await response.json();
  return schema.parse(payload);
}

function sanitizeSqlStatement(sql: string): string {
  return sql.replace(/;+\s*$/, '');
}

function wrapWithLimit(statement: string, limit?: number): string {
  if (!limit || !Number.isFinite(limit) || limit <= 0) {
    return statement;
  }
  const sanitized = sanitizeSqlStatement(statement);
  return `SELECT * FROM (${sanitized}) AS apphub_sql_subquery LIMIT ${Math.floor(limit)}`;
}

async function runSqlRead(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  sql: string,
  options: { signal?: AbortSignal } = {}
): Promise<Array<Record<string, unknown>>> {
  const url = createTimestoreUrl('sql/read');
  url.searchParams.set('format', 'json');
  const response = await authorizedFetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
    signal: options.signal
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(extractSqlErrorMessage(text, response.status));
  }
  const normalized = text.trim();
  if (normalized.length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Unexpected SQL response payload');
    }
    return parsed as Array<Record<string, unknown>>;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Failed to parse SQL response');
  }
}

export async function fetchDatasets(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  params: DatasetListParams = {},
  options: { signal?: AbortSignal } = {}
): Promise<DatasetListResponse> {
  const url = createTimestoreUrl('admin/datasets');
  if (params.cursor) {
    url.searchParams.set('cursor', params.cursor);
  }
  if (params.limit) {
    url.searchParams.set('limit', params.limit.toString());
  }
  if (params.status) {
    url.searchParams.set('status', params.status);
  }
  if (params.search) {
    url.searchParams.set('search', params.search);
  }

  const response = await authorizedFetch(url.toString(), { signal: options.signal });
  if (!response.ok) {
    throw new Error(`Fetch datasets failed with status ${response.status}`);
  }
  return parseJson(response, datasetListResponseSchema);
}

export async function fetchDatasetById(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  datasetId: string,
  options: { signal?: AbortSignal } = {}
): Promise<DatasetRecord> {
  const url = createTimestoreUrl(`admin/datasets/${encodeURIComponent(datasetId)}`);
  const response = await authorizedFetch(url.toString(), { signal: options.signal });
  if (!response.ok) {
    throw new Error(`Fetch dataset failed with status ${response.status}`);
  }
  const payload = await response.json();
  return datasetRecordSchema.parse(payload.dataset);
}

export async function fetchDatasetManifest(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  datasetId: string,
  options: { signal?: AbortSignal } = {}
): Promise<ManifestResponse> {
  const url = createTimestoreUrl(`admin/datasets/${encodeURIComponent(datasetId)}/manifest`);
  const response = await authorizedFetch(url.toString(), { signal: options.signal });
  if (!response.ok) {
    throw new Error(`Fetch manifest failed with status ${response.status}`);
  }
  return parseJson(response, manifestResponseSchema);
}

export async function fetchLifecycleStatus(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  params: { limit?: number; datasetId?: string } = {},
  options: { signal?: AbortSignal } = {}
): Promise<LifecycleStatusResponse> {
  const url = createTimestoreUrl('admin/lifecycle/status');
  if (params.limit) {
    url.searchParams.set('limit', params.limit.toString());
  }
  if (params.datasetId) {
    url.searchParams.set('datasetId', params.datasetId);
  }
  const response = await authorizedFetch(url.toString(), { signal: options.signal });
  if (!response.ok) {
    throw new Error(`Fetch lifecycle status failed with status ${response.status}`);
  }
  return parseJson(response, lifecycleStatusResponseSchema);
}

export async function fetchRetentionPolicy(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  datasetId: string,
  options: { signal?: AbortSignal } = {}
): Promise<RetentionResponse> {
  const url = createTimestoreUrl(`admin/datasets/${encodeURIComponent(datasetId)}/retention`);
  const response = await authorizedFetch(url.toString(), { signal: options.signal });
  if (!response.ok) {
    throw new Error(`Fetch retention failed with status ${response.status}`);
  }
  return parseJson(response, retentionResponseSchema);
}

export async function updateRetentionPolicy(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  datasetId: string,
  policy: RetentionPolicy,
  options: { signal?: AbortSignal } = {}
): Promise<RetentionResponse> {
  const url = createTimestoreUrl(`admin/datasets/${encodeURIComponent(datasetId)}/retention`);
  const response = await authorizedFetch(url.toString(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(policy),
    signal: options.signal
  });
  if (!response.ok) {
    throw new Error(`Update retention failed with status ${response.status}`);
  }
  return parseJson(response, retentionResponseSchema);
}

function parseLifecycleRunResponse(payload: unknown): LifecycleRunResponse {
  if (lifecycleRunCompletedSchema.safeParse(payload).success) {
    return lifecycleRunCompletedSchema.parse(payload);
  }
  return lifecycleRunQueuedSchema.parse(payload);
}

export async function runLifecycleJob(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  input: {
    datasetId: string;
    datasetSlug: string;
    operations: string[];
    mode: 'inline' | 'queue';
  }
): Promise<LifecycleRunResponse> {
  const url = createTimestoreUrl('admin/lifecycle/run');
  const response = await authorizedFetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      datasetId: input.datasetId,
      datasetSlug: input.datasetSlug,
      operations: input.operations,
      mode: input.mode
    })
  });
  if (!response.ok) {
    throw new Error(`Lifecycle run failed with status ${response.status}`);
  }
  const payload = await response.json();
  return parseLifecycleRunResponse(payload);
}

export async function rescheduleLifecycleJob(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  jobId: string
): Promise<LifecycleRunResponse> {
  const url = createTimestoreUrl('admin/lifecycle/reschedule');
  const response = await authorizedFetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId })
  });
  if (!response.ok) {
    throw new Error(`Lifecycle reschedule failed with status ${response.status}`);
  }
  const payload = await response.json();
  return lifecycleRunQueuedSchema.parse(payload);
}

export async function runDatasetQuery(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  datasetSlug: string,
  body: unknown
): Promise<QueryResponse> {
  const url = createTimestoreUrl(`datasets/${encodeURIComponent(datasetSlug)}/query`);
  const response = await authorizedFetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Query failed with status ${response.status}`);
  }
  return parseJson(response, queryResponseSchema);
}

export async function fetchMetrics(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  options: { signal?: AbortSignal } = {}
): Promise<string> {
  const url = createTimestoreUrl('metrics');
  const response = await authorizedFetch(url.toString(), {
    signal: options.signal,
    headers: { Accept: 'text/plain' }
  });
  if (!response.ok) {
    throw new Error(`Fetch metrics failed with status ${response.status}`);
  }
  return response.text();
}

function extractSqlErrorMessage(raw: string, status: number): string {
  if (!raw) {
    return `SQL query failed with status ${status}`;
  }
  try {
    const parsed = JSON.parse(raw) as { message?: unknown; error?: unknown; details?: unknown };
    const candidate = parsed.message ?? parsed.error ?? parsed.details;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  } catch {
    // Ignore JSON parsing issues and fall back to raw text.
  }
  return raw;
}

export async function fetchSqlSchema(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  options: { signal?: AbortSignal } = {}
): Promise<SqlSchemaResponse> {
  const schemaSql = `
    SELECT
      table_schema,
      table_name,
      column_name,
      data_type,
      is_nullable
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name, ordinal_position
  `;

  const rows = await runSqlRead(authorizedFetch, schemaSql, options);
  const tablesMap = new Map<string, SqlSchemaTable>();

  for (const row of rows) {
    const schema = String(row.table_schema ?? 'public');
    const tableName = String(row.table_name ?? 'unknown');
    const columnName = String(row.column_name ?? 'column');
    const dataType = row.data_type ? String(row.data_type) : 'unknown';
    const nullable = row.is_nullable ? String(row.is_nullable).toUpperCase() !== 'NO' : undefined;
    const qualifiedName = `${schema}.${tableName}`;

    if (!tablesMap.has(qualifiedName)) {
      tablesMap.set(qualifiedName, {
        name: qualifiedName,
        description: null,
        partitionKeys: undefined,
        columns: []
      });
    }

    tablesMap.get(qualifiedName)?.columns.push({
      name: columnName,
      type: dataType,
      nullable,
      description: null
    });
  }

  const tables = Array.from(tablesMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  return sqlSchemaResponseSchema.parse({
    fetchedAt: new Date().toISOString(),
    tables
  });
}

export async function executeSqlQuery(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  request: SqlQueryRequest,
  options: { signal?: AbortSignal } = {}
): Promise<SqlQueryResult> {
  const limitedStatement = wrapWithLimit(request.statement, request.maxRows);
  const rows = await runSqlRead(authorizedFetch, limitedStatement, options);
  const columns = rows.length > 0
    ? Object.keys(rows[0]).map((name) => ({ name, type: inferColumnType(rows, name) }))
    : [];

  return sqlQueryResultSchema.parse({
    columns,
    rows,
    statistics: {
      rowCount: rows.length
    }
  });
}

function inferColumnType(rows: Array<Record<string, unknown>>, columnName: string): string | undefined {
  for (const row of rows) {
    const value = row[columnName];
    if (value === null || value === undefined) {
      continue;
    }
    const type = typeof value;
    if (type === 'number') {
      return 'numeric';
    }
    if (type === 'bigint') {
      return 'bigint';
    }
    if (type === 'boolean') {
      return 'boolean';
    }
    if (value instanceof Date) {
      return 'timestamp';
    }
    if (type === 'object') {
      return Array.isArray(value) ? 'jsonb' : 'jsonb';
    }
    return 'text';
  }
  return undefined;
}

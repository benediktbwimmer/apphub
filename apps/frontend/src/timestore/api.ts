import { TIMESTORE_BASE_URL } from '../config';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import type {
  ArchiveDatasetRequest,
  CreateDatasetRequest,
  DatasetAccessAuditListResponse,
  DatasetListResponse,
  DatasetRecord,
  DatasetResponse,
  LifecycleRunResponse,
  LifecycleStatusResponse,
  ManifestResponse,
  PatchDatasetRequest,
  QueryResponse,
  RetentionPolicy,
  RetentionResponse,
  SavedSqlQuery,
  SavedSqlQueryListResponse,
  SavedSqlQueryResponse,
  SavedSqlQueryStats,
  SqlQueryResult,
  SqlSchemaResponse
} from './types';
import {
  archiveDatasetRequestSchema,
  datasetAccessAuditListResponseSchema,
  createDatasetRequestSchema,
  datasetAccessAuditListResponseSchema,
  datasetListResponseSchema,
  datasetRecordSchema,
  datasetResponseSchema,
  lifecycleRunCompletedSchema,
  lifecycleRunQueuedSchema,
  lifecycleStatusResponseSchema,
  manifestResponseSchema,
  patchDatasetRequestSchema,
  queryResponseSchema,
  retentionResponseSchema,
  savedSqlQueryListResponseSchema,
  savedSqlQueryResponseSchema,
  sqlQueryResultSchema,
  sqlSchemaResponseSchema
} from './types';

export type DatasetAccessAuditListParams = {
  limit?: number;
  cursor?: string | null;
  actions?: string[];
  success?: boolean | null;
  startTime?: string | null;
  endTime?: string | null;
};

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

export type SqlResponseFormat = 'json' | 'csv' | 'table';

export type SavedSqlQueryUpsertRequest = {
  id: string;
  statement: string;
  label?: string | null;
  stats?: SavedSqlQueryStats | null;
};

export type SqlQueryExport = {
  blob: Blob;
  contentType: string | null;
  requestId: string | null;
};

async function parseJson<T>(response: Response, schema: { parse: (input: unknown) => T }): Promise<T> {
  const payload = await response.json();
  return schema.parse(payload);
}

async function parseDatasetApiError(response: Response, fallback: string): Promise<never> {
  const raw = await response.text();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown; details?: unknown };
      const candidate = parsed.error ?? parsed.message ?? parsed.details;
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        throw new Error(candidate.trim());
      }
    } catch {
      const trimmed = raw.trim();
      if (trimmed.length > 0) {
        throw new Error(trimmed);
      }
    }
  }
  throw new Error(fallback);
}

async function parseDatasetResponse(response: Response): Promise<DatasetResponse> {
  const parsed = await parseJson(response, datasetResponseSchema);
  const headerEtag = response.headers.get('etag');
  const normalizedEtag = parsed.etag?.trim().length
    ? parsed.etag.trim()
    : headerEtag?.trim().length
      ? headerEtag.trim()
      : parsed.dataset.updatedAt;
  return {
    dataset: parsed.dataset,
    etag: normalizedEtag
  };
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

async function requestSqlRead(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  sql: string,
  format: SqlResponseFormat,
  options: { signal?: AbortSignal } = {}
): Promise<Response> {
  const url = createTimestoreUrl('sql/read');
  if (format !== 'json') {
    url.searchParams.set('format', format);
  }
  const response = await authorizedFetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
    signal: options.signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(extractSqlErrorMessage(errorText, response.status));
  }

  return response;
}

async function callSqlRead(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  sql: string,
  options: { signal?: AbortSignal } = {}
): Promise<SqlQueryResult> {
  const response = await requestSqlRead(authorizedFetch, sql, 'json', options);

  const warningsHeader = response.headers.get('x-sql-warnings');
  const payload = await response.json();
  if (!payload.warnings && warningsHeader) {
    try {
      const parsedWarnings = JSON.parse(warningsHeader) as unknown;
      if (Array.isArray(parsedWarnings)) {
        payload.warnings = parsedWarnings;
      }
    } catch {
      // ignore malformed warning headers
    }
  }

  return sqlQueryResultSchema.parse(payload);
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

export async function fetchDatasetAccessAudit(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  datasetId: string,
  params: DatasetAccessAuditListParams = {},
  options: { signal?: AbortSignal } = {}
): Promise<DatasetAccessAuditListResponse> {
  const url = createTimestoreUrl(`admin/datasets/${encodeURIComponent(datasetId)}/audit`);
  if (params.limit) {
    url.searchParams.set('limit', Math.max(1, Math.min(params.limit, 200)).toString());
  }
  if (params.cursor) {
    url.searchParams.set('cursor', params.cursor);
  }
  if (Array.isArray(params.actions)) {
    for (const action of params.actions) {
      if (action && action.trim().length > 0) {
        url.searchParams.append('actions', action.trim());
      }
    }
  }
  if (typeof params.success === 'boolean') {
    url.searchParams.set('success', params.success ? 'true' : 'false');
  }
  if (params.startTime) {
    url.searchParams.set('startTime', params.startTime);
  }
  if (params.endTime) {
    url.searchParams.set('endTime', params.endTime);
  }

  const response = await authorizedFetch(url.toString(), { signal: options.signal });
  if (!response.ok) {
    throw new Error(`Fetch dataset access audit failed with status ${response.status}`);
  }
  return parseJson(response, datasetAccessAuditListResponseSchema);
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

export async function createDataset(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  body: CreateDatasetRequest,
  options: { signal?: AbortSignal } = {}
): Promise<DatasetResponse> {
  const payload = createDatasetRequestSchema.parse(body);
  const url = createTimestoreUrl('admin/datasets');
  const response = await authorizedFetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal
  });
  if (!response.ok) {
    await parseDatasetApiError(response, `Create dataset failed with status ${response.status}`);
  }
  return parseDatasetResponse(response);
}

export async function updateDataset(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  datasetId: string,
  body: PatchDatasetRequest,
  options: { signal?: AbortSignal } = {}
): Promise<DatasetResponse> {
  const payload = patchDatasetRequestSchema.parse(body);
  const url = createTimestoreUrl(`admin/datasets/${encodeURIComponent(datasetId)}`);
  const response = await authorizedFetch(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal
  });
  if (!response.ok) {
    await parseDatasetApiError(response, `Update dataset failed with status ${response.status}`);
  }
  return parseDatasetResponse(response);
}

export async function archiveDataset(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  datasetId: string,
  body: ArchiveDatasetRequest,
  options: { signal?: AbortSignal } = {}
): Promise<DatasetResponse> {
  const payload = archiveDatasetRequestSchema.parse(body);
  const url = createTimestoreUrl(`admin/datasets/${encodeURIComponent(datasetId)}/archive`);
  const response = await authorizedFetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal
  });
  if (!response.ok) {
    await parseDatasetApiError(response, `Archive dataset failed with status ${response.status}`);
  }
  return parseDatasetResponse(response);
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

export type DatasetAccessAuditListParams = {
  limit?: number;
  cursor?: string | null;
  actions?: string[];
  success?: boolean;
  startTime?: string;
  endTime?: string;
};

export async function fetchDatasetAccessAudit(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  datasetId: string,
  params: DatasetAccessAuditListParams = {},
  options: { signal?: AbortSignal } = {}
): Promise<DatasetAccessAuditListResponse> {
  const url = createTimestoreUrl(`admin/datasets/${encodeURIComponent(datasetId)}/audit`);
  if (params.limit) {
    url.searchParams.set('limit', Math.max(1, Math.min(params.limit, 200)).toString());
  }
  if (params.cursor) {
    url.searchParams.set('cursor', params.cursor);
  }
  if (params.actions) {
    for (const action of params.actions) {
      url.searchParams.append('actions', action);
    }
  }
  if (typeof params.success === 'boolean') {
    url.searchParams.set('success', String(params.success));
  }
  if (params.startTime) {
    url.searchParams.set('startTime', params.startTime);
  }
  if (params.endTime) {
    url.searchParams.set('endTime', params.endTime);
  }

  const response = await authorizedFetch(url.toString(), { signal: options.signal });
  if (!response.ok) {
    throw new Error(`Fetch dataset audit failed with status ${response.status}`);
  }
  return parseJson(response, datasetAccessAuditListResponseSchema);
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
  const url = createTimestoreUrl('sql/schema');
  const response = await authorizedFetch(url.toString(), { signal: options.signal });
  if (!response.ok) {
    throw new Error(`Fetch SQL schema failed with status ${response.status}`);
  }
  const payload = await response.json();
  return sqlSchemaResponseSchema.parse(payload);
}

export async function executeSqlQuery(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  request: SqlQueryRequest,
  options: { signal?: AbortSignal } = {}
): Promise<SqlQueryResult> {
  const limitedStatement = wrapWithLimit(request.statement, request.maxRows);
  return callSqlRead(authorizedFetch, limitedStatement, options);
}

export async function exportSqlQuery(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  request: SqlQueryRequest,
  format: Exclude<SqlResponseFormat, 'json'>,
  options: { signal?: AbortSignal } = {}
): Promise<SqlQueryExport> {
  const limitedStatement = wrapWithLimit(request.statement, request.maxRows);
  const response = await requestSqlRead(authorizedFetch, limitedStatement, format, options);
  const blob = await response.blob();
  return {
    blob,
    contentType: response.headers.get('content-type'),
    requestId: response.headers.get('x-sql-request-id')
  };
}

export async function listSavedSqlQueries(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  options: { signal?: AbortSignal } = {}
): Promise<SavedSqlQueryListResponse> {
  const url = createTimestoreUrl('sql/saved');
  const response = await authorizedFetch(url.toString(), {
    signal: options.signal
  });
  if (!response.ok) {
    await parseDatasetApiError(response, 'Failed to load saved SQL queries.');
  }
  return parseJson(response, savedSqlQueryListResponseSchema);
}

export async function fetchSavedSqlQuery(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  id: string,
  options: { signal?: AbortSignal } = {}
): Promise<SavedSqlQuery> {
  const url = createTimestoreUrl(`sql/saved/${encodeURIComponent(id)}`);
  const response = await authorizedFetch(url.toString(), {
    signal: options.signal
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Saved query ${id} not found.`);
    }
    await parseDatasetApiError(response, 'Failed to load saved SQL query.');
  }
  const payload = await parseJson(response, savedSqlQueryResponseSchema);
  return payload.savedQuery;
}

export async function upsertSavedSqlQuery(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  input: SavedSqlQueryUpsertRequest,
  options: { signal?: AbortSignal } = {}
): Promise<SavedSqlQuery> {
  const url = createTimestoreUrl(`sql/saved/${encodeURIComponent(input.id)}`);
  const response = await authorizedFetch(url.toString(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      statement: input.statement,
      label: input.label ?? null,
      stats: input.stats ?? undefined
    }),
    signal: options.signal
  });
  if (!response.ok) {
    await parseDatasetApiError(response, 'Failed to save SQL query.');
  }
  const payload = await parseJson(response, savedSqlQueryResponseSchema);
  return payload.savedQuery;
}

export async function deleteSavedSqlQuery(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  id: string,
  options: { signal?: AbortSignal } = {}
): Promise<void> {
  const url = createTimestoreUrl(`sql/saved/${encodeURIComponent(id)}`);
  const response = await authorizedFetch(url.toString(), {
    method: 'DELETE',
    signal: options.signal
  });
  if (!response.ok && response.status !== 404) {
    await parseDatasetApiError(response, 'Failed to delete saved SQL query.');
  }
}

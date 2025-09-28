import { METASTORE_BASE_URL } from '../config';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import {
  recordResponseSchema,
  searchResponseSchema,
  auditResponseSchema,
  bulkResponseSchema,
  namespaceListResponseSchema,
  auditDiffSchema,
  restoreResponseSchema,
  filestoreHealthSnapshotSchema,
  schemaDefinitionSchema
} from './types';
import type {
  MetastoreSearchResponse,
  MetastoreRecordDetail,
  MetastoreUpsertPayload,
  MetastorePatchPayload,
  BulkRequestPayload,
  BulkResponsePayload,
  MetastoreNamespaceListResponse,
  MetastoreAuditResponse,
  MetastoreAuditDiff,
  MetastoreRestorePayload,
  MetastoreRestoreResponse,
  MetastoreFilestoreHealth,
  MetastoreSchemaFetchResult
} from './types';

async function parseJsonOrError<T>(response: Response, schema: { parse: (input: unknown) => T }): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(extractErrorMessage(text, response.status));
  }
  const payload = text ? (JSON.parse(text) as unknown) : {};
  return schema.parse(payload);
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }
  const text = await response.text();
  throw new Error(extractErrorMessage(text, response.status));
}

function extractErrorMessage(raw: string, status: number): string {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { message?: unknown; error?: unknown };
      const candidate = parsed.message ?? parsed.error;
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate;
      }
    } catch {
      // fall through
    }
  }
  return `Metastore request failed with status ${status}`;
}

export async function searchRecords(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  body: unknown,
  options: { signal?: AbortSignal } = {}
): Promise<MetastoreSearchResponse> {
  const response = await authorizedFetch(`${METASTORE_BASE_URL}/records/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal
  });
  return parseJsonOrError(response, searchResponseSchema);
}

export async function fetchRecord(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  namespace: string,
  key: string,
  options: { includeDeleted?: boolean; signal?: AbortSignal } = {}
): Promise<MetastoreRecordDetail> {
  const url = new URL(`/records/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`, METASTORE_BASE_URL);
  if (options.includeDeleted) {
    url.searchParams.set('includeDeleted', 'true');
  }
  const response = await authorizedFetch(url.toString(), { signal: options.signal });
  const payload = await parseJsonOrError(response, recordResponseSchema);
  return payload.record;
}

export async function fetchRecordAudits(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  namespace: string,
  key: string,
  options: { limit?: number; offset?: number; signal?: AbortSignal } = {}
): Promise<MetastoreAuditResponse> {
  const url = new URL(`/records/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}/audit`, METASTORE_BASE_URL);
  if (options.limit) {
    url.searchParams.set('limit', String(options.limit));
  }
  if (options.offset) {
    url.searchParams.set('offset', String(options.offset));
  }
  const response = await authorizedFetch(url.toString(), { signal: options.signal });
  return parseJsonOrError(response, auditResponseSchema);
}

export async function fetchRecordAuditDiff(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  namespace: string,
  key: string,
  auditId: number,
  options: { signal?: AbortSignal } = {}
): Promise<MetastoreAuditDiff> {
  const url = new URL(
    `/records/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}/audit/${auditId}/diff`,
    METASTORE_BASE_URL
  );
  const response = await authorizedFetch(url.toString(), { signal: options.signal });
  return parseJsonOrError(response, auditDiffSchema);
}

export async function upsertRecord(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  namespace: string,
  key: string,
  payload: MetastoreUpsertPayload
): Promise<MetastoreRecordDetail> {
  const response = await authorizedFetch(`${METASTORE_BASE_URL}/records/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const parsed = await parseJsonOrError(response, recordResponseSchema);
  return parsed.record;
}

export async function patchRecord(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  namespace: string,
  key: string,
  payload: MetastorePatchPayload
): Promise<MetastoreRecordDetail> {
  const response = await authorizedFetch(`${METASTORE_BASE_URL}/records/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const parsed = await parseJsonOrError(response, recordResponseSchema);
  return parsed.record;
}

export async function deleteRecord(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  namespace: string,
  key: string,
  payload: { expectedVersion?: number }
): Promise<MetastoreRecordDetail> {
  const response = await authorizedFetch(`${METASTORE_BASE_URL}/records/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const parsed = await parseJsonOrError(
    response,
    recordResponseSchema
  );
  return parsed.record;
}

export async function purgeRecord(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  namespace: string,
  key: string,
  payload: { expectedVersion?: number }
): Promise<void> {
  const response = await authorizedFetch(`${METASTORE_BASE_URL}/records/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}/purge`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  await ensureOk(response);
}

export async function restoreRecordFromAudit(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  namespace: string,
  key: string,
  payload: MetastoreRestorePayload
): Promise<MetastoreRestoreResponse> {
  const response = await authorizedFetch(`${METASTORE_BASE_URL}/records/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return parseJsonOrError(response, restoreResponseSchema);
}

export async function bulkOperate(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  payload: BulkRequestPayload
): Promise<BulkResponsePayload> {
  const response = await authorizedFetch(`${METASTORE_BASE_URL}/records/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return parseJsonOrError(response, bulkResponseSchema);
}

export async function listNamespaces(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  options: { prefix?: string; limit?: number; offset?: number; signal?: AbortSignal } = {}
): Promise<MetastoreNamespaceListResponse> {
  const url = new URL('/namespaces', METASTORE_BASE_URL);
  const trimmedPrefix = options.prefix?.trim();
  if (trimmedPrefix) {
    url.searchParams.set('prefix', trimmedPrefix);
  }
  if (typeof options.limit === 'number') {
    url.searchParams.set('limit', String(options.limit));
  }
  if (typeof options.offset === 'number') {
    url.searchParams.set('offset', String(options.offset));
  }
  const response = await authorizedFetch(url.toString(), { signal: options.signal });
  return parseJsonOrError(response, namespaceListResponseSchema);
}

export async function fetchSchemaDefinition(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  schemaHash: string,
  options: { signal?: AbortSignal } = {}
): Promise<MetastoreSchemaFetchResult> {
  const url = new URL(`/schemas/${encodeURIComponent(schemaHash)}`, METASTORE_BASE_URL);
  const response = await authorizedFetch(url.toString(), { signal: options.signal });
  const text = await response.text();

  if (response.status === 404) {
    let message = 'Schema metadata not registered.';
    if (text) {
      try {
        const parsed = JSON.parse(text) as { message?: unknown };
        const candidate = parsed.message;
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
          message = candidate;
        }
      } catch {
        // ignore parse failure and fall back to default
      }
    }
    return { status: 'missing', message } satisfies MetastoreSchemaFetchResult;
  }

  if (!response.ok) {
    throw new Error(extractErrorMessage(text, response.status));
  }

  const payload = text ? (JSON.parse(text) as unknown) : {};
  const schema = schemaDefinitionSchema.parse(payload);
  return {
    status: 'found',
    schema
  } satisfies MetastoreSchemaFetchResult;
}

export async function fetchFilestoreHealth(
  authorizedFetch: ReturnType<typeof useAuthorizedFetch>,
  options: { signal?: AbortSignal } = {}
): Promise<MetastoreFilestoreHealth> {
  const response = await authorizedFetch(`${METASTORE_BASE_URL}/filestore/health`, {
    signal: options.signal
  });
  const text = await response.text();
  if (!response.ok && response.status !== 503) {
    throw new Error(extractErrorMessage(text, response.status));
  }
  let parsed: unknown = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new Error('Failed to parse filestore health payload');
    }
  }
  return filestoreHealthSnapshotSchema.parse(parsed);
}

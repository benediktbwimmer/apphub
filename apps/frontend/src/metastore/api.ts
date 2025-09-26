import { METASTORE_BASE_URL } from '../config';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import {
  recordResponseSchema,
  searchResponseSchema,
  auditResponseSchema,
  bulkResponseSchema
} from './types';
import type {
  MetastoreSearchResponse,
  MetastoreRecordDetail,
  MetastoreUpsertPayload,
  MetastorePatchPayload,
  BulkRequestPayload,
  BulkResponsePayload,
  MetastoreAuditEntry
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
): Promise<{ entries: MetastoreAuditEntry[]; total: number }> {
  const url = new URL(`/records/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}/audit`, METASTORE_BASE_URL);
  if (options.limit) {
    url.searchParams.set('limit', String(options.limit));
  }
  if (options.offset) {
    url.searchParams.set('offset', String(options.offset));
  }
  const response = await authorizedFetch(url.toString(), { signal: options.signal });
  const parsed = await parseJsonOrError(response, auditResponseSchema);
  return {
    entries: parsed.entries,
    total: parsed.pagination.total
  };
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

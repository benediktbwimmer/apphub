import { ApiError } from '@apphub/shared/api/metastore';
import { createMetastoreClient } from '@apphub/shared/api';
import { resolveCancelable } from '../api/cancelable';
import { METASTORE_BASE_URL } from '../config';
import {
  auditDiffSchema,
  auditResponseSchema,
  bulkResponseSchema,
  filestoreHealthSnapshotSchema,
  namespaceListResponseSchema,
  recordResponseSchema,
  restoreResponseSchema,
  schemaDefinitionSchema,
  searchResponseSchema,
  type BulkRequestPayload,
  type BulkResponsePayload,
  type MetastoreAuditDiff,
  type MetastoreAuditResponse,
  type MetastoreFilestoreHealth,
  type MetastoreNamespaceListResponse,
  type MetastorePatchPayload,
  type MetastoreRecordDetail,
  type MetastoreRestorePayload,
  type MetastoreRestoreResponse,
  type MetastoreSchemaFetchResult,
  type MetastoreSearchResponse,
  type MetastoreUpsertPayload
} from './types';

type MetastoreClientInstance = ReturnType<typeof createMetastoreClient>;

interface RequestOptions {
  signal?: AbortSignal;
}

type SearchRecordsInput = Parameters<MetastoreClientInstance['records']['searchRecords']>[0]['requestBody'];
type RestoreRecordInput = Parameters<MetastoreClientInstance['records']['restoreRecord']>[0]['requestBody'];
type PurgeRecordInput = Parameters<MetastoreClientInstance['records']['purgeRecord']>[0]['requestBody'];
type DeleteRecordInput = Parameters<MetastoreClientInstance['records']['deleteRecord']>[0]['requestBody'];

type SchemaFetchResponse = Awaited<ReturnType<MetastoreClientInstance['schemas']['getSchemaDefinition']>>;

type FilestoreHealthResponse = Awaited<ReturnType<MetastoreClientInstance['filestore']['filestoreHealth']>>;

type NamespaceListResponse = Awaited<ReturnType<MetastoreClientInstance['namespaces']['listNamespaces']>>;

type BulkOperationResponse = Awaited<ReturnType<MetastoreClientInstance['records']['bulkRecords']>>;

type RecordResponse = Awaited<ReturnType<MetastoreClientInstance['records']['getRecord']>>;

type RecordMutationResponse = Awaited<ReturnType<MetastoreClientInstance['records']['upsertRecord']>>;

type RecordPatchResponse = Awaited<ReturnType<MetastoreClientInstance['records']['patchRecord']>>;

type RecordDeleteResponse = Awaited<ReturnType<MetastoreClientInstance['records']['deleteRecord']>>;

type RecordRestoreResponse = Awaited<ReturnType<MetastoreClientInstance['records']['restoreRecord']>>;

type RecordAuditResponse = Awaited<ReturnType<MetastoreClientInstance['records']['listRecordAudit']>>;

type RecordAuditDiffResponse = Awaited<ReturnType<MetastoreClientInstance['records']['diffRecordAudit']>>;

type SearchRecordsResponse = Awaited<ReturnType<MetastoreClientInstance['records']['searchRecords']>>;

function createClient(token?: string | null): MetastoreClientInstance {
  return createMetastoreClient({
    baseUrl: METASTORE_BASE_URL,
    token: token ?? undefined,
    withCredentials: true
  });
}

export async function searchRecords(
  token: string | null,
  body: SearchRecordsInput,
  options: RequestOptions = {}
): Promise<MetastoreSearchResponse> {
  const client = createClient(token);
  const response = await resolveCancelable<SearchRecordsResponse>(
    client.records.searchRecords({ requestBody: body }),
    options.signal
  );
  return searchResponseSchema.parse(response);
}

export async function fetchRecord(
  token: string | null,
  namespace: string,
  key: string,
  options: RequestOptions & { includeDeleted?: boolean } = {}
): Promise<MetastoreRecordDetail> {
  const client = createClient(token);
  const response = await resolveCancelable<RecordResponse>(
    client.records.getRecord({ namespace, key, includeDeleted: options.includeDeleted }),
    options.signal
  );
  const payload = recordResponseSchema.parse(response);
  return payload.record;
}

export async function fetchRecordAudits(
  token: string | null,
  namespace: string,
  key: string,
  options: RequestOptions & { limit?: number; offset?: number } = {}
): Promise<MetastoreAuditResponse> {
  const client = createClient(token);
  const response = await resolveCancelable<RecordAuditResponse>(
    client.records.listRecordAudit({
      namespace,
      key,
      limit: options.limit,
      offset: options.offset
    }),
    options.signal
  );
  return auditResponseSchema.parse(response);
}

export async function fetchRecordAuditDiff(
  token: string | null,
  namespace: string,
  key: string,
  auditId: number,
  options: RequestOptions = {}
): Promise<MetastoreAuditDiff> {
  const client = createClient(token);
  const response = await resolveCancelable<RecordAuditDiffResponse>(
    client.records.diffRecordAudit({ namespace, key, id: auditId }),
    options.signal
  );
  return auditDiffSchema.parse(response);
}

export async function upsertRecord(
  token: string | null,
  namespace: string,
  key: string,
  payload: MetastoreUpsertPayload,
  options: RequestOptions = {}
): Promise<MetastoreRecordDetail> {
  const client = createClient(token);
  const response = await resolveCancelable<RecordMutationResponse>(
    client.records.upsertRecord({ namespace, key, requestBody: payload }),
    options.signal
  );
  const parsed = recordResponseSchema.parse(response);
  return parsed.record;
}

export async function patchRecord(
  token: string | null,
  namespace: string,
  key: string,
  payload: MetastorePatchPayload,
  options: RequestOptions = {}
): Promise<MetastoreRecordDetail> {
  const client = createClient(token);
  const response = await resolveCancelable<RecordPatchResponse>(
    client.records.patchRecord({ namespace, key, requestBody: payload }),
    options.signal
  );
  const parsed = recordResponseSchema.parse(response);
  return parsed.record;
}

export async function deleteRecord(
  token: string | null,
  namespace: string,
  key: string,
  payload: DeleteRecordInput | undefined,
  options: RequestOptions = {}
): Promise<MetastoreRecordDetail> {
  const client = createClient(token);
  const response = await resolveCancelable<RecordDeleteResponse>(
    client.records.deleteRecord({ namespace, key, requestBody: payload }),
    options.signal
  );
  const parsed = recordResponseSchema.parse(response);
  return parsed.record;
}

export async function purgeRecord(
  token: string | null,
  namespace: string,
  key: string,
  payload: PurgeRecordInput | undefined,
  options: RequestOptions = {}
): Promise<MetastoreRecordDetail> {
  const client = createClient(token);
  const response = await resolveCancelable<RecordDeleteResponse>(
    client.records.purgeRecord({ namespace, key, requestBody: payload }),
    options.signal
  );
  const parsed = recordResponseSchema.parse(response);
  return parsed.record;
}

export async function restoreRecordFromAudit(
  token: string | null,
  namespace: string,
  key: string,
  payload: MetastoreRestorePayload,
  options: RequestOptions = {}
): Promise<MetastoreRestoreResponse> {
  const client = createClient(token);
  const response = await resolveCancelable<RecordRestoreResponse>(
    client.records.restoreRecord({
      namespace,
      key,
      requestBody: payload as RestoreRecordInput
    }),
    options.signal
  );
  return restoreResponseSchema.parse(response) as MetastoreRestoreResponse;
}

export async function bulkOperate(
  token: string | null,
  payload: BulkRequestPayload,
  options: RequestOptions = {}
): Promise<BulkResponsePayload> {
  const client = createClient(token);
  const response = await resolveCancelable<BulkOperationResponse>(
    client.records.bulkRecords({ requestBody: payload }),
    options.signal
  );
  return bulkResponseSchema.parse(response);
}

export async function listNamespaces(
  token: string | null,
  options: RequestOptions & { prefix?: string; limit?: number; offset?: number } = {}
): Promise<MetastoreNamespaceListResponse> {
  const client = createClient(token);
  const response = await resolveCancelable<NamespaceListResponse>(
    client.namespaces.listNamespaces({
      prefix: options.prefix,
      limit: options.limit,
      offset: options.offset
    }),
    options.signal
  );
  return namespaceListResponseSchema.parse(response);
}

export async function fetchSchemaDefinition(
  token: string | null,
  schemaHash: string,
  options: RequestOptions = {}
): Promise<MetastoreSchemaFetchResult> {
  const client = createClient(token);
  try {
    const response = await resolveCancelable<SchemaFetchResponse>(
      client.schemas.getSchemaDefinition({ hash: schemaHash }),
      options.signal
    );
    const parsed = schemaDefinitionSchema.safeParse(response);
    if (parsed.success) {
      return { status: 'found', schema: parsed.data };
    }
    return { status: 'missing', message: 'Schema not found' };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { status: 'missing', message: 'Schema not found' };
    }
    throw error;
  }
}

export async function fetchFilestoreHealth(
  token: string | null,
  options: RequestOptions = {}
): Promise<MetastoreFilestoreHealth> {
  const client = createClient(token);
  const response = await resolveCancelable<FilestoreHealthResponse>(
    client.filestore.filestoreHealth(),
    options.signal
  );
  return filestoreHealthSnapshotSchema.parse(response);
}

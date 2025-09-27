import { FILESTORE_BASE_URL } from '../config';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { z } from 'zod';
import {
  filestoreBackendMountListEnvelopeSchema,
  filestoreCommandResponseEnvelopeSchema,
  filestoreEventSchema,
  filestoreNodeChildrenEnvelopeSchema,
  filestoreNodeListEnvelopeSchema,
  filestoreNodeResponseSchema,
  filestorePresignEnvelopeSchema,
  filestoreReconciliationEnvelopeSchema,
  filestoreReconciliationJobDetailEnvelopeSchema,
  filestoreReconciliationJobListEnvelopeSchema,
  type FilestoreCommandResponse,
  type FilestoreEvent,
  type FilestoreEventType,
  type FilestoreBackendMountList,
  type FilestoreBackendMountState,
  filestoreBackendKindSchema,
  filestoreBackendAccessModeSchema,
  type FilestoreNodeChildren,
  type FilestoreNodeKind,
  type FilestoreNodeList,
  type FilestoreNode,
  type FilestoreNodeState,
  type FilestoreReconciliationReason,
  type FilestoreReconciliationResult,
  type FilestorePresignPayload,
  type FilestoreReconciliationJob,
  type FilestoreReconciliationJobList,
  type FilestoreReconciliationJobDetail,
  type FilestoreReconciliationJobStatus
} from './types';
export type { FilestoreBackendMount, FilestoreBackendMountState } from './types';

type AuthorizedFetch = ReturnType<typeof useAuthorizedFetch>;

type JsonHeadersOptions = {
  idempotencyKey?: string;
  principal?: string;
};

type RequestOptions = {
  signal?: AbortSignal;
};

function appendQueryValues(params: URLSearchParams, key: string, values?: readonly string[]) {
  if (!values || values.length === 0) {
    return;
  }
  for (const value of values) {
    params.append(key, value);
  }
}

export type ListBackendMountsParams = {
  limit?: number;
  offset?: number;
  kinds?: z.infer<typeof filestoreBackendKindSchema>[];
  states?: FilestoreBackendMountState[];
  accessModes?: z.infer<typeof filestoreBackendAccessModeSchema>[];
  search?: string | null;
};

export type ListNodesParams = {
  backendMountId: number;
  limit?: number;
  offset?: number;
  path?: string | null;
  depth?: number | null;
  search?: string | null;
  states?: FilestoreNodeState[];
  kinds?: FilestoreNodeKind[];
  driftOnly?: boolean;
};

export type FetchNodeChildrenParams = {
  limit?: number;
  offset?: number;
  search?: string | null;
  states?: FilestoreNodeState[];
  kinds?: FilestoreNodeKind[];
  driftOnly?: boolean;
};

export type CreateDirectoryInput = {
  backendMountId: number;
  path: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  principal?: string;
};

export type DeleteNodeInput = {
  backendMountId: number;
  path: string;
  recursive?: boolean;
  idempotencyKey?: string;
  principal?: string;
};

export type UploadFileInput = {
  backendMountId: number;
  path: string;
  file: Blob;
  overwrite?: boolean;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  checksum?: string;
  contentHash?: string;
  principal?: string;
};

export type UpdateNodeMetadataInput = {
  nodeId: number;
  backendMountId: number;
  set?: Record<string, unknown>;
  unset?: string[];
  idempotencyKey?: string;
  principal?: string;
};

export type MoveNodeInput = {
  backendMountId: number;
  path: string;
  targetPath: string;
  targetBackendMountId?: number;
  overwrite?: boolean;
  idempotencyKey?: string;
  principal?: string;
};

export type CopyNodeInput = {
  backendMountId: number;
  path: string;
  targetPath: string;
  targetBackendMountId?: number;
  overwrite?: boolean;
  idempotencyKey?: string;
  principal?: string;
};

export type GetNodeByPathInput = {
  backendMountId: number;
  path: string;
};

export type EnqueueReconciliationInput = {
  backendMountId: number;
  path: string;
  nodeId?: number | null;
  reason?: FilestoreReconciliationReason;
  detectChildren?: boolean;
  requestedHash?: boolean;
};

export type ListReconciliationJobsParams = {
  backendMountId: number;
  statuses?: FilestoreReconciliationJobStatus[];
  path?: string | null;
  limit?: number;
  offset?: number;
};

export type FilestoreEventHandler = (event: FilestoreEvent) => void | Promise<void>;

export type FilestoreEventStreamOptions = {
  signal?: AbortSignal;
  eventTypes?: FilestoreEventType[];
  onError?: (error: Error) => void;
};

export type FilestoreEventSubscription = {
  close: () => void;
};

function buildFilestoreUrl(path: string): string {
  const normalizedPath = path.replace(/^\/+/, '');
  const base = FILESTORE_BASE_URL.endsWith('/') ? FILESTORE_BASE_URL : `${FILESTORE_BASE_URL}/`;
  return new URL(normalizedPath, base).toString();
}

function buildJsonHeaders(options: JsonHeadersOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }
  if (options.principal) {
    headers['x-filestore-principal'] = options.principal;
  }
  return headers;
}

function extractFilestoreErrorMessage(raw: string, status: number): string {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { message?: unknown; error?: unknown };
      const candidate = parsed.message ?? parsed.error;
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate;
      }
      if (
        candidate &&
        typeof candidate === 'object' &&
        'message' in (candidate as Record<string, unknown>) &&
        typeof (candidate as Record<string, unknown>).message === 'string'
      ) {
        return ((candidate as Record<string, unknown>).message as string) || `Filestore request failed with status ${status}`;
      }
    } catch {
      // ignore JSON parse errors
    }
  }
  return `Filestore request failed with status ${status}`;
}

async function parseJsonOrThrow<T>(response: Response, schema: z.ZodSchema<T>): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(extractFilestoreErrorMessage(text, response.status));
  }
  const payload = text ? (JSON.parse(text) as unknown) : {};
  return schema.parse(payload);
}

export async function listBackendMounts(
  authorizedFetch: AuthorizedFetch,
  params: ListBackendMountsParams = {},
  options: RequestOptions = {}
): Promise<FilestoreBackendMountList> {
  const url = new URL(buildFilestoreUrl('/v1/backend-mounts'));
  const searchParams = new URLSearchParams();
  if (params.limit !== undefined) {
    searchParams.set('limit', String(params.limit));
  }
  if (params.offset !== undefined) {
    searchParams.set('offset', String(params.offset));
  }
  appendQueryValues(searchParams, 'kinds', params.kinds);
  appendQueryValues(searchParams, 'states', params.states);
  appendQueryValues(searchParams, 'accessModes', params.accessModes);
  if (params.search && params.search.trim().length > 0) {
    searchParams.set('search', params.search.trim());
  }
  const finalUrl = searchParams.toString().length > 0 ? `${url.toString()}?${searchParams.toString()}` : url.toString();
  const response = await authorizedFetch(finalUrl, {
    method: 'GET',
    signal: options.signal
  });
  const payload = await parseJsonOrThrow(response, filestoreBackendMountListEnvelopeSchema);
  return payload.data;
}

export async function createDirectory(
  authorizedFetch: AuthorizedFetch,
  input: CreateDirectoryInput,
  options: RequestOptions = {}
): Promise<FilestoreCommandResponse> {
  const response = await authorizedFetch(buildFilestoreUrl('/v1/directories'), {
    method: 'POST',
    headers: buildJsonHeaders({ idempotencyKey: input.idempotencyKey, principal: input.principal }),
    body: JSON.stringify({
      backendMountId: input.backendMountId,
      path: input.path,
      metadata: input.metadata,
      idempotencyKey: input.idempotencyKey
    }),
    signal: options.signal
  });
  const envelope = await parseJsonOrThrow(response, filestoreCommandResponseEnvelopeSchema);
  return envelope.data;
}

export async function deleteNode(
  authorizedFetch: AuthorizedFetch,
  input: DeleteNodeInput,
  options: RequestOptions = {}
): Promise<FilestoreCommandResponse> {
  const response = await authorizedFetch(buildFilestoreUrl('/v1/nodes'), {
    method: 'DELETE',
    headers: buildJsonHeaders({ idempotencyKey: input.idempotencyKey, principal: input.principal }),
    body: JSON.stringify({
      backendMountId: input.backendMountId,
      path: input.path,
      recursive: input.recursive ?? false,
      idempotencyKey: input.idempotencyKey
    }),
    signal: options.signal
  });
  const envelope = await parseJsonOrThrow(response, filestoreCommandResponseEnvelopeSchema);
  return envelope.data;
}

export async function updateNodeMetadata(
  authorizedFetch: AuthorizedFetch,
  input: UpdateNodeMetadataInput,
  options: RequestOptions = {}
): Promise<FilestoreCommandResponse> {
  const response = await authorizedFetch(buildFilestoreUrl(`/v1/nodes/${input.nodeId}/metadata`), {
    method: 'PATCH',
    headers: buildJsonHeaders({
      idempotencyKey: input.idempotencyKey,
      principal: input.principal
    }),
    body: JSON.stringify({
      backendMountId: input.backendMountId,
      set: input.set,
      unset: input.unset
    }),
    signal: options.signal
  });
  const envelope = await parseJsonOrThrow(response, filestoreCommandResponseEnvelopeSchema);
  return envelope.data;
}

export async function moveNode(
  authorizedFetch: AuthorizedFetch,
  input: MoveNodeInput,
  options: RequestOptions = {}
): Promise<FilestoreCommandResponse> {
  const response = await authorizedFetch(buildFilestoreUrl('/v1/nodes/move'), {
    method: 'POST',
    headers: buildJsonHeaders({
      idempotencyKey: input.idempotencyKey,
      principal: input.principal
    }),
    body: JSON.stringify({
      backendMountId: input.backendMountId,
      path: input.path,
      targetPath: input.targetPath,
      targetBackendMountId: input.targetBackendMountId,
      overwrite: input.overwrite
    }),
    signal: options.signal
  });
  const envelope = await parseJsonOrThrow(response, filestoreCommandResponseEnvelopeSchema);
  return envelope.data;
}

export async function copyNode(
  authorizedFetch: AuthorizedFetch,
  input: CopyNodeInput,
  options: RequestOptions = {}
): Promise<FilestoreCommandResponse> {
  const response = await authorizedFetch(buildFilestoreUrl('/v1/nodes/copy'), {
    method: 'POST',
    headers: buildJsonHeaders({
      idempotencyKey: input.idempotencyKey,
      principal: input.principal
    }),
    body: JSON.stringify({
      backendMountId: input.backendMountId,
      path: input.path,
      targetPath: input.targetPath,
      targetBackendMountId: input.targetBackendMountId,
      overwrite: input.overwrite
    }),
    signal: options.signal
  });
  const envelope = await parseJsonOrThrow(response, filestoreCommandResponseEnvelopeSchema);
  return envelope.data;
}

export async function uploadFile(
  authorizedFetch: AuthorizedFetch,
  input: UploadFileInput,
  options: RequestOptions = {}
): Promise<FilestoreCommandResponse> {
  const formData = new FormData();
  formData.set('backendMountId', String(input.backendMountId));
  formData.set('path', input.path);
  if (input.overwrite) {
    formData.set('overwrite', 'true');
  }
  if (input.metadata) {
    formData.set('metadata', JSON.stringify(input.metadata));
  }
  if (input.idempotencyKey) {
    formData.set('idempotencyKey', input.idempotencyKey);
  }

  const candidateName = (input.file as { name?: string }).name;
  const inferredName = typeof candidateName === 'string' && candidateName.trim().length > 0 ? candidateName : 'upload.bin';
  formData.append('file', input.file, inferredName);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (input.idempotencyKey) {
    headers['Idempotency-Key'] = input.idempotencyKey;
  }
  if (input.principal) {
    headers['x-filestore-principal'] = input.principal;
  }
  if (input.checksum) {
    headers['x-filestore-checksum'] = input.checksum;
  }
  if (input.contentHash) {
    headers['x-filestore-content-hash'] = input.contentHash;
  }

  const response = await authorizedFetch(buildFilestoreUrl('/v1/files'), {
    method: 'POST',
    headers,
    body: formData,
    signal: options.signal
  });

  const envelope = await parseJsonOrThrow(response, filestoreCommandResponseEnvelopeSchema);
  return envelope.data;
}

export async function fetchNodeById(
  authorizedFetch: AuthorizedFetch,
  nodeId: number,
  options: RequestOptions = {}
): Promise<FilestoreNode> {
  const response = await authorizedFetch(buildFilestoreUrl(`/v1/nodes/${nodeId}`), {
    signal: options.signal
  });
  const payload = await parseJsonOrThrow(response, filestoreNodeResponseSchema);
  return payload.data;
}

export async function presignNodeDownload(
  authorizedFetch: AuthorizedFetch,
  nodeId: number,
  options: { expiresInSeconds?: number } = {},
  requestOptions: RequestOptions = {}
): Promise<FilestorePresignPayload> {
  const params = new URLSearchParams();
  if (options.expiresInSeconds && options.expiresInSeconds > 0) {
    params.set('expiresIn', String(options.expiresInSeconds));
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const response = await authorizedFetch(buildFilestoreUrl(`/v1/files/${nodeId}/presign${suffix}`), {
    method: 'GET',
    signal: requestOptions.signal
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(extractFilestoreErrorMessage(text, response.status));
  }
  const payload = filestorePresignEnvelopeSchema.parse(JSON.parse(text));
  return payload.data;
}

export async function fetchNodeByPath(
  authorizedFetch: AuthorizedFetch,
  input: GetNodeByPathInput,
  options: RequestOptions = {}
): Promise<FilestoreNode> {
  const url = new URL(buildFilestoreUrl('/v1/nodes/by-path'));
  url.searchParams.set('backendMountId', String(input.backendMountId));
  url.searchParams.set('path', input.path);
  const response = await authorizedFetch(url.toString(), { signal: options.signal });
  const payload = await parseJsonOrThrow(response, filestoreNodeResponseSchema);
  return payload.data;
}

export async function listNodes(
  authorizedFetch: AuthorizedFetch,
  params: ListNodesParams,
  options: RequestOptions = {}
): Promise<FilestoreNodeList> {
  const url = new URL(buildFilestoreUrl('/v1/nodes'));
  url.searchParams.set('backendMountId', String(params.backendMountId));
  if (params.limit && params.limit > 0) {
    url.searchParams.set('limit', String(params.limit));
  }
  if (params.offset && params.offset > 0) {
    url.searchParams.set('offset', String(params.offset));
  }
  if (params.path && params.path.trim().length > 0) {
    url.searchParams.set('path', params.path.trim());
  }
  if (typeof params.depth === 'number' && Number.isFinite(params.depth)) {
    url.searchParams.set('depth', String(params.depth));
  }
  if (params.search && params.search.trim().length > 0) {
    url.searchParams.set('search', params.search.trim());
  }
  if (params.driftOnly) {
    url.searchParams.set('driftOnly', 'true');
  }
  appendQueryValues(url.searchParams, 'states', params.states);
  appendQueryValues(url.searchParams, 'kinds', params.kinds);

  const response = await authorizedFetch(url.toString(), { signal: options.signal });
  const payload = await parseJsonOrThrow(response, filestoreNodeListEnvelopeSchema);
  return payload.data;
}

export async function fetchNodeChildren(
  authorizedFetch: AuthorizedFetch,
  nodeId: number,
  params: FetchNodeChildrenParams = {},
  options: RequestOptions = {}
): Promise<FilestoreNodeChildren> {
  const url = new URL(buildFilestoreUrl(`/v1/nodes/${nodeId}/children`));
  if (params.limit && params.limit > 0) {
    url.searchParams.set('limit', String(params.limit));
  }
  if (params.offset && params.offset > 0) {
    url.searchParams.set('offset', String(params.offset));
  }
  if (params.search && params.search.trim().length > 0) {
    url.searchParams.set('search', params.search.trim());
  }
  if (params.driftOnly) {
    url.searchParams.set('driftOnly', 'true');
  }
  appendQueryValues(url.searchParams, 'states', params.states);
  appendQueryValues(url.searchParams, 'kinds', params.kinds);

  const response = await authorizedFetch(url.toString(), { signal: options.signal });
  const payload = await parseJsonOrThrow(response, filestoreNodeChildrenEnvelopeSchema);
  return payload.data;
}

export async function enqueueReconciliation(
  authorizedFetch: AuthorizedFetch,
  input: EnqueueReconciliationInput,
  options: RequestOptions = {}
): Promise<FilestoreReconciliationResult> {
  const response = await authorizedFetch(buildFilestoreUrl('/v1/reconciliation'), {
    method: 'POST',
    headers: buildJsonHeaders(),
    body: JSON.stringify({
      backendMountId: input.backendMountId,
      path: input.path,
      nodeId: input.nodeId ?? null,
      reason: input.reason ?? 'manual',
      detectChildren: input.detectChildren ?? false,
      requestedHash: input.requestedHash ?? false
    }),
    signal: options.signal
  });
  const payload = await parseJsonOrThrow(response, filestoreReconciliationEnvelopeSchema);
  return payload.data;
}

export async function listReconciliationJobs(
  authorizedFetch: AuthorizedFetch,
  params: ListReconciliationJobsParams,
  options: RequestOptions = {}
): Promise<FilestoreReconciliationJobList> {
  const url = new URL(buildFilestoreUrl('/v1/reconciliation/jobs'));
  url.searchParams.set('backendMountId', String(params.backendMountId));
  if (params.limit && params.limit > 0) {
    url.searchParams.set('limit', String(params.limit));
  }
  if (params.offset && params.offset > 0) {
    url.searchParams.set('offset', String(params.offset));
  }
  if (params.path && params.path.trim().length > 0) {
    url.searchParams.set('path', params.path.trim());
  }
  appendQueryValues(url.searchParams, 'status', params.statuses);

  const response = await authorizedFetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: options.signal
  });
  const payload = await parseJsonOrThrow(response, filestoreReconciliationJobListEnvelopeSchema);
  return payload.data;
}

export async function fetchReconciliationJob(
  authorizedFetch: AuthorizedFetch,
  jobId: number,
  options: RequestOptions = {}
): Promise<FilestoreReconciliationJobDetail> {
  const response = await authorizedFetch(buildFilestoreUrl(`/v1/reconciliation/jobs/${jobId}`), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: options.signal
  });
  const payload = await parseJsonOrThrow(response, filestoreReconciliationJobDetailEnvelopeSchema);
  return payload.data;
}

export function parseFilestoreEventFrame(
  frame: string,
  eventTypes?: FilestoreEventType[]
): FilestoreEvent | null {
  if (!frame.trim()) {
    return null;
  }
  const lines = frame.split(/\n/);
  let eventName: string | null = null;
  const dataLines: string[] = [];

  for (const rawLine of lines) {
    if (!rawLine.trim()) {
      continue;
    }
    if (rawLine.startsWith(':')) {
      continue;
    }
    if (rawLine.startsWith('event:')) {
      eventName = rawLine.slice(6).trim();
      continue;
    }
    if (rawLine.startsWith('data:')) {
      dataLines.push(rawLine.slice(5).trim());
    }
  }

  if (!eventName || dataLines.length === 0) {
    return null;
  }

  if (eventTypes && !eventTypes.includes(eventName as FilestoreEventType)) {
    return null;
  }

  const payloadText = dataLines.join('\n');
  try {
    const parsed = JSON.parse(payloadText) as { data?: unknown } | undefined;
    const candidate = {
      type: eventName,
      data: parsed?.data ?? parsed
    };
    return filestoreEventSchema.parse(candidate);
  } catch {
    return null;
  }
}

export function subscribeToFilestoreEvents(
  authorizedFetch: AuthorizedFetch,
  handler: FilestoreEventHandler,
  options: FilestoreEventStreamOptions = {}
): FilestoreEventSubscription {
  const controller = new AbortController();
  const { signal, eventTypes, onError } = options;

  const notifyError = (error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    if (onError) {
      onError(err);
      return;
    }
    console.error('[filestore] event stream error', err);
  };

  const abortWithReason = (reason?: unknown) => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };

  if (signal) {
    if (signal.aborted) {
      abortWithReason(signal.reason);
    } else {
      signal.addEventListener(
        'abort',
        () => {
          abortWithReason(signal.reason);
        },
        { once: true }
      );
    }
  }

  const processBuffer = async (buffer: string): Promise<string> => {
    let working = buffer;
    let separatorIndex = working.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const frame = working.slice(0, separatorIndex);
      working = working.slice(separatorIndex + 2);
      const event = parseFilestoreEventFrame(frame, eventTypes);
      if (event) {
        try {
          await handler(event);
        } catch (err) {
          notifyError(err);
        }
      }
      separatorIndex = working.indexOf('\n\n');
    }
    return working;
  };

  const run = async () => {
    try {
      if (controller.signal.aborted) {
        return;
      }

      const response = await authorizedFetch(buildFilestoreUrl('/v1/events/stream'), {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(extractFilestoreErrorMessage(text, response.status));
      }

      if (!response.body) {
        throw new Error('Filestore event stream did not return a readable body.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            buffer = await processBuffer(buffer);
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          buffer = await processBuffer(buffer);
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      notifyError(error);
    }
  };

  if (!controller.signal.aborted) {
    void run();
  }

  return {
    close: () => {
      abortWithReason();
    }
  };
}

export type {
  FilestoreBackendMount,
  FilestoreEvent,
  FilestoreEventType,
  FilestoreNode,
  FilestoreNodeDownload,
  FilestoreNodeChildren,
  FilestoreNodeList,
  FilestorePagination,
  FilestoreNodeState,
  FilestoreNodeKind,
  FilestoreReconciliationJob,
  FilestoreReconciliationJobStatus
} from './types';
export type {
  FilestoreCommandCompletedPayload,
  FilestoreCommandResponse,
  FilestoreDriftDetectedPayload,
  FilestoreNodeEventPayload,
  FilestoreNodeReconciledPayload,
  FilestoreReconciliationReason,
  FilestoreReconciliationResult,
  FilestorePresignPayload,
  FilestoreReconciliationJobList,
  FilestoreReconciliationJobDetail
} from './types';

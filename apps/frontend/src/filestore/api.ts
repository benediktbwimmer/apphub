import { z } from 'zod';
import {
  encodeFilestoreNodeFiltersParam,
  type FilestoreNodeFilters
} from '@apphub/shared/filestoreFilters';
import { ApiError } from '@apphub/shared/api/filestore';
import { createFilestoreClient } from '@apphub/shared/api';
import { resolveCancelable, type CancelablePromiseLike } from '../api/cancelable';
import { FILESTORE_BASE_URL } from '../config';
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
  type FilestoreReconciliationJobList,
  type FilestoreReconciliationJobDetail,
  type FilestoreReconciliationJobStatus
} from './types';

interface RequestOptions {
  signal?: AbortSignal;
}

type Token = string | null | undefined;

type JsonHeadersOptions = {
  idempotencyKey?: string;
  principal?: string;
  checksum?: string;
  contentHash?: string;
};

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
  filters?: FilestoreNodeFilters | null;
};

export type FetchNodeChildrenParams = {
  limit?: number;
  offset?: number;
  search?: string | null;
  states?: FilestoreNodeState[];
  kinds?: FilestoreNodeKind[];
  driftOnly?: boolean;
  filters?: FilestoreNodeFilters | null;
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
  principal?: string;
  idempotencyKey?: string;
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
  backendMountId?: number | null;
  pathPrefix?: string | null;
  onError?: (error: Error) => void;
  fetchImpl?: typeof fetch;
};

export type FilestoreEventSubscription = {
  close: () => void;
};

type FilestoreClientInstance = ReturnType<typeof createFilestoreClient>;

function createClient(token: Token): FilestoreClientInstance {
  return createFilestoreClient({
    baseUrl: FILESTORE_BASE_URL,
    token: token ?? undefined,
    withCredentials: true
  });
}

function parseEnvelope<T>(schema: z.ZodSchema<{ data: T }>, payload: unknown): T {
  const parsed = schema.parse(payload);
  return parsed.data;
}

function buildCommandHeaders(options: JsonHeadersOptions = {}): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }
  if (options.principal) {
    headers['x-filestore-principal'] = options.principal;
  }
  if (options.checksum) {
    headers['x-filestore-checksum'] = options.checksum;
  }
  if (options.contentHash) {
    headers['x-filestore-content-hash'] = options.contentHash;
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
    } catch {
      // Ignore parse errors and fall through to default message.
    }
  }
  return `Filestore request failed with status ${status}`;
}

function handleApiError(error: unknown): never {
  if (error instanceof ApiError) {
    const status = error.status ?? 500;
    if (typeof error.body === 'string') {
      throw new Error(extractFilestoreErrorMessage(error.body, status));
    }
    if (error.body && typeof error.body === 'object') {
      const record = error.body as Record<string, unknown>;
      const candidate = record.message ?? record.error;
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        throw new Error(candidate.trim());
      }
      throw new Error(extractFilestoreErrorMessage(JSON.stringify(record), status));
    }
    throw new Error(extractFilestoreErrorMessage('', status));
  }
  if (error instanceof Error) {
    throw error;
  }
  throw new Error(String(error));
}

async function execute<T>(promise: CancelablePromiseLike<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await resolveCancelable(promise, signal);
  } catch (error) {
    handleApiError(error);
  }
}

function buildFilestoreUrl(path: string): string {
  const normalizedPath = path.replace(/^\/+/, '');
  const base = FILESTORE_BASE_URL.endsWith('/') ? FILESTORE_BASE_URL : `${FILESTORE_BASE_URL}/`;
  return new URL(normalizedPath, base).toString();
}

export async function listBackendMounts(
  token: Token,
  params: ListBackendMountsParams = {},
  options: RequestOptions = {}
): Promise<FilestoreBackendMountList> {
  const client = createClient(token);
  const response = await execute(
    client.backendMounts.getV1BackendMounts({
      limit: params.limit,
      offset: params.offset,
      kinds: params.kinds,
      states: params.states,
      accessModes: params.accessModes,
      search: params.search ?? undefined
    }),
    options.signal
  );
  return parseEnvelope(filestoreBackendMountListEnvelopeSchema, response);
}

export async function createDirectory(
  token: Token,
  input: CreateDirectoryInput,
  options: RequestOptions = {}
): Promise<FilestoreCommandResponse> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'POST',
      url: '/v1/directories',
      body: {
        backendMountId: input.backendMountId,
        path: input.path,
        metadata: input.metadata,
        idempotencyKey: input.idempotencyKey
      },
      mediaType: 'application/json',
      headers: buildCommandHeaders({
        idempotencyKey: input.idempotencyKey,
        principal: input.principal
      })
    }),
    options.signal
  );
  return parseEnvelope(filestoreCommandResponseEnvelopeSchema, response);
}

export async function deleteNode(
  token: Token,
  input: DeleteNodeInput,
  options: RequestOptions = {}
): Promise<FilestoreCommandResponse> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'DELETE',
      url: '/v1/nodes',
      body: {
        backendMountId: input.backendMountId,
        path: input.path,
        recursive: input.recursive ?? false,
        idempotencyKey: input.idempotencyKey
      },
      mediaType: 'application/json',
      headers: buildCommandHeaders({
        idempotencyKey: input.idempotencyKey,
        principal: input.principal
      })
    }),
    options.signal
  );
  return parseEnvelope(filestoreCommandResponseEnvelopeSchema, response);
}

export async function updateNodeMetadata(
  token: Token,
  input: UpdateNodeMetadataInput,
  options: RequestOptions = {}
): Promise<FilestoreCommandResponse> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'PATCH',
      url: `/v1/nodes/${input.nodeId}/metadata`,
      body: {
        backendMountId: input.backendMountId,
        set: input.set,
        unset: input.unset,
        idempotencyKey: input.idempotencyKey
      },
      mediaType: 'application/json',
      headers: buildCommandHeaders({
        idempotencyKey: input.idempotencyKey,
        principal: input.principal
      })
    }),
    options.signal
  );
  return parseEnvelope(filestoreCommandResponseEnvelopeSchema, response);
}

export async function moveNode(
  token: Token,
  input: MoveNodeInput,
  options: RequestOptions = {}
): Promise<FilestoreCommandResponse> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'POST',
      url: '/v1/nodes/move',
      body: {
        backendMountId: input.backendMountId,
        path: input.path,
        targetPath: input.targetPath,
        targetBackendMountId: input.targetBackendMountId,
        overwrite: input.overwrite,
        idempotencyKey: input.idempotencyKey
      },
      mediaType: 'application/json',
      headers: buildCommandHeaders({
        idempotencyKey: input.idempotencyKey,
        principal: input.principal
      })
    }),
    options.signal
  );
  return parseEnvelope(filestoreCommandResponseEnvelopeSchema, response);
}

export async function copyNode(
  token: Token,
  input: CopyNodeInput,
  options: RequestOptions = {}
): Promise<FilestoreCommandResponse> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'POST',
      url: '/v1/nodes/copy',
      body: {
        backendMountId: input.backendMountId,
        path: input.path,
        targetPath: input.targetPath,
        targetBackendMountId: input.targetBackendMountId,
        overwrite: input.overwrite,
        idempotencyKey: input.idempotencyKey
      },
      mediaType: 'application/json',
      headers: buildCommandHeaders({
        idempotencyKey: input.idempotencyKey,
        principal: input.principal
      })
    }),
    options.signal
  );
  return parseEnvelope(filestoreCommandResponseEnvelopeSchema, response);
}

export async function uploadFile(
  token: Token,
  input: UploadFileInput,
  options: RequestOptions = {}
): Promise<FilestoreCommandResponse> {
  const client = createClient(token);
  const formData: Record<string, unknown> = {
    file: input.file,
    backendMountId: input.backendMountId,
    path: input.path,
    overwrite: input.overwrite === true ? 'true' : undefined,
    metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    idempotencyKey: input.idempotencyKey
  };

  const response = await execute(
    client.request.request({
      method: 'POST',
      url: '/v1/files',
      formData,
      mediaType: 'multipart/form-data',
      headers: buildCommandHeaders({
        idempotencyKey: input.idempotencyKey,
        principal: input.principal,
        checksum: input.checksum,
        contentHash: input.contentHash
      })
    }),
    options.signal
  );

  return parseEnvelope(filestoreCommandResponseEnvelopeSchema, response);
}

export async function fetchNodeById(
  token: Token,
  nodeId: number,
  options: RequestOptions = {}
): Promise<FilestoreNode> {
  const client = createClient(token);
  const response = await execute(client.nodes.getV1Nodes1({ id: nodeId }), options.signal);
  return parseEnvelope(filestoreNodeResponseSchema, response);
}

export async function presignNodeDownload(
  token: Token,
  nodeId: number,
  options: { expiresInSeconds?: number } = {},
  requestOptions: RequestOptions = {}
): Promise<FilestorePresignPayload> {
  const client = createClient(token);
  const response = await execute(
    client.files.getV1FilesPresign({ id: nodeId, expiresIn: options.expiresInSeconds }),
    requestOptions.signal
  );
  return parseEnvelope(filestorePresignEnvelopeSchema, response);
}

export async function fetchNodeByPath(
  token: Token,
  input: GetNodeByPathInput,
  options: RequestOptions = {}
): Promise<FilestoreNode> {
  const client = createClient(token);
  const response = await execute(
    client.nodes.getV1NodesByPath({ backendMountId: input.backendMountId, path: input.path }),
    options.signal
  );
  return parseEnvelope(filestoreNodeResponseSchema, response);
}

export async function listNodes(
  token: Token,
  params: ListNodesParams,
  options: RequestOptions = {}
): Promise<FilestoreNodeList> {
  const client = createClient(token);
  const response = await execute(
    client.nodes.getV1Nodes({
      backendMountId: params.backendMountId,
      limit: params.limit,
      offset: params.offset,
      path: params.path ?? undefined,
      depth: params.depth ?? undefined,
      search: (params.filters?.query ?? params.search) ?? undefined,
      states: params.states,
      kinds: params.kinds,
      driftOnly: params.driftOnly,
      filters: encodeFilestoreNodeFiltersParam(params.filters ?? null) ?? undefined
    }),
    options.signal
  );
  return parseEnvelope(filestoreNodeListEnvelopeSchema, response);
}

export async function fetchNodeChildren(
  token: Token,
  nodeId: number,
  params: FetchNodeChildrenParams = {},
  options: RequestOptions = {}
): Promise<FilestoreNodeChildren> {
  const client = createClient(token);
  const response = await execute(
    client.nodes.getV1NodesChildren({
      id: nodeId,
      limit: params.limit,
      offset: params.offset,
      search: (params.filters?.query ?? params.search) ?? undefined,
      states: params.states,
      kinds: params.kinds,
      driftOnly: params.driftOnly,
      filters: encodeFilestoreNodeFiltersParam(params.filters ?? null) ?? undefined
    }),
    options.signal
  );
  return parseEnvelope(filestoreNodeChildrenEnvelopeSchema, response);
}

export async function enqueueReconciliation(
  token: Token,
  input: EnqueueReconciliationInput,
  options: RequestOptions = {}
): Promise<FilestoreReconciliationResult> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'POST',
      url: '/v1/reconciliation',
      body: {
        backendMountId: input.backendMountId,
        path: input.path,
        nodeId: input.nodeId,
        reason: input.reason,
        detectChildren: input.detectChildren,
        requestedHash: input.requestedHash,
        idempotencyKey: input.idempotencyKey
      },
      mediaType: 'application/json',
      headers: buildCommandHeaders({
        idempotencyKey: input.idempotencyKey,
        principal: input.principal
      })
    }),
    options.signal
  );
  return parseEnvelope(filestoreReconciliationEnvelopeSchema, response);
}

export async function listReconciliationJobs(
  token: Token,
  params: ListReconciliationJobsParams,
  options: RequestOptions = {}
): Promise<FilestoreReconciliationJobList> {
  const client = createClient(token);
  const response = await execute(
    client.reconciliation.getV1ReconciliationJobs({
      backendMountId: params.backendMountId,
      status: params.statuses,
      path: params.path ?? undefined,
      limit: params.limit,
      offset: params.offset
    }),
    options.signal
  );
  return parseEnvelope(filestoreReconciliationJobListEnvelopeSchema, response);
}

export async function fetchReconciliationJob(
  token: Token,
  jobId: number,
  options: RequestOptions = {}
): Promise<FilestoreReconciliationJobDetail> {
  const client = createClient(token);
  const response = await execute(client.reconciliation.getV1ReconciliationJobs1({ id: jobId }), options.signal);
  return parseEnvelope(filestoreReconciliationJobDetailEnvelopeSchema, response);
}

function parseFilestoreEventFrameInternal(frame: string): FilestoreEvent | null {
  const lines = frame.split('\n');
  let eventType: string | null = null;
  let dataPayload = '';

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.slice('event:'.length).trim();
    }
    if (line.startsWith('data:')) {
      dataPayload += `${line.slice('data:'.length).trim()}`;
    }
  }

  if (!eventType || !dataPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(dataPayload) as unknown;
    const event = filestoreEventSchema.parse(parsed);
    return event;
  } catch {
    return null;
  }
}

export function parseFilestoreEventFrame(frame: string, allowedEvents?: FilestoreEventType[]): FilestoreEvent | null {
  const event = parseFilestoreEventFrameInternal(frame);
  if (!event) {
    return null;
  }
  if (allowedEvents && allowedEvents.length > 0 && !allowedEvents.includes(event.type)) {
    return null;
  }
  return event;
}

export function subscribeToFilestoreEvents(
  token: Token,
  handler: FilestoreEventHandler,
  options: FilestoreEventStreamOptions = {}
): FilestoreEventSubscription {
  const controller = new AbortController();
  const signal = options.signal;
  const fetchImpl = options.fetchImpl ?? fetch;

  const normalizedMountId = options.backendMountId ?? null;
  const normalizedPathPrefix = options.pathPrefix ?? null;
  const normalizedEventTypes = options.eventTypes ?? null;

  const notifyError = (error: unknown) => {
    if (typeof options.onError === 'function') {
      const normalized = error instanceof Error ? error : new Error(String(error));
      options.onError(normalized);
    }
  };

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener(
        'abort',
        () => {
          controller.abort(signal.reason);
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
      const event = parseFilestoreEventFrame(frame, normalizedEventTypes ?? undefined);
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

      const streamUrl = new URL(buildFilestoreUrl('/v1/events/stream'));
      if (normalizedMountId !== null) {
        streamUrl.searchParams.set('backendMountId', String(normalizedMountId));
      }
      if (normalizedPathPrefix) {
        streamUrl.searchParams.set('pathPrefix', normalizedPathPrefix);
      }
      if (normalizedEventTypes && normalizedEventTypes.length > 0) {
        for (const eventType of normalizedEventTypes) {
          streamUrl.searchParams.append('events', eventType);
        }
      }

      const headers: Record<string, string> = { Accept: 'text/event-stream' };
      const trimmedToken = token?.trim();
      if (trimmedToken) {
        headers.Authorization = `Bearer ${trimmedToken}`;
      }

      const response = await fetchImpl(streamUrl.toString(), {
        method: 'GET',
        headers,
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
      if (!controller.signal.aborted) {
        notifyError(error);
      }
    }
  };

  if (!controller.signal.aborted) {
    void run();
  }

  return {
    close: () => {
      controller.abort();
    }
  };
}

export type {
  FilestoreBackendMount,
  FilestoreBackendMountState,
  FilestoreCommandCompletedPayload,
  FilestoreCommandResponse,
  FilestoreDriftDetectedPayload,
  FilestoreEvent,
  FilestoreEventType,
  FilestoreNode,
  FilestoreNodeChildren,
  FilestoreNodeDownload,
  FilestoreNodeDownloadedPayload,
  FilestoreNodeEventPayload,
  FilestoreNodeKind,
  FilestoreNodeList,
  FilestoreNodeReconciledPayload,
  FilestoreNodeState,
  FilestorePagination,
  FilestoreReconciliationJob,
  FilestoreReconciliationJobDetail,
  FilestoreReconciliationJobList,
  FilestoreReconciliationJobStatus,
  FilestoreReconciliationReason,
} from './types';
export { describeFilestoreEvent } from './eventSummaries';

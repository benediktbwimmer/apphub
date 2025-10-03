import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import {
  CapabilityRequestError,
  type CapabilityErrorMetadata
} from '../errors';
import { httpRequest, type FetchLike, type TokenProvider } from '../internal/http';

export type FilestoreNodeKind = 'file' | 'directory' | string;

export interface FilestoreNode {
  id: number;
  backendMountId: number;
  parentId: number | null;
  path: string;
  name: string;
  depth: number;
  kind: FilestoreNodeKind;
  sizeBytes: number | null;
  checksum: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  state: string;
  version: number;
  isSymlink: boolean;
  lastSeenAt: string;
  lastModifiedAt: string | null;
  consistencyState: string;
  consistencyCheckedAt: string;
  lastReconciledAt: string | null;
  lastDriftDetectedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  rollup: Record<string, unknown> | null;
}

export interface FilestoreBackendMount {
  id: number;
  mountKey: string;
  backendKind: string;
  state: string;
  accessMode: string;
  displayName?: string | null;
  description?: string | null;
  labels?: Record<string, unknown> | null;
}

export interface FilestoreCommandResult<TResult = unknown> {
  idempotent: boolean;
  node: FilestoreNode | null;
  result: TResult;
}

export interface FilestoreCapabilityConfig {
  baseUrl: string;
  backendMountId: number;
  token?: TokenProvider;
  principal?: string;
  fetchImpl?: FetchLike;
}

export interface EnsureDirectoryInput {
  backendMountId?: number;
  path: string;
  metadata?: Record<string, unknown>;
  principal?: string;
  idempotencyKey?: string;
}

export interface UploadFileInput {
  backendMountId?: number;
  path: string;
  content: string | Uint8Array | ArrayBuffer;
  contentType?: string;
  metadata?: Record<string, unknown>;
  overwrite?: boolean;
  principal?: string;
  idempotencyKey?: string;
  filename?: string;
}

export interface UploadFileResult {
  nodeId: number | null;
  path: string;
  node?: FilestoreNode | null;
  idempotent: boolean;
}

export interface GetNodeByPathInput {
  backendMountId?: number;
  path: string;
  principal?: string;
}

export interface ListNodesInput {
  backendMountId?: number;
  path?: string;
  limit?: number;
  offset?: number;
  depth?: number;
  kinds?: Array<'file' | 'directory'>;
  states?: string[];
  search?: string;
  driftOnly?: boolean;
  principal?: string;
}

export interface ListNodesResult {
  nodes: FilestoreNode[];
  total: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
}

function classifyAssetMissing(
  error: CapabilityRequestError,
  metadata: CapabilityErrorMetadata
): never {
  const details: CapabilityErrorMetadata = {
    capability: 'filestore',
    resource: 'filestore.node',
    ...metadata
  };
  throw CapabilityRequestError.classify(error, {
    code: 'asset_missing',
    metadata: details
  });
}

export interface CopyNodeInput {
  backendMountId?: number;
  path: string;
  targetPath: string;
  targetBackendMountId?: number;
  overwrite?: boolean;
  principal?: string;
  idempotencyKey?: string;
}

export interface MoveNodeInput {
  backendMountId?: number;
  path: string;
  targetPath: string;
  targetBackendMountId?: number;
  overwrite?: boolean;
  principal?: string;
  idempotencyKey?: string;
}

export interface DeleteNodeInput {
  backendMountId?: number;
  path: string;
  recursive?: boolean;
  principal?: string;
  idempotencyKey?: string;
}

export interface DownloadFileInput {
  nodeId: number;
  principal?: string;
  range?: { start: number; end: number };
  signal?: AbortSignal;
}

export type FilestoreDownloadStream = NodeJS.ReadableStream | ReadableStream<Uint8Array>;

export interface DownloadFileResult {
  stream: FilestoreDownloadStream;
  status: number;
  contentLength: number | null;
  totalSize: number | null;
  checksum: string | null;
  contentHash: string | null;
  contentType: string | null;
  lastModified: string | null;
  headers: Record<string, string>;
}

export interface FilestoreCapability {
  ensureDirectory(input: EnsureDirectoryInput): Promise<void>;
  uploadFile(input: UploadFileInput): Promise<UploadFileResult>;
  getNodeByPath(input: GetNodeByPathInput): Promise<FilestoreNode>;
  listNodes(input: ListNodesInput): Promise<ListNodesResult>;
  copyNode(input: CopyNodeInput): Promise<FilestoreCommandResult>;
  moveNode(input: MoveNodeInput): Promise<FilestoreCommandResult>;
  deleteNode(input: DeleteNodeInput): Promise<FilestoreCommandResult>;
  downloadFile(input: DownloadFileInput): Promise<DownloadFileResult>;
  findBackendMountByKey(mountKey: string): Promise<FilestoreBackendMount | null>;
}

function toBuffer(content: string | Uint8Array | ArrayBuffer): Buffer {
  if (typeof content === 'string') {
    return Buffer.from(content, 'utf8');
  }
  if (content instanceof ArrayBuffer) {
    return Buffer.from(content);
  }
  return Buffer.from(content);
}

function resolveBackendMountId(
  candidate: number | undefined,
  fallback: number
): number {
  const value = candidate ?? fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('Filestore backend mount id must be a positive number');
  }
  return value;
}

async function resolveToken(provider?: TokenProvider): Promise<string | null> {
  if (!provider) {
    return null;
  }
  if (typeof provider === 'function') {
    const result = await provider();
    if (!result) {
      return null;
    }
    const trimmed = String(result).trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const trimmed = provider.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getFetch(fetchImpl?: FetchLike): FetchLike {
  const impl = fetchImpl ?? globalThis.fetch;
  if (!impl) {
    throw new Error('No fetch implementation available. Provide fetchImpl in the filestore capability config.');
  }
  return impl;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined | null>
): string {
  const normalizedBase = baseUrl.replace(/\/$/, '');
  const normalizedPath = path.replace(/^\//, '');
  const url = new URL(`${normalizedBase}/${normalizedPath}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

type CommandOutcomeEnvelope<TResult = unknown> = {
  data?: {
    idempotent?: boolean;
    node?: FilestoreNode | null;
    result?: TResult;
  } | null;
};

type ListNodesEnvelope = {
  data?: {
    nodes?: FilestoreNode[];
    pagination?: {
      total?: number;
      limit?: number;
      offset?: number;
      nextOffset?: number | null;
    };
  } | null;
};

type BackendMountListEnvelope = {
  data?: {
    mounts?: FilestoreBackendMount[];
    pagination?: {
      total?: number;
      limit?: number;
      offset?: number;
      nextOffset?: number | null;
    };
  } | null;
};

function toFilestoreCommandResult<TResult = unknown>(
  envelope: CommandOutcomeEnvelope<TResult>
): FilestoreCommandResult<TResult> {
  return {
    idempotent: envelope.data?.idempotent ?? false,
    node: envelope.data?.node ?? null,
    result: envelope.data?.result as TResult
  } satisfies FilestoreCommandResult<TResult>;
}

function toReadableStream(stream: ReadableStream<Uint8Array>): FilestoreDownloadStream {
  const readable = (Readable as unknown as { fromWeb?: (stream: ReadableStream<Uint8Array>) => NodeJS.ReadableStream })
    .fromWeb;
  if (typeof readable === 'function') {
    try {
      return readable(stream);
    } catch {
      // fall through to returning the original stream
    }
  }
  return stream;
}

function normalizeHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

function parseSize(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function createFilestoreCapability(config: FilestoreCapabilityConfig): FilestoreCapability {
  return {
    async ensureDirectory(input: EnsureDirectoryInput): Promise<void> {
      const backendMountId = resolveBackendMountId(input.backendMountId, config.backendMountId);
      await httpRequest({
        baseUrl: config.baseUrl,
        path: '/v1/directories',
        method: 'POST',
        authToken: config.token,
        principal: input.principal ?? config.principal,
        idempotencyKey: input.idempotencyKey,
        fetchImpl: config.fetchImpl,
        body: {
          backendMountId,
          path: input.path,
          metadata: input.metadata
        },
        expectJson: true
      });
    },

    async uploadFile(input: UploadFileInput): Promise<UploadFileResult> {
      const backendMountId = resolveBackendMountId(input.backendMountId, config.backendMountId);
      const fetchImpl = getFetch(config.fetchImpl);
      const url = buildUrl(config.baseUrl, '/v1/files');
      const token = await resolveToken(config.token);
      const principal = input.principal ?? config.principal ?? null;

      const form = new FormData();
      form.set('backendMountId', String(backendMountId));
      form.set('path', input.path);
      form.set('overwrite', String(input.overwrite ?? true));
      if (input.metadata) {
        form.set('metadata', JSON.stringify(input.metadata));
      }
      if (input.idempotencyKey) {
        form.set('idempotencyKey', input.idempotencyKey);
      }

      const filename = input.filename ?? input.path.split('/').pop() ?? 'upload.bin';
      const buffer = toBuffer(input.content);
      const binary = new Uint8Array(buffer.length);
      binary.set(buffer);
      const blob = new Blob([binary], {
        type: input.contentType ?? 'application/octet-stream'
      });
      form.set('file', blob, filename);

      const headers = new Headers();
      if (token) {
        headers.set('authorization', `Bearer ${token}`);
      }
      if (principal) {
        headers.set('x-apphub-principal', principal);
      }
      if (input.idempotencyKey) {
        headers.set('idempotency-key', input.idempotencyKey);
      }

      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: form as unknown as BodyInit
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => undefined);
        throw new CapabilityRequestError({
          method: 'POST',
          url,
          status: response.status,
          body: detail
        });
      }

      const payload = (await response.json()) as CommandOutcomeEnvelope<{ path?: string | null }>;
      const commandResult = toFilestoreCommandResult(payload);
      const node = commandResult.node;
      const resultPath = node?.path ?? payload.data?.result?.path ?? input.path;
      return {
        nodeId: node?.id ?? null,
        path: resultPath ?? input.path,
        node,
        idempotent: commandResult.idempotent
      } satisfies UploadFileResult;
    },

    async getNodeByPath(input: GetNodeByPathInput): Promise<FilestoreNode> {
      const backendMountId = resolveBackendMountId(input.backendMountId, config.backendMountId);
      let response: Awaited<ReturnType<typeof httpRequest<{ data?: FilestoreNode }>>>;
      try {
        response = await httpRequest<{ data?: FilestoreNode }>(
          {
            baseUrl: config.baseUrl,
            path: '/v1/nodes/by-path',
            method: 'GET',
            authToken: config.token,
            principal: input.principal ?? config.principal,
            fetchImpl: config.fetchImpl,
            query: {
              backendMountId,
              path: input.path
            },
            expectJson: true
          }
        );
      } catch (error) {
        if (error instanceof CapabilityRequestError && error.status === 404) {
          classifyAssetMissing(error, {
            capability: 'filestore.getNodeByPath',
            resource: 'filestore.path',
            assetId: input.path
          });
        }
        throw error;
      }

      const node = response.data?.data;
      if (!node) {
        throw new CapabilityRequestError({
          method: 'GET',
          url: buildUrl(config.baseUrl, '/v1/nodes/by-path'),
          status: response.status,
          body: 'Node not found',
          code: 'asset_missing',
          metadata: {
            capability: 'filestore.getNodeByPath',
            resource: 'filestore.path',
            assetId: input.path
          }
        });
      }
      return node;
    },

    async listNodes(input: ListNodesInput): Promise<ListNodesResult> {
      const backendMountId = resolveBackendMountId(input.backendMountId, config.backendMountId);
      const response = await httpRequest<ListNodesEnvelope>({
        baseUrl: config.baseUrl,
        path: '/v1/nodes',
        method: 'GET',
        authToken: config.token,
        principal: input.principal ?? config.principal,
        fetchImpl: config.fetchImpl,
        query: {
          backendMountId,
          path: input.path,
          limit: input.limit,
          offset: input.offset,
          depth: input.depth,
          driftOnly: input.driftOnly,
          kinds: input.kinds && input.kinds.length > 0 ? input.kinds.join(',') : undefined,
          states: input.states && input.states.length > 0 ? input.states.join(',') : undefined,
          search: input.search
        },
        expectJson: true
      });

      const data = response.data?.data ?? {};
      const nodes = Array.isArray(data.nodes) ? data.nodes : [];
      const pagination = data.pagination ?? {};
      return {
        nodes,
        total: pagination.total ?? nodes.length,
        limit: pagination.limit ?? (input.limit ?? nodes.length),
        offset: pagination.offset ?? (input.offset ?? 0),
        nextOffset:
          pagination.nextOffset !== undefined
            ? pagination.nextOffset
            : null
      } satisfies ListNodesResult;
    },

    async copyNode(input: CopyNodeInput): Promise<FilestoreCommandResult> {
      const backendMountId = resolveBackendMountId(input.backendMountId, config.backendMountId);
      const response = await httpRequest<CommandOutcomeEnvelope>({
        baseUrl: config.baseUrl,
        path: '/v1/nodes/copy',
        method: 'POST',
        authToken: config.token,
        principal: input.principal ?? config.principal,
        idempotencyKey: input.idempotencyKey,
        fetchImpl: config.fetchImpl,
        body: {
          backendMountId,
          path: input.path,
          targetPath: input.targetPath,
          targetBackendMountId: input.targetBackendMountId,
          overwrite: input.overwrite ?? false,
          idempotencyKey: input.idempotencyKey
        },
        expectJson: true
      });
      return toFilestoreCommandResult(response.data ?? {});
    },

    async moveNode(input: MoveNodeInput): Promise<FilestoreCommandResult> {
      const backendMountId = resolveBackendMountId(input.backendMountId, config.backendMountId);
      const response = await httpRequest<CommandOutcomeEnvelope>({
        baseUrl: config.baseUrl,
        path: '/v1/nodes/move',
        method: 'POST',
        authToken: config.token,
        principal: input.principal ?? config.principal,
        idempotencyKey: input.idempotencyKey,
        fetchImpl: config.fetchImpl,
        body: {
          backendMountId,
          path: input.path,
          targetPath: input.targetPath,
          targetBackendMountId: input.targetBackendMountId,
          overwrite: input.overwrite ?? false,
          idempotencyKey: input.idempotencyKey
        },
        expectJson: true
      });
      return toFilestoreCommandResult(response.data ?? {});
    },

    async deleteNode(input: DeleteNodeInput): Promise<FilestoreCommandResult> {
      const backendMountId = resolveBackendMountId(input.backendMountId, config.backendMountId);
      const response = await httpRequest<CommandOutcomeEnvelope>({
        baseUrl: config.baseUrl,
        path: '/v1/nodes',
        method: 'DELETE',
        authToken: config.token,
        principal: input.principal ?? config.principal,
        idempotencyKey: input.idempotencyKey,
        fetchImpl: config.fetchImpl,
        body: {
          backendMountId,
          path: input.path,
          recursive: input.recursive ?? false,
          idempotencyKey: input.idempotencyKey
        },
        expectJson: true
      });
      return toFilestoreCommandResult(response.data ?? {});
    },

    async downloadFile(input: DownloadFileInput): Promise<DownloadFileResult> {
      const fetchImpl = getFetch(config.fetchImpl);
      const token = await resolveToken(config.token);
      const principal = input.principal ?? config.principal ?? null;
      const url = buildUrl(config.baseUrl, `/v1/files/${encodeURIComponent(input.nodeId)}/content`);
      const headers = new Headers();
      if (token) {
        headers.set('authorization', `Bearer ${token}`);
      }
      if (principal) {
        headers.set('x-apphub-principal', principal);
      }
      if (input.range) {
        const start = Math.max(0, input.range.start);
        const end = Math.max(start, input.range.end);
        headers.set('range', `bytes=${start}-${end}`);
      }

      const response = await fetchImpl(url, {
        method: 'GET',
        headers,
        signal: input.signal
      });

      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => undefined);
        const error = new CapabilityRequestError({
          method: 'GET',
          url,
          status: response.status,
          body: detail
        });
        if (response.status === 404) {
          classifyAssetMissing(error, {
            capability: 'filestore.downloadFile',
            assetId: String(input.nodeId),
            resource: 'filestore.node'
          });
        }
        throw error;
      }

      const headersRecord = normalizeHeaders(response.headers);
      const contentLength = parseSize(response.headers.get('content-length'));
      const contentRange = response.headers.get('content-range');
      let totalSize: number | null = null;
      if (contentRange) {
        const match = /bytes\s+\d+-\d+\/(\d+|\*)/i.exec(contentRange);
        if (match) {
          totalSize = match[1] === '*' ? null : parseSize(match[1]) ?? null;
        }
      }

      return {
        stream: toReadableStream(response.body as ReadableStream<Uint8Array>),
        status: response.status,
        contentLength,
        totalSize,
        checksum: response.headers.get('x-filestore-checksum'),
        contentHash: response.headers.get('x-filestore-content-hash'),
        contentType: response.headers.get('content-type'),
        lastModified: response.headers.get('last-modified'),
        headers: headersRecord
      } satisfies DownloadFileResult;
    },

    async findBackendMountByKey(mountKey: string): Promise<FilestoreBackendMount | null> {
      const normalizedKey = mountKey.trim();
      if (!normalizedKey) {
        throw new Error('mountKey must be provided to resolve a backend mount.');
      }

      const pageSize = 100;
      let offset = 0;

      while (true) {
        const response = await httpRequest<BackendMountListEnvelope>({
          baseUrl: config.baseUrl,
          path: '/v1/backend-mounts',
          method: 'GET',
          authToken: config.token,
          fetchImpl: config.fetchImpl,
          query: {
            limit: pageSize,
            offset,
            search: normalizedKey
          },
          expectJson: true
        });

        const mounts = Array.isArray(response.data?.data?.mounts)
          ? response.data?.data?.mounts ?? []
          : [];
        const match = mounts.find((candidate) => candidate.mountKey === normalizedKey);
        if (match) {
          return match;
        }

        const nextOffset = response.data?.data?.pagination?.nextOffset;
        if (nextOffset === null || nextOffset === undefined || nextOffset === offset) {
          break;
        }
        offset = nextOffset;
      }

      return null;
    }
  } satisfies FilestoreCapability;
}

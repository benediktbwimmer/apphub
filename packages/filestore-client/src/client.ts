import { randomUUID } from 'node:crypto';
import { fetch, Headers, FormData } from 'undici';
import type { RequestInit, Response } from 'undici';
import { Blob, Buffer } from 'node:buffer';
import type { FilestoreEvent } from '@apphub/shared/filestoreEvents';
import { FilestoreClientError, FilestoreStreamClosedError } from './errors';
import type {
  ApiEnvelope,
  CommandResponse,
  CreateDirectoryInput,
  DeleteNodeInput,
  EnqueueReconciliationInput,
  FilestoreClientOptions,
  FilestoreEventEnvelope,
  FilestoreNodeResponse,
  GetNodeByPathInput,
  ListEventsOptions,
  ListNodesInput,
  ListNodesResult,
  CopyNodeInput,
  MoveNodeInput,
  UploadFileInput
} from './types';

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  idempotencyKey?: string;
  principal?: string;
  signal?: AbortSignal;
  expectJson?: boolean;
}

function combineSignals(primary: AbortController, external?: AbortSignal): void {
  if (!external) {
    return;
  }
  if (external.aborted) {
    primary.abort(external.reason);
    return;
  }
  external.addEventListener(
    'abort',
    () => {
      primary.abort(external.reason);
    },
    { once: true }
  );
}

async function resolveToken(token?: FilestoreClientOptions['token']): Promise<string | null> {
  if (!token) {
    return null;
  }
  if (typeof token === 'function') {
    const resolved = await token();
    return resolved ? String(resolved) : null;
  }
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export class FilestoreClient {
  private readonly baseUrl: URL;
  private readonly token?: FilestoreClientOptions['token'];
  private readonly defaultHeaders: Record<string, string>;
  private readonly userAgent?: string;
  private readonly fetchTimeoutMs?: number;

  constructor(options: FilestoreClientOptions) {
    if (!options.baseUrl) {
      throw new Error('FilestoreClient requires a baseUrl');
    }
    this.baseUrl = new URL(options.baseUrl);
    this.token = options.token;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.userAgent = options.userAgent;
    this.fetchTimeoutMs = options.fetchTimeoutMs;
  }

  async createDirectory<T = Record<string, unknown>>(
    input: CreateDirectoryInput
  ): Promise<CommandResponse<T>> {
    const idempotencyKey = input.idempotencyKey ?? randomUUID();
    const envelope = await this.request<ApiEnvelope<CommandResponse<T>>>(
      'POST',
      '/v1/directories',
      {
        body: {
          backendMountId: input.backendMountId,
          path: input.path,
          metadata: input.metadata,
          idempotencyKey
        },
        idempotencyKey,
        principal: input.principal
      }
    );
    return envelope.data;
  }

  async uploadFile<T = Record<string, unknown>>(
    input: UploadFileInput
  ): Promise<CommandResponse<T>> {
    const idempotencyKey = input.idempotencyKey ?? randomUUID();
    const form = new FormData();
    form.set('backendMountId', String(input.backendMountId));
    form.set('path', input.path);
    if (input.metadata) {
      form.set('metadata', JSON.stringify(input.metadata));
    }
    if (input.overwrite !== undefined) {
      form.set('overwrite', input.overwrite ? 'true' : 'false');
    }
    form.set('idempotencyKey', idempotencyKey);

    const contentBuffer =
      typeof input.content === 'string' ? Buffer.from(input.content) : Buffer.from(input.content);
    const blob = new Blob([contentBuffer], {
      type: input.contentType ?? 'application/octet-stream'
    });
    const filename = input.filename ?? input.path.split('/').pop() ?? 'upload.bin';
    form.append('file', blob, filename);

    const headers = this.buildHeaders(input.principal);
    headers.set('Idempotency-Key', idempotencyKey);

    const response = await this.fetchRaw(this.buildUrl('/v1/files'), {
      method: 'POST',
      headers,
      body: form
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const envelope = (await response.json()) as ApiEnvelope<CommandResponse<T>>;
    return envelope.data;
  }

  async deleteNode<T = Record<string, unknown>>(
    input: DeleteNodeInput
  ): Promise<CommandResponse<T>> {
    const idempotencyKey = input.idempotencyKey ?? randomUUID();
    const envelope = await this.request<ApiEnvelope<CommandResponse<T>>>(
      'DELETE',
      '/v1/nodes',
      {
        body: {
          backendMountId: input.backendMountId,
          path: input.path,
          recursive: input.recursive ?? false,
          idempotencyKey
        },
        idempotencyKey,
        principal: input.principal
      }
    );
    return envelope.data;
  }

  async moveNode<T = Record<string, unknown>>(
    input: MoveNodeInput
  ): Promise<CommandResponse<T>> {
    const idempotencyKey = input.idempotencyKey ?? randomUUID();
    const body: Record<string, unknown> = {
      backendMountId: input.backendMountId,
      path: input.path,
      targetPath: input.targetPath,
      overwrite: input.overwrite ?? false,
      idempotencyKey
    };
    if (input.targetBackendMountId !== undefined) {
      body.targetBackendMountId = input.targetBackendMountId;
    }
    const envelope = await this.request<ApiEnvelope<CommandResponse<T>>>(
      'POST',
      '/v1/nodes/move',
      {
        body,
        idempotencyKey,
        principal: input.principal
      }
    );
    return envelope.data;
  }

  async copyNode<T = Record<string, unknown>>(
    input: CopyNodeInput
  ): Promise<CommandResponse<T>> {
    const idempotencyKey = input.idempotencyKey ?? randomUUID();
    const body: Record<string, unknown> = {
      backendMountId: input.backendMountId,
      path: input.path,
      targetPath: input.targetPath,
      overwrite: input.overwrite ?? false,
      idempotencyKey
    };
    if (input.targetBackendMountId !== undefined) {
      body.targetBackendMountId = input.targetBackendMountId;
    }

    const envelope = await this.request<ApiEnvelope<CommandResponse<T>>>(
      'POST',
      '/v1/nodes/copy',
      {
        body,
        idempotencyKey,
        principal: input.principal
      }
    );
    return envelope.data;
  }

  async getNodeByPath(input: GetNodeByPathInput): Promise<FilestoreNodeResponse> {
    const envelope = await this.request<ApiEnvelope<FilestoreNodeResponse>>(
      'GET',
      '/v1/nodes/by-path',
      {
        query: {
          backendMountId: input.backendMountId,
          path: input.path
        }
      }
    );
    return envelope.data;
  }

  async listNodes(input: ListNodesInput): Promise<ListNodesResult> {
    const query: Record<string, string | number | boolean | undefined> = {
      backendMountId: input.backendMountId,
      limit: input.limit,
      offset: input.offset,
      path: input.path,
      depth: input.depth,
      driftOnly: input.driftOnly,
      search: input.search
    };
    if (input.states?.length) {
      query.states = input.states.join(',');
    }
    if (input.kinds?.length) {
      query.kinds = input.kinds.join(',');
    }

    const envelope = await this.request<
      ApiEnvelope<{
        nodes: FilestoreNodeResponse[];
        pagination: { total: number; limit: number; offset: number; nextOffset: number | null };
      }>
    >('GET', '/v1/nodes', {
      query
    });

    return {
      nodes: envelope.data.nodes,
      total: envelope.data.pagination.total,
      limit: envelope.data.pagination.limit,
      offset: envelope.data.pagination.offset,
      nextOffset: envelope.data.pagination.nextOffset
    } satisfies ListNodesResult;
  }

  async getNodeById(id: number): Promise<FilestoreNodeResponse> {
    const envelope = await this.request<ApiEnvelope<FilestoreNodeResponse>>('GET', `/v1/nodes/${id}`);
    return envelope.data;
  }

  async enqueueReconciliation(input: EnqueueReconciliationInput): Promise<{ enqueued: true }> {
    const envelope = await this.request<ApiEnvelope<{ enqueued: true }>>('POST', '/v1/reconciliation', {
      body: {
        backendMountId: input.backendMountId,
        path: input.path,
        nodeId: input.nodeId ?? null,
        reason: input.reason ?? 'manual',
        detectChildren: input.detectChildren ?? false,
        requestedHash: input.requestedHash ?? false
      }
    });
    return envelope.data;
  }

  streamEvents(options: ListEventsOptions = {}): AsyncIterable<FilestoreEvent> {
    const { signal, eventTypes, backendMountId, pathPrefix } = options;
    const self = this;
    const normalizedEventTypes =
      eventTypes && eventTypes.length > 0 ? Array.from(new Set(eventTypes)) : undefined;
    const eventTypeSet = normalizedEventTypes ? new Set(normalizedEventTypes) : null;
    const normalizedMountId =
      typeof backendMountId === 'number' && Number.isFinite(backendMountId) ? backendMountId : null;
    const normalizedPathPrefix = typeof pathPrefix === 'string' ? pathPrefix.trim() : '';

    async function* iterator(): AsyncGenerator<FilestoreEvent> {
      const controller = new AbortController();
      combineSignals(controller, signal);
      let timeout: NodeJS.Timeout | undefined;
      if (self.fetchTimeoutMs && self.fetchTimeoutMs > 0) {
        timeout = setTimeout(() => {
          controller.abort(new Error('Event stream request timed out'));
        }, self.fetchTimeoutMs);
      }

      let response: Response | null = null;
      try {
        const headers = self.buildHeaders();
        headers.set('Accept', 'text/event-stream');
        const url = self.buildUrl('/v1/events/stream');
        if (normalizedMountId !== null) {
          url.searchParams.set('backendMountId', String(normalizedMountId));
        }
        if (normalizedPathPrefix) {
          url.searchParams.set('pathPrefix', normalizedPathPrefix);
        }
        if (normalizedEventTypes) {
          for (const type of normalizedEventTypes) {
            url.searchParams.append('events', type);
          }
        }

        response = await self.fetchRaw(url, {
          method: 'GET',
          headers,
          signal: controller.signal
        });

        if (response.status !== 200 || !response.body) {
          const text = await response.text().catch(() => response?.statusText ?? '');
          throw new FilestoreClientError('Failed to open event stream', {
            statusCode: response.status,
            code: null,
            details: text
          });
        }

        const decoder = new TextDecoder();
        let buffer = '';

        for await (const chunk of response.body as any) {
          buffer += decoder.decode(chunk, { stream: true });
          let separatorIndex: number;
          // Process each SSE frame
          // Frames are separated by two consecutive newlines
          while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);
            if (!frame) {
              continue;
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
              continue;
            }

            if (eventTypeSet && !eventTypeSet.has(eventName as FilestoreEvent['type'])) {
              continue;
            }

            const payloadText = dataLines.join('\n');
            let payload: FilestoreEventEnvelope;
            try {
              payload = JSON.parse(payloadText) as FilestoreEventEnvelope;
            } catch (err) {
              // Skip malformed payloads
              continue;
            }

            const event = {
              type: eventName as FilestoreEvent['type'],
              data: payload.data
            } as FilestoreEvent;
            yield event;
          }
        }
      } catch (err) {
        if (err instanceof FilestoreClientError) {
          throw err;
        }
        if ((err as Error).name === 'AbortError') {
          throw new FilestoreStreamClosedError();
        }
        throw err;
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
        if (response && !response.body?.locked) {
          try {
            await response.body?.cancel();
          } catch {
            // ignore
          }
        }
        controller.abort();
      }
    }

    return {
      [Symbol.asyncIterator]: iterator
    };
  }

  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions & { expectJson: false }
  ): Promise<Response>;
  private async request<T>(method: string, path: string, options?: RequestOptions): Promise<T>;
  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {}
  ): Promise<T | Response> {
    const response = await this.fetchJson(method, path, options);
    if (options.expectJson === false) {
      return response;
    }
    return (await response.json()) as T;
  }

  private async fetchJson(method: string, path: string, options: RequestOptions): Promise<Response> {
    const headers = this.buildHeaders(options.principal);
    if (options.idempotencyKey) {
      headers.set('Idempotency-Key', options.idempotencyKey);
    }

    let body: string | undefined;
    if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers.set('Content-Type', 'application/json');
    }

    const url = this.buildUrl(path, options.query);
    const controller = new AbortController();
    combineSignals(controller, options.signal);
    let timeout: NodeJS.Timeout | undefined;
    if (this.fetchTimeoutMs && this.fetchTimeoutMs > 0) {
      timeout = setTimeout(() => {
        controller.abort(new Error('Request timed out'));
      }, this.fetchTimeoutMs);
    }

    try {
      const response = await this.fetchRaw(url, {
        method,
        headers,
        body,
        signal: controller.signal
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      return response;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new FilestoreClientError('Request aborted', {
          statusCode: 0,
          code: 'ABORTED',
          details: (err as Error).message
        });
      }
      throw err;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private async fetchRaw(input: string | URL, init: RequestInit): Promise<Response> {
    const headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers ?? undefined);
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json');
    }
    if (this.userAgent && !headers.has('User-Agent')) {
      headers.set('User-Agent', this.userAgent);
    }
    const token = await resolveToken(this.token);
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    return fetch(input, { ...init, headers });
  }

  private buildHeaders(principal?: string): Headers {
    const headers = new Headers({ Accept: 'application/json' });
    for (const [key, value] of Object.entries(this.defaultHeaders)) {
      if (value !== undefined) {
        headers.set(key, value);
      }
    }
    if (this.userAgent) {
      headers.set('User-Agent', this.userAgent);
    }
    if (principal) {
      headers.set('x-filestore-principal', principal);
    }
    return headers;
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): URL {
    const url = new URL(path, this.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) {
          continue;
        }
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = await response.text().catch(() => null);
    }

    if (payload && typeof payload === 'object' && 'error' in payload) {
      const errorPayload = (payload as { error: { code?: string; message?: string; details?: unknown } }).error;
      throw new FilestoreClientError(errorPayload.message ?? 'Filestore request failed', {
        statusCode: response.status,
        code: errorPayload.code ?? null,
        details: errorPayload.details
      });
    }

    throw new FilestoreClientError(response.statusText || 'Filestore request failed', {
      statusCode: response.status,
      code: null,
      details: payload
    });
  }
}

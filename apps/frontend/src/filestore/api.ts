import { FILESTORE_BASE_URL } from '../config';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { z } from 'zod';
import {
  filestoreCommandResponseEnvelopeSchema,
  filestoreEventSchema,
  filestoreNodeResponseSchema,
  filestoreReconciliationEnvelopeSchema,
  type FilestoreCommandResponse,
  type FilestoreEvent,
  type FilestoreEventType,
  type FilestoreNode,
  type FilestoreReconciliationReason,
  type FilestoreReconciliationResult
} from './types';

type AuthorizedFetch = ReturnType<typeof useAuthorizedFetch>;

type JsonHeadersOptions = {
  idempotencyKey?: string;
  principal?: string;
};

type RequestOptions = {
  signal?: AbortSignal;
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
  return new URL(path, FILESTORE_BASE_URL).toString();
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

export async function fetchNodeByPath(
  authorizedFetch: AuthorizedFetch,
  input: GetNodeByPathInput,
  options: RequestOptions = {}
): Promise<FilestoreNode> {
  const url = new URL('/v1/nodes/by-path', FILESTORE_BASE_URL);
  url.searchParams.set('backendMountId', String(input.backendMountId));
  url.searchParams.set('path', input.path);
  const response = await authorizedFetch(url.toString(), { signal: options.signal });
  const payload = await parseJsonOrThrow(response, filestoreNodeResponseSchema);
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

export type { FilestoreEvent, FilestoreEventType, FilestoreNode } from './types';
export type {
  FilestoreCommandCompletedPayload,
  FilestoreCommandResponse,
  FilestoreDriftDetectedPayload,
  FilestoreNodeEventPayload,
  FilestoreNodeReconciledPayload,
  FilestoreReconciliationReason,
  FilestoreReconciliationResult
} from './types';

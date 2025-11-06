import { API_BASE_URL } from '../config';
import { coreRequest, CoreApiError } from '../core/api';
import { ApiError, createApiClient, type AuthorizedFetch, type QueryValue } from '../lib/apiClient';
import { normalizeWorkflowRun } from '../workflows/normalizers';
import type { WorkflowRun } from '../workflows/types';
import { normalizeAssetGraphResponse } from './normalizers';
import type { AssetGraphData } from './types';

export type SavedPartitionParameters = {
  partitionKey: string | null;
  parameters: unknown;
  source: string | null;
  capturedAt: string;
  updatedAt: string;
};

type Token = string | null | undefined;
type TokenInput = Token | AuthorizedFetch;

type CoreJsonOptions = {
  method?: string;
  url: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
  errorMessage: string;
};

type FetchWithMetadata = AuthorizedFetch & {
  authToken?: string | null | undefined;
  authOptional?: boolean | null | undefined;
};

function ensureToken(input: TokenInput): string | undefined {
  if (typeof input === 'function') {
    const fetcher = input as FetchWithMetadata;
    const candidate = typeof fetcher.authToken === 'string' ? fetcher.authToken.trim() : '';
    if (candidate.length > 0) {
      return candidate;
    }
    if (fetcher.authOptional) {
      return undefined;
    }
  } else if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
    return undefined;
  } else if (input === null || input === undefined) {
    return undefined;
  }
  throw new Error('Authentication required for data asset requests.');
}

function toApiError(error: CoreApiError, fallback: string): ApiError {
  const message = error.message && error.message.trim().length > 0 ? error.message : fallback;
  return new ApiError(message, error.status ?? 500, error.details ?? null);
}

async function coreJson<T>(token: TokenInput, options: CoreJsonOptions): Promise<T> {
  if (typeof token === 'function') {
    const client = createApiClient(token, { baseUrl: API_BASE_URL });
    const bodyIsFormData = options.body instanceof FormData;
    const result = await client.request(options.url, {
      method: options.method,
      query: options.query,
      body: bodyIsFormData ? (options.body as FormData) : undefined,
      json: !bodyIsFormData ? options.body : undefined,
      errorMessage: options.errorMessage,
      signal: options.signal
    });
    return result as T;
  }

  try {
    const resolvedToken = ensureToken(token);
    return (await coreRequest<T>(resolvedToken, {
      method: options.method,
      url: options.url,
      query: options.query,
      body: options.body,
      signal: options.signal
    })) as T;
  } catch (error) {
    if (error instanceof CoreApiError) {
      throw toApiError(error, options.errorMessage);
    }
    throw error;
  }
}

export async function fetchAssetGraph(
  token: TokenInput,
  options: { moduleId?: string | null } = {}
): Promise<AssetGraphData> {
  const query = options.moduleId ? { moduleId: options.moduleId } : undefined;
  const payload = await coreJson<{ data?: unknown }>(token, {
    url: '/assets/graph',
    query,
    errorMessage: 'Failed to load asset graph'
  });
  const normalized = normalizeAssetGraphResponse(payload);
  if (!normalized) {
    throw new ApiError('Failed to parse asset graph', 500, payload);
  }
  return normalized;
}

export async function markAssetPartitionStale(
  token: TokenInput,
  slug: string,
  assetId: string,
  options: { partitionKey?: string | null; note?: string | null; moduleId?: string | null } = {}
): Promise<void> {
  const body: Record<string, string> = {};
  if (options.partitionKey && options.partitionKey.length > 0) {
    body.partitionKey = options.partitionKey;
  }
  if (options.note && options.note.length > 0) {
    body.note = options.note;
  }
  const query: Record<string, QueryValue> | undefined = options.moduleId
    ? { moduleId: options.moduleId }
    : undefined;
  await coreJson(token, {
    method: 'POST',
    url: `/workflows/${encodeURIComponent(slug)}/assets/${encodeURIComponent(assetId)}/stale`,
    body,
    query,
    errorMessage: 'Failed to mark asset partition stale'
  });
}

export async function clearAssetPartitionStale(
  token: TokenInput,
  slug: string,
  assetId: string,
  partitionKey?: string | null,
  moduleId?: string | null
): Promise<void> {
  await coreJson(token, {
    method: 'DELETE',
    url: `/workflows/${encodeURIComponent(slug)}/assets/${encodeURIComponent(assetId)}/stale`,
    query: (() => {
      if (!partitionKey && !moduleId) {
        return undefined;
      }
      const params: Record<string, QueryValue> = {};
      if (partitionKey && partitionKey.length > 0) {
        params.partitionKey = partitionKey;
      }
      if (moduleId) {
        params.moduleId = moduleId;
      }
      return Object.keys(params).length > 0 ? params : undefined;
    })(),
    errorMessage: 'Failed to clear asset partition stale flag'
  });
}

export async function triggerWorkflowRun(
  token: TokenInput,
  slug: string,
  options: {
    partitionKey?: string | null;
    triggeredBy?: string | null;
    parameters?: unknown;
    moduleId?: string | null;
  } = {}
): Promise<WorkflowRun> {
  const body: Record<string, unknown> = {
    triggeredBy: options.triggeredBy ?? 'assets-ui'
  };
  if (options.partitionKey && options.partitionKey.length > 0) {
    body.partitionKey = options.partitionKey;
  }
  if (options.parameters !== undefined) {
    body.parameters = options.parameters;
  }
  const query = options.moduleId ? { moduleId: options.moduleId } : undefined;
  const payload = await coreJson<{ data?: unknown }>(token, {
    method: 'POST',
    url: `/workflows/${encodeURIComponent(slug)}/run`,
    body,
    query,
    errorMessage: 'Failed to trigger workflow run'
  });
  const runRecord = normalizeWorkflowRun(payload?.data);
  if (!runRecord) {
    throw new ApiError('Failed to parse workflow run response', 500, payload);
  }
  return runRecord;
}

export async function saveAssetPartitionParameters(
  token: TokenInput,
  slug: string,
  assetId: string,
  input: { partitionKey?: string | null; parameters: unknown; moduleId?: string | null }
): Promise<SavedPartitionParameters> {
  const body: Record<string, unknown> = {
    parameters: input.parameters
  };
  if (input.partitionKey === null) {
    body.partitionKey = null;
  } else if (typeof input.partitionKey === 'string' && input.partitionKey.length > 0) {
    body.partitionKey = input.partitionKey;
  }
  const payload = await coreJson<{ data?: unknown }>(token, {
    method: 'PUT',
    url: `/workflows/${encodeURIComponent(slug)}/assets/${encodeURIComponent(assetId)}/partition-parameters`,
    body,
    query: input.moduleId ? { moduleId: input.moduleId } : undefined,
    errorMessage: 'Failed to save partition parameters'
  });
  const data = (payload?.data ?? null) as Record<string, unknown> | null;
  const partitionKey = typeof data?.partitionKey === 'string' && data.partitionKey.length > 0 ? data.partitionKey : null;
  return {
    partitionKey,
    parameters: data?.parameters ?? null,
    source: typeof data?.source === 'string' ? data.source : null,
    capturedAt:
      typeof data?.capturedAt === 'string' ? data.capturedAt : new Date().toISOString(),
    updatedAt:
      typeof data?.updatedAt === 'string'
        ? data.updatedAt
        : typeof data?.capturedAt === 'string'
          ? data.capturedAt
          : new Date().toISOString()
  } satisfies SavedPartitionParameters;
}

export async function deleteAssetPartitionParameters(
  token: TokenInput,
  slug: string,
  assetId: string,
  partitionKey?: string | null,
  moduleId?: string | null
): Promise<void> {
  const params = new URLSearchParams();
  if (typeof partitionKey === 'string' && partitionKey.length > 0) {
    params.set('partitionKey', partitionKey);
  }
  if (moduleId) {
    params.set('moduleId', moduleId);
  }
  const query = params.toString();
  await coreJson(token, {
    method: 'DELETE',
    url: `/workflows/${encodeURIComponent(slug)}/assets/${encodeURIComponent(assetId)}/partition-parameters`,
    query: query ? Object.fromEntries(params.entries()) : undefined,
    errorMessage: 'Failed to delete partition parameters'
  });
}

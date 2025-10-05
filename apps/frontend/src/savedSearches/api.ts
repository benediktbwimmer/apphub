import { API_BASE_URL } from '../config';
import { coreRequest, CoreApiError } from '../core/api';
import { ApiError } from '../lib/apiClient';
import { createApiClient, type AuthorizedFetch, type QueryValue } from '../lib/apiClient';
import type {
  SavedSearch,
  SavedSearchCreateInput,
  SavedSearchUpdateInput
} from './types';

const SAVED_SEARCHES_ROOT = '/saved-searches';
const AUTH_ERROR = 'Authentication required for saved search requests.';

type Token = string | null | undefined;
type TokenInput = Token | AuthorizedFetch;

type RequestOptions = {
  method?: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  errorMessage: string;
};

function ensureToken(input: TokenInput): string {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  } else if (typeof input === 'function') {
    const candidate = (input as AuthorizedFetch & { authToken?: string | null | undefined }).authToken;
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  throw new Error(AUTH_ERROR);
}

function toApiError(error: CoreApiError, fallback: string): ApiError {
  const message = error.message && error.message.trim().length > 0 ? error.message : fallback;
  return new ApiError(message, error.status ?? 500, error.details ?? null);
}

async function requestJson<T = unknown>(tokenInput: TokenInput, path: string, options: RequestOptions): Promise<T> {
  const { method, query, body, errorMessage } = options;

  if (typeof tokenInput === 'function') {
    const client = createApiClient(tokenInput, { baseUrl: API_BASE_URL });
    return client.request(path, {
      method,
      query,
      json: body,
      errorMessage
    }) as Promise<T>;
  }

  try {
    return await coreRequest<T>(ensureToken(tokenInput), {
      method,
      url: path,
      query,
      body
    });
  } catch (error) {
    if (error instanceof CoreApiError) {
      throw toApiError(error, errorMessage);
    }
    throw error;
  }
}

export async function listSavedSearches<TStatus extends string, TConfig = unknown>(
  token: TokenInput,
  params: { category?: string }
): Promise<Array<SavedSearch<TStatus, TConfig>>> {
  const query: Record<string, QueryValue> = {};
  if (params.category) {
    query.category = params.category;
  }
  const payload = await requestJson<{ data?: Array<SavedSearch<TStatus, TConfig>> }>(token, SAVED_SEARCHES_ROOT, {
    query,
    errorMessage: 'Failed to load saved searches'
  });
  return Array.isArray(payload?.data) ? payload.data : [];
}

export async function createSavedSearch<TStatus extends string, TConfig = unknown>(
  token: TokenInput,
  input: SavedSearchCreateInput<TStatus, TConfig>
): Promise<SavedSearch<TStatus, TConfig>> {
  const payload = await requestJson<{ data?: SavedSearch<TStatus, TConfig> }>(token, SAVED_SEARCHES_ROOT, {
    method: 'POST',
    body: input,
    errorMessage: 'Failed to create saved search'
  });
  const record = payload?.data;
  if (!record) {
    throw new ApiError('Saved search response missing data payload', 500, payload);
  }
  return record;
}

export async function updateSavedSearch<TStatus extends string, TConfig = unknown>(
  token: TokenInput,
  slug: string,
  updates: SavedSearchUpdateInput<TStatus, TConfig>
): Promise<SavedSearch<TStatus, TConfig>> {
  const payload = await requestJson<{ data?: SavedSearch<TStatus, TConfig> }>(
    token,
    `${SAVED_SEARCHES_ROOT}/${encodeURIComponent(slug)}`,
    {
      method: 'PATCH',
      body: updates,
      errorMessage: 'Failed to update saved search'
    }
  );
  const record = payload?.data;
  if (!record) {
    throw new ApiError('Saved search response missing data payload', 500, payload);
  }
  return record;
}

export async function deleteSavedSearch(token: TokenInput, slug: string): Promise<'deleted' | 'not_found'> {
  try {
    await requestJson(token, `${SAVED_SEARCHES_ROOT}/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
      errorMessage: 'Failed to delete saved search'
    });
    return 'deleted';
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return 'not_found';
    }
    throw error;
  }
}

export async function applySavedSearch<TStatus extends string, TConfig = unknown>(
  token: TokenInput,
  slug: string
): Promise<SavedSearch<TStatus, TConfig> | null> {
  try {
    const payload = await requestJson<{ data?: SavedSearch<TStatus, TConfig> }>(
      token,
      `${SAVED_SEARCHES_ROOT}/${encodeURIComponent(slug)}/apply`,
      {
        method: 'POST',
        errorMessage: 'Failed to record saved search usage'
      }
    );
    return payload?.data ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function shareSavedSearch<TStatus extends string, TConfig = unknown>(
  token: TokenInput,
  slug: string
): Promise<SavedSearch<TStatus, TConfig> | null> {
  try {
    const payload = await requestJson<{ data?: SavedSearch<TStatus, TConfig> }>(
      token,
      `${SAVED_SEARCHES_ROOT}/${encodeURIComponent(slug)}/share`,
      {
        method: 'POST',
        errorMessage: 'Failed to record saved search share'
      }
    );
    return payload?.data ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function getSavedSearch<TStatus extends string, TConfig = unknown>(
  token: TokenInput,
  slug: string
): Promise<SavedSearch<TStatus, TConfig> | null> {
  try {
    const payload = await requestJson<{ data?: SavedSearch<TStatus, TConfig> }>(
      token,
      `${SAVED_SEARCHES_ROOT}/${encodeURIComponent(slug)}`,
      {
        errorMessage: 'Failed to load saved search'
      }
    );
    return payload?.data ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

import type { ApiRequestOptions } from '@apphub/shared/api/core';
import { ApiError } from '@apphub/shared/api/core';
import { createCoreClient } from '@apphub/shared/api';

const DEFAULT_CORE_URL = 'http://127.0.0.1:4000';

export class CoreError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'CoreError';
    this.status = status;
    this.details = details;
  }
}

export type CoreRequestConfig = {
  baseUrl?: string;
  token?: string;
  path: string;
  method?: ApiRequestOptions['method'];
  body?: ApiRequestOptions['body'];
  query?: ApiRequestOptions['query'];
  mediaType?: ApiRequestOptions['mediaType'];
  headers?: ApiRequestOptions['headers'];
  responseHeader?: ApiRequestOptions['responseHeader'];
};

export function resolveCoreUrl(override?: string): string {
  const fallback = process.env.APPHUB_API_URL || process.env.APPHUB_CORE_URL || DEFAULT_CORE_URL;
  const raw = override || fallback;
  return raw.replace(/\/+$/, '');
}

export function resolveCoreToken(override?: string): string {
  const token = override || process.env.APPHUB_TOKEN;
  if (!token) {
    throw new Error('Core API token is required. Provide --token or set APPHUB_TOKEN.');
  }
  const normalized = token.trim();
  if (!normalized) {
    throw new Error('Core API token is required. Provide --token or set APPHUB_TOKEN.');
  }
  return normalized;
}

function createClient(config: CoreRequestConfig) {
  const baseUrl = resolveCoreUrl(config.baseUrl);
  const token = resolveCoreToken(config.token);

  return createCoreClient({
    baseUrl,
    token,
    headers: config.headers,
    withCredentials: false
  });
}

export async function coreRequest<T = unknown>(config: CoreRequestConfig): Promise<T> {
  const client = createClient(config);
  const requestOptions: ApiRequestOptions = {
    method: config.method ?? 'GET',
    url: config.path.startsWith('/') ? config.path : `/${config.path}`,
    body: config.body,
    query: config.query,
    mediaType: config.mediaType,
    headers: config.headers,
    responseHeader: config.responseHeader
  };

  if (requestOptions.body !== undefined && !requestOptions.mediaType && !(requestOptions.body instanceof FormData)) {
    requestOptions.mediaType = 'application/json';
  }

  try {
    return await client.request.request<T>(requestOptions);
  } catch (error) {
    if (error instanceof ApiError) {
      const details = error.body ?? error;
      let message = error.message;
      const body = error.body;
      if (typeof body === 'string') {
        const trimmed = body.trim();
        if (trimmed.length > 0) {
          message = trimmed;
        }
      } else if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        const candidate = record.error ?? record.message;
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
          message = candidate.trim();
        } else {
          const formErrors = Array.isArray(record.formErrors)
            ? record.formErrors.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
            : undefined;
          if (formErrors) {
            message = formErrors;
          }
        }
      }
      throw new CoreError(message, error.status, details);
    }
    if (error instanceof Error) {
      throw new CoreError(error.message, 500);
    }
    throw error;
  }
}

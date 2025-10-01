import { CapabilityRequestError } from '../errors';

export type TokenProvider =
  | string
  | null
  | undefined
  | (() => string | null | undefined | Promise<string | null | undefined>);

export type FetchLike = typeof fetch;

export interface HttpRequestOptions {
  baseUrl: string;
  path: string;
  method: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string | undefined>;
  body?: unknown;
  authToken?: TokenProvider;
  principal?: string;
  idempotencyKey?: string;
  expectJson?: boolean;
  fetchImpl?: FetchLike;
}

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Headers;
  data: T;
}

function buildUrl(baseUrl: string, path: string, query?: HttpRequestOptions['query']): string {
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

async function resolveToken(provider: TokenProvider): Promise<string | null> {
  if (!provider) {
    return null;
  }
  if (typeof provider === 'function') {
    const value = await provider();
    if (!value) {
      return null;
    }
    const trimmed = String(value).trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const trimmed = provider.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isFormData(value: unknown): boolean {
  return Object.prototype.toString.call(value) === '[object FormData]';
}

function isBlob(value: unknown): boolean {
  return Object.prototype.toString.call(value) === '[object Blob]';
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

function isReadableStream(value: unknown): boolean {
  return Object.prototype.toString.call(value) === '[object ReadableStream]';
}

function buildHeaders(options: HttpRequestOptions, token: string | null): Headers {
  const headers = new Headers();
  if (options.expectJson) {
    headers.set('accept', 'application/json');
  }
  const body = options.body;
  if (body && !isFormData(body) && !isBlob(body) && !isArrayBuffer(body) && typeof body === 'object' && !isReadableStream(body)) {
    headers.set('content-type', 'application/json');
  }
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }
  if (options.principal) {
    headers.set('x-apphub-principal', options.principal);
  }
  if (options.idempotencyKey) {
    headers.set('idempotency-key', options.idempotencyKey);
  }
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      if (value !== undefined) {
        headers.set(key, value);
      }
    }
  }
  return headers;
}

function normalizeBody(body: unknown): BodyInit | null | undefined {
  if (body === undefined) {
    return undefined;
  }
  if (body === null) {
    return null;
  }
  if (
    typeof body === 'string' ||
    body instanceof Uint8Array ||
    isArrayBuffer(body) ||
    isFormData(body) ||
    isBlob(body) ||
    isReadableStream(body)
  ) {
    return body as BodyInit;
  }
  if (typeof body === 'object') {
    return JSON.stringify(body);
  }
  if (typeof body === 'number' || typeof body === 'boolean') {
    return JSON.stringify(body);
  }
  return undefined;
}

export async function httpRequest<T = unknown>(options: HttpRequestOptions): Promise<HttpResponse<T>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error(
      'No fetch implementation available. Provide fetchImpl when running outside environments with global fetch.'
    );
  }
  const token = await resolveToken(options.authToken ?? null);
  const url = buildUrl(options.baseUrl, options.path, options.query);
  const init: RequestInit = {
    method: options.method.toUpperCase(),
    headers: buildHeaders(options, token)
  };
  const normalizedBody = normalizeBody(options.body);
  if (normalizedBody !== undefined) {
    init.body = normalizedBody;
  }

  const response = await fetchImpl(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => undefined);
    throw new CapabilityRequestError({
      method: options.method,
      url,
      status: response.status,
      body: text
    });
  }

  let data: T;
  if (options.expectJson === false || response.status === 204) {
    data = undefined as T;
  } else {
    try {
      data = (await response.json()) as T;
    } catch {
      data = undefined as T;
    }
  }

  return {
    status: response.status,
    headers: response.headers,
    data
  };
}

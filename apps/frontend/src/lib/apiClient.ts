import { z, type ZodTypeAny } from 'zod';

type FetchArgs = Parameters<typeof fetch>;
type FetchInput = FetchArgs[0];
type FetchInit = FetchArgs[1];

export type AuthorizedFetch = ((input: FetchInput, init?: FetchInit) => Promise<Response>) & {
  authToken?: string | null;
};

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean>;

export interface ApiClientConfig {
  baseUrl?: string;
  defaultHeaders?: HeadersInit;
}

export interface ApiRequestOptionsBase {
  method?: string;
  headers?: HeadersInit;
  query?: Record<string, QueryValue>;
  body?: BodyInit;
  json?: unknown;
  errorMessage?: string;
  signal?: AbortSignal;
}

export interface ApiRequestOptionsWithSchema<TSchema extends ZodTypeAny, TResult = z.infer<TSchema>>
  extends ApiRequestOptionsBase {
  schema: TSchema;
  transform?: (payload: z.infer<TSchema>, response: Response) => TResult;
}

export interface ApiRequestOptionsWithoutSchema<TResult = unknown> extends ApiRequestOptionsBase {
  schema?: undefined;
  transform?: (payload: unknown, response: Response) => TResult;
}

type ApiRequestOptionsUnion =
  | ApiRequestOptionsWithSchema<ZodTypeAny, unknown>
  | ApiRequestOptionsWithoutSchema<unknown>;

type RequestTransform = (payload: unknown, response: Response) => unknown;

export type ApiErrorDetails = unknown;

export class ApiError extends Error {
  status: number;
  details: ApiErrorDetails;

  constructor(message: string, status: number, details?: ApiErrorDetails) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details ?? null;
  }
}

function isAbsoluteUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

function joinUrl(baseUrl: string | undefined, path: string): string {
  if (!baseUrl || isAbsoluteUrl(path)) {
    return path;
  }
  const normalizedBase = baseUrl.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function appendQuery(url: string, query?: Record<string, QueryValue>): string {
  if (!query || Object.keys(query).length === 0) {
    return url;
  }
  const [base, existingQuery = ''] = url.split('?', 2);
  const searchParams = new URLSearchParams(existingQuery);
  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue === undefined) {
      continue;
    }
    if (Array.isArray(rawValue)) {
      for (const entry of rawValue) {
        const value = entry ?? '';
        searchParams.append(key, String(value));
      }
      continue;
    }
    if (rawValue === null) {
      searchParams.append(key, '');
      continue;
    }
    searchParams.append(key, String(rawValue));
  }
  const serialized = searchParams.toString();
  return serialized ? `${base}?${serialized}` : base;
}

function cloneHeaders(source?: HeadersInit): Headers {
  if (source instanceof Headers) {
    return new Headers(source);
  }
  return new Headers(source ?? {});
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError('Failed to parse server response', response.status, text);
  }
}

async function buildApiError(response: Response, fallbackMessage: string): Promise<ApiError> {
  let message = fallbackMessage;
  let details: ApiErrorDetails = null;
  try {
    const text = await response.text();
    if (text) {
      try {
        const parsed = JSON.parse(text) as unknown;
        details = parsed;
        if (parsed && typeof parsed === 'object') {
          const record = parsed as Record<string, unknown>;
          const candidates = [record.error, record.message];
          for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
              message = candidate.trim();
              break;
            }
          }
          if (message === fallbackMessage) {
            const formErrors = record.formErrors;
            if (Array.isArray(formErrors)) {
              const first = formErrors.find(
                (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
              );
              if (first) {
                message = first.trim();
              }
            }
          }
        }
        if (message === fallbackMessage) {
          const textValue = typeof parsed === 'string' ? parsed.trim() : '';
          if (textValue.length > 0) {
            message = textValue;
          }
        }
      } catch {
        const trimmed = text.trim();
        details = trimmed || text;
        if (trimmed.length > 0) {
          message = trimmed;
        }
      }
    }
  } catch {
    // Ignore secondary parse errors.
  }
  return new ApiError(message, response.status, details);
}

class ApiClient {
  private readonly baseUrl?: string;
  private readonly defaultHeaders?: HeadersInit;
  private readonly fetcher: AuthorizedFetch;

  constructor(fetcher: AuthorizedFetch, config: ApiClientConfig = {}) {
    this.fetcher = fetcher;
    this.baseUrl = config.baseUrl;
    this.defaultHeaders = config.defaultHeaders;
  }

  async request<TSchema extends ZodTypeAny, TResult = z.infer<TSchema>>(
    path: string,
    options: ApiRequestOptionsWithSchema<TSchema, TResult>
  ): Promise<TResult>;
  async request<TResult = unknown>(
    path: string,
    options?: ApiRequestOptionsWithoutSchema<TResult>
  ): Promise<TResult>;
  async request(path: string, options: ApiRequestOptionsUnion = {}): Promise<unknown> {
    const method = options.method ?? 'GET';
    const urlWithBase = joinUrl(this.baseUrl, path);
    const requestUrl = appendQuery(urlWithBase, options.query);

    const headers = cloneHeaders(this.defaultHeaders);
    if (options.headers) {
      const override = cloneHeaders(options.headers);
      override.forEach((value, key) => headers.set(key, value));
    }

    let body: BodyInit | undefined = options.body;
    if (options.json !== undefined) {
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      body = JSON.stringify(options.json);
    }

    const response = await this.fetcher(requestUrl, { method, headers, body, signal: options.signal });

    if (!response.ok) {
      const errorMessage = options.errorMessage ?? 'Request failed';
      throw await buildApiError(response, errorMessage);
    }

    if (
      method.toUpperCase() === 'HEAD' ||
      response.status === 204 ||
      response.status === 205 ||
      response.status === 304
    ) {
      return {};
    }

    const payload = await parseJsonBody(response);

    const schema = (options as ApiRequestOptionsUnion).schema;
    const transform = (options as ApiRequestOptionsUnion).transform as RequestTransform | undefined;

    const validated = schema ? schema.parse(payload) : payload;
    return transform ? transform(validated, response) : validated;
  }

  async get<TSchema extends ZodTypeAny, TResult = z.infer<TSchema>>(
    path: string,
    options: ApiRequestOptionsWithSchema<TSchema, TResult>
  ): Promise<TResult>;
  async get<TResult = unknown>(
    path: string,
    options?: ApiRequestOptionsWithoutSchema<TResult>
  ): Promise<TResult>;
  async get(path: string, options: ApiRequestOptionsUnion = {}): Promise<unknown> {
    if ('schema' in options && options.schema) {
      const schemaOptions = { ...options, method: 'GET' } as ApiRequestOptionsWithSchema<ZodTypeAny, unknown>;
      return this.request(path, schemaOptions);
    }
    const basicOptions = { ...options, method: 'GET' } as ApiRequestOptionsWithoutSchema<unknown>;
    return this.request(path, basicOptions);
  }

  async post<TSchema extends ZodTypeAny, TResult = z.infer<TSchema>>(
    path: string,
    options: ApiRequestOptionsWithSchema<TSchema, TResult>
  ): Promise<TResult>;
  async post<TResult = unknown>(
    path: string,
    options?: ApiRequestOptionsWithoutSchema<TResult>
  ): Promise<TResult>;
  async post(path: string, options: ApiRequestOptionsUnion = {}): Promise<unknown> {
    if ('schema' in options && options.schema) {
      const schemaOptions = { ...options, method: 'POST' } as ApiRequestOptionsWithSchema<ZodTypeAny, unknown>;
      return this.request(path, schemaOptions);
    }
    const basicOptions = { ...options, method: 'POST' } as ApiRequestOptionsWithoutSchema<unknown>;
    return this.request(path, basicOptions);
  }

  async put<TSchema extends ZodTypeAny, TResult = z.infer<TSchema>>(
    path: string,
    options: ApiRequestOptionsWithSchema<TSchema, TResult>
  ): Promise<TResult>;
  async put<TResult = unknown>(
    path: string,
    options?: ApiRequestOptionsWithoutSchema<TResult>
  ): Promise<TResult>;
  async put(path: string, options: ApiRequestOptionsUnion = {}): Promise<unknown> {
    if ('schema' in options && options.schema) {
      const schemaOptions = { ...options, method: 'PUT' } as ApiRequestOptionsWithSchema<ZodTypeAny, unknown>;
      return this.request(path, schemaOptions);
    }
    const basicOptions = { ...options, method: 'PUT' } as ApiRequestOptionsWithoutSchema<unknown>;
    return this.request(path, basicOptions);
  }

  async patch<TSchema extends ZodTypeAny, TResult = z.infer<TSchema>>(
    path: string,
    options: ApiRequestOptionsWithSchema<TSchema, TResult>
  ): Promise<TResult>;
  async patch<TResult = unknown>(
    path: string,
    options?: ApiRequestOptionsWithoutSchema<TResult>
  ): Promise<TResult>;
  async patch(path: string, options: ApiRequestOptionsUnion = {}): Promise<unknown> {
    if ('schema' in options && options.schema) {
      const schemaOptions = { ...options, method: 'PATCH' } as ApiRequestOptionsWithSchema<ZodTypeAny, unknown>;
      return this.request(path, schemaOptions);
    }
    const basicOptions = { ...options, method: 'PATCH' } as ApiRequestOptionsWithoutSchema<unknown>;
    return this.request(path, basicOptions);
  }

  async delete<TSchema extends ZodTypeAny, TResult = z.infer<TSchema>>(
    path: string,
    options: ApiRequestOptionsWithSchema<TSchema, TResult>
  ): Promise<TResult>;
  async delete<TResult = unknown>(
    path: string,
    options?: ApiRequestOptionsWithoutSchema<TResult>
  ): Promise<TResult>;
  async delete(path: string, options: ApiRequestOptionsUnion = {}): Promise<unknown> {
    if ('schema' in options && options.schema) {
      const schemaOptions = { ...options, method: 'DELETE' } as ApiRequestOptionsWithSchema<ZodTypeAny, unknown>;
      return this.request(path, schemaOptions);
    }
    const basicOptions = { ...options, method: 'DELETE' } as ApiRequestOptionsWithoutSchema<unknown>;
    return this.request(path, basicOptions);
  }
}

export function createApiClient(fetcher: AuthorizedFetch, config: ApiClientConfig = {}): ApiClient {
  return new ApiClient(fetcher, config);
}

export async function ensureOk(response: Response, fallbackMessage: string): Promise<Response> {
  if (response.ok) {
    return response;
  }
  throw await buildApiError(response, fallbackMessage);
}

export async function parseJson<T>(response: Response): Promise<T> {
  return parseJsonBody(response) as Promise<T>;
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

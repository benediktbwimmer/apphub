import { httpRequest, type FetchLike, type TokenProvider } from '../internal/http';

export interface CoreHttpCapabilityConfig {
  baseUrl: string;
  token?: TokenProvider;
  fetchImpl?: FetchLike;
}

export interface CoreHttpRequestOptions<TBody = unknown> {
  path: string;
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string | undefined>;
  body?: TBody;
  principal?: string;
  idempotencyKey?: string;
  expectJson?: boolean;
}

export interface CoreHttpCapability {
  request<TResponse = unknown, TBody = unknown>(
    options: CoreHttpRequestOptions<TBody>
  ): Promise<TResponse>;
}

export function createCoreHttpCapability(config: CoreHttpCapabilityConfig): CoreHttpCapability {
  return {
    async request<TResponse = unknown, TBody = unknown>(
      options: CoreHttpRequestOptions<TBody>
    ): Promise<TResponse> {
      const response = await httpRequest<TResponse>({
        baseUrl: config.baseUrl,
        path: options.path,
        method: options.method ?? 'GET',
        authToken: config.token,
        principal: options.principal,
        idempotencyKey: options.idempotencyKey,
        fetchImpl: config.fetchImpl,
        query: options.query,
        headers: options.headers,
        body: options.body,
        expectJson: options.expectJson ?? true
      });
      return response.data;
    }
  } satisfies CoreHttpCapability;
}

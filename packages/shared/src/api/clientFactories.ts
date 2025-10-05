import type { OpenAPIConfig as CoreOpenAPIConfig } from './core';
import { CoreClient } from './core';
import type { OpenAPIConfig as FilestoreOpenAPIConfig } from './filestore';
import { FilestoreClient } from './filestore';
import type { OpenAPIConfig as MetastoreOpenAPIConfig } from './metastore';
import { MetastoreClient } from './metastore';
import type { OpenAPIConfig as TimestoreOpenAPIConfig } from './timestore';
import { TimestoreClient } from './timestore';

type TokenInput = string | null | undefined | (() => Promise<string | null | undefined> | string | null | undefined);

type HeadersInput =
  | Record<string, string>
  | null
  | undefined
  | (() => Promise<Record<string, string> | null | undefined> | Record<string, string> | null | undefined);

interface CommonClientOptions {
  baseUrl: string;
  token?: TokenInput;
  headers?: HeadersInput;
  withCredentials?: boolean;
  credentials?: CoreOpenAPIConfig['CREDENTIALS'];
}

type ClientConfig = Pick<CoreOpenAPIConfig, 'BASE' | 'WITH_CREDENTIALS' | 'CREDENTIALS' | 'HEADERS'>;

type CoreClientOptions = CommonClientOptions & Partial<Omit<CoreOpenAPIConfig, keyof ClientConfig>>;
type MetastoreClientOptions = CommonClientOptions & Partial<Omit<MetastoreOpenAPIConfig, keyof ClientConfig>>;
type FilestoreClientOptions = CommonClientOptions & Partial<Omit<FilestoreOpenAPIConfig, keyof ClientConfig>>;
type TimestoreClientOptions = CommonClientOptions & Partial<Omit<TimestoreOpenAPIConfig, keyof ClientConfig>>;

async function resolveToken(token: TokenInput): Promise<string | undefined> {
  if (typeof token === 'function') {
    const value = await token();
    return value ?? undefined;
  }
  return token ?? undefined;
}

async function resolveHeaders(headers: HeadersInput): Promise<Record<string, string>> {
  if (typeof headers === 'function') {
    const value = await headers();
    return value ?? {};
  }
  return headers ?? {};
}

function buildHeadersResolver(options: CommonClientOptions): CoreOpenAPIConfig['HEADERS'] {
  if (!options.token && !options.headers) {
    return undefined;
  }

  return async () => {
    const [headers, token] = await Promise.all([
      resolveHeaders(options.headers ?? {}),
      resolveToken(options.token ?? undefined)
    ]);

    if (token && !headers.Authorization) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  };
}

function toConfig(options: CommonClientOptions): Partial<ClientConfig> {
  const config: Partial<ClientConfig> = {
    BASE: options.baseUrl.replace(/\/$/, ''),
    WITH_CREDENTIALS: options.withCredentials ?? false,
    CREDENTIALS: options.credentials ?? 'include'
  };

  const headersResolver = buildHeadersResolver(options);
  if (headersResolver) {
    config.HEADERS = headersResolver;
  }

  return config;
}

export function createCoreClient(options: CoreClientOptions): CoreClient {
  const { baseUrl, token, headers, withCredentials, credentials, ...rest } = options;
  return new CoreClient({
    ...rest,
    ...toConfig({ baseUrl, token, headers, withCredentials, credentials })
  });
}

export function createMetastoreClient(options: MetastoreClientOptions): MetastoreClient {
  const { baseUrl, token, headers, withCredentials, credentials, ...rest } = options;
  return new MetastoreClient({
    ...rest,
    ...toConfig({ baseUrl, token, headers, withCredentials, credentials })
  });
}

export function createFilestoreClient(options: FilestoreClientOptions): FilestoreClient {
  const { baseUrl, token, headers, withCredentials, credentials, ...rest } = options;
  return new FilestoreClient({
    ...rest,
    ...toConfig({ baseUrl, token, headers, withCredentials, credentials })
  });
}

export function createTimestoreClient(options: TimestoreClientOptions): TimestoreClient {
  const { baseUrl, token, headers, withCredentials, credentials, ...rest } = options;
  return new TimestoreClient({
    ...rest,
    ...toConfig({ baseUrl, token, headers, withCredentials, credentials })
  });
}

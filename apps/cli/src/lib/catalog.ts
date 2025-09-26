const DEFAULT_CATALOG_URL = 'http://127.0.0.1:4000';

export type CatalogRequestConfig = {
  baseUrl: string;
  token: string;
  path: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
};

export function resolveCatalogUrl(override?: string): string {
  const fallback = process.env.APPHUB_API_URL || process.env.APPHUB_CATALOG_URL || DEFAULT_CATALOG_URL;
  const raw = override || fallback;
  return raw.replace(/\/+$/, '');
}

export function resolveCatalogToken(override?: string): string {
  const token = override || process.env.APPHUB_TOKEN;
  if (!token) {
    throw new Error('Catalog API token is required. Provide --token or set APPHUB_TOKEN.');
  }
  return token;
}

function buildHeaders(token: string, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`
  };
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

function buildUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export async function catalogRequest<T = unknown>(config: CatalogRequestConfig): Promise<T> {
  const url = buildUrl(config.baseUrl, config.path);
  const method = config.method ?? 'GET';
  const hasBody = config.body !== undefined && config.body !== null;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: buildHeaders(config.token, hasBody),
      body: hasBody ? JSON.stringify(config.body) : undefined
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to contact catalog API at ${url}: ${message}`);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const parsed = await response.json();
      detail = parsed?.error ? `: ${JSON.stringify(parsed.error)}` : `: ${JSON.stringify(parsed)}`;
    } catch {
      const text = await response.text();
      detail = text ? `: ${text}` : '';
    }
    throw new Error(`Catalog API responded with ${response.status}${detail}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }

  return (await response.text()) as unknown as T;
}

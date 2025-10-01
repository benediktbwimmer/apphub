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
  baseUrl: string;
  token: string;
  path: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
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

export async function coreRequest<T = unknown>(config: CoreRequestConfig): Promise<T> {
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
    throw new Error(`Failed to contact core API at ${url}: ${message}`);
  }

  if (!response.ok) {
    let message = `Core API responded with ${response.status}`;
    let details: unknown = null;
    try {
      const text = await response.text();
      if (text) {
        try {
          const parsed = JSON.parse(text) as Record<string, unknown> | null;
          const container = parsed && typeof parsed === 'object' ? parsed : null;
          const errorValue = container && 'error' in container ? container.error : parsed;
          details = errorValue ?? parsed;
          let candidate: unknown =
            container && typeof container.error === 'string'
              ? container.error
              : container && typeof container.message === 'string'
                ? container.message
                : null;
          if (!candidate && errorValue && typeof errorValue === 'object' && !Array.isArray(errorValue)) {
            const record = errorValue as Record<string, unknown>;
            const formErrors = record.formErrors;
            if (Array.isArray(formErrors)) {
              const first = formErrors.find(
                (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
              );
              if (first) {
                candidate = first;
              }
            }
          }
          if (typeof candidate === 'string' && candidate.trim().length > 0) {
            message = candidate.trim();
          }
        } catch {
          const trimmed = text.trim();
          details = trimmed || text;
          if (trimmed.length > 0) {
            message = `${message}: ${trimmed}`;
          }
        }
      }
    } catch {
      // Ignore secondary parse errors.
    }
    throw new CoreError(message, response.status, details);
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

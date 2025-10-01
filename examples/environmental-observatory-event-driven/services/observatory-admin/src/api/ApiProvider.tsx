import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

export type ApiConfig = {
  baseUrl: string;
  token: string;
};

export const DEFAULT_API_BASE_URL = 'http://localhost:4000';

type ApiProviderProps = {
  value: ApiConfig;
  onChange: (next: ApiConfig) => void;
  children: ReactNode;
};

type ApiContextValue = {
  config: ApiConfig;
  updateConfig: (updates: Partial<ApiConfig>) => void;
  authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({ value, onChange, children }: ApiProviderProps) {
  const updateConfig = useCallback(
    (updates: Partial<ApiConfig>) => {
      const next = { ...value, ...updates } satisfies ApiConfig;
      onChange(next);
    },
    [value, onChange]
  );

  const authorizedFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers ?? {});
      const tokenValue = value.token.trim();
      if (tokenValue.length > 0 && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${tokenValue}`);
      }
      if (!headers.has('Content-Type') && init?.body && !(init.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
      }

      const requestInfo: RequestInfo | URL =
        typeof input === 'string'
          ? resolveRequestUrl(value.baseUrl, input)
          : input instanceof URL
            ? input
            : input;

      return fetch(requestInfo, {
        ...init,
        headers,
        credentials: 'include'
      });
    },
    [value.baseUrl, value.token]
  );

  const contextValue = useMemo<ApiContextValue>(
    () => ({
      config: value,
      updateConfig,
      authorizedFetch
    }),
    [value, updateConfig, authorizedFetch]
  );

  return <ApiContext.Provider value={contextValue}>{children}</ApiContext.Provider>;
}

function resolveRequestUrl(baseUrl: string, input: string): string {
  if (/^https?:\/\//i.test(input)) {
    return input;
  }
  const normalizedBase = (baseUrl || DEFAULT_API_BASE_URL).replace(/\/$/, '');
  const normalizedPath = input.startsWith('/') ? input : `/${input}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function useApiContext(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) {
    throw new Error('useApiContext must be used within an ApiProvider');
  }
  return ctx;
}

export function useAuthorizedFetch() {
  return useApiContext().authorizedFetch;
}

export function useApiConfig() {
  const { config, updateConfig } = useApiContext();
  return { config, updateConfig };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import {
  AuthContext,
  type ApiKeySummary,
  type AuthContextValue,
  type AuthIdentity,
  type CreateApiKeyInput,
  type CreateApiKeyResult
} from './context';
import { API_BASE_URL } from '../config';

const DEMO_OPERATOR_TOKEN = (() => {
  const token = import.meta.env.VITE_DEMO_OPERATOR_TOKEN;
  if (typeof token !== 'string') {
    return null;
  }
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
})();

const DEV_SERVICE_SCOPES = [
  'timestore:read',
  'timestore:write',
  'timestore:admin',
  'timestore:sql:read',
  'timestore:sql:exec',
  'timestore:metrics',
  'metastore:read',
  'metastore:write',
  'metastore:delete',
  'metastore:admin',
  'runtime:write'
] as const;

function normalizeIdentity(identity: AuthIdentity | null): AuthIdentity | null {
  if (!identity || !identity.authDisabled) {
    return identity;
  }
  const scopes = new Set(identity.scopes);
  for (const scope of DEV_SERVICE_SCOPES) {
    scopes.add(scope);
  }
  return {
    ...identity,
    scopes: Array.from(scopes)
  } satisfies AuthIdentity;
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Failed to parse response payload');
  }
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.error === 'string') {
    return candidate.error;
  }
  return null;
}

const API_BASE = API_BASE_URL.replace(/\/$/, '');

function resolveInput(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === 'string') {
    if (/^https?:\/\//i.test(input)) {
      return input;
    }
    const normalizedPath = input.startsWith('/') ? input : `/${input}`;
    return `${API_BASE}${normalizedPath}`;
  }
  return input;
}

export function AuthProvider({ children }: PropsWithChildren<unknown>) {
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);
  const [identityLoading, setIdentityLoading] = useState(true);
  const [identityError, setIdentityError] = useState<string | null>(null);

  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [apiKeysError, setApiKeysError] = useState<string | null>(null);

  const [activeToken, setActiveToken] = useState<string | null>(DEMO_OPERATOR_TOKEN);

  const identityFetchRef = useRef<Promise<void> | null>(null);
  const apiKeysFetchRef = useRef<Promise<void> | null>(null);

  const fetchWithAuth = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers ?? {});
      if (activeToken && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${activeToken}`);
      }
      if (!headers.has('Content-Type') && init?.body && !(init.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
      }
      return fetch(resolveInput(input), {
        ...init,
        credentials: 'include',
        headers
      });
    },
    [activeToken]
  );

  const refreshIdentity = useCallback(async () => {
    if (identityFetchRef.current) {
      await identityFetchRef.current;
      return;
    }
    const task = (async () => {
      setIdentityLoading(true);
      setIdentityError(null);
      try {
        const response = await fetchWithAuth('/auth/identity');
        if (response.status === 401) {
          setIdentity(null);
          return;
        }
        if (!response.ok) {
          const payload = await parseJson<unknown>(response);
          throw new Error(extractErrorMessage(payload) ?? 'Failed to load identity');
        }
        const payload = await parseJson<{ data?: AuthIdentity }>(response);
        setIdentity(normalizeIdentity(payload.data ?? null));
      } catch (err) {
        setIdentity(null);
        setIdentityError(err instanceof Error ? err.message : 'Failed to load identity');
      } finally {
        setIdentityLoading(false);
        identityFetchRef.current = null;
      }
    })();
    identityFetchRef.current = task;
    await task;
  }, [fetchWithAuth]);

  const refreshApiKeys = useCallback(async () => {
    if (identity?.authDisabled) {
      setApiKeys([]);
      setApiKeysError(null);
      setApiKeysLoading(false);
      return;
    }
    if (apiKeysFetchRef.current) {
      await apiKeysFetchRef.current;
      return;
    }
    const task = (async () => {
      setApiKeysLoading(true);
      setApiKeysError(null);
      try {
        const response = await fetchWithAuth('/auth/api-keys');
        if (!response.ok) {
          const payload = await parseJson<unknown>(response);
          throw new Error(extractErrorMessage(payload) ?? 'Failed to load API keys');
        }
        const payload = await parseJson<{ data?: { keys?: ApiKeySummary[] } }>(response);
        setApiKeys(payload.data?.keys ?? []);
      } catch (err) {
        setApiKeysError(err instanceof Error ? err.message : 'Failed to load API keys');
      } finally {
        setApiKeysLoading(false);
        apiKeysFetchRef.current = null;
      }
    })();
    apiKeysFetchRef.current = task;
    await task;
  }, [fetchWithAuth, identity?.authDisabled]);

  const createApiKey = useCallback(
    async (input: CreateApiKeyInput): Promise<CreateApiKeyResult> => {
      if (identity?.authDisabled) {
        throw new Error('Auth is disabled; API keys are unavailable in this environment.');
      }
      const response = await fetchWithAuth('/auth/api-keys', {
        method: 'POST',
        body: JSON.stringify({
          name: input.name ?? undefined,
          scopes: input.scopes ?? undefined,
          expiresAt: input.expiresAt ?? undefined
        })
      });
      if (!response.ok) {
        const payload = await parseJson<unknown>(response);
        throw new Error(extractErrorMessage(payload) ?? 'Failed to create API key');
      }
      const payload = await parseJson<{ data?: { key?: ApiKeySummary; token?: string } }>(response);
      if (!payload.data?.key || !payload.data?.token) {
        throw new Error('API key response was missing fields');
      }
      await refreshApiKeys();
      return { key: payload.data.key, token: payload.data.token } satisfies CreateApiKeyResult;
    },
    [fetchWithAuth, refreshApiKeys, identity?.authDisabled]
  );

  const revokeApiKey = useCallback(
    async (id: string) => {
      if (identity?.authDisabled) {
        throw new Error('Auth is disabled; API keys are unavailable in this environment.');
      }
      const response = await fetchWithAuth(`/auth/api-keys/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      if (!response.ok && response.status !== 204) {
        const payload = await parseJson<unknown>(response);
        throw new Error(extractErrorMessage(payload) ?? 'Failed to revoke API key');
      }
      await refreshApiKeys();
    },
    [fetchWithAuth, refreshApiKeys, identity?.authDisabled]
  );

  useEffect(() => {
    void refreshIdentity();
  }, [refreshIdentity]);

  useEffect(() => {
    void refreshApiKeys();
  }, [refreshApiKeys]);

  const value = useMemo<AuthContextValue>(
    () => ({
      identity,
      identityLoading,
      identityError,
      refreshIdentity,
      apiKeys,
      apiKeysLoading,
      apiKeysError,
      refreshApiKeys,
      createApiKey,
      revokeApiKey,
      activeToken,
      setActiveToken
    }),
    [
      identity,
      identityLoading,
      identityError,
      refreshIdentity,
      apiKeys,
      apiKeysLoading,
      apiKeysError,
      refreshApiKeys,
      createApiKey,
      revokeApiKey,
      activeToken
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

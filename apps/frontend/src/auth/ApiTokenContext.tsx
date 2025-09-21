import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';

type StoredApiToken = {
  id: string;
  label: string;
  token: string;
  createdAt: string;
  lastUsedAt: string | null;
};

type PersistedState = {
  tokens: StoredApiToken[];
  activeTokenId: string | null;
};

type TokenInput = {
  label?: string;
  token: string;
};

type TokenUpdate = {
  label?: string;
  token?: string;
};

type ApiTokenContextValue = {
  tokens: StoredApiToken[];
  activeTokenId: string | null;
  activeToken: StoredApiToken | null;
  addToken: (input: TokenInput) => string;
  updateToken: (id: string, updates: TokenUpdate) => void;
  removeToken: (id: string) => void;
  setActiveToken: (id: string | null) => void;
  clearTokens: () => void;
  touchToken: (id: string) => void;
};

const STORAGE_KEY = 'apphub.apiTokens.v1';
const ACTIVE_TOKEN_KEY = 'apphub.activeTokenId.v1';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function safeParseState(raw: string | null): StoredApiToken[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const tokens: StoredApiToken[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const candidate = entry as Record<string, unknown>;
      const id = typeof candidate.id === 'string' ? candidate.id : null;
      const token = typeof candidate.token === 'string' ? candidate.token : null;
      if (!id || !token) {
        continue;
      }
      const label = typeof candidate.label === 'string' ? candidate.label : '';
      const createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString();
      const lastUsedAt = typeof candidate.lastUsedAt === 'string' ? candidate.lastUsedAt : null;
      tokens.push({ id, token, label, createdAt, lastUsedAt });
    }
    return tokens;
  } catch {
    return [];
  }
}

function loadInitialState(): PersistedState {
  if (!isBrowser()) {
    return { tokens: [], activeTokenId: null };
  }

  const rawTokens = window.localStorage.getItem(STORAGE_KEY);
  const tokens = safeParseState(rawTokens);

  const rawActive = window.localStorage.getItem(ACTIVE_TOKEN_KEY);
  const activeTokenId = rawActive && tokens.some((token) => token.id === rawActive) ? rawActive : null;

  return { tokens, activeTokenId };
}

function persistTokens(tokens: StoredApiToken[]): void {
  if (!isBrowser()) {
    return;
  }
  try {
    const payload = JSON.stringify(tokens);
    window.localStorage.setItem(STORAGE_KEY, payload);
  } catch {
    // Ignore storage errors (quota, disabled storage, etc.).
  }
}

function persistActiveToken(id: string | null): void {
  if (!isBrowser()) {
    return;
  }
  try {
    if (id) {
      window.localStorage.setItem(ACTIVE_TOKEN_KEY, id);
    } else {
      window.localStorage.removeItem(ACTIVE_TOKEN_KEY);
    }
  } catch {
    // Ignore storage errors.
  }
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `tok_${Math.random().toString(36).slice(2, 10)}`;
}

export const ApiTokenContext = createContext<ApiTokenContextValue | null>(null);

export function ApiTokenProvider({ children }: PropsWithChildren<unknown>) {
  const initial = useRef(loadInitialState());
  const [tokens, setTokens] = useState<StoredApiToken[]>(() => initial.current.tokens);
  const [activeTokenId, setActiveTokenId] = useState<string | null>(() => initial.current.activeTokenId);

  useEffect(() => {
    persistTokens(tokens);
  }, [tokens]);

  useEffect(() => {
    persistActiveToken(activeTokenId);
  }, [activeTokenId]);

  const addToken = useCallback((input: TokenInput) => {
    const trimmedToken = input.token.trim();
    if (!trimmedToken) {
      throw new Error('Token value is required');
    }
    const trimmedLabel = input.label?.trim() ?? '';
    const id = createId();
    const now = new Date().toISOString();
    setTokens((prev) => {
      const label = trimmedLabel || `Token ${prev.length + 1}`;
      return [
        ...prev,
        { id, token: trimmedToken, label, createdAt: now, lastUsedAt: null } satisfies StoredApiToken
      ];
    });
    setActiveTokenId(id);
    return id;
  }, []);

  const updateToken = useCallback((id: string, updates: TokenUpdate) => {
    setTokens((prev) =>
      prev.map((token) => {
        if (token.id !== id) {
          return token;
        }
        const nextLabel = updates.label !== undefined ? updates.label.trim() : token.label;
        const nextToken = updates.token !== undefined ? updates.token.trim() : token.token;
        return {
          ...token,
          label: nextLabel || token.label,
          token: nextToken || token.token
        } satisfies StoredApiToken;
      })
    );
  }, []);

  const removeToken = useCallback((id: string) => {
    setTokens((prev) => prev.filter((token) => token.id !== id));
    setActiveTokenId((current) => (current === id ? null : current));
  }, []);

  const clearTokens = useCallback(() => {
    setTokens([]);
    setActiveTokenId(null);
  }, []);

  const touchToken = useCallback((id: string) => {
    setTokens((prev) =>
      prev.map((token) =>
        token.id === id
          ? {
              ...token,
              lastUsedAt: new Date().toISOString()
            }
          : token
      )
    );
  }, []);

  const value = useMemo<ApiTokenContextValue>(() => {
    const activeToken = activeTokenId ? tokens.find((token) => token.id === activeTokenId) ?? null : null;
    return {
      tokens,
      activeTokenId,
      activeToken,
      addToken,
      updateToken,
      removeToken,
      setActiveToken: setActiveTokenId,
      clearTokens,
      touchToken
    } satisfies ApiTokenContextValue;
  }, [tokens, activeTokenId, addToken, updateToken, removeToken, clearTokens, touchToken]);

  return <ApiTokenContext.Provider value={value}>{children}</ApiTokenContext.Provider>;
}

export function useApiTokens(): ApiTokenContextValue {
  const context = useContext(ApiTokenContext);
  if (!context) {
    throw new Error('useApiTokens must be used within an ApiTokenProvider');
  }
  return context;
}

export type { StoredApiToken, ApiTokenContextValue };

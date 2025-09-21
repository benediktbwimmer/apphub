import { createContext } from 'react';

export type StoredApiToken = {
  id: string;
  label: string;
  token: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type ApiTokenContextValue = {
  tokens: StoredApiToken[];
  activeTokenId: string | null;
  activeToken: StoredApiToken | null;
  addToken: (input: { label?: string; token: string }) => string;
  updateToken: (id: string, updates: { label?: string; token?: string }) => void;
  removeToken: (id: string) => void;
  setActiveToken: (id: string | null) => void;
  clearTokens: () => void;
  touchToken: (id: string) => void;
};

export const ApiTokenContext = createContext<ApiTokenContextValue | null>(null);

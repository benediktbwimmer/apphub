import { createContext } from 'react';

export type AuthIdentity = {
  subject: string;
  kind: 'user' | 'service';
  scopes: string[];
  userId: string | null;
  sessionId: string | null;
  apiKeyId: string | null;
  displayName: string | null;
  email: string | null;
  roles: string[];
};

export type ApiKeySummary = {
  id: string;
  name: string | null;
  prefix: string;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type CreateApiKeyInput = {
  name?: string;
  scopes?: string[];
  expiresAt?: string | null;
};

export type CreateApiKeyResult = {
  key: ApiKeySummary;
  token: string;
};

export type AuthContextValue = {
  identity: AuthIdentity | null;
  identityLoading: boolean;
  identityError: string | null;
  refreshIdentity: () => Promise<void>;
  apiKeys: ApiKeySummary[];
  apiKeysLoading: boolean;
  apiKeysError: string | null;
  refreshApiKeys: () => Promise<void>;
  createApiKey: (input: CreateApiKeyInput) => Promise<CreateApiKeyResult>;
  revokeApiKey: (id: string) => Promise<void>;
  activeToken: string | null;
  setActiveToken: (token: string | null) => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

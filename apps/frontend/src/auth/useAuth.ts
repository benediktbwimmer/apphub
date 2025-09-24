import { useContext } from 'react';
import {
  AuthContext,
  type AuthIdentity,
  type ApiKeySummary,
  type CreateApiKeyInput,
  type CreateApiKeyResult
} from './context';
import { AuthProvider } from './AuthProvider';

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export { AuthProvider };
export type { AuthIdentity, ApiKeySummary, CreateApiKeyInput, CreateApiKeyResult };

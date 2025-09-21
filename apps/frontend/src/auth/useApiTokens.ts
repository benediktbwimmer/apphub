import { useContext } from 'react';
import { ApiTokenContext, type ApiTokenContextValue } from './apiTokenContextShared';

export function useApiTokens(): ApiTokenContextValue {
  const context = useContext(ApiTokenContext);
  if (!context) {
    throw new Error('useApiTokens must be used within an ApiTokenProvider');
  }
  return context;
}

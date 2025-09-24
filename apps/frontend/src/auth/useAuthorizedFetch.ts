import { useCallback } from 'react';
import { useAuth } from './useAuth';

type FetchArgs = Parameters<typeof fetch>;

type FetchInput = FetchArgs[0];

type FetchInit = FetchArgs[1];

export function useAuthorizedFetch(): (input: FetchInput, init?: FetchInit) => Promise<Response> {
  const { activeToken } = useAuth();

  return useCallback(
    async (input: FetchInput, init?: FetchInit) => {
      const headers = new Headers(init?.headers ?? {});
      const tokenValue = activeToken?.trim();
      if (tokenValue && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${tokenValue}`);
      }

      return fetch(input, {
        ...init,
        headers,
        credentials: 'include'
      });
    },
    [activeToken]
  );
}

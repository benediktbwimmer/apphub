import { useCallback } from 'react';
import { useApiTokens } from './ApiTokenContext';

type FetchArgs = Parameters<typeof fetch>;

type FetchInput = FetchArgs[0];

type FetchInit = FetchArgs[1];

export function useAuthorizedFetch(): (input: FetchInput, init?: FetchInit) => Promise<Response> {
  const { activeToken } = useApiTokens();

  return useCallback(
    async (input: FetchInput, init?: FetchInit) => {
      const headers = new Headers(init?.headers ?? {});
      const tokenValue = activeToken?.token?.trim();
      if (tokenValue) {
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${tokenValue}`);
        }
      }

      const response = await fetch(input, { ...init, headers });

      return response;
    },
    [activeToken]
  );
}

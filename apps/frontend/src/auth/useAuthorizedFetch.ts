import { useCallback } from 'react';
import { API_BASE_URL } from '../config';
import { useAuth } from './useAuth';

type FetchArgs = Parameters<typeof fetch>;

type FetchInput = FetchArgs[0];

type FetchInit = FetchArgs[1];

const API_BASE = API_BASE_URL.replace(/\/$/, '');

function resolveInput(input: FetchInput): FetchInput {
  if (typeof input === 'string') {
    if (/^https?:\/\//i.test(input)) {
      return input;
    }
    const normalizedPath = input.startsWith('/') ? input : `/${input}`;
    return `${API_BASE}${normalizedPath}`;
  }
  return input;
}

export function useAuthorizedFetch(): (input: FetchInput, init?: FetchInit) => Promise<Response> {
  const { activeToken } = useAuth();

  return useCallback(
    async (input: FetchInput, init?: FetchInit) => {
      const headers = new Headers(init?.headers ?? {});
      const tokenValue = activeToken?.trim();
      if (tokenValue && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${tokenValue}`);
      }

      return fetch(resolveInput(input), {
        ...init,
        headers,
        credentials: 'include'
      });
    },
    [activeToken]
  );
}

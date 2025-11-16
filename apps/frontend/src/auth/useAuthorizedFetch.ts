import { useCallback } from 'react';
import { API_BASE_URL } from '../config';
import { useAuth } from './useAuth';
import type { AuthorizedFetch } from '../lib/apiClient';

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

export function useAuthorizedFetch(): AuthorizedFetch {
  const { activeToken, identity } = useAuth();
  const authDisabled = identity?.authDisabled ?? false;
  const normalizedToken = activeToken?.trim() ?? null;

  const fetcher = useCallback(
    async (input: FetchInput, init?: FetchInit) => {
      const headers = new Headers(init?.headers ?? {});
      if (normalizedToken && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${normalizedToken}`);
      }
      const moduleId =
        typeof globalThis !== 'undefined'
          ? ((globalThis as unknown as Record<string, string | null>).__APPHUB_ACTIVE_MODULE_ID ?? null)
          : null;
      const normalizedModuleId = typeof moduleId === 'string' ? moduleId.trim() : '';
      if (normalizedModuleId && !headers.has('X-AppHub-Module-Id')) {
        headers.set('X-AppHub-Module-Id', normalizedModuleId);
      }
      if (!headers.has('Content-Type') && init?.body && !(init.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
      }

      return fetch(resolveInput(input), {
        ...init,
        headers,
        credentials: 'include'
      });
    },
    [normalizedToken]
  ) as AuthorizedFetch;

  fetcher.authToken = normalizedToken ?? null;
  fetcher.authOptional = authDisabled;

  return fetcher;
}

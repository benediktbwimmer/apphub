import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCatalogSearch } from '../useCatalogSearch';
import type { TagFacet } from '../../types';

const mockAuthorizedFetch = vi.fn<
  (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
>();

vi.mock('../../../auth/useAuthorizedFetch', () => ({
  useAuthorizedFetch: () => mockAuthorizedFetch
}));

vi.mock('../../../events/context', async () => {
  const actual = await vi.importActual('../../../events/context');
  return {
    ...actual,
    useAppHubEvent: () => {
      // no-op for tests
    }
  };
});

const createResponse = (body: unknown, init?: { status?: number; ok?: boolean }) => ({
  ok: init?.ok ?? true,
  status: init?.status ?? 200,
  async json() {
    return body;
  }
}) as unknown as Response;

describe('useCatalogSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockAuthorizedFetch.mockReset();
    mockAuthorizedFetch.mockImplementation((input) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/tags/suggest')) {
        return Promise.resolve(createResponse({ data: [] }));
      }
      return Promise.resolve(createResponse({ data: [], facets: {}, meta: { tokens: [] } }));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('switches search sort between relevance and updated based on the parsed query', async () => {
    const { result } = renderHook(() => useCatalogSearch());

    mockAuthorizedFetch.mockClear();

    await act(async () => {
      result.current.setInputValue('alpha');
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const relevanceCall = mockAuthorizedFetch.mock.calls.find(([request]) =>
      typeof request === 'string' && request.includes('/apps?')
    );
    expect(relevanceCall).toBeDefined();
    const relevanceUrl = new URL(relevanceCall?.[0] as string, 'https://catalog.test');
    expect(relevanceUrl.searchParams.get('sort')).toBe('relevance');

    mockAuthorizedFetch.mockClear();

    await act(async () => {
      result.current.handlers.setSortMode('name');
    });

    await act(async () => {
      result.current.setInputValue('');
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const updatedCall = mockAuthorizedFetch.mock.calls.find(([request]) =>
      typeof request === 'string' && request.includes('/apps?')
    );
    expect(updatedCall).toBeDefined();
    const updatedUrl = new URL(updatedCall?.[0] as string, 'https://catalog.test');
    expect(updatedUrl.searchParams.get('sort')).toBe('updated');
  });

  it('avoids duplicating applied tag facets', () => {
    const { result } = renderHook(() => useCatalogSearch());

    act(() => {
      result.current.setInputValue('lang:ts ');
    });

    const facet: TagFacet = { key: 'lang', value: 'ts', count: 12 };

    act(() => {
      result.current.handlers.applyTagFacet(facet);
    });

    expect(result.current.inputValue.trim()).toBe('lang:ts');

    const nextFacet: TagFacet = { key: 'framework', value: 'nextjs', count: 7 };

    act(() => {
      result.current.handlers.applyTagFacet(nextFacet);
    });

    expect(result.current.inputValue.trim()).toBe('lang:ts framework:nextjs');
  });
});

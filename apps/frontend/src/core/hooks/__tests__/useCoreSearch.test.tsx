import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCoreSearch } from '../useCoreSearch';
import type { TagFacet } from '../../types';

const mockAuthToken = 'token';
const mockSearchRepositories = vi.fn();
const mockSuggestTags = vi.fn();

vi.mock('../../../auth/useAuth', () => ({
  useAuth: () => ({ activeToken: mockAuthToken })
}));

vi.mock('../../api', () => ({
  searchRepositories: (...args: unknown[]) => mockSearchRepositories(...args),
  suggestTags: (...args: unknown[]) => mockSuggestTags(...args)
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

describe('useCoreSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSearchRepositories.mockReset();
    mockSuggestTags.mockReset();
    mockSearchRepositories.mockImplementation((_, params) =>
      Promise.resolve({
        repositories: [],
        facets: { tags: [], statuses: [], owners: [], frameworks: [] },
        total: 0,
        meta: {
          tokens: [],
          sort: (params as { sort?: string } | undefined)?.sort ?? 'relevance',
          weights: { name: 1, description: 1, tags: 1 }
        }
      })
    );
    mockSuggestTags.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('switches search sort between relevance and updated based on the parsed query', async () => {
    const { result } = renderHook(() => useCoreSearch());

    mockSearchRepositories.mockClear();

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

    const relevanceCall = mockSearchRepositories.mock.calls[0];
    expect(relevanceCall).toBeDefined();
    const relevanceParams = relevanceCall?.[1] as { sort?: string } | undefined;
    expect(relevanceParams?.sort).toBe('relevance');

    mockSearchRepositories.mockClear();

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

    const updatedCall = mockSearchRepositories.mock.calls[0];
    expect(updatedCall).toBeDefined();
    const updatedParams = updatedCall?.[1] as { sort?: string } | undefined;
    expect(updatedParams?.sort).toBe('updated');
  });

  it('avoids duplicating applied tag facets', () => {
    const { result } = renderHook(() => useCoreSearch());

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

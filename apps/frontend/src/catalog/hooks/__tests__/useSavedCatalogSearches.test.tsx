import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSavedCatalogSearches } from '../useSavedCatalogSearches';
import type { SavedCatalogSearch } from '../../types';

const mockAuthorizedFetch = vi.fn<
  (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
>();

vi.mock('../../../auth/useAuthorizedFetch', () => ({
  useAuthorizedFetch: () => mockAuthorizedFetch
}));

vi.mock('../../utils/useAnalytics', () => ({
  useAnalytics: () => ({
    trackEvent: () => {
      // no-op
    }
  })
}));

const createResponse = (body: unknown, init?: { status?: number; ok?: boolean }) => ({
  ok: init?.ok ?? true,
  status: init?.status ?? 200,
  async json() {
    return body;
  }
}) as unknown as Response;

describe('useSavedCatalogSearches', () => {
  const baseSearch: SavedCatalogSearch = {
    id: 'search-1',
    slug: 'ready-services',
    name: 'Ready services',
    description: null,
    searchInput: 'status:ready',
    statusFilters: ['ready'],
    sort: 'relevance',
    category: 'catalog',
    config: {},
    visibility: 'private',
    appliedCount: 2,
    sharedCount: 0,
    lastAppliedAt: null,
    lastSharedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  beforeEach(() => {
    mockAuthorizedFetch.mockReset();
    mockAuthorizedFetch.mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/saved-searches') && url.includes('category=catalog') && (!init || !init.method)) {
        return Promise.resolve(createResponse({ data: [baseSearch] }));
      }
      if (url.includes('/saved-searches') && init?.method === 'POST') {
        const created = {
          ...baseSearch,
          id: 'search-2',
          slug: 'new-search',
          name: 'My apps',
          searchInput: 'framework:nextjs',
          statusFilters: [],
          appliedCount: 0,
          sharedCount: 0
        } satisfies SavedCatalogSearch;
        return Promise.resolve(createResponse({ data: created }));
      }
      if (url.includes('/saved-searches/new-search/apply')) {
        const applied = {
          ...baseSearch,
          id: 'search-2',
          slug: 'new-search',
          name: 'My apps',
          searchInput: 'framework:nextjs',
          statusFilters: [],
          appliedCount: 1,
          sharedCount: 0,
          lastAppliedAt: new Date().toISOString()
        } satisfies SavedCatalogSearch;
        return Promise.resolve(createResponse({ data: applied }));
      }
      if (url.includes('/saved-searches/new-search/share')) {
        const shared = {
          ...baseSearch,
          id: 'search-2',
          slug: 'new-search',
          name: 'My apps',
          searchInput: 'framework:nextjs',
          statusFilters: [],
          appliedCount: 1,
          sharedCount: 1,
          lastSharedAt: new Date().toISOString()
        } satisfies SavedCatalogSearch;
        return Promise.resolve(createResponse({ data: shared }));
      }
      if (url.includes('/saved-searches/new-search') && (!init || !init.method)) {
        const created = {
          ...baseSearch,
          id: 'search-2',
          slug: 'new-search',
          name: 'My apps',
          searchInput: 'framework:nextjs',
          statusFilters: [],
          appliedCount: 1,
          sharedCount: 1
        } satisfies SavedCatalogSearch;
        return Promise.resolve(createResponse({ data: created }));
      }
      if (url.includes('/saved-searches/new-search') && init?.method === 'PATCH') {
        const updated = {
          ...baseSearch,
          id: 'search-2',
          slug: 'new-search',
          name: 'Renamed search',
          searchInput: 'framework:nextjs',
          statusFilters: [],
          appliedCount: 1,
          sharedCount: 1
        } satisfies SavedCatalogSearch;
        return Promise.resolve(createResponse({ data: updated }));
      }
      if (url.includes('/saved-searches/new-search') && init?.method === 'DELETE') {
        return Promise.resolve(createResponse({}, { status: 204 }));
      }
      return Promise.resolve(createResponse({ data: [] }));
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads saved searches on mount and creates new entries', async () => {
    const { result } = renderHook(() => useSavedCatalogSearches());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.savedSearches).toHaveLength(1);
    expect(result.current.savedSearches[0].slug).toBe('ready-services');

    await act(async () => {
      await result.current.createSavedSearch({
        name: 'My apps',
        description: null,
        searchInput: 'framework:nextjs',
        statusFilters: [],
        sort: 'name'
      });
    });

    expect(result.current.savedSearches).toHaveLength(2);
    expect(result.current.savedSearches.some((item) => item.slug === 'new-search')).toBe(true);
  });

  it('fetches and applies a saved search by slug', async () => {
    const { result } = renderHook(() => useSavedCatalogSearches());

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.createSavedSearch({
        name: 'My apps',
        description: null,
        searchInput: 'framework:nextjs',
        statusFilters: [],
        sort: 'name'
      });
    });

    await act(async () => {
      const fetched = await result.current.getSavedSearch('new-search');
      expect(fetched?.slug).toBe('new-search');
    });

    await act(async () => {
      await result.current.recordSavedSearchApplied('new-search');
    });

    const applied = result.current.savedSearches.find((item) => item.slug === 'new-search');
    expect(applied?.appliedCount).toBe(1);
  });

  it('records share activity for a saved search', async () => {
    const { result } = renderHook(() => useSavedCatalogSearches());

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.createSavedSearch({
        name: 'My apps',
        description: null,
        searchInput: 'framework:nextjs',
        statusFilters: [],
        sort: 'name'
      });
    });

    await act(async () => {
      await result.current.recordSavedSearchShared('new-search');
    });

    const shared = result.current.savedSearches.find((item) => item.slug === 'new-search');
    expect(shared?.sharedCount).toBe(1);
  });
});

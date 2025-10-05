import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSavedCoreSearches } from '../useSavedCoreSearches';
import type { SavedCoreSearch } from '../../types';

const apiMocks = vi.hoisted(() => ({
  listSavedSearchesMock: vi.fn(),
  createSavedSearchMock: vi.fn(),
  updateSavedSearchMock: vi.fn(),
  deleteSavedSearchMock: vi.fn(),
  applySavedSearchMock: vi.fn(),
  shareSavedSearchMock: vi.fn(),
  getSavedSearchMock: vi.fn()
}));

const authorizedFetchMock = vi.hoisted(() => {
  const fn = vi.fn();
  (fn as unknown as { authToken?: string | null }).authToken = 'test-token';
  return fn;
});

vi.mock('../../../savedSearches/api', () => ({
  listSavedSearches: apiMocks.listSavedSearchesMock,
  createSavedSearch: apiMocks.createSavedSearchMock,
  updateSavedSearch: apiMocks.updateSavedSearchMock,
  deleteSavedSearch: apiMocks.deleteSavedSearchMock,
  applySavedSearch: apiMocks.applySavedSearchMock,
  shareSavedSearch: apiMocks.shareSavedSearchMock,
  getSavedSearch: apiMocks.getSavedSearchMock
}));

vi.mock('../../utils/useAnalytics', () => ({
  useAnalytics: () => ({
    trackEvent: vi.fn()
  })
}));

vi.mock('../../../auth/useAuthorizedFetch', () => ({
  useAuthorizedFetch: () => authorizedFetchMock
}));

vi.mock('../../../auth/useAuth', () => ({
  useAuth: () => ({
    activeToken: 'test-token',
    setActiveToken: vi.fn(),
    identity: null,
    identityLoading: false,
    identityError: null,
    refreshIdentity: vi.fn(),
    apiKeys: [],
    apiKeysLoading: false,
    apiKeysError: null,
    refreshApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn()
  })
}));

describe('useSavedCoreSearches', () => {
  const baseSearch: SavedCoreSearch = {
    id: 'search-1',
    slug: 'ready-services',
    name: 'Ready services',
    description: null,
    searchInput: 'status:ready',
    statusFilters: ['ready'],
    sort: 'relevance',
    category: 'core',
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
    apiMocks.listSavedSearchesMock.mockReset();
    apiMocks.createSavedSearchMock.mockReset();
    apiMocks.updateSavedSearchMock.mockReset();
    apiMocks.deleteSavedSearchMock.mockReset();
    apiMocks.applySavedSearchMock.mockReset();
    apiMocks.shareSavedSearchMock.mockReset();
    apiMocks.getSavedSearchMock.mockReset();
    authorizedFetchMock.mockReset();
    (authorizedFetchMock as unknown as { authToken?: string | null }).authToken = 'test-token';

    apiMocks.listSavedSearchesMock.mockResolvedValue([baseSearch]);

    const created: SavedCoreSearch = {
      ...baseSearch,
      id: 'search-2',
      slug: 'new-search',
      name: 'My apps',
      searchInput: 'framework:nextjs',
      statusFilters: [],
      appliedCount: 0,
      sharedCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    apiMocks.createSavedSearchMock.mockResolvedValue(created);

    const applied: SavedCoreSearch = {
      ...created,
      appliedCount: 1,
      lastAppliedAt: new Date().toISOString()
    };
    apiMocks.applySavedSearchMock.mockResolvedValue(applied);

    const shared: SavedCoreSearch = {
      ...applied,
      sharedCount: 1,
      lastSharedAt: new Date().toISOString()
    };
    apiMocks.shareSavedSearchMock.mockResolvedValue(shared);
    apiMocks.getSavedSearchMock.mockResolvedValue(shared);

    const updated: SavedCoreSearch = {
      ...shared,
      name: 'Renamed search'
    };
    apiMocks.updateSavedSearchMock.mockResolvedValue(updated);

    apiMocks.deleteSavedSearchMock.mockResolvedValue('deleted');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads saved searches on mount and creates new entries', async () => {
    const { result } = renderHook(() => useSavedCoreSearches());

    await act(async () => {
      await Promise.resolve();
    });

    expect(apiMocks.listSavedSearchesMock).toHaveBeenCalledWith('test-token', { category: 'core' });
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

    expect(apiMocks.createSavedSearchMock).toHaveBeenCalled();
    expect(result.current.savedSearches).toHaveLength(2);
    expect(result.current.savedSearches.some((item) => item.slug === 'new-search')).toBe(true);
  });

  it('fetches and applies a saved search by slug', async () => {
    const { result } = renderHook(() => useSavedCoreSearches());

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.recordSavedSearchApplied('new-search');
    });
    expect(apiMocks.applySavedSearchMock).toHaveBeenCalledWith('test-token', 'new-search');
    expect(result.current.savedSearches.find((item) => item.slug === 'new-search')?.appliedCount).toBe(1);

    await act(async () => {
      await result.current.recordSavedSearchShared('new-search');
    });
    expect(apiMocks.shareSavedSearchMock).toHaveBeenCalledWith('test-token', 'new-search');
    expect(result.current.savedSearches.find((item) => item.slug === 'new-search')?.sharedCount).toBe(1);

    await act(async () => {
      await result.current.getSavedSearch('new-search');
    });
    expect(apiMocks.getSavedSearchMock).toHaveBeenCalledWith('test-token', 'new-search');
  });

  it('updates and deletes saved searches', async () => {
    const { result } = renderHook(() => useSavedCoreSearches());

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.updateSavedSearch('new-search', { name: 'Renamed search' });
    });
    expect(apiMocks.updateSavedSearchMock).toHaveBeenCalledWith('test-token', 'new-search', {
      name: 'Renamed search'
    });
    expect(result.current.savedSearches.find((item) => item.slug === 'new-search')?.name).toBe(
      'Renamed search'
    );

    await act(async () => {
      await result.current.deleteSavedSearch('new-search');
    });
    expect(apiMocks.deleteSavedSearchMock).toHaveBeenCalledWith('test-token', 'new-search');
    expect(result.current.savedSearches.find((item) => item.slug === 'new-search')).toBeUndefined();
  });
});

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { API_BASE_URL } from '../constants';
import type { SavedCatalogSearch, SavedCatalogSearchCreateInput } from '../types';
import { useAnalytics } from '../../utils/useAnalytics';

const API_ROOT = `${API_BASE_URL}/saved-searches`;

function sortSavedSearches(searches: SavedCatalogSearch[]): SavedCatalogSearch[] {
  return searches
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function mergeSearch(current: SavedCatalogSearch[], next: SavedCatalogSearch): SavedCatalogSearch[] {
  const existingIndex = current.findIndex((item) => item.id === next.id);
  if (existingIndex === -1) {
    return sortSavedSearches([...current, next]);
  }
  const merged = current.slice();
  merged[existingIndex] = next;
  return sortSavedSearches(merged);
}

export type SavedSearchMutationState = {
  creating: boolean;
  applyingSlug: string | null;
  sharingSlug: string | null;
  updatingSlug: string | null;
  deletingSlug: string | null;
};

export type UseSavedCatalogSearchesResult = {
  savedSearches: SavedCatalogSearch[];
  loading: boolean;
  error: string | null;
  mutationState: SavedSearchMutationState;
  createSavedSearch: (input: SavedCatalogSearchCreateInput) => Promise<SavedCatalogSearch | null>;
  updateSavedSearch: (
    slug: string,
    updates: Partial<Pick<SavedCatalogSearchCreateInput, 'name' | 'description' | 'statusFilters' | 'sort' | 'searchInput'>>
  ) => Promise<SavedCatalogSearch | null>;
  deleteSavedSearch: (slug: string) => Promise<boolean>;
  recordSavedSearchApplied: (slug: string) => Promise<SavedCatalogSearch | null>;
  recordSavedSearchShared: (slug: string) => Promise<SavedCatalogSearch | null>;
  getSavedSearch: (slug: string) => Promise<SavedCatalogSearch | null>;
  refresh: () => Promise<void>;
};

export function useSavedCatalogSearches(): UseSavedCatalogSearchesResult {
  const authorizedFetch = useAuthorizedFetch();
  const analytics = useAnalytics();
  const [savedSearches, setSavedSearches] = useState<SavedCatalogSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [applyingSlug, setApplyingSlug] = useState<string | null>(null);
  const [sharingSlug, setSharingSlug] = useState<string | null>(null);
  const [updatingSlug, setUpdatingSlug] = useState<string | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authorizedFetch(`${API_ROOT}`);
      if (!response.ok) {
        throw new Error(`Failed to load saved searches (${response.status})`);
      }
      const payload = await response.json();
      const items = Array.isArray(payload?.data) ? (payload.data as SavedCatalogSearch[]) : [];
      setSavedSearches(sortSavedSearches(items));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [authorizedFetch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createSavedSearch = useCallback(
    async (input: SavedCatalogSearchCreateInput): Promise<SavedCatalogSearch | null> => {
      setCreating(true);
      setError(null);
      try {
        const response = await authorizedFetch(`${API_ROOT}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input)
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail?.error ?? `Failed to create saved search (${response.status})`);
        }
        const payload = await response.json();
        const record = payload?.data as SavedCatalogSearch | undefined;
        if (record) {
          setSavedSearches((current) => mergeSearch(current, record));
          analytics.trackEvent('catalog_saved_search_created', {
            slug: record.slug,
            sort: record.sort,
            statusFilters: record.statusFilters
          });
          return record;
        }
        return null;
      } catch (err) {
        setError((err as Error).message);
        throw err;
      } finally {
        setCreating(false);
      }
    },
    [analytics, authorizedFetch]
  );

  const updateSavedSearch = useCallback(
    async (
      slug: string,
      updates: Partial<Pick<SavedCatalogSearchCreateInput, 'name' | 'description' | 'statusFilters' | 'sort' | 'searchInput'>>
    ): Promise<SavedCatalogSearch | null> => {
      setUpdatingSlug(slug);
      setError(null);
      try {
        const response = await authorizedFetch(`${API_ROOT}/${encodeURIComponent(slug)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates)
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail?.error ?? `Failed to update saved search (${response.status})`);
        }
        const payload = await response.json();
        const record = payload?.data as SavedCatalogSearch | undefined;
        if (record) {
          setSavedSearches((current) => mergeSearch(current, record));
          return record;
        }
        return null;
      } catch (err) {
        setError((err as Error).message);
        throw err;
      } finally {
        setUpdatingSlug(null);
      }
    },
    [authorizedFetch]
  );

  const deleteSavedSearch = useCallback(
    async (slug: string): Promise<boolean> => {
      setDeletingSlug(slug);
      setError(null);
      try {
        const response = await authorizedFetch(`${API_ROOT}/${encodeURIComponent(slug)}`, {
          method: 'DELETE'
        });
        if (response.status === 204) {
          setSavedSearches((current) => current.filter((item) => item.slug !== slug));
          return true;
        }
        if (response.status === 404) {
          setSavedSearches((current) => current.filter((item) => item.slug !== slug));
          return false;
        }
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail?.error ?? `Failed to delete saved search (${response.status})`);
      } catch (err) {
        setError((err as Error).message);
        throw err;
      } finally {
        setDeletingSlug(null);
      }
    },
    [authorizedFetch]
  );

  const recordSavedSearchApplied = useCallback(
    async (slug: string): Promise<SavedCatalogSearch | null> => {
      setApplyingSlug(slug);
      setError(null);
      try {
        const response = await authorizedFetch(`${API_ROOT}/${encodeURIComponent(slug)}/apply`, {
          method: 'POST'
        });
        if (response.status === 404) {
          setSavedSearches((current) => current.filter((item) => item.slug !== slug));
          return null;
        }
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail?.error ?? `Failed to record saved search usage (${response.status})`);
        }
        const payload = await response.json();
        const record = payload?.data as SavedCatalogSearch | undefined;
        if (record) {
          setSavedSearches((current) => mergeSearch(current, record));
          analytics.trackEvent('catalog_saved_search_applied', {
            slug: record.slug,
            sort: record.sort,
            statusFilters: record.statusFilters
          });
          return record;
        }
        return null;
      } catch (err) {
        setError((err as Error).message);
        throw err;
      } finally {
        setApplyingSlug(null);
      }
    },
    [analytics, authorizedFetch]
  );

  const recordSavedSearchShared = useCallback(
    async (slug: string): Promise<SavedCatalogSearch | null> => {
      setSharingSlug(slug);
      setError(null);
      try {
        const response = await authorizedFetch(`${API_ROOT}/${encodeURIComponent(slug)}/share`, {
          method: 'POST'
        });
        if (response.status === 404) {
          setSavedSearches((current) => current.filter((item) => item.slug !== slug));
          return null;
        }
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail?.error ?? `Failed to record saved search share (${response.status})`);
        }
        const payload = await response.json();
        const record = payload?.data as SavedCatalogSearch | undefined;
        if (record) {
          setSavedSearches((current) => mergeSearch(current, record));
          analytics.trackEvent('catalog_saved_search_shared', {
            slug: record.slug,
            sort: record.sort,
            statusFilters: record.statusFilters
          });
          return record;
        }
        return null;
      } catch (err) {
        setError((err as Error).message);
        throw err;
      } finally {
        setSharingSlug(null);
      }
    },
    [analytics, authorizedFetch]
  );

  const getSavedSearch = useCallback(
    async (slug: string): Promise<SavedCatalogSearch | null> => {
      const existing = savedSearches.find((item) => item.slug === slug);
      if (existing) {
        return existing;
      }
      try {
        const response = await authorizedFetch(`${API_ROOT}/${encodeURIComponent(slug)}`);
        if (response.status === 404) {
          return null;
        }
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail?.error ?? `Failed to load saved search (${response.status})`);
        }
        const payload = await response.json();
        const record = payload?.data as SavedCatalogSearch | undefined;
        if (record) {
          setSavedSearches((current) => mergeSearch(current, record));
          return record;
        }
        return null;
      } catch (err) {
        setError((err as Error).message);
        throw err;
      }
    },
    [authorizedFetch, savedSearches]
  );

  const mutationState = useMemo<SavedSearchMutationState>(
    () => ({ creating, applyingSlug, sharingSlug, updatingSlug, deletingSlug }),
    [applyingSlug, creating, deletingSlug, sharingSlug, updatingSlug]
  );

  return {
    savedSearches,
    loading,
    error,
    mutationState,
    createSavedSearch,
    updateSavedSearch,
    deleteSavedSearch,
    recordSavedSearchApplied,
    recordSavedSearchShared,
    getSavedSearch,
    refresh
  } satisfies UseSavedCatalogSearchesResult;
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE_URL } from '../config';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { useAnalytics } from '../utils/useAnalytics';
import type {
  SavedSearch,
  SavedSearchCreateInput,
  SavedSearchMutationState,
  SavedSearchUpdateInput
} from './types';

type AnalyticsOptions<TStatus extends string, TConfig> = {
  createdEvent?: string;
  appliedEvent?: string;
  sharedEvent?: string;
  payloadMapper?: (record: SavedSearch<TStatus, TConfig>) => Record<string, unknown>;
};

export type UseSavedSearchesOptions<TStatus extends string, TConfig> = {
  category: string;
  analytics?: AnalyticsOptions<TStatus, TConfig>;
  sortComparator?: (a: SavedSearch<TStatus, TConfig>, b: SavedSearch<TStatus, TConfig>) => number;
};

export type UseSavedSearchesResult<TStatus extends string, TConfig> = {
  savedSearches: SavedSearch<TStatus, TConfig>[];
  loading: boolean;
  error: string | null;
  mutationState: SavedSearchMutationState;
  createSavedSearch: (
    input: SavedSearchCreateInput<TStatus, TConfig>
  ) => Promise<SavedSearch<TStatus, TConfig> | null>;
  updateSavedSearch: (
    slug: string,
    updates: SavedSearchUpdateInput<TStatus, TConfig>
  ) => Promise<SavedSearch<TStatus, TConfig> | null>;
  deleteSavedSearch: (slug: string) => Promise<boolean>;
  recordSavedSearchApplied: (slug: string) => Promise<SavedSearch<TStatus, TConfig> | null>;
  recordSavedSearchShared: (slug: string) => Promise<SavedSearch<TStatus, TConfig> | null>;
  getSavedSearch: (slug: string) => Promise<SavedSearch<TStatus, TConfig> | null>;
  refresh: () => Promise<void>;
};

const API_ROOT = `${API_BASE_URL}/saved-searches`;

function defaultComparator<TStatus extends string, TConfig>(
  a: SavedSearch<TStatus, TConfig>,
  b: SavedSearch<TStatus, TConfig>
): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function mergeSearch<TStatus extends string, TConfig>(
  current: SavedSearch<TStatus, TConfig>[],
  next: SavedSearch<TStatus, TConfig>,
  comparator: (a: SavedSearch<TStatus, TConfig>, b: SavedSearch<TStatus, TConfig>) => number
): SavedSearch<TStatus, TConfig>[] {
  const existingIndex = current.findIndex((item) => item.id === next.id);
  if (existingIndex === -1) {
    return [...current, next].sort(comparator);
  }
  const updated = current.slice();
  updated[existingIndex] = next;
  return updated.sort(comparator);
}

export function useSavedSearches<TStatus extends string = string, TConfig = unknown>(
  options: UseSavedSearchesOptions<TStatus, TConfig>
): UseSavedSearchesResult<TStatus, TConfig> {
  const { category, analytics: analyticsOptions, sortComparator } = options;
  const authorizedFetch = useAuthorizedFetch();
  const analytics = useAnalytics();
  const comparatorRef = useRef<
    (a: SavedSearch<TStatus, TConfig>, b: SavedSearch<TStatus, TConfig>) => number
  >(sortComparator ?? defaultComparator<TStatus, TConfig>);
  comparatorRef.current = sortComparator ?? defaultComparator<TStatus, TConfig>;

  const [savedSearches, setSavedSearches] = useState<SavedSearch<TStatus, TConfig>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [applyingSlug, setApplyingSlug] = useState<string | null>(null);
  const [sharingSlug, setSharingSlug] = useState<string | null>(null);
  const [updatingSlug, setUpdatingSlug] = useState<string | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);

  const trackEvent = useCallback(
    (eventName: string | undefined, record: SavedSearch<TStatus, TConfig>) => {
      if (!eventName) {
        return;
      }
      const payload = analyticsOptions?.payloadMapper?.(record) ?? {
        slug: record.slug,
        category: record.category
      };
      analytics.trackEvent(eventName, payload);
    },
    [analytics, analyticsOptions]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (category) {
        query.set('category', category);
      }
      const response = await authorizedFetch(`${API_ROOT}?${query.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to load saved searches (${response.status})`);
      }
      const payload = await response.json();
      const items = Array.isArray(payload?.data) ? (payload.data as SavedSearch<TStatus, TConfig>[]) : [];
      setSavedSearches(items.slice().sort(comparatorRef.current));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [authorizedFetch, category]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createSavedSearch = useCallback(
    async (
      input: SavedSearchCreateInput<TStatus, TConfig>
    ): Promise<SavedSearch<TStatus, TConfig> | null> => {
      setCreating(true);
      setError(null);
      try {
        const payload = {
          ...input,
          category: input.category ?? category
        } satisfies SavedSearchCreateInput<TStatus, TConfig>;
        const response = await authorizedFetch(`${API_ROOT}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail?.error ?? `Failed to create saved search (${response.status})`);
        }
        const body = await response.json();
        const record = body?.data as SavedSearch<TStatus, TConfig> | undefined;
        if (record) {
          setSavedSearches((current) => mergeSearch(current, record, comparatorRef.current));
          trackEvent(analyticsOptions?.createdEvent, record);
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
    [analyticsOptions, authorizedFetch, category, trackEvent]
  );

  const updateSavedSearch = useCallback(
    async (
      slug: string,
      updates: SavedSearchUpdateInput<TStatus, TConfig>
    ): Promise<SavedSearch<TStatus, TConfig> | null> => {
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
        const body = await response.json();
        const record = body?.data as SavedSearch<TStatus, TConfig> | undefined;
        if (record) {
          setSavedSearches((current) => mergeSearch(current, record, comparatorRef.current));
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
        if (response.status === 204 || response.status === 404) {
          setSavedSearches((current) => current.filter((item) => item.slug !== slug));
          return response.status === 204;
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
    async (slug: string): Promise<SavedSearch<TStatus, TConfig> | null> => {
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
        const body = await response.json();
        const record = body?.data as SavedSearch<TStatus, TConfig> | undefined;
        if (record) {
          setSavedSearches((current) => mergeSearch(current, record, comparatorRef.current));
          trackEvent(analyticsOptions?.appliedEvent, record);
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
    [analyticsOptions, authorizedFetch, trackEvent]
  );

  const recordSavedSearchShared = useCallback(
    async (slug: string): Promise<SavedSearch<TStatus, TConfig> | null> => {
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
        const body = await response.json();
        const record = body?.data as SavedSearch<TStatus, TConfig> | undefined;
        if (record) {
          setSavedSearches((current) => mergeSearch(current, record, comparatorRef.current));
          trackEvent(analyticsOptions?.sharedEvent, record);
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
    [analyticsOptions, authorizedFetch, trackEvent]
  );

  const getSavedSearch = useCallback(
    async (slug: string): Promise<SavedSearch<TStatus, TConfig> | null> => {
      try {
        const response = await authorizedFetch(`${API_ROOT}/${encodeURIComponent(slug)}`);
        if (response.status === 404) {
          return null;
        }
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail?.error ?? `Failed to load saved search (${response.status})`);
        }
        const body = await response.json();
        return (body?.data as SavedSearch<TStatus, TConfig>) ?? null;
      } catch (err) {
        setError((err as Error).message);
        throw err;
      }
    },
    [authorizedFetch]
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
  } satisfies UseSavedSearchesResult<TStatus, TConfig>;
}

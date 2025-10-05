import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { useAnalytics } from '../utils/useAnalytics';
import { useAuth } from '../auth/useAuth';
import { ApiError } from '../lib/apiClient';
import type {
  SavedSearch,
  SavedSearchCreateInput,
  SavedSearchMutationState,
  SavedSearchUpdateInput
} from './types';
import {
  applySavedSearch,
  createSavedSearch as createSavedSearchRequest,
  deleteSavedSearch as deleteSavedSearchRequest,
  getSavedSearch as getSavedSearchRequest,
  listSavedSearches,
  shareSavedSearch,
  updateSavedSearch as updateSavedSearchRequest
} from './api';

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

const AUTH_ERROR_MESSAGE = 'Authentication required for saved search requests.';

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

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function useSavedSearches<TStatus extends string = string, TConfig = unknown>(
  options: UseSavedSearchesOptions<TStatus, TConfig>
): UseSavedSearchesResult<TStatus, TConfig> {
  const { category, analytics: analyticsOptions, sortComparator } = options;
  const authorizedFetch = useAuthorizedFetch();
  const { activeToken } = useAuth();
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

  const tokenInput = useCallback(() => {
    if (activeToken && activeToken.trim().length > 0) {
      return activeToken;
    }
    return authorizedFetch;
  }, [activeToken, authorizedFetch]);

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
      const items = await listSavedSearches<TStatus, TConfig>(tokenInput(), { category });
      setSavedSearches(items.slice().sort(comparatorRef.current));
    } catch (err) {
      const message = extractErrorMessage(err, 'Failed to load saved searches');
      setError(message);
      if (message === AUTH_ERROR_MESSAGE) {
        setSavedSearches([]);
      }
    } finally {
      setLoading(false);
    }
  }, [category, tokenInput]);

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
        const record = await createSavedSearchRequest<TStatus, TConfig>(tokenInput(), payload);
        if (record) {
          setSavedSearches((current) => mergeSearch(current, record, comparatorRef.current));
          trackEvent(analyticsOptions?.createdEvent, record);
          return record;
        }
        return null;
      } catch (err) {
        const message = extractErrorMessage(err, 'Failed to create saved search');
        setError(message);
        throw err;
      } finally {
        setCreating(false);
      }
    },
    [analyticsOptions, category, tokenInput, trackEvent]
  );

  const updateSavedSearch = useCallback(
    async (
      slug: string,
      updates: SavedSearchUpdateInput<TStatus, TConfig>
    ): Promise<SavedSearch<TStatus, TConfig> | null> => {
      setUpdatingSlug(slug);
      setError(null);
      try {
        const record = await updateSavedSearchRequest<TStatus, TConfig>(tokenInput(), slug, updates);
        if (record) {
          setSavedSearches((current) => mergeSearch(current, record, comparatorRef.current));
          return record;
        }
        return null;
      } catch (err) {
        const message = extractErrorMessage(err, 'Failed to update saved search');
        setError(message);
        throw err;
      } finally {
        setUpdatingSlug(null);
      }
    },
    [tokenInput]
  );

  const deleteSavedSearch = useCallback(
    async (slug: string): Promise<boolean> => {
      setDeletingSlug(slug);
      setError(null);
      try {
        const result = await deleteSavedSearchRequest(tokenInput(), slug);
        setSavedSearches((current) => current.filter((item) => item.slug !== slug));
        return result === 'deleted';
      } catch (err) {
        const message = extractErrorMessage(err, 'Failed to delete saved search');
        setError(message);
        throw err;
      } finally {
        setDeletingSlug(null);
      }
    },
    [tokenInput]
  );

  const recordSavedSearchApplied = useCallback(
    async (slug: string): Promise<SavedSearch<TStatus, TConfig> | null> => {
      setApplyingSlug(slug);
      setError(null);
      try {
        const record = await applySavedSearch<TStatus, TConfig>(tokenInput(), slug);
        if (record) {
          setSavedSearches((current) => mergeSearch(current, record, comparatorRef.current));
          trackEvent(analyticsOptions?.appliedEvent, record);
          return record;
        }
        setSavedSearches((current) => current.filter((item) => item.slug !== slug));
        return null;
      } catch (err) {
        const message = extractErrorMessage(err, 'Failed to record saved search usage');
        setError(message);
        throw err;
      } finally {
        setApplyingSlug(null);
      }
    },
    [analyticsOptions, tokenInput, trackEvent]
  );

  const recordSavedSearchShared = useCallback(
    async (slug: string): Promise<SavedSearch<TStatus, TConfig> | null> => {
      setSharingSlug(slug);
      setError(null);
      try {
        const record = await shareSavedSearch<TStatus, TConfig>(tokenInput(), slug);
        if (record) {
          setSavedSearches((current) => mergeSearch(current, record, comparatorRef.current));
          trackEvent(analyticsOptions?.sharedEvent, record);
          return record;
        }
        setSavedSearches((current) => current.filter((item) => item.slug !== slug));
        return null;
      } catch (err) {
        const message = extractErrorMessage(err, 'Failed to record saved search share');
        setError(message);
        throw err;
      } finally {
        setSharingSlug(null);
      }
    },
    [analyticsOptions, tokenInput, trackEvent]
  );

  const getSavedSearch = useCallback(
    async (slug: string): Promise<SavedSearch<TStatus, TConfig> | null> => {
      try {
        return await getSavedSearchRequest<TStatus, TConfig>(tokenInput(), slug);
      } catch (err) {
        const message = extractErrorMessage(err, 'Failed to load saved search');
        setError(message);
        throw err;
      }
    },
    [tokenInput]
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

import { useCallback, useMemo } from 'react';
import type { SavedSearchMutationState } from '../../savedSearches/types';
import { useSavedSearches } from '../../savedSearches/useSavedSearches';
export type { SavedSearchMutationState } from '../../savedSearches/types';
import type { SavedCoreSearch, SavedCoreSearchCreateInput, SearchSort, IngestStatus } from '../types';

export type UseSavedCoreSearchesResult = {
  savedSearches: SavedCoreSearch[];
  loading: boolean;
  error: string | null;
  mutationState: SavedSearchMutationState;
  createSavedSearch: (input: SavedCoreSearchCreateInput) => Promise<SavedCoreSearch | null>;
  updateSavedSearch: (
    slug: string,
    updates: Partial<Pick<SavedCoreSearchCreateInput, 'name' | 'description' | 'statusFilters' | 'sort' | 'searchInput'>>
  ) => Promise<SavedCoreSearch | null>;
  deleteSavedSearch: (slug: string) => Promise<boolean>;
  recordSavedSearchApplied: (slug: string) => Promise<SavedCoreSearch | null>;
  recordSavedSearchShared: (slug: string) => Promise<SavedCoreSearch | null>;
  getSavedSearch: (slug: string) => Promise<SavedCoreSearch | null>;
  refresh: () => Promise<void>;
};

function mapStatusFilters(filters: string[]): IngestStatus[] {
  return filters.filter((status): status is IngestStatus =>
    ['seed', 'pending', 'processing', 'ready', 'failed'].includes(status as IngestStatus)
  );
}

export function useSavedCoreSearches(): UseSavedCoreSearchesResult {
  const base = useSavedSearches<IngestStatus, Record<string, unknown>>({
    category: 'core',
    analytics: {
      createdEvent: 'core_saved_search_created',
      appliedEvent: 'core_saved_search_applied',
      sharedEvent: 'core_saved_search_shared',
      payloadMapper: (record) => ({
        slug: record.slug,
        sort: record.sort,
        statusFilters: record.statusFilters
      })
    },
    sortComparator: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  });

  const savedSearches = useMemo<SavedCoreSearch[]>(
    () =>
      base.savedSearches.map((entry) => ({
        ...entry,
        sort: entry.sort as SearchSort,
        statusFilters: mapStatusFilters(entry.statusFilters)
      })),
    [base.savedSearches]
  );

  const createSavedSearch = useCallback(
    async (input: SavedCoreSearchCreateInput): Promise<SavedCoreSearch | null> => {
      const record = await base.createSavedSearch({ ...input, category: 'core' });
      return record
        ? ({
            ...record,
            sort: record.sort as SearchSort,
            statusFilters: mapStatusFilters(record.statusFilters)
          } as SavedCoreSearch)
        : null;
    },
    [base]
  );

  const updateSavedSearch = useCallback(
    async (
      slug: string,
      updates: Partial<Pick<SavedCoreSearchCreateInput, 'name' | 'description' | 'statusFilters' | 'sort' | 'searchInput'>>
    ): Promise<SavedCoreSearch | null> => {
      const record = await base.updateSavedSearch(slug, updates);
      return record
        ? ({
            ...record,
            sort: record.sort as SearchSort,
            statusFilters: mapStatusFilters(record.statusFilters)
          } as SavedCoreSearch)
        : null;
    },
    [base]
  );

  const recordSavedSearchApplied = useCallback(
    async (slug: string): Promise<SavedCoreSearch | null> => {
      const record = await base.recordSavedSearchApplied(slug);
      return record
        ? ({
            ...record,
            sort: record.sort as SearchSort,
            statusFilters: mapStatusFilters(record.statusFilters)
          } as SavedCoreSearch)
        : null;
    },
    [base]
  );

  const recordSavedSearchShared = useCallback(
    async (slug: string): Promise<SavedCoreSearch | null> => {
      const record = await base.recordSavedSearchShared(slug);
      return record
        ? ({
            ...record,
            sort: record.sort as SearchSort,
            statusFilters: mapStatusFilters(record.statusFilters)
          } as SavedCoreSearch)
        : null;
    },
    [base]
  );

  const getSavedSearch = useCallback(
    async (slug: string): Promise<SavedCoreSearch | null> => {
      const record = await base.getSavedSearch(slug);
      return record
        ? ({
            ...record,
            sort: record.sort as SearchSort,
            statusFilters: mapStatusFilters(record.statusFilters)
          } as SavedCoreSearch)
        : null;
    },
    [base]
  );

  return {
    savedSearches,
    loading: base.loading,
    error: base.error,
    mutationState: base.mutationState,
    createSavedSearch,
    updateSavedSearch,
    deleteSavedSearch: base.deleteSavedSearch,
    recordSavedSearchApplied,
    recordSavedSearchShared,
    getSavedSearch,
    refresh: base.refresh
  } satisfies UseSavedCoreSearchesResult;
}

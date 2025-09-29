import { useCallback, useMemo } from 'react';
import type { SavedSearchMutationState } from '../../savedSearches/types';
import { useSavedSearches } from '../../savedSearches/useSavedSearches';
export type { SavedSearchMutationState } from '../../savedSearches/types';
import type { SavedCatalogSearch, SavedCatalogSearchCreateInput, SearchSort, IngestStatus } from '../types';

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

function mapStatusFilters(filters: string[]): IngestStatus[] {
  return filters.filter((status): status is IngestStatus =>
    ['seed', 'pending', 'processing', 'ready', 'failed'].includes(status as IngestStatus)
  );
}

export function useSavedCatalogSearches(): UseSavedCatalogSearchesResult {
  const base = useSavedSearches<IngestStatus, Record<string, unknown>>({
    category: 'catalog',
    analytics: {
      createdEvent: 'catalog_saved_search_created',
      appliedEvent: 'catalog_saved_search_applied',
      sharedEvent: 'catalog_saved_search_shared',
      payloadMapper: (record) => ({
        slug: record.slug,
        sort: record.sort,
        statusFilters: record.statusFilters
      })
    },
    sortComparator: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  });

  const savedSearches = useMemo<SavedCatalogSearch[]>(
    () =>
      base.savedSearches.map((entry) => ({
        ...entry,
        sort: entry.sort as SearchSort,
        statusFilters: mapStatusFilters(entry.statusFilters)
      })),
    [base.savedSearches]
  );

  const createSavedSearch = useCallback(
    async (input: SavedCatalogSearchCreateInput): Promise<SavedCatalogSearch | null> => {
      const record = await base.createSavedSearch({ ...input, category: 'catalog' });
      return record
        ? ({
            ...record,
            sort: record.sort as SearchSort,
            statusFilters: mapStatusFilters(record.statusFilters)
          } as SavedCatalogSearch)
        : null;
    },
    [base]
  );

  const updateSavedSearch = useCallback(
    async (
      slug: string,
      updates: Partial<Pick<SavedCatalogSearchCreateInput, 'name' | 'description' | 'statusFilters' | 'sort' | 'searchInput'>>
    ): Promise<SavedCatalogSearch | null> => {
      const record = await base.updateSavedSearch(slug, updates);
      return record
        ? ({
            ...record,
            sort: record.sort as SearchSort,
            statusFilters: mapStatusFilters(record.statusFilters)
          } as SavedCatalogSearch)
        : null;
    },
    [base]
  );

  const recordSavedSearchApplied = useCallback(
    async (slug: string): Promise<SavedCatalogSearch | null> => {
      const record = await base.recordSavedSearchApplied(slug);
      return record
        ? ({
            ...record,
            sort: record.sort as SearchSort,
            statusFilters: mapStatusFilters(record.statusFilters)
          } as SavedCatalogSearch)
        : null;
    },
    [base]
  );

  const recordSavedSearchShared = useCallback(
    async (slug: string): Promise<SavedCatalogSearch | null> => {
      const record = await base.recordSavedSearchShared(slug);
      return record
        ? ({
            ...record,
            sort: record.sort as SearchSort,
            statusFilters: mapStatusFilters(record.statusFilters)
          } as SavedCatalogSearch)
        : null;
    },
    [base]
  );

  const getSavedSearch = useCallback(
    async (slug: string): Promise<SavedCatalogSearch | null> => {
      const record = await base.getSavedSearch(slug);
      return record
        ? ({
            ...record,
            sort: record.sort as SearchSort,
            statusFilters: mapStatusFilters(record.statusFilters)
          } as SavedCatalogSearch)
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
  } satisfies UseSavedCatalogSearchesResult;
}

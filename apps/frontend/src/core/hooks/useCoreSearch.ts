import { useCallback, useEffect, useMemo, useState, type KeyboardEventHandler } from 'react';
import { useAuth } from '../../auth/useAuth';
import { useAppHubEvent, type AppHubSocketEvent } from '../../events/context';
import { INGEST_STATUSES } from '../constants';
import { searchRepositories, suggestTags } from '../api';
import type {
  AppRecord,
  SearchMeta,
  SearchParseResult,
  SearchSort,
  StatusFacet,
  TagFacet,
  TagSuggestion
} from '../types';
import {
  applySuggestionToInput,
  computeAutocompleteContext,
  parseSearchInput
} from '../utils';

export type CoreRepositoryMutators = {
  replace: (repository: AppRecord) => void;
  update: (id: string, updater: (app: AppRecord) => AppRecord) => void;
  merge: (id: string, patch: Partial<AppRecord> | null | undefined) => void;
};

export type CoreSearchHandlers = {
  handleKeyDown: KeyboardEventHandler<HTMLInputElement>;
  applySuggestion: (suggestion: TagSuggestion) => void;
  toggleStatus: (status: AppRecord['ingestStatus']) => void;
  clearStatusFilters: () => void;
  setStatusFilters: (statuses: AppRecord['ingestStatus'][]) => void;
  applyTagFacet: (facet: TagFacet) => void;
  setSortMode: (sort: SearchSort) => void;
  toggleHighlights: (enabled: boolean) => void;
};

export type UseCoreSearchResult = {
  inputValue: string;
  setInputValue: (value: string) => void;
  apps: AppRecord[];
  loading: boolean;
  error: string | null;
  suggestions: TagSuggestion[];
  highlightIndex: number;
  parsedQuery: SearchParseResult;
  statusFilters: AppRecord['ingestStatus'][];
  tagFacets: TagFacet[];
  statusFacets: StatusFacet[];
  ownerFacets: TagFacet[];
  frameworkFacets: TagFacet[];
  searchMeta: SearchMeta | null;
  sortMode: SearchSort;
  showHighlights: boolean;
  activeTokens: string[];
  highlightEnabled: boolean;
  handlers: CoreSearchHandlers;
  repositories: CoreRepositoryMutators;
  setGlobalError: (message: string | null) => void;
};

export function useCoreSearch(): UseCoreSearchResult {
  const [inputValue, setInputValue] = useState('');
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [statusFilters, setStatusFilters] = useState<AppRecord['ingestStatus'][]>([]);
  const [tagFacets, setTagFacets] = useState<TagFacet[]>([]);
  const [statusFacets, setStatusFacets] = useState<StatusFacet[]>(() =>
    INGEST_STATUSES.map((status) => ({ status, count: 0 }))
  );
  const [ownerFacets, setOwnerFacets] = useState<TagFacet[]>([]);
  const [frameworkFacets, setFrameworkFacets] = useState<TagFacet[]>([]);
  const [searchMeta, setSearchMeta] = useState<SearchMeta | null>(null);
  const [sortMode, setSortModeInternal] = useState<SearchSort>('relevance');
  const [sortManuallySet, setSortManuallySet] = useState(false);
  const [showHighlights, setShowHighlights] = useState(false);
  const { activeToken: authToken } = useAuth();

  const autocompleteContext = useMemo(() => computeAutocompleteContext(inputValue), [inputValue]);
  const parsedQuery = useMemo(() => parseSearchInput(inputValue), [inputValue]);
  const statusSignature = useMemo(
    () => statusFilters.slice().sort().join(','),
    [statusFilters]
  );
  const searchSignature = useMemo(
    () =>
      [
        parsedQuery.text,
        parsedQuery.tags.join(','),
        statusSignature,
        sortMode
      ].join('|'),
    [parsedQuery.text, parsedQuery.tags, statusSignature, sortMode]
  );
  const activeTokens = useMemo(() => searchMeta?.tokens ?? [], [searchMeta]);
  const highlightEnabled = showHighlights && activeTokens.length > 0;

  useEffect(() => {
    if (!parsedQuery.text) {
      setSortManuallySet(false);
    }
    if (parsedQuery.text && !sortManuallySet && sortMode !== 'relevance') {
      setSortModeInternal('relevance');
    }
    if (!parsedQuery.text && !sortManuallySet && sortMode !== 'updated') {
      setSortModeInternal('updated');
    }
  }, [parsedQuery.text, sortMode, sortManuallySet]);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await searchRepositories(
          authToken,
          {
            query: parsedQuery.text || undefined,
            tags: parsedQuery.tags,
            statuses: statusFilters,
            sort: sortMode
          },
          { signal: controller.signal }
        );
        setApps(result.repositories);
        setTagFacets(result.facets.tags);
        setStatusFacets(() => {
          const counts = new Map(result.facets.statuses.map((item) => [item.status, item.count]));
          return INGEST_STATUSES.map((status) => ({
            status,
            count: counts.get(status) ?? 0
          }));
        });
        setOwnerFacets(result.facets.owners);
        setFrameworkFacets(result.facets.frameworks);
        setSearchMeta(result.meta);
        if (result.meta.sort && result.meta.sort !== sortMode) {
          setSortModeInternal(result.meta.sort);
          setSortManuallySet(false);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        const message = err instanceof Error ? err.message : 'Search failed';
        setError(message);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [authToken, searchSignature, parsedQuery, statusFilters, sortMode]);

  useEffect(() => {
    const controller = new AbortController();
    const { activeToken: activeSuggestionToken } = autocompleteContext;
    if (!activeSuggestionToken) {
      setSuggestions([]);
      setHighlightIndex(0);
      return () => {
        controller.abort();
      };
    }

    const timeoutId = setTimeout(async () => {
      try {
        const result = await suggestTags(
          authToken,
          { prefix: activeSuggestionToken, limit: 12 },
          { signal: controller.signal }
        );
        setSuggestions(result);
        setHighlightIndex(0);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
      }
    }, 150);

    return () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [authToken, autocompleteContext]);

  useEffect(() => {
    if (suggestions.length === 0) {
      setHighlightIndex(0);
    } else {
      setHighlightIndex((current) => Math.min(current, suggestions.length - 1));
    }
  }, [suggestions]);

  const applySuggestion = useCallback((suggestion: TagSuggestion) => {
    setInputValue((prev) => applySuggestionToInput(prev, suggestion));
    setSuggestions([]);
  }, []);

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = useCallback(
    (event) => {
      if (suggestions.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setHighlightIndex((idx) => (idx + 1) % suggestions.length);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setHighlightIndex((idx) => (idx - 1 + suggestions.length) % suggestions.length);
          return;
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          applySuggestion(suggestions[highlightIndex]);
          return;
        }
        if (event.key === 'Enter') {
          if (suggestions[highlightIndex]) {
            event.preventDefault();
            applySuggestion(suggestions[highlightIndex]);
            return;
          }
        }
      }

      if (event.key === 'Escape') {
        setSuggestions([]);
      }
    },
    [applySuggestion, highlightIndex, suggestions]
  );

  const toggleStatus = useCallback((status: AppRecord['ingestStatus']) => {
    setStatusFilters((current) => {
      if (current.includes(status)) {
        return current.filter((item) => item !== status);
      }
      return [...current, status];
    });
  }, []);

  const applyTagFacet = useCallback((facet: TagFacet) => {
    const token = `${facet.key}:${facet.value}`;
    setInputValue((prev) => {
      const { tags } = parseSearchInput(prev);
      if (tags.includes(token)) {
        return prev;
      }
      const needsSpace = prev.length > 0 && !/\s$/.test(prev);
      return `${prev}${needsSpace ? ' ' : ''}${token} `;
    });
    setSuggestions([]);
  }, []);

  const clearStatusFilters = useCallback(() => {
    setStatusFilters([]);
  }, []);

  const setStatusFiltersExplicit = useCallback((statuses: AppRecord['ingestStatus'][]) => {
    setStatusFilters(Array.from(new Set(statuses)));
  }, []);

  const setSortMode = useCallback((next: SearchSort) => {
    setSortModeInternal(next);
    setSortManuallySet(true);
  }, []);

  const toggleHighlights = useCallback((enabled: boolean) => {
    setShowHighlights(enabled);
  }, []);

  const replaceRepository = useCallback((repository: AppRecord) => {
    setApps((prev) => {
      const index = prev.findIndex((item) => item.id === repository.id);
      if (index === -1) {
        return prev;
      }
      const next = prev.slice();
      next[index] = repository;
      return next;
    });
  }, []);

  const updateRepository = useCallback((id: string, updater: (app: AppRecord) => AppRecord) => {
    setApps((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      if (index === -1) {
        return prev;
      }
      const next = prev.slice();
      const current = prev[index];
      next[index] = updater(current);
      return next;
    });
  }, []);

  const mergeRepository = useCallback(
    (id: string, patch: Partial<AppRecord> | null | undefined) => {
      if (!patch) {
        return;
      }
      updateRepository(id, (current) => ({ ...current, ...patch }));
    },
    [updateRepository]
  );

  const repositories = useMemo(
    () => ({
      replace: replaceRepository,
      update: updateRepository,
      merge: mergeRepository
    }),
    [replaceRepository, updateRepository, mergeRepository]
  );

  const setGlobalError = useCallback((message: string | null) => {
    setError(message);
  }, []);

  const handleRepositoryUpdate = useCallback((repository: AppRecord) => {
    replaceRepository(repository);
  }, [replaceRepository]);

  const handleRepositorySocketEvent = useCallback(
    (event: Extract<AppHubSocketEvent, { type: 'repository.updated' }>) => {
      if (event.data?.repository) {
        handleRepositoryUpdate(event.data.repository);
      }
    },
    [handleRepositoryUpdate]
  );

  useAppHubEvent('repository.updated', handleRepositorySocketEvent);

  return {
    inputValue,
    setInputValue,
    apps,
    loading,
    error,
    suggestions,
    highlightIndex,
    parsedQuery,
    statusFilters,
    tagFacets,
    statusFacets,
    ownerFacets,
    frameworkFacets,
    searchMeta,
    sortMode,
    showHighlights,
    activeTokens,
    highlightEnabled,
    handlers: {
      handleKeyDown,
      applySuggestion,
      toggleStatus,
      clearStatusFilters,
      setStatusFilters: setStatusFiltersExplicit,
      applyTagFacet,
      setSortMode,
      toggleHighlights
    },
    repositories,
    setGlobalError
  };
}

import { useCallback, useEffect, useState } from 'react';
import { useCatalogSearch } from './hooks/useCatalogSearch';
import { useCatalogHistory } from './hooks/useCatalogHistory';
import { useCatalogBuilds } from './hooks/useCatalogBuilds';
import { useCatalogLaunches } from './hooks/useCatalogLaunches';
import { useSavedCatalogSearches } from './hooks/useSavedCatalogSearches';
import SearchSection from './components/SearchSection';
import AppList from './components/AppList';
import { Spinner } from '../components';
import { useToastHelpers } from '../components/toast';
import type { SavedCatalogSearch } from './types';

type CatalogPageProps = {
  searchSeed?: string;
  onSeedApplied?: () => void;
  savedSearchSlug?: string;
  onSavedSearchApplied?: () => void;
};

function CatalogPage({ searchSeed, onSeedApplied, savedSearchSlug, onSavedSearchApplied }: CatalogPageProps) {
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const { showSuccess, showError, showInfo } = useToastHelpers();

  const {
    inputValue,
    setInputValue,
    apps,
    loading,
    error,
    suggestions,
    highlightIndex,
    statusFilters,
    sortMode,
    showHighlights,
    activeTokens,
    highlightEnabled,
    searchMeta,
    handlers,
    repositories,
    setGlobalError
  } = useCatalogSearch();
  const savedSearches = useSavedCatalogSearches();
  const history = useCatalogHistory({ repositories, setGlobalError });
  const builds = useCatalogBuilds({ repositories });
  const launches = useCatalogLaunches({ repositories });

  useEffect(() => {
    if (searchSeed && searchSeed !== inputValue) {
      setInputValue(searchSeed);
      onSeedApplied?.();
    }
  }, [searchSeed, inputValue, setInputValue, onSeedApplied]);

  const applySavedSearch = useCallback(
    async (search: SavedCatalogSearch, notifyApplied = false) => {
      setInputValue(search.searchInput);
      handlers.setStatusFilters(search.statusFilters);
      handlers.setSortMode(search.sort);

      try {
        await savedSearches.recordSavedSearchApplied(search.slug);
      } catch (err) {
        showError('Failed to record saved search usage', err, 'Unable to track saved search usage.');
      } finally {
        if (notifyApplied) {
          onSavedSearchApplied?.();
        }
      }
    },
    [handlers, onSavedSearchApplied, savedSearches, setInputValue, showError]
  );

  useEffect(() => {
    if (!savedSearchSlug) {
      return;
    }

    let cancelled = false;

    const loadAndApply = async () => {
      try {
        const record = await savedSearches.getSavedSearch(savedSearchSlug);
        if (cancelled) {
          return;
        }
        if (!record) {
          showError('Saved search unavailable', 'The saved search could not be found.');
          onSavedSearchApplied?.();
          return;
        }
        await applySavedSearch(record, true);
      } catch (err) {
        if (!cancelled) {
          showError('Saved search unavailable', err, 'Failed to load saved search.');
          onSavedSearchApplied?.();
        }
      }
    };

    void loadAndApply();

    return () => {
      cancelled = true;
    };
  }, [applySavedSearch, onSavedSearchApplied, savedSearchSlug, savedSearches, showError]);

  const handleCreateSavedSearch = useCallback(
    async (name: string) => {
      try {
        await savedSearches.createSavedSearch({
          name,
          description: null,
          searchInput: inputValue,
          statusFilters,
          sort: sortMode
        });
        showSuccess('Saved search created');
      } catch (err) {
        showError('Failed to save search', err, 'Unable to save this search right now.');
      }
    },
    [inputValue, savedSearches, showError, showSuccess, sortMode, statusFilters]
  );

  const handleRenameSavedSearch = useCallback(
    async (search: SavedCatalogSearch, nextName: string) => {
      try {
        await savedSearches.updateSavedSearch(search.slug, { name: nextName });
        showSuccess('Saved search renamed');
      } catch (err) {
        showError('Failed to rename saved search', err, 'Unable to rename this saved search.');
      }
    },
    [savedSearches, showError, showSuccess]
  );

  const handleDeleteSavedSearch = useCallback(
    async (search: SavedCatalogSearch) => {
      try {
        await savedSearches.deleteSavedSearch(search.slug);
        showInfo('Saved search deleted');
      } catch (err) {
        showError('Failed to delete saved search', err, 'Unable to delete this saved search.');
      }
    },
    [savedSearches, showError, showInfo]
  );

  const handleShareSavedSearch = useCallback(
    async (search: SavedCatalogSearch) => {
      const shareUrl = `${window.location.origin}/catalog?saved=${encodeURIComponent(search.slug)}`;
      try {
        await savedSearches.recordSavedSearchShared(search.slug);
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(shareUrl);
          showSuccess('Share link copied to clipboard');
        } else {
          showInfo('Share link ready', shareUrl);
        }
      } catch (err) {
        showError('Failed to share saved search', err, 'Unable to share this saved search right now.');
      }
    },
    [savedSearches, showError, showInfo, showSuccess]
  );

  useEffect(() => {
    if (!searchSeed) {
      return;
    }
    const match = apps.find((app) => app.id === searchSeed);
    if (match) {
      setSelectedAppId(match.id);
    }
  }, [apps, searchSeed]);

  useEffect(() => {
    if (!selectedAppId) {
      return;
    }
    const exists = apps.some((app) => app.id === selectedAppId);
    if (!exists) {
      setSelectedAppId(null);
    }
  }, [apps, selectedAppId]);

  const handleSelectApp = (id: string) => {
    setSelectedAppId((current) => (current === id ? null : id));
  };

  return (
    <>
      <SearchSection
        inputValue={inputValue}
        onInputChange={setInputValue}
        onKeyDown={handlers.handleKeyDown}
        suggestions={suggestions}
        highlightIndex={highlightIndex}
        onApplySuggestion={handlers.applySuggestion}
        sortMode={sortMode}
        onSortChange={handlers.setSortMode}
        showHighlights={showHighlights}
        onToggleHighlights={handlers.toggleHighlights}
        activeTokens={activeTokens}
        searchMeta={searchMeta}
        savedSearches={savedSearches.savedSearches}
        savedSearchesLoading={savedSearches.loading}
        savedSearchError={savedSearches.error}
        savedSearchMutation={savedSearches.mutationState}
        onCreateSavedSearch={handleCreateSavedSearch}
        onApplySavedSearch={applySavedSearch}
        onRenameSavedSearch={handleRenameSavedSearch}
        onDeleteSavedSearch={handleDeleteSavedSearch}
        onShareSavedSearch={handleShareSavedSearch}
      />
      <section className="flex flex-col gap-6">
        {loading && (
          <div className="rounded-2xl border border-subtle bg-surface-muted px-5 py-4 text-scale-sm font-weight-medium text-secondary shadow-sm">
            <Spinner label="Loading apps…" size="sm" />
          </div>
        )}
        {error && !loading && (
          <div className="rounded-2xl border border-status-danger bg-status-danger-soft px-5 py-4 text-scale-sm font-weight-semibold text-status-danger shadow-sm">
            {error}
          </div>
        )}
        {!loading && !error && apps.length === 0 && (
          <div className="rounded-2xl border border-subtle bg-surface-muted px-5 py-4 text-scale-sm font-weight-medium text-secondary shadow-sm">
            No apps match your filters yet.
          </div>
        )}
        <AppList
          apps={apps}
          activeTokens={activeTokens}
          highlightEnabled={highlightEnabled}
          retryingId={history.retryingId}
          onRetry={history.retryIngestion}
          buildState={builds.buildState}
          onTriggerBuild={builds.triggerBuild}
          onLaunch={launches.launchApp}
          onStopLaunch={launches.stopLaunch}
          launchingId={launches.launchingId}
          stoppingLaunchId={launches.stoppingLaunchId}
          launchErrors={launches.launchErrors}
          selectedAppId={selectedAppId}
          onSelectApp={handleSelectApp}
          historyState={history.historyState}
          onToggleHistory={history.toggleHistory}
          onToggleBuilds={builds.toggleBuilds}
          onLoadMoreBuilds={builds.loadMoreBuilds}
          onToggleLogs={builds.toggleLogs}
          onRetryBuild={builds.retryBuild}
          launchLists={launches.launchLists}
          onToggleLaunches={launches.toggleLaunches}
        />
      </section>
    </>
  );
}

export default CatalogPage;

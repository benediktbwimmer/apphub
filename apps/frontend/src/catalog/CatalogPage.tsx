import { useEffect, useMemo, useState } from 'react';
import { useCatalog } from './useCatalog';
import SearchSection from './components/SearchSection';
import FilterPanel from './components/FilterPanel';
import AppGrid from './components/AppGrid';
import AppList from './components/AppList';
import AppDetailsPanel from './components/AppDetailsPanel';

type CatalogPageProps = {
  searchSeed?: string;
  onSeedApplied?: () => void;
};

function CatalogPage({ searchSeed, onSeedApplied }: CatalogPageProps) {
  const [viewMode, setViewMode] = useState<'preview' | 'list'>('preview');
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const {
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
    historyState,
    buildState,
    launchLists,
    launchErrors,
    launchingId,
    stoppingLaunchId,
    retryingId,
    handlers
  } = useCatalog();

  useEffect(() => {
    if (searchSeed && searchSeed !== inputValue) {
      setInputValue(searchSeed);
      onSeedApplied?.();
    }
  }, [searchSeed, inputValue, setInputValue, onSeedApplied]);

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
    if (viewMode === 'list') {
      setSelectedAppId(null);
    }
  }, [viewMode]);

  useEffect(() => {
    if (!selectedAppId) {
      return;
    }
    const exists = apps.some((app) => app.id === selectedAppId);
    if (!exists) {
      setSelectedAppId(null);
    }
  }, [apps, selectedAppId]);

  const selectedApp = useMemo(() => {
    if (!selectedAppId) {
      return null;
    }
    return apps.find((app) => app.id === selectedAppId) ?? null;
  }, [apps, selectedAppId]);

  const handleSelectApp = (id: string) => {
    setSelectedAppId((current) => (current === id ? current : id));
  };

  const appliedTags = parsedQuery.tags;

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
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />
      <section className="flex flex-col gap-6">
        {loading && (
          <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 px-5 py-4 text-sm font-medium text-slate-600 shadow-sm dark:border-slate-700/70 dark:bg-slate-800/70 dark:text-slate-300">
            Loading apps…
          </div>
        )}
        {error && !loading && (
          <div className="rounded-2xl border border-rose-300/70 bg-rose-50/70 px-5 py-4 text-sm font-semibold text-rose-600 shadow-sm dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
            {error}
          </div>
        )}
        {!loading && !error && apps.length === 0 && (
          <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 px-5 py-4 text-sm font-medium text-slate-600 shadow-sm dark:border-slate-700/70 dark:bg-slate-800/70 dark:text-slate-300">
            No apps match your filters yet.
          </div>
        )}
        {!error && (
          <FilterPanel
            statusFilters={statusFilters}
            statusFacets={statusFacets}
            onToggleStatus={handlers.toggleStatus}
            onClearStatusFilters={handlers.clearStatusFilters}
            tagFacets={tagFacets}
            ownerFacets={ownerFacets}
            frameworkFacets={frameworkFacets}
            appliedTagTokens={appliedTags}
            onApplyFacet={handlers.applyTagFacet}
          />
        )}
        {viewMode === 'preview' ? (
          <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md transition-colors dark:border-slate-700/70 dark:bg-slate-900/70">
            <AppGrid
              apps={apps}
              activeTokens={activeTokens}
              highlightEnabled={highlightEnabled}
              selectedAppId={selectedAppId}
              onSelectApp={handleSelectApp}
            />
            {selectedApp && (
              <div className="mt-6 flex flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md transition-colors dark:border-slate-700/70 dark:bg-slate-900/70">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{selectedApp.name}</h2>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/80 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:border-violet-300 hover:bg-violet-500/10 hover:text-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-200/10 dark:hover:text-slate-100"
                    onClick={() => setSelectedAppId(null)}
                  >
                    Close details
                  </button>
                </div>
                <AppDetailsPanel
                  app={selectedApp}
                  activeTokens={activeTokens}
                  highlightEnabled={highlightEnabled}
                  retryingId={retryingId}
                  onRetry={handlers.retryIngestion}
                  historyEntry={historyState[selectedApp.id]}
                  onToggleHistory={handlers.toggleHistory}
                  buildEntry={buildState[selectedApp.id]}
                  onToggleBuilds={handlers.toggleBuilds}
                  onLoadMoreBuilds={handlers.loadMoreBuilds}
                  onToggleLogs={handlers.toggleLogs}
                  onRetryBuild={handlers.retryBuild}
                  onTriggerBuild={handlers.triggerBuild}
                  launchEntry={launchLists[selectedApp.id]}
                  onToggleLaunches={handlers.toggleLaunches}
                  onLaunch={handlers.launchApp}
                  onStopLaunch={handlers.stopLaunch}
                  launchingId={launchingId}
                  stoppingLaunchId={stoppingLaunchId}
                  launchErrors={launchErrors}
                />
              </div>
            )}
          </div>
        ) : (
          <AppList
            apps={apps}
            activeTokens={activeTokens}
            highlightEnabled={highlightEnabled}
            retryingId={retryingId}
            onRetry={handlers.retryIngestion}
            buildState={buildState}
            onTriggerBuild={handlers.triggerBuild}
            onLaunch={handlers.launchApp}
            onStopLaunch={handlers.stopLaunch}
            launchingId={launchingId}
            stoppingLaunchId={stoppingLaunchId}
            launchErrors={launchErrors}
          />
        )}
      </section>
    </>
  );
}

export default CatalogPage;

import { useEffect, useState } from 'react';
import { useCatalog } from './useCatalog';
import SearchSection from './components/SearchSection';
import FilterPanel from './components/FilterPanel';
import AppGrid from './components/AppGrid';
import AppList from './components/AppList';

type CatalogPageProps = {
  searchSeed?: string;
  onSeedApplied?: () => void;
};

function CatalogPage({ searchSeed, onSeedApplied }: CatalogPageProps) {
  const [viewMode, setViewMode] = useState<'preview' | 'list'>('preview');
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
        <div className="flex justify-end">
          <div className="inline-flex rounded-full border border-slate-200/70 bg-white/70 p-1 text-xs font-semibold text-slate-500 shadow-sm dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300">
            <button
              type="button"
              className={`rounded-full px-3 py-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                viewMode === 'preview'
                  ? 'bg-blue-600 text-white shadow hover:bg-blue-500 dark:bg-slate-200/30 dark:text-slate-900'
                  : 'hover:text-blue-600 dark:hover:text-slate-100'
              }`}
              onClick={() => setViewMode('preview')}
            >
              Preview view
            </button>
            <button
              type="button"
              className={`rounded-full px-3 py-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                viewMode === 'list'
                  ? 'bg-blue-600 text-white shadow hover:bg-blue-500 dark:bg-slate-200/30 dark:text-slate-900'
                  : 'hover:text-blue-600 dark:hover:text-slate-100'
              }`}
              onClick={() => setViewMode('list')}
            >
              List view
            </button>
          </div>
        </div>
        {viewMode === 'preview' ? (
          <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md transition-colors dark:border-slate-700/70 dark:bg-slate-900/70">
            <AppGrid
              apps={apps}
              activeTokens={activeTokens}
              highlightEnabled={highlightEnabled}
              retryingId={retryingId}
              onRetry={handlers.retryIngestion}
              historyState={historyState}
              onToggleHistory={handlers.toggleHistory}
              buildState={buildState}
              onToggleBuilds={handlers.toggleBuilds}
              onLoadMoreBuilds={handlers.loadMoreBuilds}
              onToggleLogs={handlers.toggleLogs}
              onRetryBuild={handlers.retryBuild}
              onTriggerBuild={handlers.triggerBuild}
              launchLists={launchLists}
              onToggleLaunches={handlers.toggleLaunches}
              onLaunch={handlers.launchApp}
              onStopLaunch={handlers.stopLaunch}
              launchingId={launchingId}
              stoppingLaunchId={stoppingLaunchId}
              launchErrors={launchErrors}
            />
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

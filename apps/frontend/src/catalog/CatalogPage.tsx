import { useEffect } from 'react';
import { useCatalog } from './useCatalog';
import SearchSection from './components/SearchSection';
import FilterPanel from './components/FilterPanel';
import AppGrid from './components/AppGrid';

type CatalogPageProps = {
  searchSeed?: string;
  onSeedApplied?: () => void;
};

function CatalogPage({ searchSeed, onSeedApplied }: CatalogPageProps) {
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
    ingestedAfter,
    ingestedBefore,
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
      <section className="results">
        {loading && <div className="status">Loading apps…</div>}
        {error && !loading && <div className="status error">{error}</div>}
        {!loading && !error && apps.length === 0 && (
          <div className="status">No apps match your filters yet.</div>
        )}
        {!error && (
          <FilterPanel
            statusFilters={statusFilters}
            statusFacets={statusFacets}
            onToggleStatus={handlers.toggleStatus}
            onClearStatusFilters={handlers.clearStatusFilters}
            ingestedAfter={ingestedAfter}
            ingestedBefore={ingestedBefore}
            onChangeIngestedAfter={handlers.setIngestedAfter}
            onChangeIngestedBefore={handlers.setIngestedBefore}
            onClearDateFilters={handlers.clearDateFilters}
            tagFacets={tagFacets}
            ownerFacets={ownerFacets}
            frameworkFacets={frameworkFacets}
            appliedTagTokens={appliedTags}
            onApplyFacet={handlers.applyTagFacet}
          />
        )}
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
          launchLists={launchLists}
          onToggleLaunches={handlers.toggleLaunches}
          onLaunch={handlers.launchApp}
          onStopLaunch={handlers.stopLaunch}
          launchingId={launchingId}
          stoppingLaunchId={stoppingLaunchId}
          launchErrors={launchErrors}
        />
      </section>
    </>
  );
}

export default CatalogPage;

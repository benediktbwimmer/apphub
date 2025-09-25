import { useEffect, useState } from 'react';
import { useCatalog } from './useCatalog';
import SearchSection from './components/SearchSection';
import AppList from './components/AppList';
import { Spinner } from '../components';

type CatalogPageProps = {
  searchSeed?: string;
  onSeedApplied?: () => void;
};

function CatalogPage({ searchSeed, onSeedApplied }: CatalogPageProps) {
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const {
    inputValue,
    setInputValue,
    apps,
    loading,
    error,
    suggestions,
    highlightIndex,
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
      />
      <section className="flex flex-col gap-6">
        {loading && (
          <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 px-5 py-4 text-sm font-medium text-slate-600 shadow-sm dark:border-slate-700/70 dark:bg-slate-800/70 dark:text-slate-300">
            <Spinner label="Loading apps…" size="sm" />
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
          selectedAppId={selectedAppId}
          onSelectApp={handleSelectApp}
          historyState={historyState}
          onToggleHistory={handlers.toggleHistory}
          onToggleBuilds={handlers.toggleBuilds}
          onLoadMoreBuilds={handlers.loadMoreBuilds}
          onToggleLogs={handlers.toggleLogs}
          onRetryBuild={handlers.retryBuild}
          launchLists={launchLists}
          onToggleLaunches={handlers.toggleLaunches}
        />
      </section>
    </>
  );
}

export default CatalogPage;

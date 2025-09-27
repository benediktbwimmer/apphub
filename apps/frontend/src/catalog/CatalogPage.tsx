import { useEffect, useState } from 'react';
import { useCatalogSearch } from './hooks/useCatalogSearch';
import { useCatalogHistory } from './hooks/useCatalogHistory';
import { useCatalogBuilds } from './hooks/useCatalogBuilds';
import { useCatalogLaunches } from './hooks/useCatalogLaunches';
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
    sortMode,
    showHighlights,
    activeTokens,
    highlightEnabled,
    searchMeta,
    handlers,
    repositories,
    setGlobalError
  } = useCatalogSearch();
  const history = useCatalogHistory({ repositories, setGlobalError });
  const builds = useCatalogBuilds({ repositories });
  const launches = useCatalogLaunches({ repositories });

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

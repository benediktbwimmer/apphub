import AppCard from './AppCard';
import type {
  AppRecord,
  BuildTimelineState,
  HistoryState,
  LaunchListState
} from '../types';

type AppGridProps = {
  apps: AppRecord[];
  activeTokens: string[];
  highlightEnabled: boolean;
  retryingId: string | null;
  onRetry: (id: string) => void;
  historyState: HistoryState;
  onToggleHistory: (id: string) => void;
  buildState: Record<string, BuildTimelineState>;
  onToggleBuilds: (id: string) => void;
  onLoadMoreBuilds: (id: string) => void;
  onToggleLogs: (appId: string, buildId: string) => void;
  onRetryBuild: (appId: string, buildId: string) => void;
  launchLists: LaunchListState;
  onToggleLaunches: (id: string) => void;
  onLaunch: (id: string) => void;
  onStopLaunch: (appId: string, launchId: string) => void;
  launchingId: string | null;
  stoppingLaunchId: string | null;
  launchErrors: Record<string, string | null>;
};

function AppGrid({
  apps,
  activeTokens,
  highlightEnabled,
  retryingId,
  onRetry,
  historyState,
  onToggleHistory,
  buildState,
  onToggleBuilds,
  onLoadMoreBuilds,
  onToggleLogs,
  onRetryBuild,
  launchLists,
  onToggleLaunches,
  onLaunch,
  onStopLaunch,
  launchingId,
  stoppingLaunchId,
  launchErrors
}: AppGridProps) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {apps.map((app) => (
        <AppCard
          key={app.id}
          app={app}
          activeTokens={activeTokens}
          highlightEnabled={highlightEnabled}
          retryingId={retryingId}
          onRetry={onRetry}
          historyEntry={historyState[app.id]}
          onToggleHistory={onToggleHistory}
          buildEntry={buildState[app.id]}
          onToggleBuilds={onToggleBuilds}
          onLoadMoreBuilds={onLoadMoreBuilds}
          onToggleLogs={onToggleLogs}
          onRetryBuild={onRetryBuild}
          launchEntry={launchLists[app.id]}
          onToggleLaunches={onToggleLaunches}
          onLaunch={onLaunch}
          onStopLaunch={onStopLaunch}
          launchingId={launchingId}
          stoppingLaunchId={stoppingLaunchId}
          launchErrors={launchErrors}
        />
      ))}
    </div>
  );
}

export default AppGrid;

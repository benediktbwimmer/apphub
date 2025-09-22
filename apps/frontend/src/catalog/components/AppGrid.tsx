import { useMemo } from 'react';
import AppCard from './AppCard';
import { usePreviewLayout } from '../../settings/previewLayoutContext';
import type {
  AppRecord,
  BuildTimelineState,
  HistoryState,
  LaunchListState,
  LaunchRequestDraft
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
  onTriggerBuild: (appId: string, options: { branch?: string; ref?: string }) => Promise<boolean>;
  launchLists: LaunchListState;
  onToggleLaunches: (id: string) => void;
  onLaunch: (id: string, draft: LaunchRequestDraft) => void;
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
  onTriggerBuild,
  launchLists,
  onToggleLaunches,
  onLaunch,
  onStopLaunch,
  launchingId,
  stoppingLaunchId,
  launchErrors
}: AppGridProps) {
  const { width } = usePreviewLayout();

  const gridTemplateColumns = useMemo(() => {
    const clampedWidth = Math.round(width);
    return `repeat(auto-fit, minmax(${clampedWidth}px, 1fr))`;
  }, [width]);

  return (
    <div className="grid gap-6" style={{ gridTemplateColumns }}>
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
          onTriggerBuild={onTriggerBuild}
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

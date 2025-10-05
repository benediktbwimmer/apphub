import { Fragment, type KeyboardEvent, type MouseEvent } from 'react';
import { buildDockerRunCommandString, createLaunchId } from '../launchCommand';
import { formatDuration, highlightSegments } from '../utils';
import type {
  AppRecord,
  BuildTimelineState,
  HistoryState,
  LaunchRequestDraft,
  LaunchEnvVar,
  LaunchListState
} from '../types';
import AppDetailsPanel from './AppDetailsPanel';
import { collectAvailableEnvVars, mergeEnvSources } from './envUtils';
import { getStatusToneClasses } from '../../theme/statusTokens';

type AppListProps = {
  apps: AppRecord[];
  activeTokens: string[];
  highlightEnabled: boolean;
  retryingId: string | null;
  onRetry: (id: string) => void;
  buildState: Record<string, BuildTimelineState>;
  onTriggerBuild: (appId: string, options: { branch?: string; ref?: string }) => Promise<boolean>;
  onLaunch: (id: string, draft: LaunchRequestDraft) => void;
  onStopLaunch: (appId: string, launchId: string) => void;
  launchingId: string | null;
  stoppingLaunchId: string | null;
  launchErrors: Record<string, string | null>;
  selectedAppId: string | null;
  onSelectApp: (id: string) => void;
  historyState: HistoryState;
  onToggleHistory: (id: string) => void;
  onToggleBuilds: (id: string) => void;
  onLoadMoreBuilds: (id: string) => void;
  onToggleLogs: (appId: string, buildId: string) => void;
  onRetryBuild: (appId: string, buildId: string) => void;
  launchLists: LaunchListState;
  onToggleLaunches: (id: string) => void;
};

const STATUS_BADGE_BASE =
  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-weight-semibold uppercase tracking-[0.25em]';

const PRIMARY_ACTION_BUTTON =
  'inline-flex items-center justify-center rounded-full px-3 py-1.5 text-scale-xs font-weight-semibold bg-accent text-inverse shadow-lg shadow-accent-soft transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 hover:bg-accent-strong';

const SECONDARY_ACTION_BUTTON =
  'inline-flex items-center justify-center rounded-full border border-subtle bg-surface-glass px-3 py-1.5 text-scale-xs font-weight-semibold text-secondary transition-all hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const TERTIARY_ACTION_BUTTON =
  'inline-flex items-center justify-center rounded-full border border-subtle bg-surface-glass px-3 py-1.5 text-scale-xs font-weight-semibold text-secondary transition-all hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const ACTIVE_LAUNCH_STATUSES = new Set(['pending', 'starting', 'running', 'stopping']);

function getStatusBadgeClasses(status: string) {
  return `${STATUS_BADGE_BASE} ${getStatusToneClasses(status)}`;
}

function collectLaunchEnv(app: AppRecord): LaunchEnvVar[] {
  const availableEnv = collectAvailableEnvVars({
    tags: app.tags,
    availableEnv: app.availableEnv,
    availableLaunchEnv: app.availableLaunchEnv,
    launchEnvTemplates: app.launchEnvTemplates
  });
  return mergeEnvSources(app.latestLaunch?.env ?? [], availableEnv);
}

function AppList({
  apps,
  activeTokens,
  highlightEnabled,
  retryingId,
  onRetry,
  buildState,
  onTriggerBuild,
  onLaunch,
  onStopLaunch,
  launchingId,
  stoppingLaunchId,
  launchErrors,
  selectedAppId,
  onSelectApp,
  historyState,
  onToggleHistory,
  onToggleBuilds,
  onLoadMoreBuilds,
  onToggleLogs,
  onRetryBuild,
  launchLists,
  onToggleLaunches
}: AppListProps) {
  const handleRowClick = (event: MouseEvent<HTMLTableRowElement>, id: string) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, label')) {
      return;
    }
    onSelectApp(id);
  };

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, id: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectApp(id);
    }
  };

  return (
    <div className="overflow-x-auto rounded-3xl border border-subtle bg-surface-glass shadow-elevation-xl backdrop-blur-md transition-colors">
      <table className="min-w-full divide-y divide-subtle">
        <thead className="bg-surface-muted text-left text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted">
          <tr>
            <th scope="col" className="px-6 py-4">Build</th>
            <th scope="col" className="px-6 py-4">Ingestion</th>
            <th scope="col" className="px-6 py-4">Latest build</th>
            <th scope="col" className="px-6 py-4">Latest launch</th>
            <th scope="col" className="px-6 py-4">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-subtle text-scale-sm text-secondary">
          {apps.map((app) => {
            const ingestStatusBadge = (
              <span className={getStatusBadgeClasses(app.ingestStatus)}>
                ingest {app.ingestStatus}
              </span>
            );
            const ingestError = app.ingestError;
            const build = app.latestBuild;
            const buildStatusBadge = build ? (
              <span className={getStatusBadgeClasses(build.status)}>
                build {build.status}
              </span>
            ) : (
              <span className="text-scale-xs font-weight-medium text-muted">No builds yet</span>
            );
            const buildDuration = build ? formatDuration(build.durationMs) : null;
            const buildStateEntry = buildState[app.id];
            const buildCreating = buildStateEntry?.creating ?? false;
            const launch = app.latestLaunch;
            const launchStatusBadge = launch ? (
              <span className={getStatusBadgeClasses(launch.status)}>
                launch {launch.status}
              </span>
            ) : (
              <span className="text-scale-xs font-weight-medium text-muted">No launches yet</span>
            );
            const launchError = launchErrors[app.id] ?? launch?.errorMessage ?? null;
            const isLaunching = launchingId === app.id;
            const canLaunch = app.latestBuild?.status === 'succeeded';
            const currentLaunchId = launch?.id ?? null;
            const canStop = Boolean(launch && ACTIVE_LAUNCH_STATUSES.has(launch.status));
            const isStopping = stoppingLaunchId === currentLaunchId;
            const isSelected = selectedAppId === app.id;

            const handleLaunch = () => {
              const env = collectLaunchEnv(app);
              const launchId = createLaunchId();
              const command = buildDockerRunCommandString({
                repositoryId: app.id,
                launchId,
                imageTag: app.latestBuild?.imageTag ?? null,
                env
              });
              onLaunch(app.id, { env, command, launchId });
            };

            const handleStop = () => {
              if (currentLaunchId) {
                onStopLaunch(app.id, currentLaunchId);
              }
            };

            const handleBuild = () => {
              void onTriggerBuild(app.id, {});
            };

            return (
              <Fragment key={app.id}>
                <tr
                  className={`cursor-pointer bg-surface-glass transition-colors ${
                    isSelected ? 'ring-1 ring-accent' : 'hover:bg-accent-soft'
                  }`}
                  onClick={(event) => handleRowClick(event, app.id)}
                  onKeyDown={(event) => handleRowKeyDown(event, app.id)}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isSelected}
                  aria-label={`View build details for ${app.name}`}
                >
                  <td className="max-w-xs px-6 py-4 align-top">
                    <div className="space-y-2">
                      <div className="text-scale-md font-weight-semibold text-primary">
                        {highlightSegments(app.name, activeTokens, highlightEnabled)}
                      </div>
                      {ingestError && (
                        <p className="text-scale-xs font-weight-medium text-status-danger">{ingestError}</p>
                      )}
                      {launchError && (
                        <p className="text-scale-xs font-weight-medium text-status-danger">{launchError}</p>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 align-top">
                    <div className="flex flex-col gap-2 text-scale-xs text-muted">
                      {ingestStatusBadge}
                      <time dateTime={app.updatedAt}>
                        Updated {new Date(app.updatedAt).toLocaleString()}
                      </time>
                      {retryingId === app.id ? (
                        <span className="text-scale-xs font-weight-medium text-muted">Retrying…</span>
                      ) : app.ingestStatus === 'failed' ? (
                        <button
                          type="button"
                          className={TERTIARY_ACTION_BUTTON}
                          onClick={() => onRetry(app.id)}
                        >
                          Retry ingestion
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-6 py-4 align-top">
                    <div className="flex flex-col gap-2 text-scale-xs text-muted">
                      {buildStatusBadge}
                      {build?.gitBranch && <span>branch: {build.gitBranch}</span>}
                      {build?.gitRef && <span>ref: {build.gitRef}</span>}
                      {build?.commitSha && <span>commit: {build.commitSha.slice(0, 10)}</span>}
                      {build?.completedAt && (
                        <time dateTime={build.completedAt}>
                          {new Date(build.completedAt).toLocaleString()}
                        </time>
                      )}
                      {buildDuration && <span>duration: {buildDuration}</span>}
                    </div>
                  </td>
                  <td className="px-6 py-4 align-top">
                    <div className="flex flex-col gap-2 text-scale-xs text-muted">
                      {launchStatusBadge}
                      {launch?.updatedAt && (
                        <time dateTime={launch.updatedAt}>
                          Updated {new Date(launch.updatedAt).toLocaleString()}
                        </time>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 align-top">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={PRIMARY_ACTION_BUTTON}
                        onClick={handleLaunch}
                        disabled={isLaunching || !canLaunch}
                      >
                        {isLaunching ? 'Launching…' : 'Launch'}
                      </button>
                      <button
                        type="button"
                        className={SECONDARY_ACTION_BUTTON}
                        onClick={handleStop}
                        disabled={!canStop || isStopping}
                      >
                        {isStopping ? 'Stopping…' : 'Stop'}
                      </button>
                      <button
                        type="button"
                        className={TERTIARY_ACTION_BUTTON}
                        onClick={handleBuild}
                        disabled={buildCreating}
                      >
                        {buildCreating ? 'Triggering…' : 'Trigger build'}
                      </button>
                    </div>
                  </td>
                </tr>
                {isSelected && (
                  <tr className="bg-transparent">
                    <td colSpan={5} className="px-6 pb-6 pt-0">
                      <AppDetailsPanel
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
                        showPreview={false}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default AppList;

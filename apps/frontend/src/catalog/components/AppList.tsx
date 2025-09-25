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
  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em]';

const STATUS_BADGE_VARIANTS: Record<string, string> = {
  seed: 'border-slate-300/70 bg-slate-100/70 text-slate-600 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-200',
  pending: 'border-amber-300/70 bg-amber-50/80 text-amber-700 dark:border-amber-400/60 dark:bg-amber-500/20 dark:text-amber-200',
  processing: 'border-sky-300/70 bg-sky-50/80 text-sky-700 dark:border-sky-400/60 dark:bg-sky-500/20 dark:text-sky-200',
  running:
    'border-sky-300/70 bg-sky-50/80 text-sky-700 dark:border-sky-400/60 dark:bg-sky-500/20 dark:text-sky-200 running-badge',
  succeeded:
    'border-emerald-400/70 bg-emerald-500/15 text-emerald-700 dark:border-emerald-400/60 dark:bg-emerald-500/20 dark:text-emerald-200',
  ready:
    'border-emerald-400/70 bg-emerald-500/15 text-emerald-700 dark:border-emerald-400/60 dark:bg-emerald-500/20 dark:text-emerald-200',
  failed:
    'border-rose-400/70 bg-rose-500/15 text-rose-700 dark:border-rose-400/60 dark:bg-rose-500/20 dark:text-rose-200',
  starting: 'border-sky-300/70 bg-sky-50/80 text-sky-700 dark:border-sky-400/60 dark:bg-sky-500/20 dark:text-sky-200',
  stopping: 'border-amber-400/70 bg-amber-500/15 text-amber-700 dark:border-amber-400/60 dark:bg-amber-500/20 dark:text-amber-200',
  stopped: 'border-slate-400/70 bg-slate-200/70 text-slate-700 dark:border-slate-500/60 dark:bg-slate-700/40 dark:text-slate-100'
};

const PRIMARY_ACTION_BUTTON =
  'inline-flex items-center justify-center rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-violet-500/30 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 bg-violet-600 hover:bg-violet-500 dark:bg-slate-200/20 dark:text-slate-50 dark:hover:bg-slate-200/30';

const SECONDARY_ACTION_BUTTON =
  'inline-flex items-center justify-center rounded-full border border-slate-200/70 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-all hover:border-violet-300 hover:bg-violet-500/10 hover:text-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-200/10 dark:hover:text-slate-100';

const TERTIARY_ACTION_BUTTON =
  'inline-flex items-center justify-center rounded-full border border-slate-200/70 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-all hover:border-violet-300 hover:bg-violet-500/10 hover:text-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-200/10 dark:hover:text-slate-100';

const ACTIVE_LAUNCH_STATUSES = new Set(['pending', 'starting', 'running', 'stopping']);

function getStatusBadgeClasses(status: string) {
  return `${STATUS_BADGE_BASE} ${STATUS_BADGE_VARIANTS[status] ?? STATUS_BADGE_VARIANTS.seed}`;
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
    <div className="overflow-x-auto rounded-3xl border border-slate-200/70 bg-white/80 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md transition-colors dark:border-slate-700/70 dark:bg-slate-900/70">
      <table className="min-w-full divide-y divide-slate-200/70 dark:divide-slate-700/60">
        <thead className="bg-slate-50/70 text-left text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
          <tr>
            <th scope="col" className="px-6 py-4">App</th>
            <th scope="col" className="px-6 py-4">Ingestion</th>
            <th scope="col" className="px-6 py-4">Latest build</th>
            <th scope="col" className="px-6 py-4">Latest launch</th>
            <th scope="col" className="px-6 py-4">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200/70 text-sm dark:divide-slate-700/60">
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
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">No builds yet</span>
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
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">No launches yet</span>
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
                  className={`cursor-pointer bg-white/50 transition-colors dark:bg-slate-900/40 ${
                    isSelected
                      ? 'ring-1 ring-violet-300/70 dark:ring-slate-600/70'
                      : 'hover:bg-violet-500/5 dark:hover:bg-slate-800/60'
                  }`}
                  onClick={(event) => handleRowClick(event, app.id)}
                  onKeyDown={(event) => handleRowKeyDown(event, app.id)}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isSelected}
                  aria-label={`View details for ${app.name}`}
                >
                  <td className="max-w-xs px-6 py-4 align-top">
                    <div className="space-y-2">
                      <div className="text-base font-semibold text-slate-700 dark:text-slate-100">
                        {highlightSegments(app.name, activeTokens, highlightEnabled)}
                      </div>
                      {ingestError && (
                        <p className="text-xs font-medium text-rose-600 dark:text-rose-300">{ingestError}</p>
                      )}
                      {launchError && (
                        <p className="text-xs font-medium text-rose-600 dark:text-rose-300">{launchError}</p>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 align-top">
                    <div className="flex flex-col gap-2 text-xs text-slate-500 dark:text-slate-400">
                      {ingestStatusBadge}
                      <time dateTime={app.updatedAt}>
                        Updated {new Date(app.updatedAt).toLocaleString()}
                      </time>
                      {retryingId === app.id ? (
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Retrying…</span>
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
                    <div className="flex flex-col gap-2 text-xs text-slate-500 dark:text-slate-400">
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
                    <div className="flex flex-col gap-2 text-xs text-slate-500 dark:text-slate-400">
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

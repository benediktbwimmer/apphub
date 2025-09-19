import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '../constants';
import {
  formatBytes,
  formatDuration,
  formatNormalizedScore,
  formatScore,
  highlightSegments
} from '../utils';
import type { AppRecord, BuildTimelineState, HistoryState, LaunchListState, TagKV } from '../types';

const TAG_COLOR_PALETTE: { background: string; border: string; color: string }[] = [
  { background: 'rgba(59, 130, 246, 0.16)', border: 'rgba(37, 99, 235, 0.35)', color: '#1e3a8a' },
  { background: 'rgba(139, 92, 246, 0.16)', border: 'rgba(124, 58, 237, 0.35)', color: '#5b21b6' },
  { background: 'rgba(16, 185, 129, 0.18)', border: 'rgba(5, 150, 105, 0.35)', color: '#065f46' },
  { background: 'rgba(245, 158, 11, 0.2)', border: 'rgba(217, 119, 6, 0.38)', color: '#92400e' },
  { background: 'rgba(248, 113, 113, 0.2)', border: 'rgba(239, 68, 68, 0.38)', color: '#b91c1c' },
  { background: 'rgba(14, 116, 144, 0.18)', border: 'rgba(8, 145, 178, 0.35)', color: '#0f766e' }
];

const STATUS_BADGE_BASE =
  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em]';

const STATUS_BADGE_VARIANTS: Record<string, string> = {
  seed: 'border-slate-300/70 bg-slate-100/70 text-slate-600 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-200',
  pending: 'border-amber-300/70 bg-amber-50/80 text-amber-700 dark:border-amber-400/60 dark:bg-amber-500/20 dark:text-amber-200',
  processing: 'border-sky-300/70 bg-sky-50/80 text-sky-700 dark:border-sky-400/60 dark:bg-sky-500/20 dark:text-sky-200',
  running: 'border-sky-300/70 bg-sky-50/80 text-sky-700 dark:border-sky-400/60 dark:bg-sky-500/20 dark:text-sky-200',
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

const getStatusBadgeClasses = (status: string) =>
  `${STATUS_BADGE_BASE} ${STATUS_BADGE_VARIANTS[status] ?? STATUS_BADGE_VARIANTS.seed}`;

const BUTTON_BASE =
  'inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-60';

const PRIMARY_BUTTON_CLASSES = `${BUTTON_BASE} bg-blue-600 text-white shadow-lg shadow-blue-500/30 hover:bg-blue-500 dark:bg-slate-200/20 dark:text-slate-50 dark:hover:bg-slate-200/30`;

const SECONDARY_BUTTON_CLASSES = `${BUTTON_BASE} border border-slate-200/70 bg-white/80 text-slate-600 hover:border-blue-300 hover:bg-blue-500/10 hover:text-blue-700 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-200/10 dark:hover:text-slate-100`;

const PILL_LABEL_CLASSES =
  'inline-flex items-center gap-1 rounded-full bg-slate-200/70 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-700/60 dark:text-slate-200';

const SMALL_BUTTON_BASE =
  'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-60';

const SMALL_BUTTON_GHOST = `${SMALL_BUTTON_BASE} border border-slate-200/70 bg-white/70 text-slate-600 hover:border-blue-300 hover:bg-blue-500/10 hover:text-blue-700 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-200/10 dark:hover:text-slate-100`;

const SMALL_BUTTON_DANGER = `${SMALL_BUTTON_BASE} border border-rose-300/70 bg-rose-500/5 text-rose-600 hover:border-rose-400 hover:bg-rose-500/15 hover:text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20`;

const getTagColors = (key: string) => {
  if (key.length === 0) {
    return TAG_COLOR_PALETTE[0];
  }

  const paletteIndex = [...key].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % TAG_COLOR_PALETTE.length, 0);
  return TAG_COLOR_PALETTE[paletteIndex];
};

type AppCardProps = {
  app: AppRecord;
  activeTokens: string[];
  highlightEnabled: boolean;
  retryingId: string | null;
  onRetry: (id: string) => void;
  historyEntry?: HistoryState[string];
  onToggleHistory: (id: string) => void;
  buildEntry?: BuildTimelineState;
  onToggleBuilds: (id: string) => void;
  onLoadMoreBuilds: (id: string) => void;
  onToggleLogs: (appId: string, buildId: string) => void;
  onRetryBuild: (appId: string, buildId: string) => void;
  launchEntry?: LaunchListState[string];
  onToggleLaunches: (id: string) => void;
  onLaunch: (id: string) => void;
  onStopLaunch: (appId: string, launchId: string) => void;
  launchingId: string | null;
  stoppingLaunchId: string | null;
  launchErrors: Record<string, string | null>;
};

function TagList({ tags, activeTokens, highlightEnabled }: { tags: TagKV[]; activeTokens: string[]; highlightEnabled: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => {
        const { background, border, color } = getTagColors(tag.key);

        return (
          <span
            key={`${tag.key}:${tag.value}`}
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium shadow-sm"
            style={{ backgroundColor: background, borderColor: border, color }}
          >
            <span className="font-semibold">
              {highlightSegments(tag.key, activeTokens, highlightEnabled)}
            </span>
            <span className="opacity-70">:</span>
            <span>{highlightSegments(tag.value, activeTokens, highlightEnabled)}</span>
          </span>
        );
      })}
    </div>
  );
}

function PreviewMedia({ tile }: { tile: AppRecord['previewTiles'][number] }) {
  if ((tile.kind === 'image' || tile.kind === 'gif') && tile.src) {
    return (
      <img
        className="h-full w-full object-cover"
        src={tile.src}
        alt={tile.title ?? 'Application preview frame'}
        loading="lazy"
      />
    );
  }
  if (tile.kind === 'video' && tile.src) {
    return (
      <video
        muted
        autoPlay
        loop
        playsInline
        poster={tile.posterUrl ?? undefined}
        src={tile.src}
        className="h-full w-full object-cover"
      >
        Your browser does not support the video tag.
      </video>
    );
  }
  if ((tile.kind === 'storybook' || tile.kind === 'embed') && tile.embedUrl) {
    return (
      <iframe
        src={tile.embedUrl}
        title={tile.title ?? 'Interactive preview'}
        loading="lazy"
        allow="autoplay; fullscreen"
        sandbox="allow-scripts allow-same-origin allow-popups"
        className="h-full w-full border-0"
      />
    );
  }
  if (tile.src) {
    return (
      <img
        className="h-full w-full object-cover"
        src={tile.src}
        alt={tile.title ?? 'Preview still'}
        loading="lazy"
      />
    );
  }
  return null;
}

function ChannelPreview({
  tiles,
  appName,
  launch
}: {
  tiles: AppRecord['previewTiles'];
  appName: string;
  launch: AppRecord['latestLaunch'];
}) {
  const livePreviewUrl = launch?.status === 'running' && launch.instanceUrl ? launch.instanceUrl : null;
  const usableTiles = useMemo(
    () => tiles.filter((tile) => Boolean(tile.src || tile.embedUrl)),
    [tiles]
  );
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (livePreviewUrl) {
      return;
    }
    setActiveIndex(0);
  }, [usableTiles.length, livePreviewUrl]);

  useEffect(() => {
    if (livePreviewUrl) {
      return;
    }
    if (usableTiles.length <= 1) {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mediaQuery.matches) {
      return;
    }
    const interval = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % usableTiles.length);
    }, 7000);
    return () => window.clearInterval(interval);
  }, [usableTiles, livePreviewUrl]);

  if (livePreviewUrl) {
    return (
      <div className="relative aspect-video overflow-hidden rounded-3xl border border-emerald-300/70 bg-slate-950/80 shadow-[inset_0_0_40px_rgba(15,23,42,0.8)] dark:border-emerald-500/50">
        <iframe
          src={livePreviewUrl}
          title={`${appName} live preview`}
          className="h-full w-full border-0 bg-white"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; geolocation; gyroscope; picture-in-picture"
          allowFullScreen
        />
        <div className="pointer-events-none absolute left-4 top-4 inline-flex items-center gap-2 rounded-full border border-emerald-200/70 bg-emerald-500/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.35em] text-emerald-100 shadow-lg">
          Live preview
        </div>
      </div>
    );
  }

  if (usableTiles.length === 0) {
    const initial = appName.trim().slice(0, 1).toUpperCase() || 'A';
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-slate-300/70 bg-slate-50/70 text-slate-400 shadow-inner dark:border-slate-700/60 dark:bg-slate-800/40 dark:text-slate-500">
        <span className="text-5xl font-semibold tracking-tight">{initial}</span>
        <span className="text-xs uppercase tracking-[0.3em]">Live preview pending</span>
      </div>
    );
  }

  const activeTile = usableTiles[Math.min(activeIndex, usableTiles.length - 1)];

  return (
    <div className="relative aspect-video overflow-hidden rounded-3xl border border-slate-200/70 bg-slate-950/80 shadow-[inset_0_0_40px_rgba(15,23,42,0.8)] dark:border-slate-700/70">
      <PreviewMedia tile={activeTile} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent p-4 text-slate-100">
        <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.3em]">
          <span className="rounded-full bg-white/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.35em]">
            {activeTile.kind}
          </span>
          {activeTile.source && (
            <span className="opacity-80">{activeTile.source.replace('ingestion:', '')}</span>
          )}
        </div>
        {(activeTile.title || activeTile.description) && (
          <div className="space-y-1 text-left text-sm">
            {activeTile.title && <h3 className="text-sm font-semibold">{activeTile.title}</h3>}
            {activeTile.description && <p className="text-xs font-medium text-slate-200/80">{activeTile.description}</p>}
          </div>
        )}
      </div>
      {usableTiles.length > 1 && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2">
          {usableTiles.map((tile, index) => (
            <button
              key={tile.id ?? `${tile.kind}-${index}`}
              type="button"
              className={`h-2.5 w-2.5 rounded-full border border-white/30 transition-all ${
                activeIndex === index ? 'scale-110 bg-white/90' : 'bg-white/30 hover:bg-white/70'
              }`}
              onClick={() => setActiveIndex(index)}
              aria-label={`Show preview ${index + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BuildSummarySection({ build }: { build: AppRecord['latestBuild'] }) {
  if (!build) {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-slate-300/70 bg-slate-50/70 p-4 text-sm text-slate-500 dark:border-slate-700/60 dark:bg-slate-800/40 dark:text-slate-300">
        <span className={getStatusBadgeClasses('pending')}>build pending</span>
        <span>Awaiting first build run.</span>
      </div>
    );
  }

  const updatedAt = build.completedAt ?? build.startedAt ?? build.updatedAt;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-700/60 dark:bg-slate-800/60">
      <div className="flex flex-wrap items-center gap-3">
        <span className={getStatusBadgeClasses(build.status)}>build {build.status}</span>
        {updatedAt && (
          <time className="text-xs text-slate-500 dark:text-slate-400" dateTime={updatedAt}>
            Updated {new Date(updatedAt).toLocaleString()}
          </time>
        )}
        {build.imageTag && (
          <code className="rounded-full bg-slate-200/70 px-2.5 py-1 font-mono text-xs text-slate-600 dark:bg-slate-700/60 dark:text-slate-200">
            {build.imageTag}
          </code>
        )}
      </div>
      {build.errorMessage && (
        <p className="text-sm font-medium text-rose-600 dark:text-rose-300">{build.errorMessage}</p>
      )}
      {build.status === 'pending' && (
        <span className="text-sm text-slate-500 dark:text-slate-400">Waiting for build worker…</span>
      )}
      {build.status === 'running' && (
        <span className="text-sm text-slate-500 dark:text-slate-400">Docker build in progress…</span>
      )}
      {build.logsPreview && (
        <pre className="max-h-40 overflow-auto rounded-xl bg-slate-900/90 p-4 text-xs text-slate-100 shadow-inner dark:bg-slate-950/70">
          {build.logsPreview}
          {build.logsTruncated ? '\n…' : ''}
        </pre>
      )}
    </div>
  );
}

function LaunchSummarySection({
  app,
  activeTokens,
  highlightEnabled,
  launchingId,
  stoppingLaunchId,
  onLaunch,
  onStop,
  launchErrors
}: {
  app: AppRecord;
  activeTokens: string[];
  highlightEnabled: boolean;
  launchingId: string | null;
  stoppingLaunchId: string | null;
  onLaunch: (id: string) => void;
  onStop: (appId: string, launchId: string) => void;
  launchErrors: Record<string, string | null>;
}) {
  const launch = app.latestLaunch;
  const updatedAt = launch?.updatedAt ?? null;
  const isLaunching = launchingId === app.id;
  const isStopping = launch ? stoppingLaunchId === launch.id : false;
  const canLaunch = app.latestBuild?.status === 'succeeded';
  const canStop = launch ? ['running', 'starting', 'stopping'].includes(launch.status) : false;
  const launchError = launchErrors[app.id] ?? null;

  return (
    <div
      className={
        launch
          ? 'flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-700/60 dark:bg-slate-800/60'
          : 'flex flex-col gap-3 rounded-2xl border border-dashed border-slate-300/70 bg-slate-50/50 p-4 text-slate-500 dark:border-slate-700/60 dark:bg-slate-800/30 dark:text-slate-300'
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className={getStatusBadgeClasses(launch ? launch.status : 'pending')}>
          {launch ? `launch ${launch.status}` : 'launch pending'}
        </span>
        {updatedAt && (
          <time className="text-xs text-slate-500 dark:text-slate-400" dateTime={updatedAt}>
            Updated {new Date(updatedAt).toLocaleString()}
          </time>
        )}
        {launch?.instanceUrl && (
          <a
            className="rounded-full border border-blue-200/70 px-3 py-1 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-500/10 dark:border-slate-600/60 dark:text-slate-100 dark:hover:bg-slate-200/10"
            href={launch.instanceUrl}
            target="_blank"
            rel="noreferrer"
          >
            Preview
          </a>
        )}
      </div>
      {(launchError || launch?.errorMessage) && (
        <p className="text-sm font-medium text-rose-600 dark:text-rose-300">
          {highlightSegments(launchError ?? launch?.errorMessage ?? '', activeTokens, highlightEnabled)}
        </p>
      )}
      {!canLaunch && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Launch requires a successful build.</p>
      )}
      {launch?.status === 'starting' && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Container starting…</p>
      )}
      {launch?.status === 'stopping' && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Stopping container…</p>
      )}
      {launch?.status === 'stopped' && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Last launch has ended.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={PRIMARY_BUTTON_CLASSES}
          onClick={() => onLaunch(app.id)}
          disabled={isLaunching || !canLaunch || canStop}
        >
          {isLaunching ? 'Launching…' : 'Launch app'}
        </button>
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASSES}
          onClick={() => {
            if (launch) {
              onStop(app.id, launch.id);
            }
          }}
          disabled={!launch || !canStop || isStopping}
        >
          {isStopping ? 'Stopping…' : 'Stop launch'}
        </button>
      </div>
      {launch?.instanceUrl && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-blue-600 dark:text-slate-200">
          <span className="font-semibold text-slate-600 dark:text-slate-200">Preview URL:</span>
          <a className="break-all underline-offset-4 hover:underline" href={launch.instanceUrl} target="_blank" rel="noreferrer">
            {launch.instanceUrl}
          </a>
        </div>
      )}
      {launch?.resourceProfile && (
        <div className="text-sm text-slate-500 dark:text-slate-400">Profile: {launch.resourceProfile}</div>
      )}
    </div>
  );
}

function BuildTimeline({
  appId,
  entry,
  onToggleLogs,
  onRetryBuild,
  onLoadMore
}: {
  appId: string;
  entry?: BuildTimelineState;
  onToggleLogs: (appId: string, buildId: string) => void;
  onRetryBuild: (appId: string, buildId: string) => void;
  onLoadMore: (appId: string) => void;
}) {
  if (!entry) {
    return null;
  }

  const builds = entry.builds ?? [];

  return (
    <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-white/80 p-4 dark:border-slate-700/60 dark:bg-slate-900/60">
      {entry.loading && (
        <div className="rounded-xl border border-slate-200/70 bg-slate-100/70 px-4 py-2 text-sm text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300">
          Loading builds…
        </div>
      )}
      {entry.error && !entry.loading && (
        <div className="rounded-xl border border-rose-300/70 bg-rose-50/70 px-4 py-2 text-sm font-medium text-rose-600 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300">
          {entry.error}
        </div>
      )}
      {!entry.loading && !entry.error && builds.length === 0 && (
        <div className="rounded-xl border border-slate-200/70 bg-slate-100/70 px-4 py-2 text-sm text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300">
          No builds recorded yet.
        </div>
      )}
      {builds.map((build) => {
        const logState = entry.logs[build.id];
        const logOpen = logState?.open ?? false;
        const logLoading = logState?.loading ?? false;
        const logError = logState?.error ?? null;
        const logSize = logState?.size ?? build.logsSize;
        const logUpdatedAt = logState?.updatedAt ?? null;
        const isRetryingBuild = entry.retrying?.[build.id] ?? false;
        const completedAt = build.completedAt ?? build.startedAt ?? build.updatedAt;
        const durationLabel = formatDuration(build.durationMs);
        const downloadUrl = `${API_BASE_URL}/builds/${build.id}/logs?download=1`;
        return (
          <div
            key={build.id}
            className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-700/60 dark:bg-slate-800/60"
          >
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className={getStatusBadgeClasses(build.status)}>build {build.status}</span>
              {build.commitSha && (
                <code className="rounded-full bg-slate-200/70 px-2.5 py-1 font-mono text-[11px] tracking-wider text-slate-600 dark:bg-slate-700/60 dark:text-slate-200">
                  {build.commitSha.slice(0, 10)}
                </code>
              )}
              {completedAt && (
                <time className="text-slate-500 dark:text-slate-400" dateTime={completedAt}>
                  {new Date(completedAt).toLocaleString()}
                </time>
              )}
              {durationLabel && (
                <span className="rounded-full bg-slate-200/70 px-2.5 py-1 font-semibold text-slate-500 dark:bg-slate-700/60 dark:text-slate-200">
                  {durationLabel}
                </span>
              )}
              {build.imageTag && (
                <code className="rounded-full bg-slate-200/70 px-2.5 py-1 font-mono text-[11px] text-slate-600 dark:bg-slate-700/60 dark:text-slate-200">
                  {build.imageTag}
                </code>
              )}
            </div>
            {build.errorMessage && (
              <p className="text-sm font-medium text-rose-600 dark:text-rose-300">{build.errorMessage}</p>
            )}
            {build.logsPreview && (
              <pre className="max-h-40 overflow-auto rounded-xl bg-slate-900/90 p-4 text-xs text-slate-100 dark:bg-slate-950/70">
                {build.logsPreview}
                {build.logsTruncated ? '\n…' : ''}
              </pre>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                className="inline-flex items-center rounded-full border border-slate-200/70 px-3 py-1 font-semibold text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-500/10 hover:text-blue-700 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-200/10 dark:hover:text-slate-100"
                onClick={() => onToggleLogs(appId, build.id)}
              >
                {logOpen ? 'Hide logs' : 'View logs'}
              </button>
              <a
                className="inline-flex items-center rounded-full border border-slate-200/70 px-3 py-1 font-semibold text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-500/10 hover:text-blue-700 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-200/10 dark:hover:text-slate-100"
                href={downloadUrl}
                target="_blank"
                rel="noreferrer"
              >
                Download logs
              </a>
              {build.status === 'failed' && (
                <button
                  type="button"
                  className="inline-flex items-center rounded-full border border-rose-300/70 px-3 py-1 font-semibold text-rose-600 transition-colors hover:border-rose-400 hover:bg-rose-500/10 hover:text-rose-700 disabled:opacity-60 dark:border-rose-500/50 dark:text-rose-300 dark:hover:bg-rose-500/20"
                  disabled={isRetryingBuild}
                  onClick={() => onRetryBuild(appId, build.id)}
                >
                  {isRetryingBuild ? 'Retrying…' : 'Retry build'}
                </button>
              )}
            </div>
            {logOpen && (
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4 dark:border-slate-700/60 dark:bg-slate-800/60">
                {logLoading && (
                  <div className="text-sm text-slate-500 dark:text-slate-400">Loading logs…</div>
                )}
                {logError && !logLoading && (
                  <div className="text-sm font-medium text-rose-600 dark:text-rose-300">{logError}</div>
                )}
                {!logLoading && !logError && (
                  <>
                    <div className="flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
                      <span>Size {formatBytes(logSize)}</span>
                      {logUpdatedAt && (
                        <time dateTime={logUpdatedAt}>Updated {new Date(logUpdatedAt).toLocaleString()}</time>
                      )}
                    </div>
                    <pre className="max-h-60 overflow-auto rounded-xl bg-slate-900/90 p-4 font-mono text-xs leading-5 text-slate-100 shadow-inner dark:bg-slate-950/70">
                      {logState?.content ?? 'No logs available yet.'}
                    </pre>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {entry.meta?.hasMore && (
        <button
          type="button"
          className="self-start rounded-full border border-slate-200/70 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-500/10 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-200/10 dark:hover:text-slate-100"
          onClick={() => onLoadMore(appId)}
          disabled={entry.loadingMore}
        >
          {entry.loadingMore ? 'Loading…' : 'Load more builds'}
        </button>
      )}
    </div>
  );
}

function LaunchTimeline({
  entry,
  activeTokens,
  highlightEnabled
}: {
  entry?: LaunchListState[string];
  activeTokens: string[];
  highlightEnabled: boolean;
}) {
  if (!entry) {
    return null;
  }

  const launches = entry.launches ?? [];

  return (
    <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-white/80 p-4 dark:border-slate-700/60 dark:bg-slate-900/60">
      {entry.loading && (
        <div className="rounded-xl border border-slate-200/70 bg-slate-100/70 px-4 py-2 text-sm text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300">
          Loading launches…
        </div>
      )}
      {entry.error && (
        <div className="rounded-xl border border-rose-300/70 bg-rose-50/70 px-4 py-2 text-sm font-medium text-rose-600 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300">
          {entry.error}
        </div>
      )}
      {!entry.loading && !entry.error && launches.length === 0 && (
        <div className="rounded-xl border border-slate-200/70 bg-slate-100/70 px-4 py-2 text-sm text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300">
          No launches recorded yet.
        </div>
      )}
      {launches.length > 0 && (
        <ul className="flex flex-col gap-3">
          {launches.map((launchItem) => {
            const timestamp = launchItem.updatedAt ?? launchItem.createdAt;
            return (
              <li key={launchItem.id}>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className={getStatusBadgeClasses(launchItem.status)}>{launchItem.status}</span>
                  <time className="text-slate-500 dark:text-slate-400" dateTime={timestamp}>
                    {new Date(timestamp).toLocaleString()}
                  </time>
                  <code className="rounded-full bg-slate-200/70 px-2.5 py-1 font-mono text-[11px] text-slate-600 dark:bg-slate-700/60 dark:text-slate-200">
                    {launchItem.buildId.slice(0, 8)}
                  </code>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  {launchItem.instanceUrl && (
                    <a
                      href={launchItem.instanceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-blue-200/70 px-3 py-1 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-500/10 dark:border-slate-600/60 dark:text-slate-100 dark:hover:bg-slate-200/10"
                    >
                      Open preview
                    </a>
                  )}
                  {launchItem.errorMessage && (
                    <div className="text-sm font-medium text-rose-600 dark:text-rose-300">
                      {highlightSegments(launchItem.errorMessage, activeTokens, highlightEnabled)}
                    </div>
                  )}
                  {launchItem.resourceProfile && (
                    <span className={PILL_LABEL_CLASSES}>{launchItem.resourceProfile}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function HistoryTimeline({ entry }: { entry?: HistoryState[string] }) {
  if (!entry) {
    return null;
  }

  const events = entry.events ?? [];

  return (
    <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-white/80 p-4 dark:border-slate-700/60 dark:bg-slate-900/60">
      {entry.loading && (
        <div className="rounded-xl border border-slate-200/70 bg-slate-100/70 px-4 py-2 text-sm text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300">
          Loading history…
        </div>
      )}
      {entry.error && (
        <div className="rounded-xl border border-rose-300/70 bg-rose-50/70 px-4 py-2 text-sm font-medium text-rose-600 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300">
          {entry.error}
        </div>
      )}
      {!entry.loading && !entry.error && events.length === 0 && (
        <div className="rounded-xl border border-slate-200/70 bg-slate-100/70 px-4 py-2 text-sm text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300">
          No events recorded yet.
        </div>
      )}
      {events.length > 0 && (
        <ul className="flex flex-col gap-3">
          {events.map((event) => (
            <li key={event.id}>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className={getStatusBadgeClasses(event.status)}>{event.status}</span>
                <time className="text-slate-500 dark:text-slate-400" dateTime={event.createdAt}>
                  {new Date(event.createdAt).toLocaleString()}
                </time>
              </div>
              <div className="mt-2 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <div className="font-medium text-slate-700 dark:text-slate-200">
                  {event.message ?? 'No additional message'}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                  {event.attempt !== null && <span>Attempt {event.attempt}</span>}
                  {typeof event.durationMs === 'number' && (
                    <span>{`${Math.max(event.durationMs, 0)} ms`}</span>
                  )}
                  {event.commitSha && (
                    <code className="rounded-full bg-slate-200/70 px-2.5 py-1 font-mono text-[11px] text-slate-600 dark:bg-slate-700/60 dark:text-slate-200">
                      {event.commitSha.slice(0, 10)}
                    </code>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AppCard({
  app,
  activeTokens,
  highlightEnabled,
  retryingId,
  onRetry,
  historyEntry,
  onToggleHistory,
  buildEntry,
  onToggleBuilds,
  onLoadMoreBuilds,
  onToggleLogs,
  onRetryBuild,
  launchEntry,
  onToggleLaunches,
  onLaunch,
  onStopLaunch,
  launchingId,
  stoppingLaunchId,
  launchErrors
}: AppCardProps) {
  const showHistory = historyEntry?.open ?? false;
  const showBuilds = buildEntry?.open ?? false;
  const showLaunches = launchEntry?.open ?? false;

  return (
    <article className="flex flex-col gap-5 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.6)] transition-colors dark:border-slate-700/70 dark:bg-slate-900/70">
      <ChannelPreview tiles={app.previewTiles ?? []} appName={app.name} launch={app.latestLaunch} />
      <div className="flex flex-col gap-3">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {highlightSegments(app.name, activeTokens, highlightEnabled)}
        </h2>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className={getStatusBadgeClasses(app.ingestStatus)}>{app.ingestStatus}</span>
          <time className="text-slate-500 dark:text-slate-400" dateTime={app.updatedAt}>
            Updated {new Date(app.updatedAt).toLocaleDateString()}
          </time>
          <span className={PILL_LABEL_CLASSES}>Attempts {app.ingestAttempts}</span>
        </div>
        {app.relevance && (
          <div className="flex flex-col gap-2 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 text-sm text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200">
            <div className="flex flex-wrap items-center gap-3 text-sm font-semibold">
              <span>Score {formatScore(app.relevance.score)}</span>
              <span className="rounded-full bg-slate-200/70 px-3 py-1 text-xs font-semibold text-slate-500 dark:bg-slate-700/60 dark:text-slate-300">
                Normalized {formatNormalizedScore(app.relevance.normalizedScore)}
              </span>
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
              <span
                title={`${app.relevance.components.name.hits} name hits × ${app.relevance.components.name.weight}`}
              >
                Name {formatScore(app.relevance.components.name.score)}
              </span>
              <span
                title={`${app.relevance.components.description.hits} description hits × ${app.relevance.components.description.weight}`}
              >
                Description {formatScore(app.relevance.components.description.score)}
              </span>
              <span
                title={`${app.relevance.components.tags.hits} tag hits × ${app.relevance.components.tags.weight}`}
              >
                Tags {formatScore(app.relevance.components.tags.score)}
              </span>
            </div>
          </div>
        )}
      </div>
      <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
        {highlightSegments(app.description, activeTokens, highlightEnabled)}
      </p>
      {app.ingestError && (
        <p className="rounded-2xl border border-rose-300/70 bg-rose-50/70 p-3 text-sm font-medium text-rose-600 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300">
          {highlightSegments(app.ingestError, activeTokens, highlightEnabled)}
        </p>
      )}
      <TagList tags={app.tags} activeTokens={activeTokens} highlightEnabled={highlightEnabled} />
      <BuildSummarySection build={app.latestBuild} />
      <LaunchSummarySection
        app={app}
        activeTokens={activeTokens}
        highlightEnabled={highlightEnabled}
        launchingId={launchingId}
        stoppingLaunchId={stoppingLaunchId}
        onLaunch={onLaunch}
        onStop={onStopLaunch}
        launchErrors={launchErrors}
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <a
          className="rounded-full border border-blue-200/70 px-3 py-1 font-semibold text-blue-600 transition-colors hover:bg-blue-500/10 dark:border-slate-600/60 dark:text-slate-100 dark:hover:bg-slate-200/10"
          href={app.repoUrl}
          target="_blank"
          rel="noreferrer"
        >
          View repository
        </a>
        <code className="rounded-full bg-slate-200/70 px-3 py-1 font-mono text-xs text-slate-600 dark:bg-slate-700/60 dark:text-slate-200">
          {highlightSegments(app.dockerfilePath, activeTokens, highlightEnabled)}
        </code>
        {app.ingestStatus === 'failed' && (
          <button
            type="button"
            className={SMALL_BUTTON_DANGER}
            disabled={retryingId === app.id}
            onClick={() => onRetry(app.id)}
          >
            {retryingId === app.id ? 'Retrying…' : 'Retry ingest'}
          </button>
        )}
        <button
          type="button"
          className={SMALL_BUTTON_GHOST}
          onClick={() => onToggleBuilds(app.id)}
        >
          {showBuilds ? 'Hide builds' : 'View builds'}
        </button>
        <button
          type="button"
          className={SMALL_BUTTON_GHOST}
          onClick={() => onToggleLaunches(app.id)}
        >
          {showLaunches ? 'Hide launches' : 'View launches'}
        </button>
        <button
          type="button"
          className={SMALL_BUTTON_GHOST}
          onClick={() => onToggleHistory(app.id)}
        >
          {showHistory ? 'Hide history' : 'View history'}
        </button>
      </div>
      {showBuilds && (
        <BuildTimeline
          appId={app.id}
          entry={buildEntry}
          onToggleLogs={onToggleLogs}
          onRetryBuild={onRetryBuild}
          onLoadMore={onLoadMoreBuilds}
        />
      )}
      {showLaunches && (
        <LaunchTimeline entry={launchEntry} activeTokens={activeTokens} highlightEnabled={highlightEnabled} />
      )}
      {showHistory && <HistoryTimeline entry={historyEntry} />}
    </article>
  );
}

export default AppCard;

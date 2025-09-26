import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { usePreviewLayout } from '../../settings/previewLayoutContext';
import { buildDockerRunCommandString, createLaunchId } from '../launchCommand';
import { API_BASE_URL } from '../constants';
import { normalizePreviewUrl } from '../../utils/url';
import { Spinner } from '../../components';
import {
  formatBytes,
  formatDuration,
  formatNormalizedScore,
  formatScore,
  highlightSegments
} from '../utils';
import { FullscreenIcon, FullscreenOverlay, type FullscreenPreviewState } from './FullscreenPreview';
import { MAX_LAUNCH_ENV_ROWS, collectAvailableEnvVars, mergeEnvSources } from './envUtils';
import type {
  AppRecord,
  BuildTimelineState,
  HistoryState,
  LaunchEnvVar,
  LaunchRequestDraft,
  LaunchListState,
  TagKV
} from '../types';

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

const getStatusBadgeClasses = (status: string) =>
  `${STATUS_BADGE_BASE} ${STATUS_BADGE_VARIANTS[status] ?? STATUS_BADGE_VARIANTS.seed}`;

const BUTTON_BASE =
  'inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60';

const PRIMARY_BUTTON_CLASSES = `${BUTTON_BASE} bg-violet-600 text-white shadow-lg shadow-violet-500/30 hover:bg-violet-500 dark:bg-slate-200/20 dark:text-slate-50 dark:hover:bg-slate-200/30`;

const SECONDARY_BUTTON_CLASSES = `${BUTTON_BASE} border border-slate-200/70 bg-white/80 text-slate-600 hover:border-violet-300 hover:bg-violet-500/10 hover:text-violet-700 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-200/10 dark:hover:text-slate-100`;

const PILL_LABEL_CLASSES =
  'inline-flex items-center gap-1 rounded-full bg-slate-200/70 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-700/60 dark:text-slate-200';

const SMALL_BUTTON_BASE =
  'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60';

const SMALL_BUTTON_GHOST = `${SMALL_BUTTON_BASE} border border-slate-200/70 bg-white/70 text-slate-600 hover:border-violet-300 hover:bg-violet-500/10 hover:text-violet-700 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-200/10 dark:hover:text-slate-100`;

const SMALL_BUTTON_DANGER = `${SMALL_BUTTON_BASE} border border-rose-300/70 bg-rose-500/5 text-rose-600 hover:border-rose-400 hover:bg-rose-500/15 hover:text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20`;


const getTagColors = (key: string) => {
  if (key.length === 0) {
    return TAG_COLOR_PALETTE[0];
  }

  const paletteIndex = [...key].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % TAG_COLOR_PALETTE.length, 0);
  return TAG_COLOR_PALETTE[paletteIndex];
};

const ACTIVE_LAUNCH_STATUSES = new Set(['pending', 'starting', 'running', 'stopping']);

type LaunchEnvRow = LaunchEnvVar & { id: string };

function createEnvRow(entry?: LaunchEnvVar, id?: string): LaunchEnvRow {
  const fallbackId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `env-${crypto.randomUUID()}`
      : `env-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id: id ?? fallbackId,
    key: entry?.key ?? '',
    value: entry?.value ?? ''
  };
}

function rowsFromEnv(env: LaunchEnvVar[] = []): LaunchEnvRow[] {
  return env.map((entry, index) =>
    createEnvRow(entry, `existing-${index}`)
  );
}

type AppDetailsPanelProps = {
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
  onTriggerBuild: (appId: string, options: { branch?: string; ref?: string }) => Promise<boolean>;
  launchEntry?: LaunchListState[string];
  onToggleLaunches: (id: string) => void;
  onLaunch: (id: string, draft: LaunchRequestDraft) => void;
  onStopLaunch: (appId: string, launchId: string) => void;
  launchingId: string | null;
  stoppingLaunchId: string | null;
  launchErrors: Record<string, string | null>;
  showPreview?: boolean;
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
  const { height } = usePreviewLayout();
  const livePreviewSourceUrl = launch?.status === 'running' ? launch.instanceUrl : null;
  const livePreviewUrl = useMemo(() => normalizePreviewUrl(livePreviewSourceUrl), [livePreviewSourceUrl]);
  const usableTiles = useMemo(
    () => tiles.filter((tile) => Boolean(tile.src || tile.embedUrl)),
    [tiles]
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [fullscreenPreview, setFullscreenPreview] = useState<FullscreenPreviewState | null>(null);
  const [livePreviewStatus, setLivePreviewStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [livePreviewRetryToken, setLivePreviewRetryToken] = useState(0);

  useEffect(() => {
    if (livePreviewUrl && livePreviewStatus !== 'failed') {
      return;
    }
    setActiveIndex(0);
  }, [usableTiles.length, livePreviewUrl, livePreviewStatus]);

  useEffect(() => {
    if (livePreviewUrl && livePreviewStatus !== 'failed') {
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
  }, [usableTiles, livePreviewUrl, livePreviewStatus]);

  useEffect(() => {
    if (!livePreviewUrl) {
      setLivePreviewStatus('idle');
      return;
    }

    let cancelled = false;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

    setLivePreviewStatus((current) => (current === 'ready' ? current : 'loading'));

    if (typeof fetch !== 'function') {
      return () => {
        cancelled = true;
        controller?.abort();
      };
    }

    const requestOptions: RequestInit = {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller?.signal
    };

    fetch(livePreviewUrl, requestOptions).catch(() => {
      if (cancelled) {
        return;
      }
      setLivePreviewStatus((current) => (current === 'ready' ? current : 'failed'));
    });

    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, [livePreviewUrl, livePreviewRetryToken]);

  useEffect(() => {
    if (!fullscreenPreview || fullscreenPreview.type !== 'live') {
      return;
    }
    if (livePreviewUrl && livePreviewStatus !== 'failed') {
      return;
    }
    setFullscreenPreview(null);
  }, [fullscreenPreview, livePreviewUrl, livePreviewStatus]);

  const hasLivePreview = Boolean(livePreviewUrl);
  const livePreviewAvailable = hasLivePreview && livePreviewStatus !== 'failed';

  const handleRetryLivePreview = () => {
    if (!hasLivePreview) {
      return;
    }
    setLivePreviewStatus('loading');
    setLivePreviewRetryToken((token) => token + 1);
  };

  const livePreviewBannerText = livePreviewStatus === 'loading' ? 'Connecting' : 'Live preview';

  if (livePreviewAvailable && livePreviewUrl) {
    return (
      <>
        <div
          className="relative overflow-hidden rounded-3xl border border-emerald-300/70 bg-slate-950/80 shadow-[inset_0_0_40px_rgba(15,23,42,0.8)] dark:border-emerald-500/50"
          style={{ height: `${height}px` }}
        >
          <iframe
            src={livePreviewUrl}
            title={`${appName} live preview`}
            className="h-full w-full border-0 bg-white"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; geolocation; gyroscope; picture-in-picture"
            allowFullScreen
            onLoad={() => setLivePreviewStatus('ready')}
            onError={() => setLivePreviewStatus('failed')}
          />
          {livePreviewStatus !== 'ready' && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/70 text-slate-200">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-transparent" aria-hidden="true" />
              <span className="text-xs font-semibold uppercase tracking-[0.3em]">Connecting...</span>
            </div>
          )}
          <div className="pointer-events-none absolute left-4 top-4 inline-flex items-center gap-2 rounded-full border border-emerald-200/70 bg-emerald-500/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.35em] text-emerald-100 shadow-lg">
            {livePreviewBannerText}
          </div>
          <button
            type="button"
            aria-label="Open fullscreen preview"
            className="absolute right-4 top-4 inline-flex items-center justify-center rounded-full bg-slate-950/70 p-2 text-white shadow-lg transition-opacity hover:bg-slate-950/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
            onClick={() => setFullscreenPreview({ type: 'live', url: livePreviewUrl, title: `${appName} live preview` })}
          >
            <FullscreenIcon />
          </button>
        </div>
        {fullscreenPreview && (
          <FullscreenOverlay preview={fullscreenPreview} onClose={() => setFullscreenPreview(null)} />
        )}
      </>
    );
  }

  const offlineNotice = hasLivePreview && !livePreviewAvailable ? (
    <div className="mt-3 rounded-2xl border border-amber-300/60 bg-amber-50/70 p-4 text-sm text-amber-700 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
      <div className="space-y-1">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700 dark:text-amber-100">
          Live preview unavailable
        </p>
        <p className="text-xs text-amber-600/90 dark:text-amber-100/80">
          We couldn't reach the running instance. It may have stopped or be blocking embeds.
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={SMALL_BUTTON_GHOST}
          onClick={handleRetryLivePreview}
        >
          Retry connection
        </button>
        <a
          className={SMALL_BUTTON_GHOST}
          href={livePreviewUrl ?? '#'}
          target="_blank"
          rel="noreferrer"
        >
          Open in new tab
        </a>
      </div>
    </div>
  ) : null;

  if (usableTiles.length === 0) {
    const initial = appName.trim().slice(0, 1).toUpperCase() || 'A';
    return (
      <>
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-slate-300/70 bg-slate-50/70 text-slate-400 shadow-inner dark:border-slate-700/60 dark:bg-slate-800/40 dark:text-slate-500"
          style={{ height: `${height}px` }}
        >
          <span className="text-5xl font-semibold tracking-tight">{initial}</span>
          <span className="text-xs uppercase tracking-[0.3em]">
            {hasLivePreview ? 'Live preview unavailable' : 'Live preview pending'}
          </span>
        </div>
        {offlineNotice}
      </>
    );
  }

  const activeTile = usableTiles[Math.min(activeIndex, usableTiles.length - 1)];
  const tileTitle = activeTile.title ?? `${appName} preview`;
  const supportsFullscreen = ['embed', 'storybook'].includes(activeTile.kind ?? '') && Boolean(activeTile.embedUrl);

  return (
    <>
      <div
        className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-slate-950/80 shadow-[inset_0_0_40px_rgba(15,23,42,0.8)] dark:border-slate-700/70"
        style={{ height: `${height}px` }}
      >
        <PreviewMedia tile={activeTile} />
        {hasLivePreview && !livePreviewAvailable && (
          <div className="pointer-events-none absolute left-4 top-4 inline-flex items-center gap-2 rounded-full border border-amber-200/70 bg-amber-500/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-100 shadow-lg">
            Preview offline
          </div>
        )}
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
        {supportsFullscreen && activeTile.embedUrl && (
          <button
            type="button"
            aria-label="Open fullscreen preview"
            className="absolute right-4 top-4 inline-flex items-center justify-center rounded-full bg-slate-950/70 p-2 text-white shadow-lg transition-opacity hover:bg-slate-950/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
            onClick={() => setFullscreenPreview({ type: 'tile', tile: activeTile, title: tileTitle })}
          >
            <FullscreenIcon />
          </button>
        )}
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
      {offlineNotice}
      {fullscreenPreview && (
        <FullscreenOverlay preview={fullscreenPreview} onClose={() => setFullscreenPreview(null)} />
      )}
    </>
  );
}

function InfoIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="h-4 w-4"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 9.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="6" r="0.85" fill="currentColor" />
    </svg>
  );
}

function ChevronIcon({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 20 20"
      fill="none"
      className={`${className ?? 'h-4 w-4 text-slate-500 transition-transform'} ${open ? 'rotate-180' : ''}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SectionIcon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200/70 text-slate-600 dark:bg-slate-700/60 dark:text-slate-200"
    >
      {children}
    </span>
  );
}

function BuildIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 20 20"
      fill="none"
      className="h-5 w-5 text-slate-600 dark:text-slate-300"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 7h7M6.5 10h4.5M6.5 13h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function TimelineIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 20 20"
      fill="none"
      className="h-5 w-5 text-slate-600 dark:text-slate-300"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M6 4v12M14 4v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="6" cy="6" r="1.5" fill="currentColor" />
      <circle cx="6" cy="14" r="1.5" fill="currentColor" />
      <circle cx="14" cy="9" r="1.5" fill="currentColor" />
      <circle cx="14" cy="14" r="1.5" fill="currentColor" />
    </svg>
  );
}

function LaunchIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 20 20"
      fill="none"
      className="h-5 w-5 text-slate-600 dark:text-slate-300"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M10 2c2.9 1.4 4.8 4.7 4.8 8.3 0 1.5-.3 3-.9 4.3L10 18l-3.9-3.4c-.6-1.3-.9-2.8-.9-4.3C5.2 6.7 7.1 3.4 10 2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M8 10.5 10 12l2-1.5V6.8L10 5.5 8 6.8v3.7z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 14c-.5 1.6-1.4 2.7-2.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13 14c.5 1.6 1.4 2.7 2.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 20 20"
      fill="none"
      className="h-5 w-5 text-slate-600 dark:text-slate-300"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="10" cy="10" r="6.75" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6v4l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10a5 5 0 0 1 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type CollapsibleSectionProps = {
  id: string;
  title: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
};

function CollapsibleSection({ id, title, icon, open, onToggle, children }: CollapsibleSectionProps) {
  const triggerId = `${id}-trigger`;
  return (
    <section
      className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/40 text-sm shadow-sm dark:border-slate-700/60 dark:bg-slate-900/30"
    >
      <button
        type="button"
        id={triggerId}
        aria-controls={id}
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 bg-slate-50/70 px-4 py-3 text-left font-semibold text-slate-700 transition-colors hover:bg-slate-100/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800/80"
      >
        <span className="flex items-center gap-2">
          <SectionIcon>{icon}</SectionIcon>
          <span>{title}</span>
        </span>
        <ChevronIcon open={open} />
      </button>
      <div
        id={id}
        role="region"
        aria-labelledby={triggerId}
        aria-hidden={!open}
        className={`${open ? 'block' : 'hidden'} border-t border-slate-200/70 bg-white/80 px-4 py-4 text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200`}
      >
        {open ? children : null}
      </div>
    </section>
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
        {build.gitBranch && (
          <code className="rounded-full bg-slate-200/70 px-2.5 py-1 font-mono text-xs text-slate-600 dark:bg-slate-700/60 dark:text-slate-200">
            branch: {build.gitBranch}
          </code>
        )}
        {build.gitRef && (
          <code className="rounded-full bg-slate-200/70 px-2.5 py-1 font-mono text-xs text-slate-600 dark:bg-slate-700/60 dark:text-slate-200">
            ref: {build.gitRef.length > 18 ? `${build.gitRef.slice(0, 18)}…` : build.gitRef}
          </code>
        )}
        {build.commitSha && (
          <code className="rounded-full bg-slate-200/70 px-2.5 py-1 font-mono text-xs tracking-wider text-slate-600 dark:bg-slate-700/60 dark:text-slate-200">
            {build.commitSha.slice(0, 10)}
          </code>
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
  launchErrors,
  detailsOpen,
  onToggleDetails
}: {
  app: AppRecord;
  activeTokens: string[];
  highlightEnabled: boolean;
  launchingId: string | null;
  stoppingLaunchId: string | null;
  onLaunch: (id: string, draft: LaunchRequestDraft) => void;
  onStop: (appId: string, launchId: string) => void;
  launchErrors: Record<string, string | null>;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}) {
  const launch = app.latestLaunch;
  const normalizedInstanceUrl = normalizePreviewUrl(launch?.instanceUrl);
  const updatedAt = launch?.updatedAt ?? null;
  const isLaunching = launchingId === app.id;
  const isStopping = launch ? stoppingLaunchId === launch.id : false;
  const canLaunch = app.latestBuild?.status === 'succeeded';
  const canStop = launch ? ['running', 'starting', 'stopping'].includes(launch.status) : false;
  const launchError = launchErrors[app.id] ?? null;

  const availableEnvVars = useMemo(
    () =>
      collectAvailableEnvVars({
        tags: app.tags,
        availableEnv: app.availableEnv,
        availableLaunchEnv: app.availableLaunchEnv,
        launchEnvTemplates: app.launchEnvTemplates
      }),
    [app.availableEnv, app.availableLaunchEnv, app.launchEnvTemplates, app.tags]
  );
  const mergedEnvForLaunch = useMemo(
    () => mergeEnvSources(launch?.env ?? [], availableEnvVars),
    [availableEnvVars, launch]
  );

  const initialLaunchIdRef = useRef<string>('');
  if (!initialLaunchIdRef.current) {
    initialLaunchIdRef.current = createLaunchId();
  }

  const initialEnvRowsRef = useRef<LaunchEnvRow[]>(rowsFromEnv(mergedEnvForLaunch));

  const initialDefaultCommandRef = useRef<string>('');
  const initialLaunchCommand = launch?.command?.trim();
  if (!initialDefaultCommandRef.current) {
    initialDefaultCommandRef.current = initialLaunchCommand?.length
      ? initialLaunchCommand
      : buildDockerRunCommandString({
          repositoryId: app.id,
          launchId: initialLaunchIdRef.current,
          imageTag: app.latestBuild?.imageTag ?? null,
          env: initialEnvRowsRef.current.map(({ key, value }) => ({ key, value }))
        });
  }

  const [envRows, setEnvRows] = useState<LaunchEnvRow[]>(initialEnvRowsRef.current);
  const [generatedDefaultCommand, setGeneratedDefaultCommand] = useState<string>(
    initialDefaultCommandRef.current
  );
  const [pendingLaunchId, setPendingLaunchId] = useState<string>(initialLaunchIdRef.current);
  const [lastLaunchId, setLastLaunchId] = useState<string | null>(launch?.id ?? null);

  useEffect(() => {
    const currentId = launch?.id ?? null;
    if (currentId !== lastLaunchId) {
      const nextEnvRows = rowsFromEnv(mergedEnvForLaunch);
      initialEnvRowsRef.current = nextEnvRows;
      setEnvRows(nextEnvRows);
      setLastLaunchId(currentId);
      const nextPendingId = createLaunchId();
      setPendingLaunchId(nextPendingId);
      const launchCommand = launch?.command?.trim();
      if (launchCommand && launchCommand.length > 0) {
        setGeneratedDefaultCommand(launchCommand);
      } else {
        const nextDefault = buildDockerRunCommandString({
          repositoryId: app.id,
          launchId: nextPendingId,
          imageTag: app.latestBuild?.imageTag ?? null,
          env: nextEnvRows.map(({ key, value }) => ({ key, value }))
        });
        setGeneratedDefaultCommand(nextDefault);
      }
      return;
    }

    const existingKeys = new Set(
      envRows
        .map((row) => row.key.trim())
        .filter((key) => key.length > 0)
    );
    const additions = mergedEnvForLaunch.filter(
      (entry) => entry.key.length > 0 && !existingKeys.has(entry.key)
    );
    if (additions.length === 0) {
      return;
    }
    setEnvRows((prevRows) => {
      if (prevRows.length >= MAX_LAUNCH_ENV_ROWS) {
        return prevRows;
      }
      const remaining = MAX_LAUNCH_ENV_ROWS - prevRows.length;
      if (remaining <= 0) {
        return prevRows;
      }
      const toAdd = additions
        .slice(0, remaining)
        .map((entry) => createEnvRow(entry));
      if (toAdd.length === 0) {
        return prevRows;
      }
      return [...prevRows, ...toAdd];
    });
  }, [
    app.id,
    app.latestBuild?.imageTag,
    envRows,
    launch,
    lastLaunchId,
    mergedEnvForLaunch
  ]);

  const envForLaunch = useMemo<LaunchEnvVar[]>(() => envRows.map(({ key, value }) => ({ key, value })), [envRows]);

  useEffect(() => {
    const launchCommand = launch?.command?.trim();
    if (launchCommand && launchCommand.length > 0) {
      setGeneratedDefaultCommand((prev) => (prev === launchCommand ? prev : launchCommand));
      return;
    }

    if (editingDisabled) {
      return;
    }

    const nextDefault = buildDockerRunCommandString({
      repositoryId: app.id,
      launchId: pendingLaunchId,
      imageTag: app.latestBuild?.imageTag ?? null,
      env: envForLaunch
    });
    setGeneratedDefaultCommand((prevDefault) => (prevDefault === nextDefault ? prevDefault : nextDefault));
  }, [
    app.id,
    app.latestBuild?.imageTag,
    editingDisabled,
    envForLaunch,
    launch?.command,
    pendingLaunchId
  ]);

  const editingDisabled =
    isLaunching || (launch ? ACTIVE_LAUNCH_STATUSES.has(launch.status) : false);

  const detailsRegionId = `launch-${app.id}-details`;

  const handleAddEnvRow = () => {
    if (editingDisabled) {
      return;
    }
    setEnvRows((prev) => {
      if (prev.length >= MAX_LAUNCH_ENV_ROWS) {
        return prev;
      }
      return [...prev, createEnvRow()];
    });
  };

  const handleEnvKeyChange = (id: string, value: string) => {
    if (editingDisabled) {
      return;
    }
    setEnvRows((prev) => prev.map((row) => (row.id === id ? { ...row, key: value } : row)));
  };

  const handleEnvValueChange = (id: string, value: string) => {
    if (editingDisabled) {
      return;
    }
    setEnvRows((prev) => prev.map((row) => (row.id === id ? { ...row, value } : row)));
  };

  const handleEnvRemove = (id: string) => {
    if (editingDisabled) {
      return;
    }
    setEnvRows((prev) => prev.filter((row) => row.id !== id));
  };

  return (
    <div
      className={
        launch
          ? 'flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-700/60 dark:bg-slate-800/60'
          : 'flex flex-col gap-3 rounded-2xl border border-dashed border-slate-300/70 bg-slate-50/50 p-4 text-slate-500 dark:border-slate-700/60 dark:bg-slate-800/30 dark:text-slate-300'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <SectionIcon>
              <LaunchIcon />
            </SectionIcon>
            Launch
          </span>
          <span className={getStatusBadgeClasses(launch ? launch.status : 'pending')}>
            {launch ? `launch ${launch.status}` : 'launch pending'}
          </span>
          {updatedAt && (
            <time className="text-xs text-slate-500 dark:text-slate-400" dateTime={updatedAt}>
              Updated {new Date(updatedAt).toLocaleString()}
            </time>
          )}
        </div>
        <button
          type="button"
          className={`${SMALL_BUTTON_GHOST} whitespace-nowrap`}
          aria-controls={detailsRegionId}
          aria-expanded={detailsOpen}
          onClick={onToggleDetails}
        >
          <span className="inline-flex items-center gap-2">
            <span>{detailsOpen ? 'Hide launch options' : 'Launch options'}</span>
            <ChevronIcon open={detailsOpen} className="h-3.5 w-3.5 text-slate-500 transition-transform" />
          </span>
        </button>
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
          onClick={() => {
            onLaunch(app.id, {
              env: envForLaunch,
              command: generatedDefaultCommand,
              launchId: pendingLaunchId
            });
            const nextPendingId = createLaunchId();
            setPendingLaunchId(nextPendingId);
            const nextDefault = buildDockerRunCommandString({
              repositoryId: app.id,
              launchId: nextPendingId,
              imageTag: app.latestBuild?.imageTag ?? null,
              env: envForLaunch
            });
            setGeneratedDefaultCommand(nextDefault);
          }}
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
      <div
        id={detailsRegionId}
        role="region"
        aria-hidden={!detailsOpen}
        className={`${detailsOpen ? 'flex flex-col gap-3' : 'hidden'} text-sm text-slate-600 dark:text-slate-300`}
      >
        {normalizedInstanceUrl && (
          <div className="flex flex-wrap items-center gap-2 text-violet-600 dark:text-slate-200">
            <span className="font-semibold text-slate-600 dark:text-slate-200">Preview URL:</span>
            <a className="break-all underline-offset-4 hover:underline" href={normalizedInstanceUrl} target="_blank" rel="noreferrer">
              {normalizedInstanceUrl}
            </a>
          </div>
        )}
        {launch?.resourceProfile && (
          <div className="text-slate-500 dark:text-slate-400">Profile: {launch.resourceProfile}</div>
        )}
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-700/60 dark:bg-slate-900/50">
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
            Docker Command
          </span>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Custom Docker commands are temporarily disabled. Launches will use the generated command below.
          </p>
          <pre className="max-h-40 overflow-auto rounded-xl bg-slate-900/90 p-4 text-xs text-slate-100 shadow-inner dark:bg-slate-950/70">
            {generatedDefaultCommand}
          </pre>
        </div>
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-700/60 dark:bg-slate-900/50">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
              Environment
            </span>
            {!editingDisabled && (
              <button
                type="button"
                className={`${SMALL_BUTTON_GHOST} whitespace-nowrap`}
                onClick={handleAddEnvRow}
                disabled={envRows.length >= MAX_LAUNCH_ENV_ROWS}
              >
                Add variable
              </button>
            )}
          </div>
          {envRows.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No environment variables configured.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {envRows.map((row) => (
                <div key={row.id} className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="KEY"
                    className="min-w-[8rem] flex-1 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm font-mono text-slate-700 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-600/60 dark:bg-slate-800/60 dark:text-slate-100 dark:disabled:bg-slate-800/40 dark:disabled:text-slate-500"
                    value={row.key}
                    onChange={(event) => handleEnvKeyChange(row.id, event.target.value)}
                    disabled={editingDisabled}
                  />
                  <input
                    type="text"
                    placeholder="value"
                    className="flex-1 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm font-mono text-slate-700 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-600/60 dark:bg-slate-800/60 dark:text-slate-100 dark:disabled:bg-slate-800/40 dark:disabled:text-slate-500"
                    value={row.value}
                    onChange={(event) => handleEnvValueChange(row.id, event.target.value)}
                    disabled={editingDisabled}
                  />
                  <button
                    type="button"
                    className={`${SMALL_BUTTON_GHOST} whitespace-nowrap`}
                    onClick={() => handleEnvRemove(row.id)}
                    disabled={editingDisabled}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          {editingDisabled && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Environment variables are locked while a launch is active.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function BuildTimeline({
  appId,
  entry,
  onToggleLogs,
  onRetryBuild,
  onTriggerBuild,
  onLoadMore
}: {
  appId: string;
  entry?: BuildTimelineState;
  onToggleLogs: (appId: string, buildId: string) => void;
  onRetryBuild: (appId: string, buildId: string) => void;
  onTriggerBuild: (appId: string, options: { branch?: string; ref?: string }) => Promise<boolean>;
  onLoadMore: (appId: string) => void;
}) {
  const [branchValue, setBranchValue] = useState('');
  const [refValue, setRefValue] = useState('');

  if (!entry) {
    return null;
  }

  const builds = entry.builds ?? [];

  const handleTriggerBuild = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const branch = branchValue.trim();
    const ref = refValue.trim();
    const success = await onTriggerBuild(appId, {
      branch: branch.length > 0 ? branch : undefined,
      ref: ref.length > 0 ? ref : undefined
    });
    if (success) {
      setBranchValue('');
      setRefValue('');
    }
  };

  return (
    <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-white/80 p-4 dark:border-slate-700/60 dark:bg-slate-900/60">
      <form
        className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-700/60 dark:bg-slate-800/60"
        onSubmit={handleTriggerBuild}
      >
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            className="w-full max-w-xs rounded-full border border-slate-200/70 bg-white/90 px-4 py-2 text-sm font-medium text-slate-600 shadow-inner focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
            placeholder="Branch (optional)"
            value={branchValue}
            onChange={(event) => setBranchValue(event.target.value)}
            disabled={entry.creating}
          />
          <input
            type="text"
            className="w-full max-w-xs rounded-full border border-slate-200/70 bg-white/90 px-4 py-2 text-sm font-medium text-slate-600 shadow-inner focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
            placeholder="Tag or commit (optional)"
            value={refValue}
            onChange={(event) => setRefValue(event.target.value)}
            disabled={entry.creating}
          />
          <button
            type="submit"
            className={SMALL_BUTTON_GHOST}
            disabled={entry.creating}
          >
            {entry.creating ? 'Triggering…' : 'Trigger build'}
          </button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Leave branch empty to use the default. Provide a git tag or commit SHA to pin the build.
        </p>
        {entry.createError && (
          <div className="rounded-xl border border-rose-300/70 bg-rose-50/70 px-3 py-2 text-xs font-semibold text-rose-600 dark:border-rose-500/50 dark:bg-rose-500/20 dark:text-rose-200">
            {entry.createError}
          </div>
        )}
      </form>
      {entry.loading && (
        <div className="rounded-xl border border-slate-200/70 bg-slate-100/70 px-4 py-2 text-sm text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300">
          <Spinner label="Loading builds…" size="xs" />
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
              {build.gitBranch && (
                <code className="rounded-full bg-slate-200/70 px-2.5 py-1 font-mono text-[11px] text-slate-600 dark:bg-slate-700/60 dark:text-slate-200">
                  branch: {build.gitBranch}
                </code>
              )}
              {build.gitRef && (
                <code className="rounded-full bg-slate-200/70 px-2.5 py-1 font-mono text-[11px] text-slate-600 dark:bg-slate-700/60 dark:text-slate-200">
                  ref: {build.gitRef.length > 18 ? `${build.gitRef.slice(0, 18)}…` : build.gitRef}
                </code>
              )}
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
                className="inline-flex items-center rounded-full border border-slate-200/70 px-3 py-1 font-semibold text-slate-600 transition-colors hover:border-violet-300 hover:bg-violet-500/10 hover:text-violet-700 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-200/10 dark:hover:text-slate-100"
                onClick={() => onToggleLogs(appId, build.id)}
              >
                {logOpen ? 'Hide logs' : 'View logs'}
              </button>
              <a
                className="inline-flex items-center rounded-full border border-slate-200/70 px-3 py-1 font-semibold text-slate-600 transition-colors hover:border-violet-300 hover:bg-violet-500/10 hover:text-violet-700 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-200/10 dark:hover:text-slate-100"
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
                  <div className="text-sm text-slate-500 dark:text-slate-400">
                    <Spinner label="Loading logs…" size="xs" />
                  </div>
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
          className="self-start rounded-full border border-slate-200/70 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:border-violet-300 hover:bg-violet-500/10 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-200/10 dark:hover:text-slate-100"
          onClick={() => onLoadMore(appId)}
          disabled={entry.loadingMore}
        >
          {entry.loadingMore ? <Spinner label="Loading more…" size="xs" /> : 'Load more builds'}
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
          <Spinner label="Loading launches…" size="xs" />
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
            const normalizedInstanceUrl = normalizePreviewUrl(launchItem.instanceUrl);
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
                  {normalizedInstanceUrl && (
                    <a
                      href={normalizedInstanceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-violet-200/70 px-3 py-1 text-xs font-semibold text-violet-600 transition-colors hover:bg-violet-500/10 dark:border-slate-600/60 dark:text-slate-100 dark:hover:bg-slate-200/10"
                    >
                      Open preview
                    </a>
                  )}
                  {launchItem.errorMessage && (
                    <div className="text-sm font-medium text-rose-600 dark:text-rose-300">
                      {highlightSegments(launchItem.errorMessage, activeTokens, highlightEnabled)}
                    </div>
                  )}
                  {launchItem.env && launchItem.env.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {launchItem.env.map((entry, index) => (
                        <code
                          key={`${launchItem.id}-env-${entry.key}-${index}`}
                          className="rounded-full bg-slate-200/70 px-2.5 py-1 font-mono text-[11px] text-slate-600 dark:bg-slate-700/60 dark:text-slate-200"
                        >
                          {entry.key}={entry.value}
                        </code>
                      ))}
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
          <Spinner label="Loading history…" size="xs" />
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

function AppDetailsPanel({
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
  onTriggerBuild,
  launchEntry,
  onToggleLaunches,
  onLaunch,
  onStopLaunch,
  launchingId,
  stoppingLaunchId,
  launchErrors,
  showPreview = true
}: AppDetailsPanelProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const infoPopoverRef = useRef<HTMLDivElement | null>(null);
  const [showBuildSummary, setShowBuildSummary] = useState(false);
  const [showLaunchDetails, setShowLaunchDetails] = useState(false);
  const showHistory = historyEntry?.open ?? false;
  const showBuilds = buildEntry?.open ?? false;
  const showLaunches = launchEntry?.open ?? false;

  useEffect(() => {
    if (!infoOpen) {
      return undefined;
    }
    if (typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!infoPopoverRef.current) {
        return;
      }
      if (!infoPopoverRef.current.contains(event.target as Node)) {
        setInfoOpen(false);
      }
    };

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setInfoOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeydown, true);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeydown, true);
    };
  }, [infoOpen]);

  const hasDescription = app.description.trim().length > 0;
  const hasTags = app.tags.length > 0;

  return (
    <article className="flex flex-col gap-5 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.6)] transition-colors dark:border-slate-700/70 dark:bg-slate-900/70">
      {showPreview && (
        <ChannelPreview tiles={app.previewTiles ?? []} appName={app.name} launch={app.latestLaunch} />
      )}
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {highlightSegments(app.name, activeTokens, highlightEnabled)}
          </h2>
          <div className="relative" ref={infoPopoverRef}>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={infoOpen}
              aria-label={infoOpen ? 'Hide app info' : 'Show app info'}
              className="inline-flex items-center justify-center rounded-full border border-slate-200/70 bg-white/80 p-2 text-slate-500 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-200/10 dark:hover:text-slate-100"
              onClick={() => setInfoOpen((open) => !open)}
            >
              <InfoIcon />
            </button>
            {infoOpen && (
              <div className="absolute right-0 z-20 mt-2 w-80 rounded-2xl border border-slate-200/80 bg-white/95 p-4 text-left shadow-xl ring-1 ring-slate-900/5 dark:border-slate-700/70 dark:bg-slate-900/95">
                <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
                  {hasDescription ? (
                    <p className="leading-6">{highlightSegments(app.description, activeTokens, highlightEnabled)}</p>
                  ) : (
                    <p className="text-sm italic text-slate-500 dark:text-slate-400">No description available.</p>
                  )}
                  <div className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                      Tags
                    </span>
                    {hasTags ? (
                      <TagList tags={app.tags} activeTokens={activeTokens} highlightEnabled={highlightEnabled} />
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400">No tags available.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
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
      {app.ingestError && (
        <p className="rounded-2xl border border-rose-300/70 bg-rose-50/70 p-3 text-sm font-medium text-rose-600 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300">
          {highlightSegments(app.ingestError, activeTokens, highlightEnabled)}
        </p>
      )}
      <CollapsibleSection
        id={`app-${app.id}-build-summary`}
        title="Build summary"
        icon={<BuildIcon />}
        open={showBuildSummary}
        onToggle={() => setShowBuildSummary((open) => !open)}
      >
        <BuildSummarySection build={app.latestBuild} />
      </CollapsibleSection>
      <LaunchSummarySection
        app={app}
        activeTokens={activeTokens}
        highlightEnabled={highlightEnabled}
        launchingId={launchingId}
        stoppingLaunchId={stoppingLaunchId}
        onLaunch={onLaunch}
        onStop={onStopLaunch}
        launchErrors={launchErrors}
        detailsOpen={showLaunchDetails}
        onToggleDetails={() => setShowLaunchDetails((open) => !open)}
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <a
          className="rounded-full border border-violet-200/70 px-3 py-1 font-semibold text-violet-600 transition-colors hover:bg-violet-500/10 dark:border-slate-600/60 dark:text-slate-100 dark:hover:bg-slate-200/10"
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
      </div>
      <CollapsibleSection
        id={`app-${app.id}-build-history`}
        title="Build history"
        icon={<TimelineIcon />}
        open={showBuilds}
        onToggle={() => onToggleBuilds(app.id)}
      >
        {buildEntry ? (
          <BuildTimeline
            appId={app.id}
            entry={buildEntry}
            onToggleLogs={onToggleLogs}
            onRetryBuild={onRetryBuild}
            onTriggerBuild={onTriggerBuild}
            onLoadMore={onLoadMoreBuilds}
          />
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">Preparing build history…</p>
        )}
      </CollapsibleSection>
      <CollapsibleSection
        id={`app-${app.id}-launch-history`}
        title="Launch history"
        icon={<LaunchIcon />}
        open={showLaunches}
        onToggle={() => onToggleLaunches(app.id)}
      >
        {launchEntry ? (
          <LaunchTimeline entry={launchEntry} activeTokens={activeTokens} highlightEnabled={highlightEnabled} />
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">Preparing launch history…</p>
        )}
      </CollapsibleSection>
      <CollapsibleSection
        id={`app-${app.id}-ingestion-history`}
        title="Ingestion history"
        icon={<HistoryIcon />}
        open={showHistory}
        onToggle={() => onToggleHistory(app.id)}
      >
        {historyEntry ? <HistoryTimeline entry={historyEntry} /> : (
          <p className="text-sm text-slate-500 dark:text-slate-400">Preparing ingestion history…</p>
        )}
      </CollapsibleSection>
    </article>
  );
}

export default AppDetailsPanel;

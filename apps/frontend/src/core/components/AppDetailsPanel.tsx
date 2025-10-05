import classNames from 'classnames';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { usePreviewLayout } from '../../settings/previewLayoutContext';
import { buildDockerRunCommandString, createLaunchId } from '../launchCommand';
import { API_BASE_URL } from '../constants';
import { normalizePreviewUrl } from '../../utils/url';
import { Spinner } from '../../components';
import { getStatusToneClasses } from '../../theme/statusTokens';
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

const TAG_STYLE_ROTATION = [
  'border border-accent-soft bg-accent-soft text-accent-strong',
  'border border-status-info bg-status-info-soft text-status-info',
  'border border-status-success bg-status-success-soft text-status-success',
  'border border-status-warning bg-status-warning-soft text-status-warning',
  'border border-status-danger bg-status-danger-soft text-status-danger',
  'border border-subtle bg-surface-muted text-secondary'
] as const;

const STATUS_BADGE_BASE =
  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-scale-2xs font-weight-semibold uppercase tracking-[0.25em]';

const getStatusBadgeClasses = (status: string) =>
  `${STATUS_BADGE_BASE} ${getStatusToneClasses(status)}`;

const BUTTON_BASE =
  'inline-flex items-center justify-center rounded-full px-4 py-2 text-scale-sm font-weight-semibold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const PRIMARY_BUTTON_CLASSES = `${BUTTON_BASE} bg-accent text-inverse shadow-lg shadow-accent-soft hover:bg-accent-strong`;

const SECONDARY_BUTTON_CLASSES = `${BUTTON_BASE} border border-subtle bg-surface-glass text-secondary hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong`;

const PILL_LABEL_CLASSES =
  'inline-flex items-center gap-1 rounded-full bg-surface-glass-soft px-2.5 py-1 text-scale-xs font-weight-semibold text-secondary';

const SMALL_BUTTON_BASE =
  'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-scale-xs font-weight-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const SMALL_BUTTON_GHOST = `${SMALL_BUTTON_BASE} border border-subtle bg-surface-glass text-secondary hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong`;

const SMALL_BUTTON_DANGER = `${SMALL_BUTTON_BASE} border border-status-danger bg-status-danger-soft text-status-danger hover:border-status-danger hover:bg-status-danger-soft hover:text-status-danger`;

const TEXT_INPUT_BASE =
  'rounded-xl border border-subtle bg-surface-glass px-3 py-2 text-scale-sm font-mono text-secondary shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted';

const ROUNDED_INPUT_BASE =
  'rounded-full border border-subtle bg-surface-glass px-4 py-2 text-scale-sm font-weight-medium text-secondary shadow-inner focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted';

const CODE_PILL_BASE =
  'rounded-full bg-surface-glass px-2.5 py-1 font-mono text-scale-2xs text-secondary';

const DURATION_PILL_CLASSES =
  'rounded-full bg-surface-glass px-2.5 py-1 font-weight-semibold text-muted';


const getTagClasses = (key: string) => {
  if (key.length === 0) {
    return TAG_STYLE_ROTATION[0];
  }

  const paletteIndex = [...key].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % TAG_STYLE_ROTATION.length, 0);
  return TAG_STYLE_ROTATION[paletteIndex];
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
        const tagClasses = getTagClasses(tag.key);

        return (
          <span
            key={`${tag.key}:${tag.value}`}
            className={classNames(
              'inline-flex items-center gap-2 rounded-full px-3 py-1 text-scale-sm font-weight-medium shadow-elevation-sm transition-colors',
              tagClasses
            )}
          >
            <span className="font-weight-semibold">
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
        alt={tile.title ?? 'Build preview frame'}
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
          className="relative overflow-hidden rounded-3xl border border-status-success bg-surface-sunken shadow-elevation-xl shadow-inner"
          style={{ height: `${height}px` }}
        >
          <iframe
            src={livePreviewUrl}
            title={`${appName} live preview`}
            className="h-full w-full border-0 bg-surface-raised"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; geolocation; gyroscope; picture-in-picture"
            allowFullScreen
            onLoad={() => setLivePreviewStatus('ready')}
            onError={() => setLivePreviewStatus('failed')}
          />
          {livePreviewStatus !== 'ready' && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-overlay-scrim text-inverse">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-subtle border-t-transparent" aria-hidden="true" />
              <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em]">Connecting...</span>
            </div>
          )}
          <div className="pointer-events-none absolute left-4 top-4 inline-flex items-center gap-2 rounded-full border border-status-success bg-status-success-soft px-3 py-1 text-scale-2xs font-weight-semibold uppercase tracking-[0.35em] text-status-success-on shadow-elevation-md">
            {livePreviewBannerText}
          </div>
          <button
            type="button"
            aria-label="Open fullscreen preview"
            className="absolute right-4 top-4 inline-flex items-center justify-center rounded-full bg-overlay-scrim p-2 text-inverse shadow-elevation-md transition-opacity hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
    <div className="mt-3 rounded-2xl border border-status-warning bg-status-warning-soft p-4 text-scale-sm text-status-warning shadow-sm">
      <div className="space-y-1">
        <p className="text-scale-sm font-weight-semibold uppercase tracking-[0.2em] text-status-warning">
          Live preview unavailable
        </p>
        <p className="text-scale-xs text-status-warning">
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
          className="flex flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-subtle bg-surface-muted text-muted shadow-inner"
          style={{ height: `${height}px` }}
        >
          <span className="text-scale-display font-weight-semibold tracking-tight">{initial}</span>
          <span className="text-scale-xs uppercase tracking-[0.3em]">
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
        className="relative overflow-hidden rounded-3xl border border-subtle bg-surface-sunken shadow-elevation-xl shadow-inner"
        style={{ height: `${height}px` }}
      >
        <PreviewMedia tile={activeTile} />
        {hasLivePreview && !livePreviewAvailable && (
          <div className="pointer-events-none absolute left-4 top-4 inline-flex items-center gap-2 rounded-full border border-status-warning bg-status-warning-soft px-3 py-1 text-scale-2xs font-weight-semibold uppercase tracking-[0.3em] text-status-warning-on shadow-elevation-md">
            Preview offline
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 core-preview-overlay p-4">
          <div className="flex items-center gap-3 text-scale-2xs font-weight-semibold uppercase tracking-[0.3em]">
            <span className="rounded-full core-preview-pill px-3 py-1 text-scale-2xs font-weight-semibold uppercase tracking-[0.35em]">
              {activeTile.kind}
            </span>
            {activeTile.source && (
              <span className="core-preview-overlay-muted">{activeTile.source.replace('ingestion:', '')}</span>
            )}
          </div>
          {(activeTile.title || activeTile.description) && (
            <div className="space-y-1 text-left text-scale-sm">
              {activeTile.title && <h3 className="text-scale-sm font-weight-semibold">{activeTile.title}</h3>}
              {activeTile.description && (
                <p className="text-scale-xs font-weight-medium core-preview-overlay-muted">
                  {activeTile.description}
                </p>
              )}
            </div>
          )}
        </div>
        {supportsFullscreen && activeTile.embedUrl && (
          <button
            type="button"
            aria-label="Open fullscreen preview"
            className="absolute right-4 top-4 inline-flex items-center justify-center rounded-full bg-overlay-scrim p-2 text-inverse shadow-elevation-md transition-opacity hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
                className={`h-2.5 w-2.5 rounded-full border transition-all ${
                  activeIndex === index ? 'core-preview-dot core-preview-dot-active scale-110' : 'core-preview-dot'
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
      className={`${className ?? 'h-4 w-4 text-muted transition-transform'} ${open ? 'rotate-180' : ''}`}
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
      className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-glass text-secondary"
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
      className="h-5 w-5 text-secondary"
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
      className="h-5 w-5 text-secondary"
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
      className="h-5 w-5 text-secondary"
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
      className="h-5 w-5 text-secondary"
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
    <section className="overflow-hidden rounded-2xl border border-subtle bg-surface-glass text-scale-sm shadow-sm">
      <button
        type="button"
        id={triggerId}
        aria-controls={id}
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 bg-surface-muted px-4 py-3 text-left font-weight-semibold text-primary transition-colors hover:bg-surface-glass-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
        className={`${open ? 'block' : 'hidden'} border-t border-subtle bg-surface-glass px-4 py-4 text-secondary`}
      >
        {open ? children : null}
      </div>
    </section>
  );
}

function BuildSummarySection({ build }: { build: AppRecord['latestBuild'] }) {
  if (!build) {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-subtle bg-surface-muted p-4 text-scale-sm text-muted">
        <span className={getStatusBadgeClasses('pending')}>build pending</span>
        <span>Awaiting first build run.</span>
      </div>
    );
  }

  const updatedAt = build.completedAt ?? build.startedAt ?? build.updatedAt;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-subtle bg-surface-muted p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={getStatusBadgeClasses(build.status)}>build {build.status}</span>
        {updatedAt && (
          <time className="text-scale-xs text-muted" dateTime={updatedAt}>
            Updated {new Date(updatedAt).toLocaleString()}
          </time>
        )}
        {build.gitBranch && (
          <code className={`${CODE_PILL_BASE}`}>
            branch: {build.gitBranch}
          </code>
        )}
        {build.gitRef && (
          <code className={`${CODE_PILL_BASE}`}>
            ref: {build.gitRef.length > 18 ? `${build.gitRef.slice(0, 18)}…` : build.gitRef}
          </code>
        )}
        {build.commitSha && (
          <code className={`${CODE_PILL_BASE} tracking-wider`}>
            {build.commitSha.slice(0, 10)}
          </code>
        )}
        {build.imageTag && (
          <code className={`${CODE_PILL_BASE}`}>
            {build.imageTag}
          </code>
        )}
      </div>
      {build.errorMessage && (
        <p className="text-scale-sm font-weight-medium text-status-danger">{build.errorMessage}</p>
      )}
      {build.status === 'pending' && (
        <span className="text-scale-sm text-muted">Waiting for build worker…</span>
      )}
      {build.status === 'running' && (
        <span className="text-scale-sm text-muted">Docker build in progress…</span>
      )}
      {build.logsPreview && (
        <pre className="max-h-40 overflow-auto rounded-xl bg-surface-sunken p-4 text-scale-xs text-primary shadow-inner">
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

  const editingDisabled =
    isLaunching || (launch ? ACTIVE_LAUNCH_STATUSES.has(launch.status) : false);

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
          ? 'flex flex-col gap-3 rounded-2xl border border-subtle bg-surface-glass p-4'
          : 'flex flex-col gap-3 rounded-2xl border border-dashed border-subtle bg-surface-muted p-4 text-muted'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-scale-sm font-weight-semibold text-primary">
            <SectionIcon>
              <LaunchIcon />
            </SectionIcon>
            Launch
          </span>
          <span className={getStatusBadgeClasses(launch ? launch.status : 'pending')}>
            {launch ? `launch ${launch.status}` : 'launch pending'}
          </span>
          {updatedAt && (
            <time className="text-scale-xs text-muted" dateTime={updatedAt}>
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
            <ChevronIcon open={detailsOpen} className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>
      {(launchError || launch?.errorMessage) && (
        <p className="text-scale-sm font-weight-medium text-status-danger">
          {highlightSegments(launchError ?? launch?.errorMessage ?? '', activeTokens, highlightEnabled)}
        </p>
      )}
      {!canLaunch && (
        <p className="text-scale-sm text-muted">Launch requires a successful build.</p>
      )}
      {launch?.status === 'starting' && (
        <p className="text-scale-sm text-muted">Container starting…</p>
      )}
      {launch?.status === 'stopping' && (
        <p className="text-scale-sm text-muted">Stopping container…</p>
      )}
      {launch?.status === 'stopped' && (
        <p className="text-scale-sm text-muted">Last launch has ended.</p>
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
          {isLaunching ? 'Launching…' : 'Launch build'}
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
        className={`${detailsOpen ? 'flex flex-col gap-3' : 'hidden'} text-scale-sm text-secondary`}
      >
        {normalizedInstanceUrl && (
          <div className="flex flex-wrap items-center gap-2 text-accent">
            <span className="font-weight-semibold text-secondary">Preview URL:</span>
            <a className="break-all underline-offset-4 hover:underline" href={normalizedInstanceUrl} target="_blank" rel="noreferrer">
              {normalizedInstanceUrl}
            </a>
          </div>
        )}
        {launch?.resourceProfile && (
          <div className="text-muted">Profile: {launch.resourceProfile}</div>
        )}
        <div className="flex flex-col gap-2 rounded-xl border border-subtle bg-surface-glass p-3">
          <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted">
            Docker Command
          </span>
          <p className="text-scale-sm text-muted">
            Custom Docker commands are temporarily disabled. Launches will use the generated command below.
          </p>
          <pre className="max-h-40 overflow-auto rounded-xl bg-surface-sunken p-4 text-scale-xs text-primary shadow-inner">
            {generatedDefaultCommand}
          </pre>
        </div>
        <div className="flex flex-col gap-2 rounded-xl border border-subtle bg-surface-glass p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted">
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
            <p className="text-scale-sm text-muted">No environment variables configured.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {envRows.map((row) => (
                <div key={row.id} className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="KEY"
                    className={`min-w-[8rem] flex-1 ${TEXT_INPUT_BASE}`}
                    value={row.key}
                    onChange={(event) => handleEnvKeyChange(row.id, event.target.value)}
                    disabled={editingDisabled}
                  />
                  <input
                    type="text"
                    placeholder="value"
                    className={`flex-1 ${TEXT_INPUT_BASE}`}
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
            <p className="text-scale-xs text-muted">
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
    <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-subtle bg-surface-glass p-4">
      <form
        className="flex flex-col gap-3 rounded-2xl border border-subtle bg-surface-muted p-4"
        onSubmit={handleTriggerBuild}
      >
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            className={`w-full max-w-xs ${ROUNDED_INPUT_BASE}`}
            placeholder="Branch (optional)"
            value={branchValue}
            onChange={(event) => setBranchValue(event.target.value)}
            disabled={entry.creating}
          />
          <input
            type="text"
            className={`w-full max-w-xs ${ROUNDED_INPUT_BASE}`}
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
        <p className="text-scale-xs text-muted">
          Leave branch empty to use the default. Provide a git tag or commit SHA to pin the build.
        </p>
        {entry.createError && (
          <div className="rounded-xl border border-status-danger bg-status-danger-soft px-3 py-2 text-scale-xs font-weight-semibold text-status-danger">
            {entry.createError}
          </div>
        )}
      </form>
      {entry.loading && (
        <div className="rounded-xl border border-subtle bg-surface-muted px-4 py-2 text-scale-sm text-secondary">
          <Spinner label="Loading builds…" size="xs" />
        </div>
      )}
      {entry.error && !entry.loading && (
        <div className="rounded-xl border border-status-danger bg-status-danger-soft px-4 py-2 text-scale-sm font-weight-medium text-status-danger">
          {entry.error}
        </div>
      )}
      {!entry.loading && !entry.error && builds.length === 0 && (
        <div className="rounded-xl border border-subtle bg-surface-muted px-4 py-2 text-scale-sm text-secondary">
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
            className="flex flex-col gap-3 rounded-2xl border border-subtle bg-surface-muted p-4"
          >
            <div className="flex flex-wrap items-center gap-3 text-scale-xs">
              <span className={getStatusBadgeClasses(build.status)}>build {build.status}</span>
              {build.gitBranch && (
                <code className={CODE_PILL_BASE}>
                  branch: {build.gitBranch}
                </code>
              )}
              {build.gitRef && (
                <code className={CODE_PILL_BASE}>
                  ref: {build.gitRef.length > 18 ? `${build.gitRef.slice(0, 18)}…` : build.gitRef}
                </code>
              )}
              {build.commitSha && (
                <code className={`${CODE_PILL_BASE} tracking-wider`}>
                  {build.commitSha.slice(0, 10)}
                </code>
              )}
              {completedAt && (
                <time className="text-muted" dateTime={completedAt}>
                  {new Date(completedAt).toLocaleString()}
                </time>
              )}
              {durationLabel && (
                <span className={DURATION_PILL_CLASSES}>
                  {durationLabel}
                </span>
              )}
              {build.imageTag && (
                <code className={CODE_PILL_BASE}>
                  {build.imageTag}
                </code>
              )}
            </div>
            {build.errorMessage && (
              <p className="text-scale-sm font-weight-medium text-status-danger">{build.errorMessage}</p>
            )}
            {build.logsPreview && (
              <pre className="max-h-40 overflow-auto rounded-xl bg-surface-sunken p-4 text-scale-xs text-primary">
                {build.logsPreview}
                {build.logsTruncated ? '\n…' : ''}
              </pre>
            )}
            <div className="flex flex-wrap items-center gap-2 text-scale-xs">
              <button
                type="button"
                className="inline-flex items-center rounded-full border border-subtle px-3 py-1 font-weight-semibold text-secondary transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent-strong"
                onClick={() => onToggleLogs(appId, build.id)}
              >
                {logOpen ? 'Hide logs' : 'View logs'}
              </button>
              <a
                className="inline-flex items-center rounded-full border border-subtle px-3 py-1 font-weight-semibold text-secondary transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent-strong"
                href={downloadUrl}
                target="_blank"
                rel="noreferrer"
              >
                Download logs
              </a>
              {build.status === 'failed' && (
                <button
                  type="button"
                  className="inline-flex items-center rounded-full border border-status-danger px-3 py-1 text-scale-xs font-weight-semibold text-status-danger transition-colors hover:bg-status-danger-soft disabled:opacity-60"
                  disabled={isRetryingBuild}
                  onClick={() => onRetryBuild(appId, build.id)}
                >
                  {isRetryingBuild ? 'Retrying…' : 'Retry build'}
                </button>
              )}
            </div>
            {logOpen && (
              <div className="flex flex-col gap-3 rounded-2xl border border-subtle bg-surface-muted p-4">
                {logLoading && (
                  <div className="text-scale-sm text-muted">
                    <Spinner label="Loading logs…" size="xs" />
                  </div>
                )}
                {logError && !logLoading && (
                  <div className="text-scale-sm font-weight-medium text-status-danger">{logError}</div>
                )}
                {!logLoading && !logError && (
                  <>
                    <div className="flex flex-wrap gap-4 text-scale-xs text-muted">
                      <span>Size {formatBytes(logSize)}</span>
                      {logUpdatedAt && (
                        <time dateTime={logUpdatedAt}>Updated {new Date(logUpdatedAt).toLocaleString()}</time>
                      )}
                    </div>
                    <pre className="max-h-60 overflow-auto rounded-xl bg-surface-sunken p-4 font-mono text-scale-xs leading-5 text-primary shadow-inner">
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
          className="self-start rounded-full border border-subtle px-4 py-2 text-scale-sm font-weight-semibold text-secondary transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
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
    <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-subtle bg-surface-glass p-4">
      {entry.loading && (
        <div className="rounded-xl border border-subtle bg-surface-muted px-4 py-2 text-scale-sm text-secondary">
          <Spinner label="Loading launches…" size="xs" />
        </div>
      )}
      {entry.error && (
        <div className="rounded-xl border border-status-danger bg-status-danger-soft px-4 py-2 text-scale-sm font-weight-medium text-status-danger">
          {entry.error}
        </div>
      )}
      {!entry.loading && !entry.error && launches.length === 0 && (
        <div className="rounded-xl border border-subtle bg-surface-muted px-4 py-2 text-scale-sm text-secondary">
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
                <div className="flex flex-wrap items-center gap-3 text-scale-xs">
                  <span className={getStatusBadgeClasses(launchItem.status)}>{launchItem.status}</span>
                  <time className="text-muted" dateTime={timestamp}>
                    {new Date(timestamp).toLocaleString()}
                  </time>
                  <code className={CODE_PILL_BASE}>
                    {launchItem.buildId ? launchItem.buildId.slice(0, 8) : '—'}
                  </code>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-scale-sm">
                  {normalizedInstanceUrl && (
                    <a
                      href={normalizedInstanceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-accent-soft px-3 py-1 text-scale-xs font-weight-semibold text-accent transition-colors hover:bg-accent-soft"
                    >
                      Open preview
                    </a>
                  )}
                  {launchItem.errorMessage && (
                    <div className="text-scale-sm font-weight-medium text-status-danger">
                      {highlightSegments(launchItem.errorMessage, activeTokens, highlightEnabled)}
                    </div>
                  )}
                  {launchItem.env && launchItem.env.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {launchItem.env.map((entry, index) => (
                        <code
                          key={`${launchItem.id}-env-${entry.key}-${index}`}
                          className={CODE_PILL_BASE}
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
    <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-subtle bg-surface-glass p-4">
      {entry.loading && (
        <div className="rounded-xl border border-subtle bg-surface-muted px-4 py-2 text-scale-sm text-secondary">
          <Spinner label="Loading history…" size="xs" />
        </div>
      )}
      {entry.error && (
        <div className="rounded-xl border border-status-danger bg-status-danger-soft px-4 py-2 text-scale-sm font-weight-medium text-status-danger">
          {entry.error}
        </div>
      )}
      {!entry.loading && !entry.error && events.length === 0 && (
        <div className="rounded-xl border border-subtle bg-surface-muted px-4 py-2 text-scale-sm text-secondary">
          No events recorded yet.
        </div>
      )}
      {events.length > 0 && (
        <ul className="flex flex-col gap-3">
          {events.map((event) => (
            <li key={event.id}>
              <div className="flex flex-wrap items-center gap-3 text-scale-xs">
                <span className={getStatusBadgeClasses(event.status)}>{event.status}</span>
                <time className="text-muted" dateTime={event.createdAt}>
                  {new Date(event.createdAt).toLocaleString()}
                </time>
              </div>
              <div className="mt-2 space-y-2 text-scale-sm text-secondary">
                <div className="font-medium text-primary">
                  {event.message ?? 'No additional message'}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-scale-xs text-muted">
                  {event.attempt !== null && <span>Attempt {event.attempt}</span>}
                  {typeof event.durationMs === 'number' && (
                    <span>{`${Math.max(event.durationMs, 0)} ms`}</span>
                  )}
                  {event.commitSha && (
                    <code className={CODE_PILL_BASE}>
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
    <article className="flex flex-col gap-5 rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-xl transition-colors">
      {showPreview && (
        <ChannelPreview tiles={app.previewTiles ?? []} appName={app.name} launch={app.latestLaunch} />
      )}
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-scale-2xl font-weight-semibold tracking-tight text-primary">
            {highlightSegments(app.name, activeTokens, highlightEnabled)}
          </h2>
          <div className="relative" ref={infoPopoverRef}>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={infoOpen}
              aria-label={infoOpen ? 'Hide build info' : 'Show build info'}
              className="inline-flex items-center justify-center rounded-full border border-subtle bg-surface-glass p-2 text-muted transition-colors hover:border-accent hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={() => setInfoOpen((open) => !open)}
            >
              <InfoIcon />
            </button>
            {infoOpen && (
              <div className="absolute right-0 z-20 mt-2 w-80 rounded-2xl border border-subtle bg-surface-glass p-4 text-left shadow-xl ring-1 ring-subtle">
                <div className="space-y-3 text-scale-sm text-secondary">
                  {hasDescription ? (
                    <p className="leading-6">{highlightSegments(app.description, activeTokens, highlightEnabled)}</p>
                  ) : (
                    <p className="text-scale-sm italic text-muted">No description available.</p>
                  )}
                  <div className="space-y-2">
                    <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted">
                      Tags
                    </span>
                    {hasTags ? (
                      <TagList tags={app.tags} activeTokens={activeTokens} highlightEnabled={highlightEnabled} />
                    ) : (
                      <p className="text-scale-xs text-muted">No tags available.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-scale-xs">
          <span className={getStatusBadgeClasses(app.ingestStatus)}>{app.ingestStatus}</span>
          <time className="text-muted" dateTime={app.updatedAt}>
            Updated {new Date(app.updatedAt).toLocaleDateString()}
          </time>
          <span className={PILL_LABEL_CLASSES}>Attempts {app.ingestAttempts}</span>
        </div>
        {app.relevance && (
          <div className="flex flex-col gap-2 rounded-2xl border border-subtle bg-surface-muted p-4 text-scale-sm text-secondary">
            <div className="flex flex-wrap items-center gap-3 text-scale-sm font-weight-semibold">
              <span>Score {formatScore(app.relevance.score)}</span>
              <span className={`${DURATION_PILL_CLASSES} px-3 text-scale-xs`}>
                Normalized {formatNormalizedScore(app.relevance.normalizedScore)}
              </span>
            </div>
            <div className="flex flex-wrap gap-3 text-scale-xs text-muted">
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
        <p className="rounded-2xl border border-status-danger bg-status-danger-soft p-3 text-scale-sm font-weight-medium text-status-danger">
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
      <div className="flex flex-wrap items-center gap-2 text-scale-sm">
        <a
          className="rounded-full border border-accent-soft px-3 py-1 font-semibold text-accent transition-colors hover:bg-accent-soft"
          href={app.repoUrl}
          target="_blank"
          rel="noreferrer"
        >
          View repository
        </a>
        <code className={`${CODE_PILL_BASE} px-3`}>
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
          <p className="text-scale-sm text-muted">Preparing build history…</p>
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
          <p className="text-scale-sm text-muted">Preparing launch history…</p>
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
          <p className="text-scale-sm text-muted">Preparing ingestion history…</p>
        )}
      </CollapsibleSection>
    </article>
  );
}

export default AppDetailsPanel;

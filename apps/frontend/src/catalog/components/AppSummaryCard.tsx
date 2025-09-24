import { memo, useMemo } from 'react';
import type { AppRecord } from '../types';
import { highlightSegments } from '../utils';

const STATUS_BADGE_BASE =
  'inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em]';

const STATUS_BADGE_VARIANTS: Record<string, string> = {
  seed: 'bg-slate-200 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200',
  pending: 'bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
  processing: 'bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
  ready: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  succeeded: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  failed: 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'
};

const PREVIEW_CONTAINER_CLASSES =
  'relative overflow-hidden rounded-3xl border border-slate-200/60 bg-slate-950/70 shadow-inner dark:border-slate-700/60 dark:bg-slate-900/60';

const PREVIEW_HEIGHT = 180;

function fallbackInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || 'A';
}

type AppSummaryCardProps = {
  app: AppRecord;
  activeTokens: string[];
  highlightEnabled: boolean;
  onOpenDetails: (id: string) => void;
  isActive?: boolean;
};

function AppSummaryCardComponent({ app, activeTokens, highlightEnabled, onOpenDetails, isActive = false }: AppSummaryCardProps) {
  const previewTile = useMemo(
    () => app.previewTiles.find((tile) => Boolean(tile.src || tile.embedUrl)) ?? null,
    [app.previewTiles]
  );

  const statusBadgeClass = `${STATUS_BADGE_BASE} ${STATUS_BADGE_VARIANTS[app.ingestStatus] ?? STATUS_BADGE_VARIANTS.seed}`;
  const updatedAtLabel = app.updatedAt ? new Date(app.updatedAt).toLocaleString() : null;
  const tags = useMemo(() => app.tags.slice(0, 4), [app.tags]);

  const containerClasses = [
    'flex h-full flex-col gap-4 rounded-3xl border bg-white/80 p-4 shadow-[0_20px_50px_-30px_rgba(15,23,42,0.65)] backdrop-blur-md transition-colors dark:bg-slate-900/70',
    'border-slate-200/70 hover:border-violet-300 hover:bg-violet-50/80 dark:border-slate-700/70 dark:hover:border-slate-500'
  ];

  if (isActive) {
    containerClasses.push('border-violet-500 ring-2 ring-violet-500/40');
  }

  return (
    <article className={containerClasses.join(' ')}>
      <div className={`${PREVIEW_CONTAINER_CLASSES}`} style={{ height: `${PREVIEW_HEIGHT}px` }}>
        {previewTile ? (
          previewTile.kind === 'video' && previewTile.src ? (
            <video
              muted
              autoPlay
              loop
              playsInline
              poster={previewTile.posterUrl ?? undefined}
              src={previewTile.src}
              className="h-full w-full object-cover"
            />
          ) : previewTile.kind === 'image' || previewTile.kind === 'gif' ? (
            <img
              src={previewTile.src ?? undefined}
              alt={previewTile.title ?? `${app.name} preview`}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-slate-900/70 text-xs font-semibold uppercase tracking-[0.3em] text-slate-200">
              Preview available in detail
            </div>
          )
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-900/80 text-slate-300">
            <span className="text-4xl font-semibold">{fallbackInitial(app.name)}</span>
            <span className="text-[11px] uppercase tracking-[0.3em]">Preview pending</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            {highlightSegments(app.name, activeTokens, highlightEnabled)}
          </h3>
          <span className={statusBadgeClass}>{app.ingestStatus}</span>
        </div>
        {app.description && (
          <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">{app.description}</p>
        )}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={`${tag.key}:${tag.value}`}
                className="rounded-full bg-slate-200/70 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-700/40 dark:text-slate-200"
              >
                {highlightSegments(`${tag.key}:${tag.value}`, activeTokens, highlightEnabled)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-3 text-xs text-slate-500 dark:text-slate-400">
        {updatedAtLabel && <span>Updated {updatedAtLabel}</span>}
        <button
          type="button"
          onClick={() => onOpenDetails(app.id)}
          className="inline-flex items-center justify-center rounded-full border border-violet-300 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-700 transition-colors hover:bg-violet-500 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-100 dark:hover:bg-slate-200/20"
        >
          Open details
        </button>
      </div>
    </article>
  );
}

const AppSummaryCard = memo(AppSummaryCardComponent);

export default AppSummaryCard;

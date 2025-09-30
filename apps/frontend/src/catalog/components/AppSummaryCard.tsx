import { memo, useMemo } from 'react';
import type { AppRecord } from '../types';
import { highlightSegments } from '../utils';
import { getStatusToneClasses } from '../../theme/statusTokens';

const STATUS_BADGE_BASE =
  'inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-weight-semibold uppercase tracking-[0.25em]';

const PREVIEW_CONTAINER_CLASSES =
  'relative overflow-hidden rounded-3xl border border-subtle bg-surface-sunken-glass shadow-inner';

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

  const statusBadgeClass = `${STATUS_BADGE_BASE} ${getStatusToneClasses(app.ingestStatus)}`;
  const updatedAtLabel = app.updatedAt ? new Date(app.updatedAt).toLocaleString() : null;
  const tags = useMemo(() => app.tags.slice(0, 4), [app.tags]);

  const containerClasses = [
    'flex h-full flex-col gap-4 rounded-3xl border border-subtle bg-surface-glass p-4 shadow-[0_20px_50px_-30px_rgba(15,23,42,0.65)] backdrop-blur-md transition-colors',
    'hover:border-accent-soft hover:bg-accent-soft'
  ];

  if (isActive) {
    containerClasses.push('border-accent ring-2 ring-accent');
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
            <div className="flex h-full w-full items-center justify-center bg-surface-sunken-glass text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-inverse">
              Preview available in detail
            </div>
          )
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-sunken-glass text-secondary">
            <span className="text-4xl font-semibold">{fallbackInitial(app.name)}</span>
            <span className="text-[11px] uppercase tracking-[0.3em]">Preview pending</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-scale-md font-weight-semibold text-primary">
            {highlightSegments(app.name, activeTokens, highlightEnabled)}
          </h3>
          <span className={statusBadgeClass}>{app.ingestStatus}</span>
        </div>
        {app.description && (
          <p className="text-scale-sm text-secondary line-clamp-2">{app.description}</p>
        )}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={`${tag.key}:${tag.value}`}
                className="rounded-full bg-surface-glass px-3 py-1 text-scale-xs font-weight-semibold text-secondary"
              >
                {highlightSegments(`${tag.key}:${tag.value}`, activeTokens, highlightEnabled)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-3 text-scale-xs text-muted">
        {updatedAtLabel && <span>Updated {updatedAtLabel}</span>}
        <button
          type="button"
          onClick={() => onOpenDetails(app.id)}
          className="inline-flex items-center justify-center rounded-full border border-accent-soft bg-accent-soft px-4 py-2 text-scale-sm font-weight-semibold text-accent transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Open details
        </button>
      </div>
    </article>
  );
}

const AppSummaryCard = memo(AppSummaryCardComponent);

export default AppSummaryCard;

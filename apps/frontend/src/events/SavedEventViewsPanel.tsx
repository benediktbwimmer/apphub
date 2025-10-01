import { useMemo, useState } from 'react';
import type { EventSavedViewRecord } from '@apphub/shared/eventsExplorer';
import type { SavedEventViewMutationState } from './useSavedEventViews';

function formatPercentage(value: number): string {
  if (!Number.isFinite(value)) {
    return '0%';
  }
  return `${Math.round(value * 1000) / 10}%`;
}

function formatEventsPerMinute(value: number): string {
  if (!Number.isFinite(value)) {
    return '0.0';
  }
  return (Math.round(value * 10) / 10).toFixed(1);
}

function normalizeDescription(value: string): string {
  return value.trim();
}

type SavedEventViewsPanelProps = {
  savedViews: EventSavedViewRecord[];
  loading: boolean;
  error: string | null;
  mutationState: SavedEventViewMutationState;
  viewerSubject: string | null;
  onCreate: (input: { name: string; description: string | null; visibility: 'private' | 'shared' }) => Promise<void>;
  onApply: (view: EventSavedViewRecord) => Promise<void>;
  onRename: (view: EventSavedViewRecord, nextName: string) => Promise<void>;
  onDelete: (view: EventSavedViewRecord) => Promise<void>;
  onShare: (view: EventSavedViewRecord) => Promise<void>;
  activeSlug: string | null;
};

const PANEL_CONTAINER =
  'flex flex-col gap-4 rounded-3xl border border-subtle bg-surface-glass p-5 shadow-elevation-lg backdrop-blur-md';
const PANEL_HEADING = 'text-scale-sm font-weight-semibold text-primary';
const PANEL_DESCRIPTION = 'text-scale-xs text-muted';
const INPUT_BASE =
  'rounded-xl border border-subtle bg-surface-glass px-3 py-1.5 text-scale-sm text-primary shadow-sm outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted';
const INLINE_ACTION =
  'rounded-md px-2 py-1 text-scale-xs font-weight-medium text-muted transition-colors hover:bg-surface-glass-soft hover:text-secondary disabled:cursor-not-allowed disabled:text-muted';
const DANGER_ACTION =
  'rounded-md px-2 py-1 text-scale-xs font-weight-medium text-status-danger transition-colors hover:bg-status-danger-soft hover:text-status-danger disabled:cursor-not-allowed disabled:text-status-danger';
const BADGE_SHARED =
  'rounded-full bg-surface-glass px-2 py-0.5 text-[10px] font-weight-semibold uppercase tracking-wide text-secondary';
const ANALYTICS_CONTAINER =
  'flex flex-wrap items-center gap-3 rounded-lg bg-surface-glass-soft px-3 py-2 text-scale-xs text-muted shadow-inner';

export function SavedEventViewsPanel({
  savedViews,
  loading,
  error,
  mutationState,
  viewerSubject,
  onCreate,
  onApply,
  onRename,
  onDelete,
  onShare,
  activeSlug
}: SavedEventViewsPanelProps) {
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [shareOnCreate, setShareOnCreate] = useState(false);

  const disableCreate = useMemo(() => mutationState.creating || draftName.trim().length === 0, [mutationState.creating, draftName]);

  const handleCreate = async () => {
    const name = draftName.trim();
    if (!name) {
      return;
    }
    const description = normalizeDescription(draftDescription);
    await onCreate({ name, description: description.length > 0 ? description : null, visibility: shareOnCreate ? 'shared' : 'private' });
    setDraftName('');
    setDraftDescription('');
    setShareOnCreate(false);
  };

  return (
    <section className={PANEL_CONTAINER}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className={PANEL_HEADING}>Saved views</h2>
            <p className={PANEL_DESCRIPTION}>
              Capture event explorer filters and pin the ones your team uses the most.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="Name this view"
            className={`w-48 ${INPUT_BASE}`}
            disabled={mutationState.creating}
          />
          <input
            type="text"
            value={draftDescription}
            onChange={(event) => setDraftDescription(event.target.value)}
            placeholder="Optional description"
            className={`w-60 ${INPUT_BASE}`}
            disabled={mutationState.creating}
          />
          <label className="inline-flex items-center gap-2 text-scale-xs font-weight-medium text-muted">
            <input
              type="checkbox"
              checked={shareOnCreate}
              onChange={(event) => setShareOnCreate(event.target.checked)}
              disabled={mutationState.creating}
              className="h-4 w-4 rounded border border-subtle bg-surface-glass text-accent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed"
            />
            Share across org
          </label>
          <button
            type="button"
            onClick={() => {
              void handleCreate();
            }}
            disabled={disableCreate}
            className="rounded-xl bg-accent px-3 py-1.5 text-scale-sm font-weight-semibold text-on-accent shadow-elevation-md transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-accent-soft disabled:opacity-60"
          >
            {mutationState.creating ? 'Saving…' : 'Save view'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-status-danger bg-status-danger-soft px-3 py-2 text-scale-xs font-weight-medium text-status-danger">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-scale-sm text-muted">Loading saved views…</div>
      ) : savedViews.length === 0 ? (
        <div className="text-scale-sm text-muted">
          You haven’t saved any event explorer views yet. Configure filters above and save them here.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {savedViews.map((view) => {
            const isOwn = viewerSubject ? view.ownerSubject === viewerSubject : true;
            const isApplying = mutationState.applyingSlug === view.slug;
            const isSharing = mutationState.sharingSlug === view.slug;
            const isUpdating = mutationState.updatingSlug === view.slug;
            const isDeleting = mutationState.deletingSlug === view.slug;
            const analytics = view.analytics;
            const active = activeSlug === view.slug;
            const shared = view.visibility === 'shared';

            return (
              <li
                key={view.id}
                className={`flex flex-col gap-2 rounded-xl border border-subtle bg-surface-glass-soft p-3 transition ${
                  active ? 'ring-2 ring-accent' : ''
                }`}
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        void onApply(view);
                      }}
                      disabled={isApplying || isDeleting}
                      className={`max-w-full text-left text-scale-sm font-weight-semibold transition-colors ${
                        active ? 'text-accent' : 'text-secondary hover:text-accent'
                      } disabled:cursor-not-allowed disabled:text-muted`}
                    >
                      {view.name}
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      {isOwn ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              const nextName = window.prompt('Rename saved view', view.name)?.trim();
                              if (!nextName || nextName === view.name) {
                                return;
                              }
                              void onRename(view, nextName);
                            }}
                            disabled={isUpdating || isDeleting}
                            className={INLINE_ACTION}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const confirmed = window.confirm(`Delete saved view “${view.name}”?`);
                              if (!confirmed) {
                                return;
                              }
                              void onDelete(view);
                            }}
                            disabled={isDeleting}
                            className={DANGER_ACTION}
                          >
                            {isDeleting ? 'Deleting…' : 'Delete'}
                          </button>
                          {!shared ? (
                            <button
                              type="button"
                              onClick={() => {
                                void onShare(view);
                              }}
                              disabled={isSharing || isDeleting}
                              className={INLINE_ACTION}
                            >
                              {isSharing ? 'Sharing…' : 'Share'}
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <span className={BADGE_SHARED}>
                          Shared
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-scale-xs text-muted">
                    {view.description ? <span>{view.description}</span> : null}
                    {shared ? <span>Visibility: Shared</span> : <span>Visibility: Private</span>}
                    {!isOwn ? <span>Owner: {view.ownerSubject}</span> : null}
                    <span>Used {view.appliedCount}×</span>
                    <span>Shared {view.sharedCount}×</span>
                  </div>
                </div>
                {analytics ? (
                  <div className={ANALYTICS_CONTAINER}>
                    <span>{formatEventsPerMinute(analytics.eventRatePerMinute)} events/min</span>
                    <span>Error ratio {formatPercentage(analytics.errorRatio)}</span>
                    <span>Total {analytics.totalEvents}</span>
                    {analytics.truncated ? (
                      <span className="text-status-warning">Sampled {analytics.sampledCount} of {analytics.sampleLimit}</span>
                    ) : (
                      <span>Sampled {analytics.sampledCount}</span>
                    )}
                    <span>Updated {new Date(analytics.generatedAt).toLocaleTimeString()}</span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default SavedEventViewsPanel;

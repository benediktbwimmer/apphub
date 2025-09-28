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
    <section className="flex flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white/70 p-5 shadow-[0_25px_60px_-35px_rgba(15,23,42,0.45)] dark:border-slate-700/60 dark:bg-slate-900/70">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Saved views</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
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
            className="w-48 rounded-lg border border-slate-200/80 bg-white px-3 py-1.5 text-sm text-slate-800 shadow-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200/40 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-400 dark:focus:ring-slate-500/30"
            disabled={mutationState.creating}
          />
          <input
            type="text"
            value={draftDescription}
            onChange={(event) => setDraftDescription(event.target.value)}
            placeholder="Optional description"
            className="w-60 rounded-lg border border-slate-200/80 bg-white px-3 py-1.5 text-sm text-slate-800 shadow-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200/40 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-400 dark:focus:ring-slate-500/30"
            disabled={mutationState.creating}
          />
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            <input
              type="checkbox"
              checked={shareOnCreate}
              onChange={(event) => setShareOnCreate(event.target.checked)}
              disabled={mutationState.creating}
              className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500 dark:border-slate-600 dark:bg-slate-800"
            />
            Share across org
          </label>
          <button
            type="button"
            onClick={() => {
              void handleCreate();
            }}
            disabled={disableCreate}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-500/60"
          >
            {mutationState.creating ? 'Saving…' : 'Save view'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200/70 bg-rose-50/70 px-3 py-2 text-xs font-medium text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-slate-500 dark:text-slate-400">Loading saved views…</div>
      ) : savedViews.length === 0 ? (
        <div className="text-sm text-slate-500 dark:text-slate-400">
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
                className={`flex flex-col gap-2 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3 transition dark:border-slate-700/60 dark:bg-slate-800/60 ${
                  active ? 'ring-2 ring-violet-400/60 dark:ring-violet-500/60' : ''
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
                      className={`max-w-full text-left text-sm font-semibold transition-colors ${
                        active
                          ? 'text-violet-700 dark:text-violet-200'
                          : 'text-slate-700 hover:text-violet-600 dark:text-slate-100 dark:hover:text-violet-200'
                      } disabled:cursor-not-allowed disabled:opacity-70`}
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
                            className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-700 disabled:cursor-not-allowed disabled:text-slate-400 dark:text-slate-300 dark:hover:bg-slate-700/70 dark:hover:text-slate-100"
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
                            className="rounded-md px-2 py-1 text-xs font-medium text-rose-500 transition-colors hover:bg-rose-100/60 hover:text-rose-600 disabled:cursor-not-allowed disabled:text-rose-300 dark:text-rose-300 dark:hover:bg-rose-500/10 dark:hover:text-rose-200"
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
                              className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-700 disabled:cursor-not-allowed disabled:text-slate-400 dark:text-slate-300 dark:hover:bg-slate-700/70 dark:hover:text-slate-100"
                            >
                              {isSharing ? 'Sharing…' : 'Share'}
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-700/60 dark:text-slate-300">
                          Shared
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                    {view.description ? <span>{view.description}</span> : null}
                    {shared ? <span>Visibility: Shared</span> : <span>Visibility: Private</span>}
                    {!isOwn ? <span>Owner: {view.ownerSubject}</span> : null}
                    <span>Used {view.appliedCount}×</span>
                    <span>Shared {view.sharedCount}×</span>
                  </div>
                </div>
                {analytics ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg bg-white/60 px-3 py-2 text-xs text-slate-500 shadow-inner dark:bg-slate-900/60 dark:text-slate-400">
                    <span>{formatEventsPerMinute(analytics.eventRatePerMinute)} events/min</span>
                    <span>Error ratio {formatPercentage(analytics.errorRatio)}</span>
                    <span>Total {analytics.totalEvents}</span>
                    {analytics.truncated ? (
                      <span className="text-amber-500">Sampled {analytics.sampledCount} of {analytics.sampleLimit}</span>
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

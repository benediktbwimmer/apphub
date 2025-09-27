import { useState } from 'react';
import type { SavedCatalogSearch } from '../types';
import type { SavedSearchMutationState } from '../hooks/useSavedCatalogSearches';

const STATUS_LABELS: Record<SavedCatalogSearch['statusFilters'][number], string> = {
  seed: 'Seed',
  pending: 'Pending',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed'
};

type SavedSearchManagerProps = {
  savedSearches: SavedCatalogSearch[];
  loading: boolean;
  error: string | null;
  mutationState: SavedSearchMutationState;
  onCreate: (name: string) => Promise<void>;
  onApply: (search: SavedCatalogSearch) => Promise<void>;
  onRename: (search: SavedCatalogSearch, nextName: string) => Promise<void>;
  onDelete: (search: SavedCatalogSearch) => Promise<void>;
  onShare: (search: SavedCatalogSearch) => Promise<void>;
};

function formatStatusFilters(filters: SavedCatalogSearch['statusFilters']): string {
  if (filters.length === 0) {
    return 'Any status';
  }
  return filters.map((filter) => STATUS_LABELS[filter] ?? filter).join(', ');
}

export function SavedSearchManager({
  savedSearches,
  loading,
  error,
  mutationState,
  onCreate,
  onApply,
  onRename,
  onDelete,
  onShare
}: SavedSearchManagerProps) {
  const [newName, setNewName] = useState('');

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      return;
    }
    await onCreate(trimmed);
    setNewName('');
  };

  const disableCreate = mutationState.creating || !newName.trim();

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/70 p-4 dark:border-slate-700/60 dark:bg-slate-900/60">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Saved searches</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Capture frequently used filters and reapply them with a click.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Name this search"
            className="w-40 rounded-lg border border-slate-200/80 bg-white px-3 py-1.5 text-sm text-slate-800 shadow-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200/40 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-400 dark:focus:ring-slate-500/30"
            disabled={mutationState.creating}
          />
          <button
            type="button"
            onClick={() => {
              void handleCreate();
            }}
            disabled={disableCreate}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-500/60"
          >
            {mutationState.creating ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {error && (
        <div className="rounded-lg border border-rose-200/70 bg-rose-50/70 px-3 py-2 text-xs font-medium text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      )}
      {loading ? (
        <div className="text-sm text-slate-500 dark:text-slate-400">Loading saved searches…</div>
      ) : savedSearches.length === 0 ? (
        <div className="text-sm text-slate-500 dark:text-slate-400">
          You haven’t saved any catalog searches yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {savedSearches.map((search) => {
            const isApplying = mutationState.applyingSlug === search.slug;
            const isSharing = mutationState.sharingSlug === search.slug;
            const isUpdating = mutationState.updatingSlug === search.slug;
            const isDeleting = mutationState.deletingSlug === search.slug;

            return (
              <li
                key={search.id}
                className="flex flex-col gap-2 rounded-xl border border-slate-200/70 bg-slate-50/60 p-3 dark:border-slate-700/60 dark:bg-slate-800/60"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => {
                        void onApply(search);
                      }}
                      disabled={isApplying || isDeleting}
                      className="max-w-full text-left text-sm font-semibold text-violet-700 transition-colors hover:text-violet-800 disabled:cursor-not-allowed disabled:text-violet-500/70 dark:text-slate-100 dark:hover:text-slate-50 dark:disabled:text-slate-400"
                    >
                      {search.name}
                    </button>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {formatStatusFilters(search.statusFilters)} · sorted by {search.sort}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const nextName = window.prompt('Rename saved search', search.name)?.trim();
                        if (!nextName || nextName === search.name) {
                          return;
                        }
                        void onRename(search, nextName);
                      }}
                      disabled={isUpdating || isDeleting}
                      className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-700 disabled:cursor-not-allowed disabled:text-slate-400 dark:text-slate-300 dark:hover:bg-slate-700/70 dark:hover:text-slate-100"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void onShare(search);
                      }}
                      disabled={isSharing || isDeleting}
                      className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-700 disabled:cursor-not-allowed disabled:text-slate-400 dark:text-slate-300 dark:hover:bg-slate-700/70 dark:hover:text-slate-100"
                    >
                      {isSharing ? 'Sharing…' : 'Share'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const confirmed = window.confirm(`Delete saved search “${search.name}”?`);
                        if (!confirmed) {
                          return;
                        }
                        void onDelete(search);
                      }}
                      disabled={isDeleting}
                      className="rounded-md px-2 py-1 text-xs font-medium text-rose-500 transition-colors hover:bg-rose-100/60 hover:text-rose-600 disabled:cursor-not-allowed disabled:text-rose-300 dark:text-rose-300 dark:hover:bg-rose-500/10 dark:hover:text-rose-200"
                    >
                      {isDeleting ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
                  <span>Used {search.appliedCount}×</span>
                  <span>Shared {search.sharedCount}×</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default SavedSearchManager;

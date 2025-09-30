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

const PANEL_CLASSES =
  'flex flex-col gap-3 rounded-2xl border border-subtle bg-surface-glass p-4 shadow-elevation-md transition-colors';

const INPUT_CLASSES =
  'w-40 rounded-lg border border-subtle bg-surface-glass px-3 py-1.5 text-scale-sm text-primary shadow-sm outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const PRIMARY_BUTTON_CLASSES =
  'rounded-lg bg-accent px-3 py-1.5 text-scale-sm font-weight-semibold text-on-accent shadow-elevation-md transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60';

const MESSAGE_ERROR_CLASSES =
  'rounded-lg border border-status-danger bg-status-danger-soft px-3 py-2 text-scale-xs font-weight-medium text-status-danger';

const LIST_ITEM_CLASSES = 'flex flex-col gap-2 rounded-2xl border border-subtle bg-surface-muted p-3';

const ACTION_BUTTON_BASE =
  'rounded-md px-2 py-1 text-scale-xs font-weight-medium text-secondary transition-colors hover:bg-accent-soft hover:text-accent-strong disabled:cursor-not-allowed disabled:text-muted';

const DELETE_BUTTON_CLASSES =
  'rounded-md px-2 py-1 text-scale-xs font-weight-medium text-status-danger transition-colors hover:bg-status-danger-soft disabled:cursor-not-allowed disabled:text-status-danger';

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
    <section className={PANEL_CLASSES}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-scale-sm font-weight-semibold text-primary">Saved searches</h3>
          <p className="text-scale-xs text-muted">
            Capture frequently used filters and reapply them with a click.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Name this search"
            className={INPUT_CLASSES}
            disabled={mutationState.creating}
          />
          <button
            type="button"
            onClick={() => {
              void handleCreate();
            }}
            disabled={disableCreate}
            className={PRIMARY_BUTTON_CLASSES}
          >
            {mutationState.creating ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {error && (
        <div className={MESSAGE_ERROR_CLASSES}>
          {error}
        </div>
      )}
      {loading ? (
        <div className="text-scale-sm text-muted">Loading saved searches…</div>
      ) : savedSearches.length === 0 ? (
        <div className="text-scale-sm text-muted">
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
                className={LIST_ITEM_CLASSES}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => {
                        void onApply(search);
                      }}
                      disabled={isApplying || isDeleting}
                      className="max-w-full text-left text-scale-sm font-weight-semibold text-accent transition-colors hover:text-accent-strong disabled:cursor-not-allowed disabled:text-muted"
                    >
                      {search.name}
                    </button>
                    <span className="text-scale-xs text-muted">
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
                      className={ACTION_BUTTON_BASE}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void onShare(search);
                      }}
                      disabled={isSharing || isDeleting}
                      className={ACTION_BUTTON_BASE}
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
                      className={DELETE_BUTTON_CLASSES}
                    >
                      {isDeleting ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-scale-xs text-muted">
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

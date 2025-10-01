import type { KeyboardEventHandler } from 'react';
import type { SavedCoreSearch, SearchMeta, SearchSort, TagSuggestion } from '../types';
import type { SavedSearchMutationState } from '../hooks/useSavedCoreSearches';
import { formatWeight } from '../utils';
import SavedSearchManager from './SavedSearchManager';

const SORT_OPTIONS: { key: SearchSort; label: string }[] = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'updated', label: 'Recently updated' },
  { key: 'name', label: 'Name A→Z' }
];

const SEARCH_PANEL_CLASSES =
  'flex flex-col gap-4 rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-xl backdrop-blur-md transition-colors';

const SEARCH_INPUT_CLASSES =
  'w-full rounded-2xl border border-subtle bg-surface-glass px-4 py-3 text-scale-md text-primary shadow-sm outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const SUGGESTION_LIST_CLASSES =
  'absolute left-0 right-0 top-full z-10 mt-2 max-h-64 overflow-y-auto rounded-2xl border border-subtle bg-surface-glass p-1 shadow-elevation-xl ring-1 ring-subtle';

const SUGGESTION_ITEM_BASE =
  'flex cursor-pointer items-center justify-between gap-4 rounded-xl px-4 py-2 text-scale-sm font-weight-medium text-secondary transition-colors';

const META_PILL_CLASSES =
  'rounded-full bg-surface-glass px-3 py-1 font-mono text-scale-xs uppercase tracking-wider text-secondary';

type SearchSectionProps = {
  inputValue: string;
  onInputChange: (value: string) => void;
  onKeyDown: KeyboardEventHandler<HTMLInputElement>;
  suggestions: TagSuggestion[];
  highlightIndex: number;
  onApplySuggestion: (suggestion: TagSuggestion) => void;
  sortMode: SearchSort;
  onSortChange: (sort: SearchSort) => void;
  showHighlights: boolean;
  onToggleHighlights: (enabled: boolean) => void;
  activeTokens: string[];
  searchMeta: SearchMeta | null;
  savedSearches: SavedCoreSearch[];
  savedSearchesLoading: boolean;
  savedSearchError: string | null;
  savedSearchMutation: SavedSearchMutationState;
  onCreateSavedSearch: (name: string) => Promise<void>;
  onApplySavedSearch: (search: SavedCoreSearch) => Promise<void>;
  onRenameSavedSearch: (search: SavedCoreSearch, name: string) => Promise<void>;
  onDeleteSavedSearch: (search: SavedCoreSearch) => Promise<void>;
  onShareSavedSearch: (search: SavedCoreSearch) => Promise<void>;
};

function SearchSection({
  inputValue,
  onInputChange,
  onKeyDown,
  suggestions,
  highlightIndex,
  onApplySuggestion,
  sortMode,
  onSortChange,
  showHighlights,
  onToggleHighlights,
  activeTokens,
  searchMeta,
  savedSearches,
  savedSearchesLoading,
  savedSearchError,
  savedSearchMutation,
  onCreateSavedSearch,
  onApplySavedSearch,
  onRenameSavedSearch,
  onDeleteSavedSearch,
  onShareSavedSearch
}: SearchSectionProps) {
  const highlightToggleDisabled = activeTokens.length === 0;

  return (
    <section className={SEARCH_PANEL_CLASSES}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-6">
        <div className="relative flex-1">
          <input
            type="text"
            value={inputValue}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type tags like framework:nextjs runtime:node18 or free text"
            spellCheck={false}
            autoFocus
            className={SEARCH_INPUT_CLASSES}
          />
          {suggestions.length > 0 && (
            <ul className={SUGGESTION_LIST_CLASSES}>
              {suggestions.map((suggestion, index) => (
                <li
                  key={`${suggestion.type}-${suggestion.value}`}
                  className={`${SUGGESTION_ITEM_BASE} ${
                    index === highlightIndex
                      ? 'bg-accent-soft text-accent-strong ring-1 ring-accent'
                      : 'hover:bg-accent-soft hover:text-accent-strong'
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onApplySuggestion(suggestion);
                  }}
                >
                  <span className="font-mono text-sm">{suggestion.label}</span>
                  <span className="text-scale-xs uppercase tracking-[0.2em] text-muted">
                    {suggestion.type === 'key' ? 'key' : 'tag'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-3 md:w-auto md:flex-none md:items-end">
          <div className="flex flex-col gap-2 md:items-end">
            <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-muted md:hidden">
              Sort by
            </span>
            <div className="inline-flex items-center gap-1 rounded-full border border-subtle bg-surface-muted p-1">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`rounded-full px-4 py-1.5 text-scale-sm font-weight-semibold transition-colors transition-shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    sortMode === option.key
                      ? 'bg-accent text-on-accent shadow-elevation-md'
                      : 'text-secondary hover:bg-accent-soft hover:text-accent-strong'
                  }`}
                  onClick={() => onSortChange(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <label
          className={`flex items-center gap-3 text-scale-sm font-weight-medium text-secondary transition-opacity ${
            highlightToggleDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
          }`}
        >
          <input
            type="checkbox"
            checked={showHighlights}
            onChange={(event) => onToggleHighlights(event.target.checked)}
            disabled={highlightToggleDisabled}
            className="size-4 rounded border-subtle accent-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed"
          />
          Highlight matches
        </label>
      </div>
      <SavedSearchManager
        savedSearches={savedSearches}
        loading={savedSearchesLoading}
        error={savedSearchError}
        mutationState={savedSearchMutation}
        onCreate={onCreateSavedSearch}
        onApply={onApplySavedSearch}
        onRename={onRenameSavedSearch}
        onDelete={onDeleteSavedSearch}
        onShare={onShareSavedSearch}
      />
      {activeTokens.length > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-subtle bg-surface-muted p-4">
          <div className="flex flex-wrap gap-2">
            {activeTokens.map((token) => (
              <span
                key={token}
                className="inline-flex items-center gap-2 rounded-full border border-accent-soft bg-accent-soft px-3 py-1 text-scale-sm font-weight-medium text-accent"
              >
                {token}
              </span>
            ))}
          </div>
          {searchMeta && (
            <div className="flex flex-wrap gap-2 text-scale-xs text-muted">
              <span className={META_PILL_CLASSES}>
                name × {formatWeight(searchMeta.weights.name)}
              </span>
              <span className={META_PILL_CLASSES}>
                description × {formatWeight(searchMeta.weights.description)}
              </span>
              <span className={META_PILL_CLASSES}>
                tags × {formatWeight(searchMeta.weights.tags)}
              </span>
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 text-scale-xs text-muted">
        <span className="inline-flex items-center justify-center rounded-md bg-surface-glass px-2 py-1 font-mono text-[11px] uppercase tracking-widest text-secondary">
          Tab
        </span>
        accepts highlighted suggestion ·
        <span className="inline-flex items-center justify-center rounded-md bg-surface-glass px-2 py-1 font-mono text-[11px] uppercase tracking-widest text-secondary">
          Esc
        </span>
        clears suggestions
      </div>
    </section>
  );
}

export default SearchSection;

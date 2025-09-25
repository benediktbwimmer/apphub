import type { KeyboardEventHandler } from 'react';
import type { SearchMeta, SearchSort, TagSuggestion } from '../types';
import { formatWeight } from '../utils';

const SORT_OPTIONS: { key: SearchSort; label: string }[] = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'updated', label: 'Recently updated' },
  { key: 'name', label: 'Name A→Z' }
];

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
  searchMeta
}: SearchSectionProps) {
  const highlightToggleDisabled = activeTokens.length === 0;

  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.7)] backdrop-blur-md transition-colors dark:border-slate-700/70 dark:bg-slate-900/70">
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
            className="w-full rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-base text-slate-900 shadow-sm outline-none transition-colors focus:border-violet-500 focus:ring-4 focus:ring-violet-200/40 dark:border-slate-700/70 dark:bg-slate-800/80 dark:text-slate-100 dark:focus:border-slate-400 dark:focus:ring-slate-500/30"
          />
          {suggestions.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-10 mt-2 max-h-64 overflow-y-auto rounded-2xl border border-slate-200/80 bg-white/95 p-1 shadow-xl ring-1 ring-slate-900/5 dark:border-slate-700/70 dark:bg-slate-900/95">
              {suggestions.map((suggestion, index) => (
                <li
                  key={`${suggestion.type}-${suggestion.value}`}
                  className={`flex cursor-pointer items-center justify-between gap-4 rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-violet-500/10 hover:text-violet-700 dark:text-slate-300 dark:hover:bg-slate-200/10 dark:hover:text-slate-100 ${
                    index === highlightIndex ? 'bg-violet-500/10 text-violet-700 dark:bg-slate-600/50 dark:text-slate-100' : ''
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onApplySuggestion(suggestion);
                  }}
                >
                  <span className="font-mono text-sm">{suggestion.label}</span>
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                    {suggestion.type === 'key' ? 'key' : 'tag'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-3 md:w-auto md:flex-none md:items-end">
          <div className="flex flex-col gap-2 md:items-end">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 md:hidden">
              Sort by
            </span>
            <div className="inline-flex items-center gap-1 rounded-full border border-slate-200/70 bg-slate-100/70 p-1 dark:border-slate-700/60 dark:bg-slate-800/60">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors transition-shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
                    sortMode === option.key
                      ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/30 dark:bg-slate-200/20 dark:text-slate-50 dark:shadow-[0_20px_50px_-28px_rgba(15,23,42,0.85)]'
                      : 'text-slate-600 hover:bg-violet-600/10 hover:text-violet-700 dark:text-slate-300 dark:hover:bg-slate-200/10 dark:hover:text-slate-100'
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
          className={`flex items-center gap-3 text-sm font-medium text-slate-600 transition-opacity dark:text-slate-300 ${
            highlightToggleDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
          }`}
        >
          <input
            type="checkbox"
            checked={showHighlights}
            onChange={(event) => onToggleHighlights(event.target.checked)}
            disabled={highlightToggleDisabled}
            className="size-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500 disabled:cursor-not-allowed dark:border-slate-600 dark:bg-slate-800"
          />
          Highlight matches
        </label>
      </div>
      {activeTokens.length > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/60 bg-slate-50/60 p-4 dark:border-slate-700/60 dark:bg-slate-800/60">
          <div className="flex flex-wrap gap-2">
            {activeTokens.map((token) => (
              <span
                key={token}
                className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-500/10 px-3 py-1 text-sm font-medium text-violet-700 dark:border-slate-600/60 dark:bg-slate-800/60 dark:text-slate-100"
              >
                {token}
              </span>
            ))}
          </div>
          {searchMeta && (
            <div className="flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-400">
              <span className="rounded-full bg-slate-200/60 px-3 py-1 font-mono text-xs uppercase tracking-wider dark:bg-slate-700/60">
                name × {formatWeight(searchMeta.weights.name)}
              </span>
              <span className="rounded-full bg-slate-200/60 px-3 py-1 font-mono text-xs uppercase tracking-wider dark:bg-slate-700/60">
                description × {formatWeight(searchMeta.weights.description)}
              </span>
              <span className="rounded-full bg-slate-200/60 px-3 py-1 font-mono text-xs uppercase tracking-wider dark:bg-slate-700/60">
                tags × {formatWeight(searchMeta.weights.tags)}
              </span>
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center justify-center rounded-md bg-slate-200/70 px-2 py-1 font-mono text-[11px] uppercase tracking-widest dark:bg-slate-700/60">
          Tab
        </span>
        accepts highlighted suggestion ·
        <span className="inline-flex items-center justify-center rounded-md bg-slate-200/70 px-2 py-1 font-mono text-[11px] uppercase tracking-widest dark:bg-slate-700/60">
          Esc
        </span>
        clears suggestions
      </div>
    </section>
  );
}

export default SearchSection;

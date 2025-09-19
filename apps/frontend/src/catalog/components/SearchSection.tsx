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
    <section className="search-area">
      <div className="search-box">
        <input
          type="text"
          value={inputValue}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type tags like framework:nextjs runtime:node18 or free text"
          spellCheck={false}
          autoFocus
        />
        {suggestions.length > 0 && (
          <ul className="suggestion-list">
            {suggestions.map((suggestion, index) => (
              <li
                key={`${suggestion.type}-${suggestion.value}`}
                className={index === highlightIndex ? 'active' : ''}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onApplySuggestion(suggestion);
                }}
              >
                <span className="suggestion-label">{suggestion.label}</span>
                <span className="suggestion-type">{suggestion.type === 'key' ? 'key' : 'tag'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="search-controls">
        <div className="sort-controls">
          <span className="controls-label">Sort by</span>
          <div className="sort-options">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`sort-option${sortMode === option.key ? ' active' : ''}`}
                onClick={() => onSortChange(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <label className={`highlight-toggle${highlightToggleDisabled ? ' disabled' : ''}`}>
          <input
            type="checkbox"
            checked={showHighlights}
            onChange={(event) => onToggleHighlights(event.target.checked)}
            disabled={highlightToggleDisabled}
          />
          Highlight matches
        </label>
      </div>
      {activeTokens.length > 0 && (
        <div className="search-meta-row">
          <div className="token-chip-row">
            {activeTokens.map((token) => (
              <span key={token} className="token-chip">
                {token}
              </span>
            ))}
          </div>
          {searchMeta && (
            <div className="weight-chip-row">
              <span className="weight-chip">name × {formatWeight(searchMeta.weights.name)}</span>
              <span className="weight-chip">description × {formatWeight(searchMeta.weights.description)}</span>
              <span className="weight-chip">tags × {formatWeight(searchMeta.weights.tags)}</span>
            </div>
          )}
        </div>
      )}
      <div className="search-hints">
        <span>Tab</span> accepts highlighted suggestion · <span>Esc</span> clears suggestions
      </div>
    </section>
  );
}

export default SearchSection;

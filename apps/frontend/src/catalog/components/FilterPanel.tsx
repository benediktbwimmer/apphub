import type { IngestStatus, StatusFacet, TagFacet } from '../types';

type FilterPanelProps = {
  statusFilters: IngestStatus[];
  statusFacets: StatusFacet[];
  onToggleStatus: (status: IngestStatus) => void;
  onClearStatusFilters: () => void;
  ingestedAfter: string;
  ingestedBefore: string;
  onChangeIngestedAfter: (value: string) => void;
  onChangeIngestedBefore: (value: string) => void;
  onClearDateFilters: () => void;
  tagFacets: TagFacet[];
  ownerFacets: TagFacet[];
  frameworkFacets: TagFacet[];
  appliedTagTokens: string[];
  onApplyFacet: (facet: TagFacet) => void;
};

function renderFacetButtons(
  facets: TagFacet[],
  appliedTokens: string[],
  onApplyFacet: (facet: TagFacet) => void,
  limit: number
) {
  if (facets.length === 0) {
    return null;
  }
  return (
    <div className="facet-tag-row">
      {facets.slice(0, limit).map((facet) => {
        const token = `${facet.key}:${facet.value}`;
        const isActive = appliedTokens.includes(token);
        return (
          <button
            key={token}
            type="button"
            className={`tag-facet${isActive ? ' active' : ''}`}
            onClick={() => onApplyFacet(facet)}
            disabled={isActive}
          >
            <span className="tag-facet-label">{token}</span>
            <span className="tag-facet-count">{facet.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function FilterPanel({
  statusFilters,
  statusFacets,
  onToggleStatus,
  onClearStatusFilters,
  ingestedAfter,
  ingestedBefore,
  onChangeIngestedAfter,
  onChangeIngestedBefore,
  onClearDateFilters,
  tagFacets,
  ownerFacets,
  frameworkFacets,
  appliedTagTokens,
  onApplyFacet
}: FilterPanelProps) {
  return (
    <aside className="filter-panel">
      <div className="filter-group">
        <div className="filter-group-header">
          <span>Ingest Status</span>
          {statusFilters.length > 0 && (
            <button type="button" className="filter-clear" onClick={onClearStatusFilters}>
              Clear
            </button>
          )}
        </div>
        <div className="filter-chip-row">
          {statusFacets.map((facet) => {
            const isActive = statusFilters.includes(facet.status);
            const isDisabled = facet.count === 0 && !isActive;
            return (
              <button
                key={facet.status}
                type="button"
                className={`filter-chip${isActive ? ' active' : ''}`}
                onClick={() => onToggleStatus(facet.status)}
                disabled={isDisabled}
              >
                <span className="filter-chip-label">{facet.status}</span>
                <span className="filter-chip-count">{facet.count}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="filter-group">
        <div className="filter-group-header">
          <span>Ingested Date</span>
          {(ingestedAfter || ingestedBefore) && (
            <button type="button" className="filter-clear" onClick={onClearDateFilters}>
              Clear
            </button>
          )}
        </div>
        <div className="filter-date-row">
          <label>
            From
            <input
              type="date"
              value={ingestedAfter}
              onChange={(event) => onChangeIngestedAfter(event.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={ingestedBefore}
              onChange={(event) => onChangeIngestedBefore(event.target.value)}
            />
          </label>
        </div>
      </div>
      {tagFacets.length > 0 && (
        <div className="filter-group">
          <div className="filter-group-header">
            <span>Popular Tags</span>
          </div>
          {renderFacetButtons(tagFacets, appliedTagTokens, onApplyFacet, 12)}
        </div>
      )}
      {ownerFacets.length > 0 && (
        <div className="filter-group">
          <div className="filter-group-header">
            <span>Top Owners</span>
          </div>
          {renderFacetButtons(ownerFacets, appliedTagTokens, onApplyFacet, 10)}
        </div>
      )}
      {frameworkFacets.length > 0 && (
        <div className="filter-group">
          <div className="filter-group-header">
            <span>Top Frameworks</span>
          </div>
          {renderFacetButtons(frameworkFacets, appliedTagTokens, onApplyFacet, 10)}
        </div>
      )}
    </aside>
  );
}

export default FilterPanel;

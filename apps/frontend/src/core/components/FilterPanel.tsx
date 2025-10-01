import { getStatusToneClasses } from '../../theme/statusTokens';
import type { IngestStatus, StatusFacet, TagFacet } from '../types';

const PANEL_CLASSES =
  'flex flex-col gap-6 rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-xl backdrop-blur-md transition-colors';

const FACET_BUTTON_BASE =
  'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-scale-sm font-weight-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const FACET_BUTTON_ACTIVE = 'border-accent bg-accent text-on-accent shadow-elevation-md';

const FACET_BUTTON_INACTIVE =
  'border-subtle bg-surface-glass text-secondary hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong';

const FACET_COUNT_PILL_CLASSES =
  'rounded-full bg-surface-glass px-2 py-0.5 text-[11px] font-weight-semibold text-muted';

const STATUS_FILTER_BUTTON_BASE =
  'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-scale-sm font-weight-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';

const STATUS_FILTER_INACTIVE =
  'border-subtle bg-surface-glass text-secondary hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong';

type FilterPanelProps = {
  statusFilters: IngestStatus[];
  statusFacets: StatusFacet[];
  onToggleStatus: (status: IngestStatus) => void;
  onClearStatusFilters: () => void;
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
    <div className="flex flex-wrap gap-2">
      {facets.slice(0, limit).map((facet) => {
        const token = `${facet.key}:${facet.value}`;
        const isActive = appliedTokens.includes(token);
        return (
          <button
            key={token}
            type="button"
            className={`${FACET_BUTTON_BASE} ${isActive ? FACET_BUTTON_ACTIVE : FACET_BUTTON_INACTIVE}`}
            onClick={() => onApplyFacet(facet)}
            disabled={isActive}
          >
            <span className="font-mono text-scale-xs uppercase tracking-widest">{token}</span>
            <span className={FACET_COUNT_PILL_CLASSES}>{facet.count}</span>
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
  tagFacets,
  ownerFacets,
  frameworkFacets,
  appliedTagTokens,
  onApplyFacet
}: FilterPanelProps) {
  return (
    <aside className={PANEL_CLASSES}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-scale-sm font-weight-semibold text-primary">
          <span className="uppercase tracking-[0.2em] text-scale-xs text-muted">Ingest Status</span>
          {statusFilters.length > 0 && (
            <button
              type="button"
              className="rounded-full px-3 py-1 text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-accent transition-colors hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={onClearStatusFilters}
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {statusFacets.map((facet) => {
            const isActive = statusFilters.includes(facet.status);
            const isDisabled = facet.count === 0 && !isActive;
            return (
              <button
                key={facet.status}
                type="button"
                className={`${STATUS_FILTER_BUTTON_BASE} ${
                  isActive
                    ? `${getStatusToneClasses(facet.status)} shadow-elevation-md`
                    : STATUS_FILTER_INACTIVE
                }`}
                onClick={() => onToggleStatus(facet.status)}
                disabled={isDisabled}
              >
                <span className="capitalize">{facet.status}</span>
                <span className={FACET_COUNT_PILL_CLASSES}>{facet.count}</span>
              </button>
            );
          })}
        </div>
      </div>
      {tagFacets.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-muted">
            Popular Tags
          </div>
          {renderFacetButtons(tagFacets, appliedTagTokens, onApplyFacet, 12)}
        </div>
      )}
      {ownerFacets.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-muted">
            Top Owners
          </div>
          {renderFacetButtons(ownerFacets, appliedTagTokens, onApplyFacet, 10)}
        </div>
      )}
      {frameworkFacets.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-muted">
            Top Frameworks
          </div>
          {renderFacetButtons(frameworkFacets, appliedTagTokens, onApplyFacet, 10)}
        </div>
      )}
    </aside>
  );
}

export default FilterPanel;

import type { IngestStatus, StatusFacet, TagFacet } from '../types';

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
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              isActive
                ? 'border-violet-500 bg-violet-600 text-white shadow-lg shadow-violet-500/30 dark:bg-slate-200/20 dark:text-slate-50'
                : 'border-slate-200/70 bg-slate-100/60 text-slate-600 hover:border-violet-300 hover:bg-violet-500/10 hover:text-violet-700 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-200/10 dark:hover:text-slate-100'
            }`}
            onClick={() => onApplyFacet(facet)}
            disabled={isActive}
          >
            <span className="font-mono text-xs uppercase tracking-widest">{token}</span>
            <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-900/60 dark:text-slate-300">
              {facet.count}
            </span>
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
    <aside className="flex flex-col gap-6 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md transition-colors dark:border-slate-700/70 dark:bg-slate-900/70">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-200">
          <span className="uppercase tracking-[0.2em] text-xs text-slate-500 dark:text-slate-400">Ingest Status</span>
          {statusFilters.length > 0 && (
            <button
              type="button"
              className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-violet-600 transition-colors hover:bg-violet-500/10 dark:text-slate-200 dark:hover:bg-slate-200/10"
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
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  isActive
                    ? 'border-violet-500 bg-violet-600 text-white shadow-lg shadow-violet-500/30 dark:bg-slate-200/20 dark:text-slate-50'
                    : 'border-slate-200/70 bg-white/70 text-slate-600 hover:border-violet-300 hover:bg-violet-500/10 hover:text-violet-700 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-200/10 dark:hover:text-slate-100'
                }`}
                onClick={() => onToggleStatus(facet.status)}
                disabled={isDisabled}
              >
                <span className="capitalize">{facet.status}</span>
                <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-700/60 dark:text-slate-300">
                  {facet.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {tagFacets.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Popular Tags
          </div>
          {renderFacetButtons(tagFacets, appliedTagTokens, onApplyFacet, 12)}
        </div>
      )}
      {ownerFacets.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Top Owners
          </div>
          {renderFacetButtons(ownerFacets, appliedTagTokens, onApplyFacet, 10)}
        </div>
      )}
      {frameworkFacets.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Top Frameworks
          </div>
          {renderFacetButtons(frameworkFacets, appliedTagTokens, onApplyFacet, 10)}
        </div>
      )}
    </aside>
  );
}

export default FilterPanel;

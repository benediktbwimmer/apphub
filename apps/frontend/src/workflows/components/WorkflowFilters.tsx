import type { WorkflowFiltersState } from '../types';

export type FilterOption = {
  value: string;
  label: string;
  count: number;
};

type WorkflowFiltersProps = {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  activeFilters: WorkflowFiltersState;
  onChange: (next: WorkflowFiltersState) => void;
  statusOptions: FilterOption[];
  repoOptions: FilterOption[];
  serviceOptions: FilterOption[];
  tagOptions: FilterOption[];
  onReset: () => void;
};

function toggleValue(values: string[], value: string): string[] {
  if (values.includes(value)) {
    return values.filter((entry) => entry !== value);
  }
  return [...values, value];
}

function renderOption(
  option: FilterOption,
  isActive: boolean,
  onToggle: (value: string) => void
) {
  return (
    <button
      key={option.value}
      type="button"
      onClick={() => onToggle(option.value)}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
        isActive
          ? 'border-violet-500 bg-violet-500/10 text-violet-600 dark:border-slate-300 dark:text-slate-100'
          : 'border-slate-200/70 bg-white/60 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300'
      }`}
    >
      <span>{option.label}</span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:bg-slate-800 dark:text-slate-300">
        {option.count}
      </span>
    </button>
  );
}

export function WorkflowFilters({
  searchTerm,
  onSearchTermChange,
  activeFilters,
  onChange,
  statusOptions,
  repoOptions,
  serviceOptions,
  tagOptions,
  onReset
}: WorkflowFiltersProps) {
  const { statuses, repos, services, tags } = activeFilters;

  const handleStatuses = (value: string) => {
    onChange({ ...activeFilters, statuses: toggleValue(statuses, value) });
  };
  const handleRepos = (value: string) => {
    onChange({ ...activeFilters, repos: toggleValue(repos, value) });
  };
  const handleServices = (value: string) => {
    onChange({ ...activeFilters, services: toggleValue(services, value) });
  };
  const handleTags = (value: string) => {
    onChange({ ...activeFilters, tags: toggleValue(tags, value) });
  };

  const showClear = statuses.length > 0 || repos.length > 0 || services.length > 0 || tags.length > 0;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={searchTerm}
          onChange={(event) => onSearchTermChange(event.target.value)}
          placeholder="Search workflows by name, slug, or description"
          className="flex-1 min-w-[220px] rounded-full border border-slate-200/70 bg-white/80 px-4 py-2 text-sm text-slate-700 shadow-sm transition-colors focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:focus:border-slate-300 dark:focus:ring-slate-500/40"
          aria-label="Search workflows"
        />
        {showClear && (
          <button
            type="button"
            className="inline-flex items-center rounded-full border border-slate-200/70 bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            onClick={onReset}
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Status
          </h3>
          <div className="flex flex-wrap gap-2">
            {statusOptions.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">No status data yet.</p>}
            {statusOptions.map((option) => renderOption(option, statuses.includes(option.value), handleStatuses))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Repository
          </h3>
          <div className="flex flex-wrap gap-2">
            {repoOptions.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">No repository metadata.</p>}
            {repoOptions.map((option) => renderOption(option, repos.includes(option.value), handleRepos))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Service
          </h3>
          <div className="flex flex-wrap gap-2">
            {serviceOptions.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">No service dependencies.</p>}
            {serviceOptions.map((option) => renderOption(option, services.includes(option.value), handleServices))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Tags
          </h3>
          <div className="flex flex-wrap gap-2">
            {tagOptions.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">No tags annotated.</p>}
            {tagOptions.map((option) => renderOption(option, tags.includes(option.value), handleTags))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default WorkflowFilters;

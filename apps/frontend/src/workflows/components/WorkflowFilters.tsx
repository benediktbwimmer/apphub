import classNames from 'classnames';
import type { WorkflowFiltersState } from '../types';

export type FilterOption = {
  value: string;
  label: string;
  count: number;
};

const SECTION_TITLE_CLASSES = 'text-scale-xs font-weight-semibold uppercase tracking-[0.24em] text-muted';

const SECTION_EMPTY_TEXT_CLASSES = 'text-scale-xs text-muted';

const FILTER_OPTION_BASE_CLASSES =
  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-scale-xs font-weight-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const FILTER_OPTION_ACTIVE_CLASSES = 'border-accent bg-accent-soft text-accent-strong';

const FILTER_OPTION_INACTIVE_CLASSES =
  'border-subtle bg-surface-glass text-secondary hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong';

const FILTER_OPTION_COUNT_BADGE_CLASSES =
  'rounded-full bg-surface-sunken px-2 py-[2px] text-[10px] font-weight-semibold uppercase tracking-[0.3em] text-muted';

const SEARCH_FIELD_CLASSES =
  'min-w-[220px] flex-1 rounded-full border border-subtle bg-surface-glass px-4 py-2 text-scale-sm text-primary shadow-elevation-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const CLEAR_BUTTON_CLASSES =
  'inline-flex items-center rounded-full border border-subtle bg-surface-glass px-3 py-1.5 text-scale-xs font-weight-semibold text-secondary transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

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
  const optionClasses = classNames(
    FILTER_OPTION_BASE_CLASSES,
    isActive ? FILTER_OPTION_ACTIVE_CLASSES : FILTER_OPTION_INACTIVE_CLASSES
  );

  return (
    <button
      key={option.value}
      type="button"
      onClick={() => onToggle(option.value)}
      className={optionClasses}
    >
      <span>{option.label}</span>
      <span className={FILTER_OPTION_COUNT_BADGE_CLASSES}>
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
          className={SEARCH_FIELD_CLASSES}
          aria-label="Search workflows"
        />
        {showClear && (
          <button
            type="button"
            className={CLEAR_BUTTON_CLASSES}
            onClick={onReset}
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-2">
          <h3 className={SECTION_TITLE_CLASSES}>
            Status
          </h3>
          <div className="flex flex-wrap gap-2">
            {statusOptions.length === 0 && <p className={SECTION_EMPTY_TEXT_CLASSES}>No status data yet.</p>}
            {statusOptions.map((option) => renderOption(option, statuses.includes(option.value), handleStatuses))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className={SECTION_TITLE_CLASSES}>
            Repository
          </h3>
          <div className="flex flex-wrap gap-2">
            {repoOptions.length === 0 && <p className={SECTION_EMPTY_TEXT_CLASSES}>No repository metadata.</p>}
            {repoOptions.map((option) => renderOption(option, repos.includes(option.value), handleRepos))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className={SECTION_TITLE_CLASSES}>
            Service
          </h3>
          <div className="flex flex-wrap gap-2">
            {serviceOptions.length === 0 && <p className={SECTION_EMPTY_TEXT_CLASSES}>No service dependencies.</p>}
            {serviceOptions.map((option) => renderOption(option, services.includes(option.value), handleServices))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className={SECTION_TITLE_CLASSES}>
            Tags
          </h3>
          <div className="flex flex-wrap gap-2">
            {tagOptions.length === 0 && <p className={SECTION_EMPTY_TEXT_CLASSES}>No tags annotated.</p>}
            {tagOptions.map((option) => renderOption(option, tags.includes(option.value), handleTags))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default WorkflowFilters;

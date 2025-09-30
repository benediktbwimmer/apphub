import { Spinner } from '../../components';
import type { JobDefinitionSummary } from '../../workflows/api';

const PANEL_CLASSES =
  'rounded-2xl border border-subtle bg-surface-glass p-4 shadow-elevation-md transition-colors';

const INPUT_CLASSES =
  'w-full rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const FILTER_BUTTON_BASE =
  'rounded-full border px-3 py-1.5 text-scale-xs font-weight-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const FILTER_BUTTON_ACTIVE = 'border-accent bg-accent text-on-accent shadow-elevation-md';

const FILTER_BUTTON_INACTIVE =
  'border-subtle bg-surface-glass text-secondary hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong';

const JOB_COUNT_TEXT = 'text-scale-xs text-muted';

const JOB_BUTTON_BASE =
  'w-full rounded-xl border border-transparent px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const JOB_BUTTON_ACTIVE = 'border-accent bg-accent text-on-accent shadow-elevation-md';

const JOB_BUTTON_INACTIVE = 'hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong text-secondary';

type RuntimeKey = 'all' | 'node' | 'python' | 'docker';

type JobsSidebarProps = {
  jobs: JobDefinitionSummary[];
  filteredJobs: JobDefinitionSummary[];
  selectedSlug: string | null;
  jobsLoading: boolean;
  jobsError: string | null;
  jobSearch: string;
  onJobSearchChange: (value: string) => void;
  runtimeFilter: RuntimeKey;
  runtimeOptions: Array<{ key: RuntimeKey; label: string }>;
  onRuntimeFilterChange: (value: RuntimeKey) => void;
  onSelectJob: (slug: string) => void;
};

export function JobsSidebar({
  jobs,
  filteredJobs,
  selectedSlug,
  jobsLoading,
  jobsError,
  jobSearch,
  onJobSearchChange,
  runtimeFilter,
  runtimeOptions,
  onRuntimeFilterChange,
  onSelectJob
}: JobsSidebarProps) {
  return (
    <aside className="lg:w-72">
      <div className={PANEL_CLASSES}>
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-scale-sm font-weight-semibold text-primary">Job catalog</h2>
            {jobsLoading && (
              <Spinner
                label="Loading jobs…"
                size="xs"
                className="text-scale-xs text-muted"
              />
            )}
          </div>
          {jobsError && (
            <p className="text-scale-xs text-status-danger">{jobsError}</p>
          )}
          <input
            type="search"
            value={jobSearch}
            onChange={(event) => onJobSearchChange(event.target.value)}
            placeholder="Filter by name or slug"
            className={INPUT_CLASSES}
          />
          <div className="flex flex-wrap gap-2">
            {runtimeOptions.map((option) => {
              const active = runtimeFilter === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  className={`${FILTER_BUTTON_BASE} ${active ? FILTER_BUTTON_ACTIVE : FILTER_BUTTON_INACTIVE}`}
                  onClick={() => onRuntimeFilterChange(option.key)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div className={JOB_COUNT_TEXT}>
            Showing {filteredJobs.length} of {jobs.length} jobs
          </div>
        </div>
        <ul className="flex max-h-[28rem] flex-col gap-1 overflow-y-auto pr-2 text-sm">
          {filteredJobs.map((job) => {
            const isActive = job.slug === selectedSlug;
            return (
              <li key={job.id}>
                <button
                  type="button"
                  onClick={() => onSelectJob(job.slug)}
                  className={`${JOB_BUTTON_BASE} ${isActive ? JOB_BUTTON_ACTIVE : JOB_BUTTON_INACTIVE}`}
                >
                  <div className="font-weight-semibold text-primary">{job.name}</div>
                  <div className="text-scale-xs text-muted">{job.slug}</div>
                </button>
              </li>
            );
          })}
          {filteredJobs.length === 0 && !jobsLoading && !jobsError && (
            <li className="rounded-xl border border-dashed border-subtle bg-surface-muted px-3 py-6 text-center text-scale-xs text-muted">
              {jobs.length === 0 ? 'No jobs registered yet.' : 'No jobs match your filters.'}
            </li>
          )}
        </ul>
      </div>
    </aside>
  );
}

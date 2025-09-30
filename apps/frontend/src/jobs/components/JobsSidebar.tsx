import { Spinner } from '../../components';
import type { JobDefinitionSummary } from '../../workflows/api';

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
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Job catalog</h2>
            {jobsLoading && (
              <Spinner
                label="Loading jobs…"
                size="xs"
                className="text-xs text-slate-500 dark:text-slate-400"
              />
            )}
          </div>
          {jobsError && (
            <p className="text-xs text-red-600 dark:text-red-400">{jobsError}</p>
          )}
          <input
            type="search"
            value={jobSearch}
            onChange={(event) => onJobSearchChange(event.target.value)}
            placeholder="Filter by name or slug"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-slate-500 dark:focus:ring-slate-500/30"
          />
          <div className="flex flex-wrap gap-2">
            {runtimeOptions.map((option) => {
              const active = runtimeFilter === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
                    active
                      ? 'border-violet-500 bg-violet-600 text-white shadow-sm dark:border-violet-400 dark:bg-violet-500'
                      : 'border-slate-200 bg-slate-100 text-slate-600 hover:border-violet-300 hover:bg-violet-500/10 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                  onClick={() => onRuntimeFilterChange(option.key)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
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
                  className={`w-full rounded-xl px-3 py-2 text-left transition-colors ${isActive ? 'bg-violet-100 text-violet-900 dark:bg-violet-600/20 dark:text-violet-200' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                >
                  <div className="font-semibold">{job.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{job.slug}</div>
                </button>
              </li>
            );
          })}
          {filteredJobs.length === 0 && !jobsLoading && !jobsError && (
            <li className="rounded-xl bg-slate-50 px-3 py-6 text-center text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {jobs.length === 0 ? 'No jobs registered yet.' : 'No jobs match your filters.'}
            </li>
          )}
        </ul>
      </div>
    </aside>
  );
}

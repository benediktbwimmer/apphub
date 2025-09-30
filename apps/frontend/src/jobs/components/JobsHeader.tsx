import { Spinner } from '../../components';
import type { JobRuntimeStatus } from '../api';

type JobsHeaderProps = {
  runtimeStatuses: JobRuntimeStatus[];
  runtimeStatusLoading: boolean;
  runtimeStatusError: string | null;
  pythonReady: boolean;
  pythonButtonTitle?: string;
  onCreateNode: () => void;
  onCreatePython: () => void;
};

export function JobsHeader({
  runtimeStatuses,
  runtimeStatusLoading,
  runtimeStatusError,
  pythonReady,
  pythonButtonTitle,
  onCreateNode,
  onCreatePython
}: JobsHeaderProps) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Jobs</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Inspect job definitions, review recent runs, and manage bundle source code.
        </p>
      </div>
      <div className="flex flex-col items-start gap-3 lg:items-end">
        <div className="flex flex-wrap gap-2">
          {runtimeStatusLoading ? (
            <Spinner
              label="Checking runtimes…"
              size="xs"
              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            />
          ) : runtimeStatuses.length > 0 ? (
            runtimeStatuses.map((status) => {
              const label =
                status.runtime === 'python'
                  ? 'Python runtime'
                  : status.runtime === 'docker'
                    ? 'Docker runtime'
                    : 'Node runtime';
              const badgeClass = status.ready
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200'
                : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200';
              const details = status.details as Record<string, unknown> | null;
              const version = details && typeof details.version === 'string' ? details.version : null;
              const tooltip = status.ready ? (version ? `Version ${version}` : 'Ready') : status.reason ?? 'Unavailable';
              return (
                <span
                  key={status.runtime}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClass}`}
                  title={tooltip}
                >
                  {label}: {status.ready ? 'Ready' : 'Unavailable'}
                </span>
              );
            })
          ) : (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Runtime readiness unknown
            </span>
          )}
        </div>
        {runtimeStatusError && (
          <p className="text-[11px] text-rose-600 dark:text-rose-300">{runtimeStatusError}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-full border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={onCreateNode}
          >
            New Node job
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={onCreatePython}
            disabled={!pythonReady}
            title={pythonButtonTitle}
          >
            New Python job
          </button>
        </div>
      </div>
    </header>
  );
}

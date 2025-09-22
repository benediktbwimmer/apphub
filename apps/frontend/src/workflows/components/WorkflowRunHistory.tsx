import { formatDuration, formatTimestamp } from '../formatters';
import StatusBadge from './StatusBadge';
import type { WorkflowDefinition, WorkflowRun, WorkflowRuntimeSummary } from '../types';

type WorkflowRunHistoryProps = {
  workflow: WorkflowDefinition | null;
  runs: WorkflowRun[];
  loading: boolean;
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  runtimeSummary?: WorkflowRuntimeSummary;
  onRefresh?: () => void;
};

export default function WorkflowRunHistory({
  workflow,
  runs,
  loading,
  selectedRunId,
  onSelectRun,
  runtimeSummary,
  onRefresh
}: WorkflowRunHistoryProps) {
  return (
    <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Run History</h2>
          {workflow && runtimeSummary && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Latest run started {formatTimestamp(runtimeSummary.startedAt ?? null)}
            </p>
          )}
        </div>
        {workflow && onRefresh && (
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200/60 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            onClick={onRefresh}
          >
            Refresh runs
          </button>
        )}
      </div>
      {loading && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Loading runs…</p>}
      {!loading && runs.length === 0 && (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">No runs yet.</p>
      )}
      {!loading && runs.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
            <thead className="bg-slate-50/80 dark:bg-slate-800/80">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Started
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Completed
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Duration
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Current Step
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Triggered By
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {runs.map((run) => {
                const isActive = run.id === selectedRunId;
                return (
                  <tr
                    key={run.id}
                    className={`cursor-pointer transition-colors ${
                      isActive ? 'bg-violet-500/5 dark:bg-violet-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                    }`}
                    onClick={() => onSelectRun(run.id)}
                  >
                    <td className="px-4 py-3 text-sm">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {formatTimestamp(run.startedAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {formatTimestamp(run.completedAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {formatDuration(run.durationMs)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {run.currentStepId ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {run.triggeredBy ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

import type { JobDetailResponse } from '../api';
import { formatDate } from '../utils';

type JobRunsPanelProps = {
  detail: JobDetailResponse;
};

export function JobRunsPanel({ detail }: JobRunsPanelProps) {
  const runs = detail.runs.slice(0, 8);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Recent runs</h3>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Showing {runs.length} of {detail.runs.length}
        </span>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">Run ID</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Started</th>
              <th className="px-3 py-2 text-left">Completed</th>
              <th className="px-3 py-2 text-left">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {runs.map((run) => {
              const started = run.startedAt ? new Date(run.startedAt).getTime() : null;
              const completed = run.completedAt ? new Date(run.completedAt).getTime() : null;
              const durationMs = started && completed ? completed - started : null;
              return (
                <tr key={run.id} className="bg-white dark:bg-slate-900">
                  <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{run.id}</td>
                  <td className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    {run.status}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{formatDate(run.startedAt)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{formatDate(run.completedAt)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                    {durationMs !== null ? `${Math.round(durationMs / 1000)}s` : '—'}
                  </td>
                </tr>
              );
            })}
            {runs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-xs text-slate-500 dark:text-slate-400">
                  No runs recorded for this job yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

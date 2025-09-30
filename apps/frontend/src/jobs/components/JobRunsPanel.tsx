import type { JobDetailResponse } from '../api';
import { formatDate } from '../utils';
import { getStatusToneClasses } from '../../theme/statusTokens';

const PANEL_CLASSES =
  'rounded-2xl border border-subtle bg-surface-glass p-6 shadow-elevation-md transition-colors';

const TABLE_HEAD_CLASSES =
  'bg-surface-muted text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-muted';

const TABLE_CELL_BASE = 'px-3 py-2 text-scale-xs text-secondary';

const BADGE_BASE =
  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-scale-xs font-weight-semibold uppercase tracking-[0.25em]';

function buildStatusBadge(status: string): string {
  return `${BADGE_BASE} ${getStatusToneClasses(status)}`;
}

type JobRunsPanelProps = {
  detail: JobDetailResponse;
};

export function JobRunsPanel({ detail }: JobRunsPanelProps) {
  const runs = detail.runs.slice(0, 8);
  return (
    <div className={PANEL_CLASSES}>
      <div className="flex items-center justify-between">
        <h3 className="text-scale-lg font-weight-semibold text-primary">Recent runs</h3>
        <span className="text-scale-xs text-muted">
          Showing {runs.length} of {detail.runs.length}
        </span>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full divide-y divide-subtle text-scale-sm">
          <thead className={TABLE_HEAD_CLASSES}>
            <tr>
              <th className="px-3 py-2 text-left">Run ID</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Started</th>
              <th className="px-3 py-2 text-left">Completed</th>
              <th className="px-3 py-2 text-left">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {runs.map((run) => {
              const started = run.startedAt ? new Date(run.startedAt).getTime() : null;
              const completed = run.completedAt ? new Date(run.completedAt).getTime() : null;
              const durationMs = started && completed ? completed - started : null;
              return (
                <tr key={run.id} className="bg-surface-glass">
                  <td className={`${TABLE_CELL_BASE} font-mono text-muted`}>{run.id}</td>
                  <td className={`${TABLE_CELL_BASE}`}>
                    <span className={buildStatusBadge(run.status)}>{run.status}</span>
                  </td>
                  <td className={TABLE_CELL_BASE}>{formatDate(run.startedAt)}</td>
                  <td className={TABLE_CELL_BASE}>{formatDate(run.completedAt)}</td>
                  <td className={TABLE_CELL_BASE}>
                    {durationMs !== null ? `${Math.round(durationMs / 1000)}s` : '—'}
                  </td>
                </tr>
              );
            })}
            {runs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-scale-xs text-muted">
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

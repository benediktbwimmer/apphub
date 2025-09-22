import type { WorkflowRunStatsSummary } from '../types';

type RunOutcomeChartProps = {
  stats: WorkflowRunStatsSummary | null;
  selectedOutcomes: string[];
  onChange: (next: string[]) => void;
};

function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) {
    return '—';
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  const minutes = seconds / 60;
  if (minutes < 60) {
    return `${minutes.toFixed(1)} min`;
  }
  const hours = minutes / 60;
  return `${hours.toFixed(1)} h`;
}

export default function RunOutcomeChart({ stats, selectedOutcomes, onChange }: RunOutcomeChartProps) {
  if (!stats) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/20 dark:text-slate-400">
        <span>No analytics available yet.</span>
        <span>Trigger runs to populate outcome insights.</span>
      </div>
    );
  }

  const statuses = Object.entries(stats.statusCounts)
    .map(([status, count]) => ({ status, count: Number(count ?? 0) }))
    .sort((a, b) => b.count - a.count);
  const maxCount = statuses.reduce((max, entry) => (entry.count > max ? entry.count : max), 0) || 1;
  const normalizedSelection = selectedOutcomes.length > 0 ? selectedOutcomes.map((status) => status.toLowerCase()) : [];
  const selectedSet = new Set(normalizedSelection);

  const toggleOutcome = (status: string) => {
    const normalized = status.toLowerCase();
    const next = new Set(selectedSet);
    if (next.has(normalized)) {
      next.delete(normalized);
    } else {
      next.add(normalized);
    }
    onChange(Array.from(next));
  };

  const renderedStatuses = statuses.map(({ status, count }) => {
    const normalized = status.toLowerCase();
    const isSelected = selectedSet.size === 0 || selectedSet.has(normalized);
    const width = Math.max(4, Math.round((count / maxCount) * 100));
    return (
      <label
        key={status}
        className="flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-2 py-1 transition hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-800/40"
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => toggleOutcome(status)}
          className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600"
        />
        <div className="flex-1">
          <div className="flex items-baseline justify-between text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <span>{status}</span>
            <span>{count}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className={`h-full rounded-full ${isSelected ? 'bg-indigo-500 dark:bg-indigo-400' : 'bg-slate-400/70 dark:bg-slate-500/60'}`}
              style={{ width: `${width}%` }}
            />
          </div>
        </div>
      </label>
    );
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-100">Run outcomes</h4>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {stats.totalRuns} runs between {new Date(stats.range.from).toLocaleString()} and{' '}
          {new Date(stats.range.to).toLocaleString()}
        </p>
      </div>
      <div className="space-y-2">{renderedStatuses}</div>
      <div className="rounded-lg bg-slate-100/70 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
        <div className="flex justify-between">
          <span>Success rate</span>
          <span>{(stats.successRate * 100).toFixed(1)}%</span>
        </div>
        <div className="flex justify-between">
          <span>Failure rate</span>
          <span>{(stats.failureRate * 100).toFixed(1)}%</span>
        </div>
        <div className="flex justify-between">
          <span>Average duration</span>
          <span>{formatDuration(stats.averageDurationMs)}</span>
        </div>
      </div>
    </div>
  );
}

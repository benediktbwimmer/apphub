import classNames from 'classnames';
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

const EMPTY_STATE_CLASSES =
  'flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-subtle bg-surface-glass-soft p-6 text-scale-sm text-muted';

const OUTCOME_HEADER_TITLE_CLASSES = 'text-scale-sm font-weight-semibold text-primary';

const OUTCOME_HEADER_SUBTEXT_CLASSES = 'text-scale-xs text-muted';

const OUTCOME_LIST_CONTAINER_CLASSES = 'space-y-2';

const OUTCOME_LABEL_BASE_CLASSES =
  'flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-2 py-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent hover:border-subtle hover:bg-surface-glass-soft';

const OUTCOME_CHECKBOX_CLASSES =
  'h-3.5 w-3.5 rounded border-subtle accent-accent text-accent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent focus-visible:ring-0';

const OUTCOME_LABEL_HEADING_CLASSES =
  'flex items-baseline justify-between text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted';

const OUTCOME_BAR_TRACK_CLASSES = 'mt-1 h-2 overflow-hidden rounded-full bg-surface-muted';

const OUTCOME_BAR_FILL_SELECTED_CLASSES = 'h-full rounded-full bg-accent transition-all';

const OUTCOME_BAR_FILL_INACTIVE_CLASSES = 'h-full rounded-full bg-surface-sunken transition-all';

const OUTCOME_SUMMARY_CARD_CLASSES =
  'rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-xs text-secondary';

const OUTCOME_SUMMARY_ROW_CLASSES = 'flex justify-between';

export default function RunOutcomeChart({ stats, selectedOutcomes, onChange }: RunOutcomeChartProps) {
  if (!stats) {
    return (
      <div className={EMPTY_STATE_CLASSES}>
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
        className={OUTCOME_LABEL_BASE_CLASSES}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => toggleOutcome(status)}
          className={OUTCOME_CHECKBOX_CLASSES}
        />
        <div className="flex-1">
          <div className={OUTCOME_LABEL_HEADING_CLASSES}>
            <span>{status}</span>
            <span>{count}</span>
          </div>
          <div className={OUTCOME_BAR_TRACK_CLASSES}>
            <div
              className={classNames(
                isSelected ? OUTCOME_BAR_FILL_SELECTED_CLASSES : OUTCOME_BAR_FILL_INACTIVE_CLASSES
              )}
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
        <h4 className={OUTCOME_HEADER_TITLE_CLASSES}>Run outcomes</h4>
        <p className={OUTCOME_HEADER_SUBTEXT_CLASSES}>
          {stats.totalRuns} runs between {new Date(stats.range.from).toLocaleString()} and{' '}
          {new Date(stats.range.to).toLocaleString()}
        </p>
      </div>
      <div className={OUTCOME_LIST_CONTAINER_CLASSES}>{renderedStatuses}</div>
      <div className={OUTCOME_SUMMARY_CARD_CLASSES}>
        <div className={OUTCOME_SUMMARY_ROW_CLASSES}>
          <span>Success rate</span>
          <span>{(stats.successRate * 100).toFixed(1)}%</span>
        </div>
        <div className={OUTCOME_SUMMARY_ROW_CLASSES}>
          <span>Failure rate</span>
          <span>{(stats.failureRate * 100).toFixed(1)}%</span>
        </div>
        <div className={OUTCOME_SUMMARY_ROW_CLASSES}>
          <span>Average duration</span>
          <span>{formatDuration(stats.averageDurationMs)}</span>
        </div>
      </div>
    </div>
  );
}

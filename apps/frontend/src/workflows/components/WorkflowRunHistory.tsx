import { formatDuration, formatTimestamp } from '../formatters';
import StatusBadge from './StatusBadge';
import { Spinner, CopyButton } from '../../components';
import { getStatusToneClasses } from '../../theme/statusTokens';
import type { WorkflowDefinition, WorkflowRun, WorkflowRuntimeSummary } from '../types';

const SECTION_CLASSES =
  'rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-xl backdrop-blur-md transition-colors';

const HEADER_TITLE_CLASSES = 'text-scale-lg font-weight-semibold text-primary';

const HEADER_SUBTEXT_CLASSES = 'text-scale-xs text-muted';

const REFRESH_BUTTON_CLASSES =
  'inline-flex items-center gap-2 rounded-full border border-subtle bg-surface-glass px-3 py-1 text-scale-xs font-weight-semibold text-secondary shadow-elevation-sm transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const MESSAGE_TEXT_CLASSES = 'mt-3 text-scale-sm text-muted';

const TABLE_WRAPPER_CLASSES = 'mt-4 overflow-hidden rounded-2xl border border-subtle';

const TABLE_CLASSES = 'min-w-full divide-y divide-subtle text-scale-sm';

const TABLE_HEAD_CLASSES = 'bg-surface-muted';

const TABLE_HEAD_CELL_CLASSES =
  'px-4 py-3 text-left text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-muted';

const TABLE_CELL_CLASSES = 'px-4 py-3 text-scale-sm text-secondary';

const SMALL_BADGE_BASE =
  'inline-flex items-center rounded-full border px-2 py-[1px] text-[10px] font-weight-semibold uppercase tracking-wide';

function toneBadge(status: string, base: string = SMALL_BADGE_BASE): string {
  return `${base} ${getStatusToneClasses(status)}`;
}

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
    <section className={SECTION_CLASSES}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className={HEADER_TITLE_CLASSES}>Run History</h2>
          {workflow && runtimeSummary && (
            <p className={HEADER_SUBTEXT_CLASSES}>
              Latest run started {formatTimestamp(runtimeSummary.startedAt ?? null)}
            </p>
          )}
        </div>
        {workflow && onRefresh && (
          <button
            type="button"
            className={REFRESH_BUTTON_CLASSES}
            onClick={onRefresh}
          >
            Refresh runs
          </button>
        )}
      </div>
      {loading && (
        <p className={MESSAGE_TEXT_CLASSES}>
          <Spinner label="Loading runs…" size="xs" />
        </p>
      )}
      {!loading && runs.length === 0 && (
        <p className={MESSAGE_TEXT_CLASSES}>No runs yet.</p>
      )}
      {!loading && runs.length > 0 && (
        <div className={TABLE_WRAPPER_CLASSES}>
          <table className={TABLE_CLASSES}>
            <thead className={TABLE_HEAD_CLASSES}>
              <tr>
                <th className={TABLE_HEAD_CELL_CLASSES}>
                  Status
                </th>
                <th className={TABLE_HEAD_CELL_CLASSES}>
                  Run Key / ID
                </th>
                <th className={TABLE_HEAD_CELL_CLASSES}>
                  Started
                </th>
                <th className={TABLE_HEAD_CELL_CLASSES}>
                  Completed
                </th>
                <th className={TABLE_HEAD_CELL_CLASSES}>
                  Duration
                </th>
                <th className={TABLE_HEAD_CELL_CLASSES}>
                  Retries
                </th>
                <th className={TABLE_HEAD_CELL_CLASSES}>
                  Current Step
                </th>
                <th className={TABLE_HEAD_CELL_CLASSES}>
                  Triggered By
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {runs.map((run) => {
                const isActive = run.id === selectedRunId;
                return (
                  <tr
                    key={run.id}
                    className={`cursor-pointer transition-colors ${
                      isActive ? 'bg-accent-soft' : 'hover:bg-surface-glass-soft'
                    }`}
                    onClick={() => onSelectRun(run.id)}
                  >
                    <td className={TABLE_CELL_CLASSES}>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={run.status} />
                        {run.health === 'degraded' && (
                          <span className={toneBadge('degraded')}>Degraded</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-scale-xs text-secondary">
                      <div className="flex flex-col gap-1">
                        {run.runKey ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-weight-semibold uppercase tracking-[0.3em] text-muted">
                              Key
                            </span>
                            <code className="break-all font-mono text-[11px] text-secondary">{run.runKey}</code>
                            <CopyButton value={run.runKey} ariaLabel="Copy run key" />
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted">—</span>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] font-weight-semibold uppercase tracking-[0.3em] text-muted">
                            ID
                          </span>
                          <code className="break-all font-mono text-[11px] text-secondary">{run.id}</code>
                          <CopyButton value={run.id} ariaLabel="Copy run id" />
                        </div>
                      </div>
                    </td>
                    <td className={TABLE_CELL_CLASSES}>{formatTimestamp(run.startedAt)}</td>
                    <td className={TABLE_CELL_CLASSES}>{formatTimestamp(run.completedAt)}</td>
                    <td className={TABLE_CELL_CLASSES}>{formatDuration(run.durationMs)}</td>
                    <td className={TABLE_CELL_CLASSES}>
                      {run.retrySummary.pendingSteps > 0
                        ? `${run.retrySummary.pendingSteps} pending · next ${formatTimestamp(run.retrySummary.nextAttemptAt)}`
                        : '—'}
                    </td>
                    <td className={TABLE_CELL_CLASSES}>{run.currentStepId ?? '—'}</td>
                    <td className={TABLE_CELL_CLASSES}>{run.triggeredBy ?? '—'}</td>
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

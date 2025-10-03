import JsonSyntaxHighlighter from '../../components/JsonSyntaxHighlighter';
import { Spinner, CopyButton } from '../../components';
import { getStatusToneClasses } from '../../theme/statusTokens';
import { formatDuration, formatTimestamp } from '../formatters';
import { toRecord } from '../normalizers';
import StatusBadge from './StatusBadge';
import type { WorkflowRun, WorkflowRunStep } from '../types';

type IdentifierChipProps = {
  label: string;
  value: string;
};

const PANEL_CONTAINER =
  'rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-lg backdrop-blur-md transition-colors';

const HEADER_TITLE = 'text-scale-lg font-weight-semibold text-primary';

const HEADER_META_LIST = 'mt-2 flex flex-wrap items-center gap-2';

const IDENTIFIER_CHIP_CLASSES =
  'inline-flex items-center gap-2 rounded-full border border-subtle bg-surface-glass px-3 py-1 text-[11px] font-weight-medium text-secondary shadow-elevation-sm transition-colors';

const IDENTIFIER_LABEL = 'text-[10px] font-weight-semibold uppercase tracking-[0.3em] text-muted';

const IDENTIFIER_SEPARATOR = 'text-muted';

const IDENTIFIER_VALUE = 'break-all font-mono text-[11px] text-primary';

const HEADER_ERROR_TEXT = 'max-w-sm text-right text-scale-sm font-weight-semibold text-status-danger';

const DETAIL_GRID = 'mt-4 grid gap-3 text-scale-xs text-secondary md:grid-cols-4';

const DETAIL_TERM = 'font-weight-semibold uppercase tracking-[0.4em] text-muted';

const DETAIL_VALUE = 'mt-1 text-primary';

const SMALL_STATUS_BADGE =
  'inline-flex items-center rounded-full border px-3 py-[2px] text-[10px] font-weight-semibold uppercase tracking-[0.25em]';

const METRICS_CARD =
  'mt-4 rounded-2xl border border-subtle bg-surface-glass px-4 py-3 text-scale-xs text-secondary shadow-elevation-sm transition-colors';

const OUTPUT_CARD =
  'mt-4 rounded-2xl border border-subtle bg-surface-muted px-4 py-3 text-scale-xs text-secondary shadow-inner transition-colors';

const CODE_BLOCK_CLASSES =
  'mt-2 overflow-auto rounded-xl bg-surface-sunken px-3 py-2 font-mono text-scale-xs leading-relaxed text-primary';

const LOADING_TEXT_CLASSES = 'mt-3 text-scale-sm text-secondary';

const ERROR_TEXT_CLASSES = 'mt-3 text-scale-sm font-weight-semibold text-status-danger';

const STEPS_LIST = 'mt-4 flex flex-col gap-3';

const STEP_CARD =
  'rounded-2xl border border-subtle bg-surface-glass px-4 py-3 text-scale-sm text-secondary shadow-elevation-sm transition-colors';

const STEP_TITLE = 'font-weight-semibold text-primary';

const STEP_META_TEXT = 'text-scale-xs text-muted';

const STEP_GRID = 'mt-2 grid gap-2 text-scale-xs text-secondary md:grid-cols-3';

const STEP_LINK = 'text-accent underline-offset-2 hover:underline';

const STEP_ERROR_TEXT = 'mt-2 text-scale-xs font-weight-semibold text-status-danger';

const EMPTY_STATE_TEXT = 'mt-3 text-scale-sm text-secondary';

function IdentifierChip({ label, value }: IdentifierChipProps) {
  return (
    <div className={IDENTIFIER_CHIP_CLASSES}>
      <span className="sr-only">{`${label}: ${value}`}</span>
      <span aria-hidden="true" className={IDENTIFIER_LABEL}>
        {label}
      </span>
      <span aria-hidden="true" className={IDENTIFIER_SEPARATOR}>
        :
      </span>
      <code aria-hidden="true" className={IDENTIFIER_VALUE}>
        {value}
      </code>
      <CopyButton value={value} ariaLabel={`Copy ${label.toLowerCase()}`} />
    </div>
  );
}

type WorkflowRunDetailsProps = {
  run: WorkflowRun | null;
  steps: WorkflowRunStep[];
  stepsLoading: boolean;
  stepsError: string | null;
};

export default function WorkflowRunDetails({ run, steps, stepsLoading, stepsError }: WorkflowRunDetailsProps) {
  if (!run) {
    return null;
  }

  return (
    <section className={PANEL_CONTAINER}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className={HEADER_TITLE}>Run Details</h2>
          <div className={HEADER_META_LIST}>
            {run.runKey ? <IdentifierChip label="Run key" value={run.runKey} /> : null}
            <IdentifierChip label="Run ID" value={run.id} />
          </div>
        </div>
        {run.errorMessage && (
          <p className={HEADER_ERROR_TEXT}>{run.errorMessage}</p>
        )}
      </div>

      <dl className={DETAIL_GRID}>
        <div>
          <dt className={DETAIL_TERM}>Status</dt>
          <dd className="mt-1 flex items-center gap-2">
            <StatusBadge status={run.status} />
            {run.health === 'degraded' && (
              <span className={`${SMALL_STATUS_BADGE} ${getStatusToneClasses('warning')}`}>
                Degraded
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className={DETAIL_TERM}>Started</dt>
          <dd className={DETAIL_VALUE}>{formatTimestamp(run.startedAt)}</dd>
        </div>
        <div>
          <dt className={DETAIL_TERM}>Duration</dt>
          <dd className={DETAIL_VALUE}>{formatDuration(run.durationMs)}</dd>
        </div>
        <div>
          <dt className={DETAIL_TERM}>Triggered By</dt>
          <dd className={DETAIL_VALUE}>{run.triggeredBy ?? '—'}</dd>
        </div>
        <div>
          <dt className={DETAIL_TERM}>Retries</dt>
          <dd className={DETAIL_VALUE}>
            {run.retrySummary.pendingSteps > 0
              ? `${run.retrySummary.pendingSteps} pending · next ${formatTimestamp(run.retrySummary.nextAttemptAt)}`
              : 'No pending retries'}
          </dd>
        </div>
      </dl>

      {run.metrics && (
        <div className={METRICS_CARD}>
          <p className="font-weight-semibold text-primary">Metrics</p>
          <p className="mt-1">Completed steps: {run.metrics.completedSteps ?? '—'} / {run.metrics.totalSteps ?? '—'}</p>
        </div>
      )}

      {run.output !== null && run.output !== undefined ? (
        <div className={OUTPUT_CARD}>
          <p className="font-weight-semibold text-primary">Workflow Output</p>
          <JsonSyntaxHighlighter
            value={run.output}
            className={`${CODE_BLOCK_CLASSES} max-h-64`}
          />
        </div>
      ) : run.status === 'succeeded' ? (
        <p className="mt-4 text-scale-xs text-muted">No output captured for this run.</p>
      ) : null}

      {stepsLoading && (
        <p className={LOADING_TEXT_CLASSES}>
          <Spinner label="Loading step details…" size="xs" />
        </p>
      )}
      {stepsError && !stepsLoading && (
        <p className={ERROR_TEXT_CLASSES}>{stepsError}</p>
      )}

      {!stepsLoading && !stepsError && steps.length > 0 && (
        <ol className={STEPS_LIST}>
          {steps.map((step) => {
            const metrics = toRecord(step.metrics);
            const isResolutionBlocked = Boolean(step.resolutionError);
            const statusLabel = isResolutionBlocked ? 'awaiting input' : step.status;
            return (
              <li
                key={step.id}
                className={STEP_CARD}
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className={STEP_TITLE}>{step.stepId}</p>
                    <p className={STEP_META_TEXT}>Attempt {step.attempt} · Job run {step.jobRunId ?? 'n/a'}</p>
                    {isResolutionBlocked && (
                      <p className={`${STEP_META_TEXT} text-status-warning`}>Waiting for upstream inputs</p>
                    )}
                  </div>
                  <StatusBadge status={statusLabel} />
                </div>
                <div className={STEP_GRID}>
                  <span>Started: {formatTimestamp(step.startedAt)}</span>
                  <span>Completed: {formatTimestamp(step.completedAt)}</span>
                  <span>
                    Logs:{' '}
                    {step.logsUrl ? (
                      <a
                        href={step.logsUrl}
                        className={STEP_LINK}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View
                      </a>
                    ) : (
                      '—'
                    )}
                  </span>
                </div>
                {metrics && (
                  <JsonSyntaxHighlighter
                    value={metrics}
                    className={`${CODE_BLOCK_CLASSES} max-h-40`}
                  />
                )}
                {step.retryState && (
                  <p className={STEP_META_TEXT}>
                    Retry state: <span className="capitalize">{step.retryState}</span>
                    {step.retryAttempts !== undefined
                      ? ` · attempts ${step.retryAttempts}`
                      : ''}
                    {step.nextAttemptAt ? ` · next ${formatTimestamp(step.nextAttemptAt)}` : ''}
                  </p>
                )}
                {step.errorMessage && (
                  <p className={STEP_ERROR_TEXT}>{step.errorMessage}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {!stepsLoading && !stepsError && steps.length === 0 && (
        <p className={EMPTY_STATE_TEXT}>No steps recorded for this run.</p>
      )}
    </section>
  );
}

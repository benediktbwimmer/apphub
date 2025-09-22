import JsonSyntaxHighlighter from '../../components/JsonSyntaxHighlighter';
import { formatDuration, formatTimestamp } from '../formatters';
import { toRecord } from '../normalizers';
import StatusBadge from './StatusBadge';
import type { WorkflowRun, WorkflowRunStep } from '../types';

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
    <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Run Details</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Run ID: {run.id}</p>
        </div>
        {run.errorMessage && (
          <p className="max-w-sm text-right text-sm font-semibold text-rose-600 dark:text-rose-300">{run.errorMessage}</p>
        )}
      </div>

      <dl className="mt-4 grid gap-3 text-xs text-slate-600 dark:text-slate-300 md:grid-cols-4">
        <div>
          <dt className="font-semibold uppercase tracking-widest text-slate-400">Status</dt>
          <dd className="mt-1">
            <StatusBadge status={run.status} />
          </dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-widest text-slate-400">Started</dt>
          <dd className="mt-1">{formatTimestamp(run.startedAt)}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-widest text-slate-400">Duration</dt>
          <dd className="mt-1">{formatDuration(run.durationMs)}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-widest text-slate-400">Triggered By</dt>
          <dd className="mt-1">{run.triggeredBy ?? '—'}</dd>
        </div>
      </dl>

      {run.metrics && (
        <div className="mt-4 rounded-2xl border border-slate-200/60 bg-slate-50/70 px-4 py-3 text-xs text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/70 dark:text-slate-300">
          <p className="font-semibold">Metrics</p>
          <p className="mt-1">Completed steps: {run.metrics.completedSteps ?? '—'} / {run.metrics.totalSteps ?? '—'}</p>
        </div>
      )}

      {run.output !== null && run.output !== undefined ? (
        <div className="mt-4 rounded-2xl border border-slate-200/60 bg-slate-50/80 px-4 py-3 text-xs text-slate-600 shadow-inner dark:border-slate-700/60 dark:bg-slate-800/80 dark:text-slate-300">
          <p className="font-semibold">Workflow Output</p>
          <JsonSyntaxHighlighter
            value={run.output}
            className="mt-2 max-h-64 overflow-auto rounded-xl bg-slate-900/80 px-3 py-2 text-[11px] leading-relaxed text-slate-200"
          />
        </div>
      ) : run.status === 'succeeded' ? (
        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">No output captured for this run.</p>
      ) : null}

      {stepsLoading && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Loading step details…</p>}
      {stepsError && !stepsLoading && (
        <p className="mt-3 text-sm font-semibold text-rose-600 dark:text-rose-300">{stepsError}</p>
      )}

      {!stepsLoading && !stepsError && steps.length > 0 && (
        <ol className="mt-4 flex flex-col gap-3">
          {steps.map((step) => {
            const metrics = toRecord(step.metrics);
            return (
              <li
                key={step.id}
                className="rounded-2xl border border-slate-200/60 bg-slate-50/70 px-4 py-3 text-sm dark:border-slate-700/60 dark:bg-slate-800/70"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-slate-700 dark:text-slate-200">{step.stepId}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Attempt {step.attempt} · Job run {step.jobRunId ?? 'n/a'}</p>
                  </div>
                  <StatusBadge status={step.status} />
                </div>
                <div className="mt-2 grid gap-2 text-xs text-slate-500 dark:text-slate-400 md:grid-cols-3">
                  <span>Started: {formatTimestamp(step.startedAt)}</span>
                  <span>Completed: {formatTimestamp(step.completedAt)}</span>
                  <span>
                    Logs:{' '}
                    {step.logsUrl ? (
                      <a
                        href={step.logsUrl}
                        className="text-violet-600 underline-offset-2 hover:underline dark:text-violet-300"
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
                    className="mt-2 max-h-40 overflow-auto rounded-xl bg-slate-900/80 px-3 py-2 text-xs text-slate-200"
                  />
                )}
                {step.errorMessage && (
                  <p className="mt-2 text-xs font-semibold text-rose-600 dark:text-rose-300">{step.errorMessage}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {!stepsLoading && !stepsError && steps.length === 0 && (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">No steps recorded for this run.</p>
      )}
    </section>
  );
}

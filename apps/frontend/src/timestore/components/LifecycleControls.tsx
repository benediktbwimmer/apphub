import { useMemo, useState } from 'react';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { useToastHelpers } from '../../components/toast';
import { formatInstant } from '../utils';
import { runLifecycleJob, rescheduleLifecycleJob } from '../api';
import type { LifecycleJobSummary, LifecycleMaintenanceReport } from '../types';

const DEFAULT_OPERATIONS: readonly LifecycleJobSummary['operations'][number][] = [
  'compaction',
  'retention',
  'parquetExport'
];

type LifecycleOperation = (typeof DEFAULT_OPERATIONS)[number];

interface LifecycleControlsProps {
  datasetId: string;
  datasetSlug: string;
  jobs: LifecycleJobSummary[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  canRun: boolean;
}

function resolveDatasetSlug(job: LifecycleJobSummary): string {
  const metadataSlug = typeof job.metadata?.datasetSlug === 'string' ? job.metadata.datasetSlug : null;
  return metadataSlug ?? 'unknown';
}

export function LifecycleControls({ datasetId, datasetSlug, jobs, loading, error, onRefresh, canRun }: LifecycleControlsProps) {
  const authorizedFetch = useAuthorizedFetch();
  const { showSuccess, showError, showInfo } = useToastHelpers();
  const [selectedOperations, setSelectedOperations] = useState<LifecycleOperation[]>([...DEFAULT_OPERATIONS]);
  const [submitting, setSubmitting] = useState(false);
  const [lastReport, setLastReport] = useState<LifecycleMaintenanceReport | null>(null);

  const sortedJobs = useMemo(
    () =>
      [...jobs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [jobs]
  );

  const toggleOperation = (operation: LifecycleOperation) => {
    setSelectedOperations((current) => {
      if (current.includes(operation)) {
        return current.filter((item) => item !== operation);
      }
      return [...current, operation];
    });
  };

  const effectiveOperations = selectedOperations.length > 0 ? selectedOperations : [...DEFAULT_OPERATIONS];

  const handleRun = async (mode: 'inline' | 'queue') => {
    if (!canRun) {
      showInfo('Missing scope', 'timestore:admin scope is required to run lifecycle jobs.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await runLifecycleJob(authorizedFetch, {
        datasetId,
        datasetSlug,
        operations: effectiveOperations,
        mode
      });
      if (response.status === 'completed') {
        setLastReport(response.report);
        showSuccess('Lifecycle run completed', `Job ${response.report.jobId} finished successfully.`);
      } else {
        setLastReport(null);
        showSuccess('Lifecycle job enqueued', `Job ${response.jobId} queued for execution.`);
      }
      onRefresh();
    } catch (err) {
      setLastReport(null);
      showError('Lifecycle run failed', err, 'Unable to run lifecycle job.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReschedule = async (jobId: string) => {
    if (!canRun) {
      showInfo('Missing scope', 'timestore:admin scope is required to reschedule lifecycle jobs.');
      return;
    }
    try {
      await rescheduleLifecycleJob(authorizedFetch, jobId);
      showSuccess('Lifecycle job enqueued', `Retry queued for job ${jobId}.`);
      onRefresh();
    } catch (err) {
      showError('Failed to reschedule job', err, 'Unable to reschedule lifecycle job.');
    }
  };

  return (
    <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-500 dark:text-violet-300">Lifecycle</span>
          <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100">Maintenance controls</h4>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!canRun || submitting}
            onClick={() => void handleRun('inline')}
            className="rounded-full bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Run inline
          </button>
          <button
            type="button"
            disabled={!canRun || submitting}
            onClick={() => void handleRun('queue')}
            className="rounded-full border border-violet-500 px-4 py-2 text-xs font-semibold text-violet-600 transition-colors hover:bg-violet-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:border-violet-400 dark:text-violet-300"
          >
            Enqueue run
          </button>
        </div>
      </header>

      {!canRun && (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
          Lifecycle operations require the <code className="font-mono">timestore:admin</code> scope.
        </p>
      )}

      <section className="mt-4 space-y-3">
        <h5 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Operations</h5>
        <div className="flex flex-wrap gap-3">
          {DEFAULT_OPERATIONS.map((operation) => {
            const checked = selectedOperations.includes(operation);
            return (
              <label key={operation} className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleOperation(operation)}
                  className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                />
                <span className="capitalize">{operation}</span>
              </label>
            );
          })}
        </div>
      </section>

      {lastReport && (
        <section className="mt-5 space-y-3 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4 text-sm dark:border-slate-700/60 dark:bg-slate-800/60">
          <h6 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Last inline run</h6>
          <p className="text-xs text-slate-500 dark:text-slate-400">Job {lastReport.jobId} • {formatInstant(lastReport.auditLogEntries[0]?.createdAt ?? new Date().toISOString())}</p>
          <ul className="space-y-2">
            {lastReport.operations.map((operation) => (
              <li key={operation.operation} className="flex items-center justify-between">
                <span className="capitalize text-slate-700 dark:text-slate-200">{operation.operation}</span>
                <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{operation.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 space-y-3">
        <div className="flex items-center justify-between">
          <h5 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Recent jobs</h5>
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
          >
            Refresh
          </button>
        </div>
        {loading ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">Loading lifecycle jobs…</p>
        ) : error ? (
          <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p>
        ) : sortedJobs.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">No lifecycle activity recorded yet.</p>
        ) : (
          <ul className="space-y-3">
            {sortedJobs.map((job) => (
              <li key={job.id} className="rounded-2xl border border-slate-200/60 bg-slate-50/80 p-4 text-sm dark:border-slate-700/60 dark:bg-slate-800/60">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{job.status}</div>
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{resolveDatasetSlug(job)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleReschedule(job.id)}
                    disabled={!canRun}
                    className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700/70 dark:text-slate-300"
                  >
                    Reschedule
                  </button>
                </div>
                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Started {formatInstant(job.startedAt)}
                  {job.completedAt ? ` • Completed ${formatInstant(job.completedAt)}` : ''}
                  {job.error ? ` • Error: ${job.error}` : ''}
                </div>
                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Operations: {job.operations.join(', ')}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

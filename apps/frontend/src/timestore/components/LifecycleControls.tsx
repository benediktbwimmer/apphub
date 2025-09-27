import { useState } from 'react';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { useToastHelpers } from '../../components/toast';
import { formatInstant } from '../utils';
import { runLifecycleJob, rescheduleLifecycleJob } from '../api';
import type { LifecycleJobSummary, LifecycleMaintenanceReport } from '../types';
import { LifecycleJobTimeline } from './LifecycleJobTimeline';

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
  panelId?: string;
}

function resolveReportTimestamp(report: LifecycleMaintenanceReport): string | null {
  const [firstEntry] = report.auditLogEntries;
  if (firstEntry && typeof firstEntry === 'object') {
    const createdAt = (firstEntry as { createdAt?: unknown }).createdAt;
    if (typeof createdAt === 'string' && createdAt.trim().length > 0) {
      return createdAt;
    }
  }
  return null;
}

export function LifecycleControls({
  datasetId,
  datasetSlug,
  jobs,
  loading,
  error,
  onRefresh,
  canRun,
  panelId
}: LifecycleControlsProps) {
  const authorizedFetch = useAuthorizedFetch();
  const { showSuccess, showError, showInfo } = useToastHelpers();
  const [selectedOperations, setSelectedOperations] = useState<LifecycleOperation[]>([...DEFAULT_OPERATIONS]);
  const [submitting, setSubmitting] = useState(false);
  const [lastReport, setLastReport] = useState<LifecycleMaintenanceReport | null>(null);

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
    <div
      id={panelId}
      className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70"
    >
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
          <p className="text-xs text-slate-500 dark:text-slate-400">Job {lastReport.jobId} • {formatInstant(resolveReportTimestamp(lastReport))}</p>
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

      <LifecycleJobTimeline
        jobs={jobs}
        loading={loading}
        error={error}
        onRefresh={onRefresh}
        onReschedule={(jobId) => void handleReschedule(jobId)}
        canManage={canRun}
      />
    </div>
  );
}

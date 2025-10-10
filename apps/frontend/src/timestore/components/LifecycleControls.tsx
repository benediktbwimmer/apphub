import { useState } from 'react';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { useToastHelpers } from '../../components/toast';
import { formatInstant } from '../utils';
import { runLifecycleJob, rescheduleLifecycleJob } from '../api';
import type { LifecycleJobSummary, LifecycleMaintenanceReport } from '../types';
import { LifecycleJobTimeline } from './LifecycleJobTimeline';
import {
  CARD_SURFACE_SOFT,
  CHECKBOX_INPUT,
  OUTLINE_ACCENT_BUTTON,
  PANEL_SURFACE_LARGE,
  PRIMARY_BUTTON_COMPACT,
  STATUS_MESSAGE,
  STATUS_META
} from '../timestoreTokens';

const DEFAULT_OPERATIONS: readonly LifecycleJobSummary['operations'][number][] = ['compaction', 'retention'];

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
    <div id={panelId} className={`${PANEL_SURFACE_LARGE} shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)]`}>
      <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-accent">Lifecycle</span>
          <h4 className="text-scale-base font-weight-semibold text-primary">Maintenance controls</h4>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!canRun || submitting}
            onClick={() => void handleRun('inline')}
            className={PRIMARY_BUTTON_COMPACT}
          >
            Run inline
          </button>
          <button
            type="button"
            disabled={!canRun || submitting}
            onClick={() => void handleRun('queue')}
            className={OUTLINE_ACCENT_BUTTON}
          >
            Enqueue run
          </button>
        </div>
      </header>

      {!canRun && (
        <p className={`mt-3 ${STATUS_MESSAGE}`}>
          Lifecycle operations require the <code className="font-mono text-secondary">timestore:admin</code> scope.
        </p>
      )}

      <section className="mt-4 space-y-3">
        <h5 className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted">Operations</h5>
        <div className="flex flex-wrap gap-3">
          {DEFAULT_OPERATIONS.map((operation) => {
            const checked = selectedOperations.includes(operation);
            return (
              <label key={operation} className="inline-flex items-center gap-2 text-scale-sm text-secondary">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleOperation(operation)}
                  className={CHECKBOX_INPUT}
                />
                <span className="capitalize">{operation}</span>
              </label>
            );
          })}
        </div>
      </section>

      {lastReport && (
        <section className={`mt-5 space-y-3 ${CARD_SURFACE_SOFT} text-scale-sm text-secondary`}>
          <h6 className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted">Last inline run</h6>
          <p className={STATUS_META}>Job {lastReport.jobId} • {formatInstant(resolveReportTimestamp(lastReport))}</p>
          <ul className="space-y-2">
            {lastReport.operations.map((operation) => (
              <li key={operation.operation} className="flex items-center justify-between">
                <span className="capitalize text-secondary">{operation.operation}</span>
                <span className="text-scale-xs uppercase tracking-[0.2em] text-muted">{operation.status}</span>
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

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '../../components';
import type { LifecycleJobSummary } from '../types';
import { formatInstant } from '../utils';
import { ROUTE_PATHS } from '../../routes/paths';
import {
  BADGE_PILL,
  BADGE_PILL_ACCENT,
  BADGE_PILL_DANGER,
  BADGE_PILL_INFO,
  BADGE_PILL_MUTED,
  BADGE_PILL_NEUTRAL,
  BADGE_PILL_SUCCESS,
  BADGE_PILL_WARNING,
  CARD_SURFACE,
  CARD_SURFACE_SOFT,
  SECONDARY_BUTTON_COMPACT,
  STATUS_BANNER_DANGER,
  STATUS_MESSAGE,
  STATUS_META
} from '../timestoreTokens';

function statusBadgeClass(status: LifecycleJobSummary['status']): string {
  switch (status) {
    case 'completed':
      return BADGE_PILL_SUCCESS;
    case 'running':
      return BADGE_PILL_INFO;
    case 'queued':
      return BADGE_PILL_WARNING;
    case 'skipped':
      return BADGE_PILL_NEUTRAL;
    case 'failed':
    default:
      return BADGE_PILL_DANGER;
  }
}

function formatDurationMs(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) {
    return 'n/a';
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  const seconds = value / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function extractJobActor(job: LifecycleJobSummary): string | null {
  const metadata = job.metadata ?? {};
  const possibleKeys = ['requestActorId', 'actorId', 'requestedBy'];
  for (const key of possibleKeys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  if (typeof job.triggerSource === 'string' && job.triggerSource.trim().length > 0) {
    return job.triggerSource.trim();
  }
  return null;
}

function extractJobMode(job: LifecycleJobSummary): string | null {
  const metadata = job.metadata ?? {};
  const possibleKeys = ['mode', 'requestedMode', 'executionMode'];
  for (const key of possibleKeys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  if (job.metadata && typeof job.metadata.queue === 'string') {
    return job.metadata.queue.trim();
  }
  return null;
}

function resolveDatasetLabel(job: LifecycleJobSummary): string {
  const metadata = job.metadata ?? {};
  const possibleKeys = ['datasetSlug', 'slug'];
  for (const key of possibleKeys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  if (job.datasetId && job.datasetId.trim().length > 0) {
    return job.datasetId.trim();
  }
  return 'unknown';
}

type LifecycleJobTimelineProps = {
  jobs: LifecycleJobSummary[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onReschedule: (jobId: string) => void;
  canManage: boolean;
};

export function LifecycleJobTimeline({
  jobs,
  loading,
  error,
  onRefresh,
  onReschedule,
  canManage
}: LifecycleJobTimelineProps) {
  const sortedJobs = useMemo(
    () =>
      [...jobs].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [jobs]
  );

  return (
    <section className={`mt-6 space-y-3 ${CARD_SURFACE_SOFT}`}>
      <div className="flex items-center justify-between">
        <h5 className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted">
          Lifecycle timeline
        </h5>
        <button
          type="button"
          onClick={onRefresh}
          className={SECONDARY_BUTTON_COMPACT}
        >
          Refresh
        </button>
      </div>

      {loading && sortedJobs.length === 0 ? (
        <div className={STATUS_MESSAGE}>
          <Spinner label="Loading lifecycle jobs" size="xs" />
        </div>
      ) : null}

      {error && (
        <div className={STATUS_BANNER_DANGER}>{error}</div>
      )}

      {!loading && !error && sortedJobs.length === 0 ? (
        <p className={STATUS_MESSAGE}>No lifecycle activity recorded yet.</p>
      ) : null}

      {sortedJobs.length > 0 && (
        <ol className="space-y-3">
          {sortedJobs.map((job) => {
            const actor = extractJobActor(job);
            const mode = extractJobMode(job);
            const operations = job.operations.join(', ');
            const duration = formatDurationMs(job.durationMs);
            const jobLink = `${ROUTE_PATHS.jobs}?${new URLSearchParams({ query: job.id }).toString()}`;
            const reason = typeof job.metadata?.reason === 'string' ? job.metadata.reason : null;
            const errorMessage = job.error ?? (typeof job.metadata?.error === 'string' ? job.metadata.error : null);
            const datasetLabel = resolveDatasetLabel(job);

            return (
              <li key={job.id} className={`flex flex-wrap gap-4 ${CARD_SURFACE} text-scale-sm text-secondary`}>
                <div className={`w-40 shrink-0 text-scale-xs font-weight-semibold text-muted`}>
                  Started {formatInstant(job.startedAt)}
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={statusBadgeClass(job.status)}
                    >
                      {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                    </span>
                    <Link
                      to={jobLink}
                      className={`${BADGE_PILL_ACCENT} hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
                    >
                      {job.id}
                    </Link>
                    {mode && (
                      <span className={BADGE_PILL_MUTED}>{mode}</span>
                    )}
                    <span className={BADGE_PILL}>{`Duration ${duration}`}</span>
                  </div>
                  <div className="text-scale-sm font-weight-semibold text-primary">Operations: {operations}</div>
                  <div className={STATUS_META}>Dataset: {datasetLabel}</div>
                  {actor ? <div className={STATUS_META}>Actor: {actor}</div> : null}
                  <div className={STATUS_META}>
                    Attempts: {job.attempts}
                    {job.completedAt ? ` • Completed ${formatInstant(job.completedAt)}` : ''}
                    {job.scheduledFor ? ` • Scheduled ${formatInstant(job.scheduledFor)}` : ''}
                  </div>
                  {reason ? <div className="text-scale-xs text-status-warning">{reason}</div> : null}
                  {errorMessage ? <div className="text-scale-xs font-weight-semibold text-status-danger">{errorMessage}</div> : null}
                  <div className={`${STATUS_META} flex flex-wrap items-center gap-3`}>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => onReschedule(job.id)}
                        className={SECONDARY_BUTTON_COMPACT}
                      >
                        Reschedule
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

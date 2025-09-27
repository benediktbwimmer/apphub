import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '../../components';
import type { LifecycleJobSummary } from '../types';
import { formatInstant } from '../utils';
import { ROUTE_PATHS } from '../../routes/paths';

function statusBadgeClass(status: LifecycleJobSummary['status']): string {
  switch (status) {
    case 'completed':
      return 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600 dark:border-emerald-400/40 dark:text-emerald-300';
    case 'running':
      return 'border-sky-500/60 bg-sky-500/10 text-sky-600 dark:border-sky-400/40 dark:text-sky-300';
    case 'queued':
      return 'border-amber-500/60 bg-amber-500/10 text-amber-600 dark:border-amber-400/40 dark:text-amber-300';
    case 'skipped':
      return 'border-slate-400/60 bg-slate-400/10 text-slate-600 dark:border-slate-500/40 dark:text-slate-300';
    case 'failed':
    default:
      return 'border-rose-500/60 bg-rose-500/10 text-rose-600 dark:border-rose-400/40 dark:text-rose-300';
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
    <section className="mt-6 space-y-3 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4 dark:border-slate-700/60 dark:bg-slate-800/60">
      <div className="flex items-center justify-between">
        <h5 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
          Lifecycle timeline
        </h5>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:text-slate-300"
        >
          Refresh
        </button>
      </div>

      {loading && sortedJobs.length === 0 ? (
        <div className="text-sm text-slate-600 dark:text-slate-300">
          <Spinner label="Loading lifecycle jobs" size="xs" />
        </div>
      ) : null}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-600 dark:border-rose-400/40 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      )}

      {!loading && !error && sortedJobs.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">No lifecycle activity recorded yet.</p>
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
              <li
                key={job.id}
                className="flex flex-wrap gap-4 rounded-2xl border border-slate-200/60 bg-white/90 p-4 text-sm shadow-sm transition-colors dark:border-slate-700/60 dark:bg-slate-900/60"
              >
                <div className="w-40 shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Started {formatInstant(job.startedAt)}
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${statusBadgeClass(job.status)}`}
                    >
                      {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                    </span>
                    <Link
                      to={jobLink}
                      className="inline-flex items-center rounded-full border border-violet-400/70 px-3 py-1 text-xs font-semibold text-violet-600 transition-colors hover:bg-violet-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-violet-400/50 dark:text-violet-200"
                    >
                      {job.id}
                    </Link>
                    {mode && (
                      <span className="inline-flex items-center rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-300">
                        {mode}
                      </span>
                    )}
                    <span className="inline-flex items-center rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-300">
                      Duration {duration}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">Operations: {operations}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Dataset: {datasetLabel}</div>
                  {actor && (
                    <div className="text-xs text-slate-500 dark:text-slate-400">Actor: {actor}</div>
                  )}
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Attempts: {job.attempts}
                    {job.completedAt ? ` • Completed ${formatInstant(job.completedAt)}` : ''}
                    {job.scheduledFor ? ` • Scheduled ${formatInstant(job.scheduledFor)}` : ''}
                  </div>
                  {reason && (
                    <div className="text-xs text-amber-600 dark:text-amber-300">{reason}</div>
                  )}
                  {errorMessage && (
                    <div className="text-xs font-semibold text-rose-600 dark:text-rose-300">{errorMessage}</div>
                  )}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => onReschedule(job.id)}
                        className="rounded-full border border-slate-300/70 px-3 py-1 font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:text-slate-300"
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

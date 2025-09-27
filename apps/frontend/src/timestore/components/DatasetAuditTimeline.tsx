import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '../../components';
import type { DatasetAccessAuditEvent } from '../types';
import { formatInstant } from '../utils';
import { ROUTE_PATHS } from '../../routes/paths';

function normalizeStage(event: DatasetAccessAuditEvent): string {
  const metadataStage = typeof event.metadata?.stage === 'string' ? event.metadata.stage : null;
  if (metadataStage && metadataStage.trim().length > 0) {
    return metadataStage.trim().toLowerCase();
  }
  const [prefix] = event.action.split('.');
  if (prefix) {
    return prefix.trim().toLowerCase();
  }
  return 'audit';
}

function formatStageLabel(event: DatasetAccessAuditEvent): string {
  const stage = normalizeStage(event);
  if (!stage) {
    return 'Audit';
  }
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

function stageBadgeClass(stage: string): string {
  switch (stage) {
    case 'ingest':
      return 'border-emerald-400/60 bg-emerald-400/10 text-emerald-600 dark:border-emerald-400/40 dark:text-emerald-300';
    case 'query':
      return 'border-sky-400/60 bg-sky-400/10 text-sky-600 dark:border-sky-400/40 dark:text-sky-300';
    case 'lifecycle':
      return 'border-violet-400/60 bg-violet-400/10 text-violet-600 dark:border-violet-400/40 dark:text-violet-300';
    default:
      return 'border-slate-400/60 bg-slate-400/10 text-slate-600 dark:border-slate-500/40 dark:text-slate-300';
  }
}

function statusBadgeClass(success: boolean): string {
  return success
    ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600 dark:border-emerald-400/40 dark:text-emerald-300'
    : 'border-rose-500/60 bg-rose-500/10 text-rose-600 dark:border-rose-400/40 dark:text-rose-300';
}

function formatActionLabel(action: string): string {
  return action
    .split('.')
    .map((segment) =>
      segment
        .split(/[_\-]/g)
        .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ''))
        .join(' ')
    )
    .join(' · ')
    .trim();
}

function formatDurationMs(value: unknown): string | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : null;
  if (numeric === null || Number.isNaN(numeric) || numeric < 0) {
    return null;
  }
  if (numeric < 1000) {
    return `${Math.round(numeric)} ms`;
  }
  const seconds = numeric / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function getJobLink(jobId: unknown): { label: string; to: string } | null {
  if (typeof jobId !== 'string' || jobId.trim().length === 0) {
    return null;
  }
  const trimmed = jobId.trim();
  const search = new URLSearchParams({ query: trimmed }).toString();
  return {
    label: `Job ${trimmed}`,
    to: `${ROUTE_PATHS.jobs}?${search}`
  };
}

function getQueueLink(queueId: unknown): { label: string; to: string } | null {
  if (typeof queueId !== 'string' || queueId.trim().length === 0) {
    return null;
  }
  const trimmed = queueId.trim();
  const search = new URLSearchParams({ queue: trimmed }).toString();
  return {
    label: `Queue entry ${trimmed}`,
    to: `${ROUTE_PATHS.jobs}?${search}`
  };
}

function extractMetadataSummary(event: DatasetAccessAuditEvent) {
  const metadata = event.metadata ?? {};
  const modeRaw = typeof metadata.mode === 'string' ? metadata.mode.trim() : null;
  const mode = modeRaw && modeRaw.length > 0 ? modeRaw : null;
  const duration = formatDurationMs(metadata.durationMs);
  const jobLink = getJobLink(metadata.jobId ?? metadata.lifecycleJobId);
  const queueLink = getQueueLink(metadata.queueEntryId ?? metadata.queueJobId);
  const manifestId = typeof metadata.manifestId === 'string' ? metadata.manifestId.trim() : null;
  const ingestId = typeof metadata.ingestId === 'string' ? metadata.ingestId.trim() : null;
  const error = typeof metadata.error === 'string' ? metadata.error : null;

  return {
    mode,
    duration,
    jobLink,
    queueLink,
    manifestId,
    ingestId,
    error
  };
}

function serializeMetadata(metadata: Record<string, unknown>): string {
  try {
    return JSON.stringify(metadata, null, 2);
  } catch {
    return String(metadata);
  }
}

type DatasetAuditTimelineProps = {
  events: DatasetAccessAuditEvent[];
  loading: boolean;
  error: string | null;
  loadMoreError: string | null;
  onRetry: () => void;
  onLoadMore: () => void;
  canView: boolean;
  loadMoreAvailable: boolean;
  loadMoreLoading: boolean;
};

export function DatasetAuditTimeline({
  events,
  loading,
  error,
  loadMoreError,
  onRetry,
  onLoadMore,
  canView,
  loadMoreAvailable,
  loadMoreLoading
}: DatasetAuditTimelineProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const sortedEvents = useMemo(
    () =>
      [...events].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [events]
  );

  const toggleExpanded = (eventId: string) => {
    setExpanded((current) => ({
      ...current,
      [eventId]: !current[eventId]
    }));
  };

  return (
    <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-500 dark:text-violet-300">
            History
          </span>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Ingestion &amp; Query Timeline
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Review recent ingest attempts, query executions, and lifecycle signals captured by the access audit API.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={!canView || loading}
            className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/70 dark:text-slate-300"
          >
            Refresh
          </button>
        </div>
      </header>

      {!canView ? (
        <p className="mt-6 text-sm text-slate-600 dark:text-slate-300">
          Viewing audit history requires the <code className="font-mono">timestore:admin</code> scope.
        </p>
      ) : (
        <>
          {error && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-600 dark:border-rose-400/40 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </div>
          )}

          {loadMoreError && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-600 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-300">
              {loadMoreError}
            </div>
          )}

          {loading && sortedEvents.length === 0 ? (
            <div className="mt-6 text-sm text-slate-600 dark:text-slate-300">
              <Spinner label="Loading audit events" size="xs" />
            </div>
          ) : null}

          {!loading && sortedEvents.length === 0 && !error ? (
            <p className="mt-6 text-sm text-slate-600 dark:text-slate-300">
              No audit history recorded yet.
            </p>
          ) : null}

          {sortedEvents.length > 0 && (
            <ol className="mt-6 space-y-3">
              {sortedEvents.map((event) => {
                const stage = normalizeStage(event);
                const stageLabel = formatStageLabel(event);
                const actionLabel = formatActionLabel(event.action);
                const metadataSummary = extractMetadataSummary(event);
                const isExpanded = Boolean(expanded[event.id]);
                const actorLine = [
                  event.actorId ? `Actor ${event.actorId}` : null,
                  event.actorScopes.length > 0 ? `Scopes: ${event.actorScopes.join(', ')}` : null
                ]
                  .filter(Boolean)
                  .join(' • ');

                return (
                  <li
                    key={event.id}
                    className="flex flex-wrap gap-4 rounded-2xl border border-slate-200/60 bg-white/80 p-4 text-sm shadow-sm transition-colors dark:border-slate-700/60 dark:bg-slate-900/60"
                  >
                    <div className="w-40 shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {formatInstant(event.createdAt)}
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${stageBadgeClass(stage)}`}
                        >
                          {stageLabel}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${statusBadgeClass(event.success)}`}
                        >
                          {event.success ? 'Success' : 'Failed'}
                        </span>
                        {metadataSummary.mode && (
                          <span className="inline-flex items-center rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-300">
                            {metadataSummary.mode}
                          </span>
                        )}
                        {metadataSummary.duration && (
                          <span className="inline-flex items-center rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-300">
                            {metadataSummary.duration}
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{actionLabel}</div>
                      {actorLine && (
                        <div className="text-xs text-slate-500 dark:text-slate-400">{actorLine}</div>
                      )}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                        {metadataSummary.jobLink && (
                          <Link
                            to={metadataSummary.jobLink.to}
                            className="rounded-full border border-violet-400/70 px-3 py-1 font-semibold text-violet-600 transition-colors hover:bg-violet-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-violet-400/50 dark:text-violet-200"
                          >
                            {metadataSummary.jobLink.label}
                          </Link>
                        )}
                        {metadataSummary.queueLink && (
                          <Link
                            to={metadataSummary.queueLink.to}
                            className="rounded-full border border-indigo-400/70 px-3 py-1 font-semibold text-indigo-600 transition-colors hover:bg-indigo-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-indigo-400/50 dark:text-indigo-200"
                          >
                            {metadataSummary.queueLink.label}
                          </Link>
                        )}
                        {metadataSummary.manifestId && (
                          <span className="rounded-full border border-slate-200 px-3 py-1 font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-300">
                            Manifest {metadataSummary.manifestId}
                          </span>
                        )}
                        {metadataSummary.ingestId && (
                          <span className="rounded-full border border-slate-200 px-3 py-1 font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-300">
                            Batch {metadataSummary.ingestId}
                          </span>
                        )}
                      </div>
                      {metadataSummary.error && (
                        <div className="text-xs font-semibold text-rose-600 dark:text-rose-300">
                          {metadataSummary.error}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleExpanded(event.id)}
                        className="text-xs font-semibold text-violet-600 transition-colors hover:text-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-violet-300"
                      >
                        {isExpanded ? 'Hide raw metadata' : 'Show raw metadata'}
                      </button>
                      {isExpanded && (
                        <pre className="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200">
                          {serializeMetadata(event.metadata ?? {})}
                        </pre>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {loadMoreAvailable && canView && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loadMoreLoading}
                className="rounded-full border border-slate-300/70 px-4 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/70 dark:text-slate-300"
              >
                {loadMoreLoading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

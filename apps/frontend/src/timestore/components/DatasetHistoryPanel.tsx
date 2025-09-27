import { useMemo } from 'react';
import { Spinner } from '../../components';
import { formatInstant } from '../utils';
import type { DatasetAccessAuditEvent } from '../types';

const BADGE_BASE =
  'inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em]';

const BADGE_VARIANTS: Record<'success' | 'failure', string> = {
  success:
    'border border-emerald-400/70 bg-emerald-500/15 text-emerald-700 dark:border-emerald-400/60 dark:bg-emerald-500/20 dark:text-emerald-200',
  failure:
    'border border-rose-400/70 bg-rose-500/15 text-rose-700 dark:border-rose-400/60 dark:bg-rose-500/20 dark:text-rose-200'
};

type HistoryEntryLink = {
  label: string;
  value: string;
  href?: string;
};

interface DatasetHistoryPanelProps {
  events: DatasetAccessAuditEvent[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  canView: boolean;
  hasMore: boolean;
  lastFetchedAt: string | null;
  onRefresh: () => void;
  onLoadMore: () => void;
}

function getString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function getNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatActionLabel(event: DatasetAccessAuditEvent): string {
  switch (event.action) {
    case 'ingest':
      return 'Ingestion';
    case 'query':
      return 'Query';
    case 'admin.dataset.created':
    case 'admin.dataset.created.idempotent':
      return 'Dataset Created';
    case 'admin.dataset.updated':
      return 'Dataset Updated';
    case 'admin.dataset.archived':
      return 'Dataset Archived';
    default:
      return event.action;
  }
}

function formatEventSummary(event: DatasetAccessAuditEvent): string {
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  if (event.action === 'ingest') {
    const mode = getString(metadata.mode);
    if (event.success) {
      return mode ? `Ingestion completed (${mode})` : 'Ingestion completed';
    }
    const stage = getString(metadata.stage);
    return stage ? `Ingestion failed during ${stage}` : 'Ingestion failed';
  }
  if (event.action === 'query') {
    const rows = getNumber(metadata.rowCount);
    if (event.success) {
      return rows !== null ? `Query succeeded • ${rows.toLocaleString()} rows` : 'Query succeeded';
    }
    return 'Query failed';
  }
  if (event.action.startsWith('admin.dataset.')) {
    if (event.action.endsWith('created') || event.action.endsWith('created.idempotent')) {
      return event.success ? 'Dataset registration accepted' : 'Dataset registration blocked';
    }
    if (event.action.endsWith('updated')) {
      return event.success ? 'Metadata changes applied' : 'Metadata update rejected';
    }
    if (event.action.endsWith('archived')) {
      return event.success ? 'Dataset archived' : 'Dataset archive failed';
    }
  }
  return event.success ? 'Operation succeeded' : 'Operation failed';
}

function buildMetadataEntries(event: DatasetAccessAuditEvent): HistoryEntryLink[] {
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  const entries: HistoryEntryLink[] = [];

  const manifestId = getString(metadata.manifestId ?? metadata.manifest_id);
  if (manifestId) {
    entries.push({ label: 'Manifest', value: manifestId, href: '#timestore-manifest' });
  }

  const jobId = getString(metadata.jobId ?? metadata.job_id);
  if (jobId) {
    entries.push({ label: 'Job', value: jobId, href: `#timestore-job-${jobId}` });
  }

  const queueId = getString(metadata.queueId ?? metadata.queue_id ?? metadata.idempotencyKey);
  if (queueId && queueId !== jobId) {
    entries.push({ label: 'Queue', value: queueId });
  }

  const mode = getString(metadata.mode);
  if (mode) {
    entries.push({ label: 'Mode', value: mode });
  }

  const durationSeconds = getNumber(metadata.durationSeconds ?? metadata.duration);
  if (durationSeconds !== null) {
    entries.push({ label: 'Duration', value: `${durationSeconds.toFixed(2)} s` });
  }

  const rangeStart = getString(metadata.rangeStart ?? metadata.range_start);
  const rangeEnd = getString(metadata.rangeEnd ?? metadata.range_end);
  if (rangeStart || rangeEnd) {
    const startLabel = rangeStart ? formatInstant(rangeStart) : '—';
    const endLabel = rangeEnd ? formatInstant(rangeEnd) : '—';
    entries.push({ label: 'Range', value: `${startLabel} → ${endLabel}` });
  }

  const rows = getNumber(metadata.rowCount ?? metadata.rows);
  if (rows !== null) {
    entries.push({ label: 'Rows', value: rows.toLocaleString() });
  }

  if (!event.success) {
    const stage = getString(metadata.stage);
    const error = getString(metadata.error);
    if (stage) {
      entries.push({ label: 'Stage', value: stage });
    }
    if (error) {
      entries.push({ label: 'Error', value: error });
    }
  }

  return entries;
}

export default function DatasetHistoryPanel({
  events,
  loading,
  loadingMore,
  error,
  canView,
  hasMore,
  lastFetchedAt,
  onRefresh,
  onLoadMore
}: DatasetHistoryPanelProps) {
  const statusLabel = useMemo(() => (lastFetchedAt ? `Updated ${formatInstant(lastFetchedAt)}` : null), [lastFetchedAt]);

  return (
    <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-500 dark:text-violet-300">
            History
          </span>
          <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Access & ingestion timeline
          </h4>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Recent ingestion attempts, queries, and administrative changes recorded for this dataset.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {statusLabel && (
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              {statusLabel}
            </span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={!canView || loading}
            className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/70 dark:text-slate-300"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {!canView ? (
        <p className="mt-4 rounded-2xl border border-amber-300/70 bg-amber-100/60 p-4 text-sm text-amber-800 dark:border-amber-400/60 dark:bg-amber-500/15 dark:text-amber-200">
          The <code className="font-mono">timestore:admin</code> scope is required to review dataset access history.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {loading && events.length === 0 && (
            <div className="rounded-2xl border border-slate-200/70 bg-slate-100/70 p-4 text-sm text-slate-600 dark:border-slate-700/70 dark:bg-slate-800/60 dark:text-slate-300">
              <Spinner label="Loading history" size="sm" />
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-rose-300/70 bg-rose-50/70 p-4 text-sm font-medium text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-200">
              {error}
            </div>
          )}

          {!loading && !error && events.length === 0 && (
            <p className="rounded-2xl border border-slate-200/70 bg-slate-100/70 p-4 text-sm text-slate-600 dark:border-slate-700/70 dark:bg-slate-800/60 dark:text-slate-300">
              No history recorded yet.
            </p>
          )}

          {events.length > 0 && (
            <ul className="space-y-3">
              {events.map((event) => {
                const metadataEntries = buildMetadataEntries(event);
                const actorScopes = Array.isArray(event.actorScopes)
                  ? event.actorScopes.filter((scope) => scope.trim().length > 0)
                  : [];
                return (
                  <li
                    key={event.id}
                    className="rounded-2xl border border-slate-200/60 bg-slate-50/80 p-4 text-sm dark:border-slate-700/60 dark:bg-slate-800/60"
                  >
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className={`${BADGE_BASE} ${BADGE_VARIANTS[event.success ? 'success' : 'failure']}`}>
                        {event.success ? 'Success' : 'Failure'}
                      </span>
                      <span className="font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                        {formatActionLabel(event)}
                      </span>
                      <time className="text-slate-500 dark:text-slate-400" dateTime={event.createdAt}>
                        {formatInstant(event.createdAt)}
                      </time>
                    </div>
                    <p className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                      {formatEventSummary(event)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>
                        Actor:{' '}
                        <code className="rounded-full bg-slate-200/70 px-2 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-slate-700/60 dark:text-slate-200">
                          {event.actorId ?? 'system'}
                        </code>
                      </span>
                      {actorScopes.length > 0 && (
                        <span className="inline-flex flex-wrap items-center gap-1">
                          Scopes:
                          {actorScopes.map((scope) => (
                            <span
                              key={`${event.id}-${scope}`}
                              className="rounded-full bg-slate-200/70 px-2 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-slate-700/60 dark:text-slate-200"
                            >
                              {scope}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                    {metadataEntries.length > 0 && (
                      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                        {metadataEntries.map((entry) => (
                          <div key={`${event.id}-${entry.label}`} className="flex flex-col gap-1">
                            <dt className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                              {entry.label}
                            </dt>
                            <dd className="text-sm text-slate-700 dark:text-slate-300">
                              {entry.href ? (
                                <a
                                  href={entry.href}
                                  className="text-violet-600 transition-colors hover:text-violet-500 dark:text-violet-300 dark:hover:text-violet-200"
                                >
                                  {entry.value}
                                </a>
                              ) : (
                                entry.value
                              )}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {hasMore && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loadingMore}
                className="rounded-full border border-slate-300/70 px-4 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/70 dark:text-slate-300"
              >
                {loadingMore ? 'Loading more…' : 'Load older events'}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

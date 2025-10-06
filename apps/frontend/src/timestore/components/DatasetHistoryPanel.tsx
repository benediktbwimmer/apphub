import { useMemo } from 'react';
import { Spinner } from '../../components';
import { formatInstant } from '../utils';
import type { DatasetAccessAuditEvent } from '../types';
import {
  BADGE_PILL_DANGER,
  BADGE_PILL_MUTED,
  BADGE_PILL_SUCCESS,
  CARD_SURFACE,
  CARD_SURFACE_SOFT,
  PANEL_SURFACE_LARGE,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON_COMPACT,
  STATUS_BANNER_DANGER,
  STATUS_BANNER_WARNING,
  STATUS_MESSAGE,
  STATUS_META
} from '../timestoreTokens';

type HistoryEntryLink = {
  label: string;
  value: string;
  href?: string;
};

const EVENT_STATUS_BADGE: Record<'success' | 'failure', string> = {
  success: BADGE_PILL_SUCCESS,
  failure: BADGE_PILL_DANGER
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
    <section className={`${PANEL_SURFACE_LARGE} shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)]`}> 
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-accent">
            History
          </span>
          <h4 className="text-scale-base font-weight-semibold text-primary">
            Access & ingestion timeline
          </h4>
          <p className={STATUS_MESSAGE}>
            Recent ingestion attempts, queries, and administrative changes recorded for this dataset.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {statusLabel ? <span className={STATUS_META}>{statusLabel}</span> : null}
          <button
            type="button"
            onClick={onRefresh}
            disabled={!canView || loading}
            className={SECONDARY_BUTTON_COMPACT}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {!canView ? (
        <p className={`mt-4 ${STATUS_BANNER_WARNING}`}>
          The <code className="font-mono text-scale-xs text-secondary">timestore:admin</code> scope is required to review dataset access history.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {loading && events.length === 0 && (
            <div className={`${CARD_SURFACE_SOFT} text-scale-sm text-secondary`}>
              <Spinner label="Loading history" size="sm" />
            </div>
          )}

          {error && (
            <div className={STATUS_BANNER_DANGER}>{error}</div>
          )}

          {!loading && !error && events.length === 0 && (
            <div className={`${CARD_SURFACE_SOFT} text-scale-sm text-secondary`}>
              No history recorded yet.
            </div>
          )}

          {events.length > 0 && (
            <div className="max-h-[420px] overflow-auto pr-1">
              <ul className="space-y-3">
                {events.map((event) => {
                  const metadataEntries = buildMetadataEntries(event);
                  const actorScopes = Array.isArray(event.actorScopes)
                    ? event.actorScopes.filter((scope) => scope.trim().length > 0)
                    : [];
                  return (
                  <li key={event.id} className={`${CARD_SURFACE} flex flex-wrap gap-4 text-scale-sm text-secondary`}
                  >
                    <div className="flex flex-wrap items-center gap-3 text-scale-xs text-muted">
                      <span className={`${EVENT_STATUS_BADGE[event.success ? 'success' : 'failure']} uppercase tracking-[0.2em]`}>
                        {event.success ? 'Success' : 'Failure'}
                      </span>
                      <span className="font-weight-semibold uppercase tracking-[0.2em] text-muted">
                        {formatActionLabel(event)}
                      </span>
                      <time className={STATUS_META} dateTime={event.createdAt}>
                        {formatInstant(event.createdAt)}
                      </time>
                    </div>
                    <p className="mt-2 text-scale-sm font-weight-medium text-primary">
                      {formatEventSummary(event)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-scale-xs text-muted">
                      <span>
                        Actor:{' '}
                        <span className={`${BADGE_PILL_MUTED} font-mono`}>
                          {event.actorId ?? 'system'}
                        </span>
                      </span>
                      {actorScopes.length > 0 && (
                        <span className="inline-flex flex-wrap items-center gap-1">
                          Scopes:
                          {actorScopes.map((scope) => (
                            <span key={`${event.id}-${scope}`} className={`${BADGE_PILL_MUTED} font-mono`}>
                              {scope}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                    {metadataEntries.length > 0 && (
                      <dl className="mt-3 grid gap-2 text-scale-sm text-secondary sm:grid-cols-2">
                        {metadataEntries.map((entry) => (
                          <div key={`${event.id}-${entry.label}`} className="flex flex-col gap-1">
                            <dt className={STATUS_META}>{entry.label}</dt>
                            <dd>
                              {entry.href ? (
                                <a href={entry.href} className="text-accent transition-colors hover:text-accent-strong">
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
            </div>
          )}

          {hasMore && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loadingMore}
                className={PRIMARY_BUTTON}
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

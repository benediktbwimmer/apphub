import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '../../components';
import type { DatasetAccessAuditEvent } from '../types';
import { formatInstant } from '../utils';
import { ROUTE_PATHS } from '../../routes/paths';
import {
  BADGE_PILL,
  BADGE_PILL_ACCENT,
  BADGE_PILL_DANGER,
  BADGE_PILL_INFO,
  BADGE_PILL_MUTED,
  BADGE_PILL_SUCCESS,
  CARD_SURFACE,
  CARD_SURFACE_SOFT,
  FOCUS_RING,
  PANEL_SURFACE_LARGE,
  SECONDARY_BUTTON_COMPACT,
  STATUS_BANNER_DANGER,
  STATUS_BANNER_WARNING,
  STATUS_MESSAGE,
  STATUS_META
} from '../timestoreTokens';

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

const STAGE_BADGES: Record<string, string> = {
  ingest: BADGE_PILL_SUCCESS,
  query: BADGE_PILL_INFO,
  lifecycle: BADGE_PILL_ACCENT
};

function stageBadgeClass(stage: string): string {
  return STAGE_BADGES[stage] ?? BADGE_PILL_MUTED;
}

function statusBadgeClass(success: boolean): string {
  return success ? BADGE_PILL_SUCCESS : BADGE_PILL_DANGER;
}

const PANEL_SHADOW = 'shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)]';
const RAW_METADATA_SURFACE = `${CARD_SURFACE_SOFT} overflow-x-auto font-mono text-scale-xs`;
const TIMELINE_METADATA = 'flex flex-wrap items-center gap-3 text-scale-xs text-muted';

function formatActionLabel(action: string): string {
  return action
    .split('.')
    .map((segment) =>
      segment
        .split(/[-_]/g)
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
    <section className={`${PANEL_SURFACE_LARGE} ${PANEL_SHADOW}`}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-accent">
            History
          </span>
          <h3 className="text-scale-base font-weight-semibold text-primary">
            Ingestion &amp; Query Timeline
          </h3>
          <p className={STATUS_MESSAGE}>
            Review recent ingest attempts, query executions, and lifecycle signals captured by the access audit API.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={!canView || loading}
            className={SECONDARY_BUTTON_COMPACT}
          >
            Refresh
          </button>
        </div>
      </header>

      {!canView ? (
        <p className={`mt-6 ${STATUS_MESSAGE}`}>
          Viewing audit history requires the <code className="font-mono text-secondary">timestore:admin</code> scope.
        </p>
      ) : (
        <>
          {error && (
            <div className={`mt-4 ${STATUS_BANNER_DANGER}`}>
              {error}
            </div>
          )}

          {loadMoreError && (
            <div className={`mt-4 ${STATUS_BANNER_WARNING}`}>
              {loadMoreError}
            </div>
          )}

          {loading && sortedEvents.length === 0 ? (
            <div className={`mt-6 ${STATUS_MESSAGE}`}>
              <Spinner label="Loading audit events" size="xs" />
            </div>
          ) : null}

          {!loading && sortedEvents.length === 0 && !error ? (
            <p className={`mt-6 ${STATUS_MESSAGE}`}>
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
                    className={`flex flex-wrap gap-4 ${CARD_SURFACE} text-scale-sm text-secondary`}
                  >
                    <div className="w-40 shrink-0 text-scale-xs font-weight-semibold text-muted">
                      {formatInstant(event.createdAt)}
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={stageBadgeClass(stage)}>{stageLabel}</span>
                        <span className={statusBadgeClass(event.success)}>
                          {event.success ? 'Success' : 'Failed'}
                        </span>
                        {metadataSummary.mode ? <span className={BADGE_PILL_MUTED}>{metadataSummary.mode}</span> : null}
                        {metadataSummary.duration ? <span className={BADGE_PILL}>{metadataSummary.duration}</span> : null}
                      </div>
                      <div className="text-scale-sm font-weight-semibold text-primary">{actionLabel}</div>
                      {actorLine ? <div className={STATUS_META}>{actorLine}</div> : null}
                      <div className={TIMELINE_METADATA}>
                        {metadataSummary.jobLink ? (
                          <Link
                            to={metadataSummary.jobLink.to}
                            className={`${BADGE_PILL_ACCENT} hover:bg-accent-soft ${FOCUS_RING}`}
                          >
                            {metadataSummary.jobLink.label}
                          </Link>
                        ) : null}
                        {metadataSummary.queueLink ? (
                          <Link
                            to={metadataSummary.queueLink.to}
                            className={`${BADGE_PILL_INFO} hover:bg-status-info-soft ${FOCUS_RING}`}
                          >
                            {metadataSummary.queueLink.label}
                          </Link>
                        ) : null}
                        {metadataSummary.manifestId ? (
                          <span className={BADGE_PILL_MUTED}>Manifest {metadataSummary.manifestId}</span>
                        ) : null}
                        {metadataSummary.ingestId ? (
                          <span className={BADGE_PILL_MUTED}>Batch {metadataSummary.ingestId}</span>
                        ) : null}
                      </div>
                      {metadataSummary.error ? (
                        <div className="text-scale-xs font-weight-semibold text-status-danger">
                          {metadataSummary.error}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => toggleExpanded(event.id)}
                        className={`text-scale-xs font-weight-semibold text-accent transition-colors hover:text-accent-strong ${FOCUS_RING}`}
                      >
                        {isExpanded ? 'Hide raw metadata' : 'Show raw metadata'}
                      </button>
                      {isExpanded ? (
                        <pre className={RAW_METADATA_SURFACE}>{serializeMetadata(event.metadata ?? {})}</pre>
                      ) : null}
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
                className={SECONDARY_BUTTON_COMPACT}
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

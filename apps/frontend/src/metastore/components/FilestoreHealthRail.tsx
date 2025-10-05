import classNames from 'classnames';
import { useCallback, useMemo } from 'react';
import { Spinner } from '../../components/Spinner';
import { usePollingResource } from '../../hooks/usePollingResource';
import { fetchFilestoreHealth } from '../api';
import type { MetastoreFilestoreHealth } from '../types';
import { formatInstant } from '../utils';
import {
  METASTORE_ALERT_ERROR_CLASSES,
  METASTORE_CARD_CONTAINER_CLASSES,
  METASTORE_FORM_FIELD_CONTAINER_CLASSES,
  METASTORE_META_TEXT_CLASSES,
  METASTORE_PRIMARY_BUTTON_SMALL_CLASSES,
  METASTORE_SECTION_LABEL_CLASSES,
  METASTORE_STATUS_DOT_CLASSES,
  METASTORE_STATUS_TONE_CLASSES
} from '../metastoreTokens';

type FilestoreHealthRailProps = {
  enabled: boolean;
  token: string | null;
};

type HealthSeverity = 'unknown' | 'disabled' | 'ok' | 'warn' | 'critical';

type SeverityDescriptor = {
  label: string;
  tone: 'neutral' | 'success' | 'warn' | 'error';
};

function computeSeverity(health: MetastoreFilestoreHealth | null): HealthSeverity {
  if (!health) {
    return 'unknown';
  }
  if (!health.enabled) {
    return 'disabled';
  }
  if (health.status === 'stalled') {
    return 'critical';
  }
  const threshold = Math.max(health.thresholdSeconds, 1);
  const lagSeconds = typeof health.lagSeconds === 'number' ? Math.max(health.lagSeconds, 0) : null;
  if (lagSeconds === null) {
    return 'ok';
  }
  if (lagSeconds >= threshold) {
    return 'critical';
  }
  if (lagSeconds >= threshold * 0.6) {
    return 'warn';
  }
  return 'ok';
}

function describeSeverity(severity: HealthSeverity): SeverityDescriptor {
  switch (severity) {
    case 'ok':
      return { label: 'Healthy', tone: 'success' } satisfies SeverityDescriptor;
    case 'warn':
      return { label: 'Lagging', tone: 'warn' } satisfies SeverityDescriptor;
    case 'critical':
      return { label: 'Stalled', tone: 'error' } satisfies SeverityDescriptor;
    case 'disabled':
      return { label: 'Disabled', tone: 'neutral' } satisfies SeverityDescriptor;
    case 'unknown':
    default:
      return { label: 'Unknown', tone: 'neutral' } satisfies SeverityDescriptor;
  }
}

function formatLagSeconds(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (!Number.isFinite(value) || value < 0) {
    return '—';
  }
  if (value < 1) {
    return `${Math.round(value * 1000) / 1000}s`;
  }
  if (value < 60) {
    return `${Math.round(value * 10) / 10}s`;
  }
  const minutes = value / 60;
  if (minutes < 60) {
    return `${Math.round(minutes * 10) / 10}m`;
  }
  const hours = minutes / 60;
  return `${Math.round(hours * 10) / 10}h`;
}

function formatPollTimestamp(value: number | null): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

export function FilestoreHealthRail({ enabled, token }: FilestoreHealthRailProps) {
  const fetcher = useCallback(
    async ({
      signal
    }: {
      authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
      signal: AbortSignal;
    }) =>
      fetchFilestoreHealth(token, { signal }),
    [token]
  );

  const { data: health, error, loading, lastUpdatedAt, refetch } = usePollingResource({
    fetcher,
    intervalMs: 20000,
    enabled,
    immediate: true
  });

  const severity = computeSeverity(health ?? null);
  const descriptor = describeSeverity(severity);
  const badgeToneClasses = METASTORE_STATUS_TONE_CLASSES[descriptor.tone];
  const badgeDotClasses = METASTORE_STATUS_DOT_CLASSES[descriptor.tone];

  const errorMessage = useMemo(() => {
    if (!error) {
      return null;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }, [error]);

  const observedAt = health?.lastEvent.observedAt ?? null;
  const receivedAt = health?.lastEvent.receivedAt ?? null;

  const retryTotals = health?.retries ?? null;

  return (
    <aside
      className={classNames(
        METASTORE_CARD_CONTAINER_CLASSES,
        'flex w-full shrink-0 flex-col gap-4'
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <h2 className="text-scale-sm font-weight-semibold text-primary">Filestore sync health</h2>
          <span className={METASTORE_META_TEXT_CLASSES}>
            Snapshot {formatPollTimestamp(lastUpdatedAt)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={classNames(
              'inline-flex items-center gap-2 rounded-full px-3 py-1 text-scale-xs font-weight-semibold uppercase tracking-[0.3em]',
              badgeToneClasses
            )}
          >
            <span className={classNames('h-2.5 w-2.5 rounded-full', badgeDotClasses)} />
            {descriptor.label}
          </span>
          <button
            type="button"
            onClick={() => {
              void refetch();
            }}
            className={METASTORE_PRIMARY_BUTTON_SMALL_CLASSES}
            disabled={!enabled || loading}
          >
            Refresh
          </button>
        </div>
      </header>

      {!enabled ? (
        <p className={METASTORE_META_TEXT_CLASSES}>
          Filestore polling is disabled without metastore access. Provide a token with <code className="font-mono text-[11px]">metastore:read</code> scope to view consumer health.
        </p>
      ) : null}

      {errorMessage && enabled ? (
        <div className={METASTORE_ALERT_ERROR_CLASSES}>{errorMessage}</div>
      ) : null}

      {loading && enabled && !health ? (
        <div className={classNames('flex items-center gap-2', METASTORE_META_TEXT_CLASSES)}>
          <Spinner size="sm" /> Loading health snapshot…
        </div>
      ) : null}

      {health ? (
        <section className="flex flex-col gap-4 text-scale-sm text-secondary">
          <div className={classNames(METASTORE_FORM_FIELD_CONTAINER_CLASSES, 'space-y-3')}>
            <h3 className={METASTORE_SECTION_LABEL_CLASSES}>Lag & thresholds</h3>
            <div className="grid grid-cols-2 gap-3 text-scale-sm">
              <div className="space-y-1">
                <div className={classNames('uppercase tracking-[0.25em]', METASTORE_META_TEXT_CLASSES)}>
                  Current lag
                </div>
                <div className="text-scale-lg font-weight-semibold text-primary">
                  {formatLagSeconds(health.lagSeconds)}
                </div>
              </div>
              <div className="space-y-1">
                <div className={classNames('uppercase tracking-[0.25em]', METASTORE_META_TEXT_CLASSES)}>
                  Stall threshold
                </div>
                <div className="text-scale-lg font-weight-semibold text-primary">
                  {formatLagSeconds(health.thresholdSeconds)}
                </div>
              </div>
            </div>
            <p className={METASTORE_META_TEXT_CLASSES}>
              {health.inline
                ? 'Consumer running inline; retries reflect local processing failures.'
                : 'Consumer running via Redis channel; retries reflect connection & processing backoff.'}
            </p>
          </div>

          <div className={classNames(METASTORE_FORM_FIELD_CONTAINER_CLASSES, 'space-y-3')}>
            <h3 className={METASTORE_SECTION_LABEL_CLASSES}>Last event</h3>
            <dl className="grid grid-cols-1 gap-2 text-scale-xs text-secondary">
              <div className="flex justify-between">
                <dt className={METASTORE_META_TEXT_CLASSES}>Type</dt>
                <dd>{health.lastEvent.type ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className={METASTORE_META_TEXT_CLASSES}>Observed at</dt>
                <dd>{formatInstant(observedAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className={METASTORE_META_TEXT_CLASSES}>Received at</dt>
                <dd>{formatInstant(receivedAt)}</dd>
              </div>
            </dl>
          </div>

          <div className={classNames(METASTORE_FORM_FIELD_CONTAINER_CLASSES, 'space-y-3')}>
            <h3 className={METASTORE_SECTION_LABEL_CLASSES}>Retry counters</h3>
            <dl className="grid grid-cols-3 gap-2 text-scale-xs text-secondary">
              <div className={classNames(METASTORE_FORM_FIELD_CONTAINER_CLASSES, 'space-y-2 text-center')}>
                <dt className={classNames('text-[10px] uppercase tracking-[0.25em]', METASTORE_META_TEXT_CLASSES)}>
                  Connect
                </dt>
                <dd className="text-scale-base font-weight-semibold text-primary">
                  {retryTotals?.connect ?? 0}
                </dd>
              </div>
              <div className={classNames(METASTORE_FORM_FIELD_CONTAINER_CLASSES, 'space-y-2 text-center')}>
                <dt className={classNames('text-[10px] uppercase tracking-[0.25em]', METASTORE_META_TEXT_CLASSES)}>
                  Processing
                </dt>
                <dd className="text-scale-base font-weight-semibold text-primary">
                  {retryTotals?.processing ?? 0}
                </dd>
              </div>
              <div className={classNames(METASTORE_FORM_FIELD_CONTAINER_CLASSES, 'space-y-2 text-center')}>
                <dt className={classNames('text-[10px] uppercase tracking-[0.25em]', METASTORE_META_TEXT_CLASSES)}>
                  Total
                </dt>
                <dd className="text-scale-base font-weight-semibold text-primary">
                  {retryTotals?.total ?? 0}
                </dd>
              </div>
            </dl>
          </div>
        </section>
      ) : null}
    </aside>
  );
}

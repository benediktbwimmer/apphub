import { useCallback, useMemo } from 'react';
import { Spinner } from '../../components/Spinner';
import { usePollingResource } from '../../hooks/usePollingResource';
import { fetchFilestoreHealth } from '../api';
import type { MetastoreFilestoreHealth } from '../types';
import { formatInstant } from '../utils';

type FilestoreHealthRailProps = {
  enabled: boolean;
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

function toneBadgeClasses(descriptor: SeverityDescriptor): string {
  switch (descriptor.tone) {
    case 'success':
      return 'bg-emerald-500';
    case 'warn':
      return 'bg-amber-500';
    case 'error':
      return 'bg-rose-500';
    case 'neutral':
    default:
      return 'bg-slate-400';
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

export function FilestoreHealthRail({ enabled }: FilestoreHealthRailProps) {
  const fetcher = useCallback(
    async ({
      authorizedFetch,
      signal
    }: {
      authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
      signal: AbortSignal;
    }) =>
      fetchFilestoreHealth(authorizedFetch, { signal }),
    []
  );

  const { data: health, error, loading, lastUpdatedAt, refetch } = usePollingResource({
    fetcher,
    intervalMs: 20000,
    enabled,
    immediate: true
  });

  const severity = computeSeverity(health ?? null);
  const descriptor = describeSeverity(severity);
  const badgeClass = toneBadgeClasses(descriptor);

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
    <aside className="flex w-full shrink-0 flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-[0_25px_60px_-35px_rgba(15,23,42,0.45)] backdrop-blur-md dark:border-slate-700/60 dark:bg-slate-900/70">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Filestore sync health</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Snapshot {formatPollTimestamp(lastUpdatedAt)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <span className={`h-2.5 w-2.5 rounded-full ${badgeClass}`} />
            {descriptor.label}
          </span>
          <button
            type="button"
            onClick={() => {
              void refetch();
            }}
            className="rounded-full border border-slate-200/70 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-800"
            disabled={!enabled || loading}
          >
            Refresh
          </button>
        </div>
      </header>

      {!enabled ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Filestore polling is disabled without metastore access. Provide a token with <code className="font-mono text-[11px]">metastore:read</code>{' '}
          scope to view consumer health.
        </p>
      ) : null}

      {errorMessage && enabled ? (
        <div className="rounded-xl border border-rose-300/70 bg-rose-50/80 px-3 py-2 text-xs text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
          {errorMessage}
        </div>
      ) : null}

      {loading && enabled && !health ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Spinner size="sm" /> Loading health snapshot…
        </div>
      ) : null}

      {health ? (
        <section className="flex flex-col gap-4 text-sm text-slate-700 dark:text-slate-200">
          <div className="rounded-2xl border border-slate-200/70 bg-white/70 p-4 dark:border-slate-700/60 dark:bg-slate-900/60">
            <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
              Lag & thresholds
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[11px] uppercase tracking-[0.25em] text-slate-400 dark:text-slate-500">
                  Current lag
                </div>
                <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {formatLagSeconds(health.lagSeconds)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.25em] text-slate-400 dark:text-slate-500">
                  Stall threshold
                </div>
                <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {formatLagSeconds(health.thresholdSeconds)}
                </div>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {health.inline
                ? 'Consumer running inline; retries reflect local processing failures.'
                : 'Consumer running via Redis channel; retries reflect connection & processing backoff.'}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-white/70 p-4 dark:border-slate-700/60 dark:bg-slate-900/60">
            <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
              Last event
            </h3>
            <dl className="mt-2 grid grid-cols-1 gap-2 text-xs text-slate-600 dark:text-slate-300">
              <div className="flex justify-between">
                <dt className="font-semibold text-slate-500 dark:text-slate-400">Type</dt>
                <dd>{health.lastEvent.type ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="font-semibold text-slate-500 dark:text-slate-400">Observed at</dt>
                <dd>{formatInstant(observedAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="font-semibold text-slate-500 dark:text-slate-400">Received at</dt>
                <dd>{formatInstant(receivedAt)}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-white/70 p-4 dark:border-slate-700/60 dark:bg-slate-900/60">
            <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
              Retry counters
            </h3>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-600 dark:text-slate-300">
              <div className="rounded-xl border border-slate-200/60 bg-white/70 p-2 text-center dark:border-slate-700/50 dark:bg-slate-900/40">
                <dt className="font-semibold text-[10px] uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">
                  Connect
                </dt>
                <dd className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {retryTotals?.connect ?? 0}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-200/60 bg-white/70 p-2 text-center dark:border-slate-700/50 dark:bg-slate-900/40">
                <dt className="font-semibold text-[10px] uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">
                  Processing
                </dt>
                <dd className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {retryTotals?.processing ?? 0}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-200/60 bg-white/70 p-2 text-center dark:border-slate-700/50 dark:bg-slate-900/40">
                <dt className="font-semibold text-[10px] uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">
                  Total
                </dt>
                <dd className="text-base font-semibold text-slate-900 dark:text-slate-100">
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
